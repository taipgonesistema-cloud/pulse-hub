import {
  BadRequestException,
  Injectable,
  Logger,
  MessageEvent,
  NotFoundException,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import path from 'node:path';
import fs from 'node:fs';
import QRCode from 'qrcode';
import { Observable, Subject, filter, map } from 'rxjs';
import { Client, LocalAuth, type Message } from 'whatsapp-web.js';
import {
  type ConversationRecord,
  type MessageRecord,
  type SessionRecord,
} from '../data/mock-data';
import type {
  CreateWhatsappSessionDto,
  SendConversationMessageDto,
} from './dto/create-session.dto';
import { RedisService } from '../persistence/redis.service';
import type { DashboardOverview, SessionQrPayload } from './whatsapp.types';
import { WhatsappStore } from './whatsapp.store';

const DASHBOARD_OVERVIEW_CACHE_KEY = 'pulse-hub:dashboard:overview';
const WHATSAPP_EVENTS_CHANNEL = 'pulse-hub:whatsapp:events';

@Injectable()
export class WhatsappService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WhatsappService.name);
  private readonly clients = new Map<string, Client>();
  private readonly browserExecutablePath = this.resolveBrowserExecutablePath();
  private readonly isHeadless = process.env.PUPPETEER_HEADLESS !== 'false';
  private readonly events$ = new Subject<WhatsappStreamEvent>();

  constructor(
    private readonly store: WhatsappStore,
    private readonly redis: RedisService,
  ) {}

  async onModuleInit() {
    await this.redis.subscribe<WhatsappStreamEvent>(
      WHATSAPP_EVENTS_CHANNEL,
      (event) => {
        this.events$.next(event);
      },
    );

    const persistedSessions = (await this.store.getSessions()).filter(
      (session) => !session.isDemo,
    );

    for (const session of persistedSessions) {
      await this.store.saveSession({
        ...session,
        status: 'disconnected',
        qrCode: null,
        qrCodeDataUrl: null,
        lastError: null,
        lastHeartbeat: new Date().toISOString(),
      });

      void this.connectSession(session.id).catch((error: unknown) => {
        const message =
          error instanceof Error ? error.message : 'Falha ao restaurar sessao.';
        this.logger.warn(
          `Nao foi possivel restaurar ${session.id}: ${message}`,
        );
      });
    }
  }

  async getOverview(): Promise<DashboardOverview> {
    const cached = await this.redis.getJson<DashboardOverview>(
      DASHBOARD_OVERVIEW_CACHE_KEY,
    );

    if (cached) {
      return cached;
    }

    const sessions = await this.store.getSessions();
    const conversations = await this.store.getAllConversations();

    const overview = {
      product: 'Pulse Hub',
      phase: 'whatsapp-core',
      metrics: {
        connectedNumbers: sessions.length,
        activeSessions: sessions.filter(
          (session) => session.status === 'active',
        ).length,
        onlineUsers: sessions.reduce(
          (sum, session) => sum + session.attendants,
          0,
        ),
        waitingConversations: sessions.reduce(
          (sum, session) => sum + session.waiting,
          0,
        ),
      },
      channels: await this.store.getChannels(),
      sessions,
      conversations,
    };

    await this.redis.setJson(DASHBOARD_OVERVIEW_CACHE_KEY, overview, 15);
    return overview;
  }

  async getSessions() {
    return this.store.getSessions();
  }

  streamSession(sessionId: string): Observable<MessageEvent> {
    return this.events$.pipe(
      filter((event) => event.sessionId === sessionId),
      map((event) => ({ data: event })),
    );
  }

  async getSessionQr(sessionId: string): Promise<SessionQrPayload> {
    const session = await this.getSessionOrFail(sessionId);

    return {
      session,
      qr: {
        code: session.qrCode,
        imageDataUrl: session.qrCodeDataUrl,
        expiresInSeconds: session.status === 'qr_ready' ? 40 : 0,
      },
    };
  }

  async getConversations(sessionId: string) {
    await this.getSessionOrFail(sessionId);
    return this.store.getConversationsBySession(sessionId);
  }

  async markConversationAsRead(sessionId: string, conversationId: string) {
    const session = await this.getSessionOrFail(sessionId);
    const conversation = await this.store.getConversation(
      sessionId,
      conversationId,
    );

    if (!conversation) {
      throw new NotFoundException('Conversa nao encontrada.');
    }

    if (!session.isDemo && session.status === 'active') {
      const client = this.clients.get(sessionId);

      if (client) {
        try {
          await client.sendSeen(conversation.participantId);
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : 'Falha ao marcar como lida.';
          this.logger.warn(
            `Nao foi possivel marcar como lida ${conversationId}: ${message}`,
          );
        }
      }
    }

    const updatedConversation = await this.store.markConversationAsRead(
      sessionId,
      conversationId,
    );

    if (updatedConversation?.unread !== conversation.unread) {
      await this.invalidateOverviewCache();
      void this.emitEvent({
        sessionId,
        conversationId,
        type: 'conversation.synced',
      });
    }

    return updatedConversation ?? conversation;
  }

  async getMessages(sessionId: string, conversationId: string) {
    const conversation = await this.store.getConversation(
      sessionId,
      conversationId,
    );

    if (!conversation) {
      throw new NotFoundException('Conversa nao encontrada.');
    }

    if (conversation.messages.length === 0 || !conversation.avatarUrl) {
      await this.loadConversationMessages(sessionId, conversationId);
    }

    const refreshedConversation = await this.store.getConversation(
      sessionId,
      conversationId,
    );

    if (!refreshedConversation) {
      throw new NotFoundException('Conversa nao encontrada.');
    }

    const readConversation = await this.markConversationAsRead(
      sessionId,
      conversationId,
    );

    return (readConversation ?? refreshedConversation).messages;
  }

  async createSession(payload: CreateWhatsappSessionDto) {
    const name = payload.name.trim();
    const phoneNumber = payload.phoneNumber.trim();
    const channelName = payload.channelName.trim();

    if (!name || !phoneNumber || !channelName) {
      throw new BadRequestException('Nome, numero e canal sao obrigatorios.');
    }

    const session: SessionRecord = {
      id: this.createId('session'),
      name,
      phoneNumber,
      channelId: this.createId('channel'),
      channelName,
      status: 'idle',
      attendants: 0,
      waiting: 0,
      unread: 0,
      lastHeartbeat: new Date().toISOString(),
      isDemo: false,
      qrCode: null,
      qrCodeDataUrl: null,
      lastError: null,
    };

    const created = await this.store.saveSession(session);
    await this.invalidateOverviewCache();
    return created;
  }

  async connectSession(sessionId: string) {
    const session = await this.getSessionOrFail(sessionId);

    if (session.isDemo) {
      const updated = await this.store.saveSession({
        ...session,
        status: 'qr_ready',
        qrCode: `demo-qr-${session.id}`,
        qrCodeDataUrl: await QRCode.toDataURL(`demo-qr-${session.id}`),
        lastHeartbeat: new Date().toISOString(),
      });

      await this.invalidateOverviewCache();
      void this.emitEvent({ sessionId, type: 'session.updated' });
      return updated;
    }

    if (this.clients.has(sessionId)) {
      return this.getSessionOrFail(sessionId);
    }

    this.cleanupSessionLocks(sessionId);

    const client = new Client({
      authStrategy: new LocalAuth({
        clientId: sessionId,
        dataPath: path.join(process.cwd(), '.wwebjs_auth'),
      }),
      takeoverOnConflict: true,
      takeoverTimeoutMs: 0,
      qrMaxRetries: 10,
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
      deviceName: 'Pulse Hub',
      browserName: 'Chrome',
      puppeteer: {
        executablePath: this.browserExecutablePath,
        headless: this.isHeadless,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-blink-features=AutomationControlled',
          '--disable-features=IsolateOrigins,site-per-process',
        ],
      },
    });

    this.logger.log(
      `Iniciando sessao ${sessionId} com browser ${this.browserExecutablePath ?? 'padrao do Puppeteer'} e headless=${String(this.isHeadless)}`,
    );

    this.clients.set(sessionId, client);
    await this.store.saveSession({
      ...session,
      status: 'initializing',
      lastError: null,
      lastHeartbeat: new Date().toISOString(),
    });
    await this.invalidateOverviewCache();
    void this.emitEvent({ sessionId, type: 'session.updated' });

    this.bindClientEvents(sessionId, client);

    void client.initialize().catch(async (error: unknown) => {
      const message =
        error instanceof Error ? error.message : 'Falha ao inicializar sessao.';

      this.logger.error(`Falha ao conectar sessao ${sessionId}: ${message}`);
      this.clients.delete(sessionId);
      await this.store.saveSession({
        ...(await this.getSessionOrFail(sessionId)),
        status: 'error',
        lastError: message,
        lastHeartbeat: new Date().toISOString(),
      });
      await this.invalidateOverviewCache();
      void this.emitEvent({ sessionId, type: 'session.updated' });
    });

    return this.getSessionOrFail(sessionId);
  }

  async disconnectSession(sessionId: string) {
    const session = await this.getSessionOrFail(sessionId);
    const client = this.clients.get(sessionId);

    if (client) {
      await client.destroy();
      this.clients.delete(sessionId);
    }

    const updatedSession = await this.store.saveSession({
      ...session,
      status: 'disconnected',
      qrCode: null,
      qrCodeDataUrl: null,
      lastHeartbeat: new Date().toISOString(),
    });

    await this.invalidateOverviewCache();
    void this.emitEvent({ sessionId, type: 'session.updated' });
    return updatedSession;
  }

  async sendMessage(
    sessionId: string,
    conversationId: string,
    payload: SendConversationMessageDto,
  ) {
    const conversation = await this.store.getConversation(
      sessionId,
      conversationId,
    );

    if (!conversation) {
      throw new NotFoundException('Conversa nao encontrada.');
    }

    const body = payload.body.trim();

    if (!body) {
      throw new BadRequestException('Mensagem vazia.');
    }

    const session = await this.getSessionOrFail(sessionId);

    if (!session.isDemo) {
      const client = this.clients.get(sessionId);

      if (!client || session.status !== 'active') {
        throw new BadRequestException('Sessao ainda nao esta conectada.');
      }

      await client.sendMessage(conversation.participantId, body);
    }

    const message: MessageRecord = {
      id: this.createId('message'),
      conversationId,
      direction: 'outgoing',
      body,
      timestamp: new Date().toISOString(),
      author: payload.author?.trim() || 'Operador',
    };

    const updatedConversation = await this.store.appendMessage(
      sessionId,
      conversationId,
      message,
    );

    await this.invalidateOverviewCache();
    void this.emitEvent({
      sessionId,
      conversationId,
      type: 'message.created',
      direction: 'outgoing',
    });

    return updatedConversation;
  }

  async onModuleDestroy() {
    const clients = [...this.clients.values()];
    await Promise.allSettled(clients.map(async (client) => client.destroy()));
    this.clients.clear();
  }

  private bindClientEvents(sessionId: string, client: Client) {
    client.on('qr', (qr) => {
      this.logger.log(
        `[SESSION ${sessionId}] QR Code recebido. Usuário precisa escanear.`,
      );
      void this.updateQrPayload(sessionId, qr);
    });

    client.on('authenticated', () => {
      void (async () => {
        this.logger.log(`[SESSION ${sessionId}] Autenticado com sucesso.`);
        const session = await this.getSessionOrFail(sessionId);
        await this.store.saveSession({
          ...session,
          status: 'syncing',
          lastError: null,
          lastHeartbeat: new Date().toISOString(),
        });
        await this.invalidateOverviewCache();
        await this.emitEvent({ sessionId, type: 'session.updated' });
      })();
    });

    client.on('ready', () => {
      void (async () => {
        this.logger.log(`[SESSION ${sessionId}] Cliente pronto e conectado.`);
        const session = await this.getSessionOrFail(sessionId);
        await this.store.saveSession({
          ...session,
          status: 'active',
          qrCode: null,
          qrCodeDataUrl: null,
          lastHeartbeat: new Date().toISOString(),
        });
        await this.invalidateOverviewCache();
        await this.emitEvent({ sessionId, type: 'session.updated' });

        await this.bootstrapChats(sessionId, client);
      })();
    });

    client.on('auth_failure', (message) => {
      void (async () => {
        this.logger.error(
          `[SESSION ${sessionId}] Falha na autenticação: ${message}`,
        );
        const session = await this.getSessionOrFail(sessionId);
        await this.store.saveSession({
          ...session,
          status: 'error',
          lastError: message,
          lastHeartbeat: new Date().toISOString(),
        });
        await this.invalidateOverviewCache();
        await this.emitEvent({ sessionId, type: 'session.updated' });
      })();
    });

    client.on('disconnected', (reason) => {
      void (async () => {
        this.logger.warn(
          `[SESSION ${sessionId}] Desconectado: ${String(reason)}`,
        );
        const session = await this.getSessionOrFail(sessionId);
        await this.store.saveSession({
          ...session,
          status: 'disconnected',
          qrCode: null,
          qrCodeDataUrl: null,
          lastError: typeof reason === 'string' ? reason : null,
          lastHeartbeat: new Date().toISOString(),
        });
        await this.invalidateOverviewCache();
        await this.emitEvent({ sessionId, type: 'session.updated' });
        this.clients.delete(sessionId);
      })();
    });

    client.on('message', (message) => {
      this.logger.debug(
        `[SESSION ${sessionId}] Nova mensagem recebida de ${message.from}`,
      );
      void this.ingestIncomingMessage(sessionId, message);
    });
  }

  private async updateQrPayload(sessionId: string, qr: string) {
    const session = await this.getSessionOrFail(sessionId);

    await this.store.saveSession({
      ...session,
      status: 'qr_ready',
      qrCode: qr,
      qrCodeDataUrl: await QRCode.toDataURL(qr),
      lastError: null,
      lastHeartbeat: new Date().toISOString(),
    });
    await this.invalidateOverviewCache();
    void this.emitEvent({ sessionId, type: 'session.updated' });
  }

  private async bootstrapChats(sessionId: string, client: Client) {
    const existing = await this.store.getConversationsBySession(sessionId);

    if (existing.length > 0) {
      return;
    }

    const session = await this.getSessionOrFail(sessionId);
    const chats = await client.getChats();
    const candidates = chats
      .filter(
        (chat) =>
          !chat.isGroup && !this.shouldIgnoreChatId(chat.id._serialized),
      )
      .slice(0, 8);

    for (const [index, chat] of candidates.entries()) {
      const avatarUrl = await this.resolveChatAvatar(
        client,
        chat.id._serialized,
      );

      const conversation: ConversationRecord = {
        id: chat.id._serialized,
        sessionId,
        sessionName: session.name,
        contact: chat.name || chat.id.user || `Contato ${index + 1}`,
        avatarUrl,
        participantId: chat.id._serialized,
        owner: 'Livre',
        status: 'Fila geral',
        channelName: session.channelName,
        waitingTime: 'agora',
        unread: chat.unreadCount,
        preview: chat.lastMessage?.body || 'Conversa sincronizada.',
        lastMessageAt: new Date().toISOString(),
        messages: [],
      };

      await this.store.saveConversation(conversation);
    }

    await this.invalidateOverviewCache();
    void this.emitEvent({ sessionId, type: 'conversation.synced' });
  }

  private async loadConversationMessages(
    sessionId: string,
    conversationId: string,
  ) {
    const session = await this.getSessionOrFail(sessionId);
    const conversation = await this.store.getConversation(
      sessionId,
      conversationId,
    );

    if (!conversation || session.status !== 'active') {
      return conversation;
    }

    const client = this.clients.get(sessionId);

    if (!client) {
      return conversation;
    }

    try {
      const chat = await client.getChatById(conversation.participantId);
      const messages = await chat.fetchMessages({ limit: 40 });

      const avatarUrl =
        conversation.avatarUrl ??
        (await this.resolveChatAvatar(client, conversation.participantId));

      const normalizedMessages: MessageRecord[] = messages
        .map((message) => ({
          id: message.id.id,
          conversationId,
          direction: message.fromMe
            ? ('outgoing' as const)
            : ('incoming' as const),
          body: message.body || '[midia]',
          timestamp: new Date(message.timestamp * 1000).toISOString(),
          author: message.fromMe
            ? 'Operador'
            : chat.name || conversation.contact,
        }))
        .sort((left, right) => left.timestamp.localeCompare(right.timestamp));

      const lastMessage = normalizedMessages.at(-1);
      const updatedConversation: ConversationRecord = {
        ...conversation,
        avatarUrl,
        preview: lastMessage?.body || conversation.preview,
        lastMessageAt: lastMessage?.timestamp || conversation.lastMessageAt,
        messages: normalizedMessages,
      };

      await this.store.saveConversation(updatedConversation);
      await this.invalidateOverviewCache();
      return updatedConversation;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Falha ao carregar mensagens.';
      this.logger.warn(
        `Nao foi possivel carregar mensagens da conversa ${conversationId}: ${message}`,
      );
      return conversation;
    }
  }

  private async ingestIncomingMessage(sessionId: string, message: Message) {
    const session = await this.getSessionOrFail(sessionId);
    const chat = await message.getChat();

    if (this.shouldIgnoreChatId(chat.id._serialized)) {
      return;
    }

    const contact = await message.getContact();
    const conversationId = chat.id._serialized;
    const existing = await this.store.getConversation(
      sessionId,
      conversationId,
    );
    const avatarUrl = await this.resolveContactAvatar(
      clientSafeGet(this.clients, sessionId),
      contact.id._serialized,
    );

    if (!existing) {
      await this.store.saveConversation({
        id: conversationId,
        sessionId,
        sessionName: session.name,
        contact:
          contact.pushname ||
          contact.name ||
          contact.number ||
          'Contato WhatsApp',
        avatarUrl,
        participantId: conversationId,
        owner: 'Livre',
        status: 'Fila geral',
        channelName: session.channelName,
        waitingTime: 'agora',
        unread: 0,
        preview: message.body,
        lastMessageAt: new Date(message.timestamp * 1000).toISOString(),
        messages: [],
      });
    } else if (avatarUrl && existing.avatarUrl !== avatarUrl) {
      await this.store.saveConversation({
        ...existing,
        avatarUrl,
      });
    }

    const payload: MessageRecord = {
      id: message.id.id,
      conversationId,
      direction: message.fromMe ? 'outgoing' : 'incoming',
      body: message.body,
      timestamp: new Date(message.timestamp * 1000).toISOString(),
      author: message.fromMe
        ? 'Operador'
        : contact.pushname || contact.name || 'Contato',
    };

    await this.store.appendMessage(sessionId, conversationId, payload);
    await this.invalidateOverviewCache();

    const streamDirection =
      payload.direction === 'incoming' || payload.direction === 'outgoing'
        ? payload.direction
        : undefined;

    void this.emitEvent({
      sessionId,
      conversationId,
      type: 'typing.started',
      direction: streamDirection,
    });
    void this.emitEvent({
      sessionId,
      conversationId,
      type: 'message.created',
      direction: streamDirection,
    });
  }

  private async getSessionOrFail(sessionId: string) {
    const session = await this.store.getSession(sessionId);

    if (!session) {
      throw new NotFoundException('Sessao nao encontrada.');
    }

    return session;
  }

  private createId(prefix: string) {
    return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
  }

  private async emitEvent(event: WhatsappStreamEvent) {
    await this.redis.publish(WHATSAPP_EVENTS_CHANNEL, {
      ...event,
      emittedAt: new Date().toISOString(),
    });
  }

  private async invalidateOverviewCache() {
    await this.redis.delete(DASHBOARD_OVERVIEW_CACHE_KEY);
  }

  private resolveBrowserExecutablePath() {
    const configuredPath = process.env.PUPPETEER_EXECUTABLE_PATH?.trim();

    if (configuredPath) {
      if (fs.existsSync(configuredPath)) {
        return configuredPath;
      }

      this.logger.warn(
        `PUPPETEER_EXECUTABLE_PATH configurado mas nao encontrado: ${configuredPath}`,
      );
    }

    const candidates = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/google-chrome',
      path.join(
        process.env.USERPROFILE ?? 'C:\\Users\\Desktop',
        '.cache',
        'puppeteer',
        'chrome',
        'win64-146.0.7680.153',
        'chrome-win64',
        'chrome.exe',
      ),
    ];

    const match = candidates.find((candidate) => fs.existsSync(candidate));

    if (!match) {
      this.logger.warn(
        'Nenhum executavel do Chrome foi encontrado; usando padrao do Puppeteer.',
      );
      return undefined;
    }

    return match;
  }

  private cleanupSessionLocks(sessionId: string) {
    const lockPaths = [
      path.join(
        process.cwd(),
        '.wwebjs_auth',
        `session-${sessionId}`,
        'Default',
        'LOCK',
      ),
      path.join(
        process.cwd(),
        '.wwebjs_auth',
        `session-${sessionId}`,
        'Default',
        'SingletonLock',
      ),
      path.join(
        process.cwd(),
        '.wwebjs_auth',
        `session-${sessionId}`,
        'Default',
        'SingletonCookie',
      ),
      path.join(
        process.cwd(),
        '.wwebjs_auth',
        `session-${sessionId}`,
        'Default',
        'SingletonSocket',
      ),
    ];

    lockPaths.forEach((lockPath) => {
      if (!fs.existsSync(lockPath)) {
        return;
      }

      try {
        fs.rmSync(lockPath, { force: true });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Falha ao remover lock.';
        this.logger.warn(
          `Nao foi possivel limpar lock da sessao ${sessionId}: ${message}`,
        );
      }
    });
  }

  private async resolveChatAvatar(client: Client, chatId: string) {
    try {
      if (this.shouldIgnoreChatId(chatId)) {
        return null;
      }

      this.logger.debug(`Buscando avatar para chat: ${chatId}`);
      const url = await client.getProfilePicUrl(chatId);
      this.logger.debug(`URL do avatar encontrada: ${url}`);
      return url;
    } catch (error) {
      this.logger.debug(
        `Falha ao buscar avatar para ${chatId}: ${error instanceof Error ? error.message : 'Erro desconhecido'}`,
      );
      return null;
    }
  }

  private async resolveContactAvatar(client: Client | null, contactId: string) {
    if (!client) {
      return null;
    }

    try {
      if (this.shouldIgnoreChatId(contactId)) {
        return null;
      }

      this.logger.debug(`Buscando avatar para contato: ${contactId}`);
      const url = await client.getProfilePicUrl(contactId);
      this.logger.debug(`URL do avatar encontrada: ${url}`);
      return url;
    } catch (error) {
      this.logger.debug(
        `Falha ao buscar avatar para ${contactId}: ${error instanceof Error ? error.message : 'Erro desconhecido'}`,
      );
      return null;
    }
  }

  private shouldIgnoreChatId(chatId: string) {
    return chatId.endsWith('@broadcast') || chatId.includes('@newsletter');
  }
}

function clientSafeGet(clients: Map<string, Client>, sessionId: string) {
  return clients.get(sessionId) ?? null;
}

type WhatsappStreamEvent = {
  sessionId: string;
  conversationId?: string;
  type:
    | 'session.updated'
    | 'conversation.synced'
    | 'message.created'
    | 'typing.started';
  direction?: 'incoming' | 'outgoing';
  emittedAt?: string;
};
