import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  MessageEvent,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import QRCode from 'qrcode';
import { Observable, Subject, filter, map } from 'rxjs';
import {
  type ConversationRecord,
  type MessageRecord,
  type SessionRecord,
} from '../data/mock-data';
import { RedisService } from '../persistence/redis.service';
import { WHATSAPP_ENGINE } from './engine/whatsapp-engine.token';
import type { WhatsappEngine } from './engine/whatsapp-engine.interface';
import type { WhatsappEngineMessage } from './engine/whatsapp-engine.types';
import type {
  CreateWhatsappSessionDto,
  SendConversationMessageDto,
} from './dto/create-session.dto';
import type { DashboardOverview, SessionQrPayload } from './whatsapp.types';
import { WhatsappStore } from './whatsapp.store';

const DASHBOARD_OVERVIEW_CACHE_KEY = 'pulse-hub:dashboard:overview';
const WHATSAPP_EVENTS_CHANNEL = 'pulse-hub:whatsapp:events';

@Injectable()
export class WhatsappService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WhatsappService.name);
  private readonly events$ = new Subject<WhatsappStreamEvent>();

  constructor(
    private readonly store: WhatsappStore,
    private readonly redis: RedisService,
    @Inject(WHATSAPP_ENGINE) private readonly engine: WhatsappEngine,
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

    if (
      !session.isDemo &&
      session.status === 'active' &&
      this.engine.hasSessionClient(sessionId)
    ) {
      try {
        await this.engine.markConversationAsRead(
          sessionId,
          conversation.participantId,
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Falha ao marcar como lida.';
        this.logger.warn(
          `Nao foi possivel marcar como lida ${conversationId}: ${message}`,
        );
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

    if (this.engine.hasSessionClient(sessionId)) {
      return this.getSessionOrFail(sessionId);
    }

    await this.store.saveSession({
      ...session,
      status: 'initializing',
      lastError: null,
      lastHeartbeat: new Date().toISOString(),
    });
    await this.invalidateOverviewCache();
    void this.emitEvent({ sessionId, type: 'session.updated' });

    await this.engine.connectSession(sessionId, {
      onQr: (qr) => this.updateQrPayload(sessionId, qr),
      onAuthenticated: () => this.handleSessionAuthenticated(sessionId),
      onReady: () => this.handleSessionReady(sessionId),
      onAuthFailure: (message) =>
        this.handleSessionAuthFailure(sessionId, message),
      onDisconnected: (reason) =>
        this.handleSessionDisconnected(sessionId, reason),
      onMessage: (message) => this.ingestIncomingMessage(sessionId, message),
      onInitError: (message) => this.handleSessionInitError(sessionId, message),
    });

    return this.getSessionOrFail(sessionId);
  }

  async disconnectSession(sessionId: string) {
    const session = await this.getSessionOrFail(sessionId);
    await this.engine.disconnectSession(sessionId);

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
      if (
        !this.engine.hasSessionClient(sessionId) ||
        session.status !== 'active'
      ) {
        throw new BadRequestException('Sessao ainda nao esta conectada.');
      }

      await this.engine.sendMessage(
        sessionId,
        conversation.participantId,
        body,
      );
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
    await this.engine.destroyAll();
  }

  private async updateQrPayload(sessionId: string, qr: string) {
    const session = await this.getSessionOrFail(sessionId);
    const isQrImageDataUrl = qr.startsWith('data:image');

    await this.store.saveSession({
      ...session,
      status: 'qr_ready',
      qrCode: isQrImageDataUrl ? null : qr,
      qrCodeDataUrl: isQrImageDataUrl ? qr : await QRCode.toDataURL(qr),
      lastError: null,
      lastHeartbeat: new Date().toISOString(),
    });
    await this.invalidateOverviewCache();
    void this.emitEvent({ sessionId, type: 'session.updated' });
  }

  private async handleSessionAuthenticated(sessionId: string) {
    const session = await this.getSessionOrFail(sessionId);
    await this.store.saveSession({
      ...session,
      status: 'syncing',
      lastError: null,
      lastHeartbeat: new Date().toISOString(),
    });
    await this.invalidateOverviewCache();
    await this.emitEvent({ sessionId, type: 'session.updated' });
  }

  private async handleSessionReady(sessionId: string) {
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
    await this.bootstrapChats(sessionId);
  }

  private async handleSessionAuthFailure(sessionId: string, message: string) {
    const session = await this.getSessionOrFail(sessionId);
    await this.store.saveSession({
      ...session,
      status: 'error',
      lastError: message,
      lastHeartbeat: new Date().toISOString(),
    });
    await this.invalidateOverviewCache();
    await this.emitEvent({ sessionId, type: 'session.updated' });
  }

  private async handleSessionDisconnected(
    sessionId: string,
    reason: string | null,
  ) {
    const session = await this.getSessionOrFail(sessionId);
    await this.store.saveSession({
      ...session,
      status: 'disconnected',
      qrCode: null,
      qrCodeDataUrl: null,
      lastError: reason,
      lastHeartbeat: new Date().toISOString(),
    });
    await this.invalidateOverviewCache();
    await this.emitEvent({ sessionId, type: 'session.updated' });
  }

  private async handleSessionInitError(sessionId: string, message: string) {
    const session = await this.getSessionOrFail(sessionId);
    await this.store.saveSession({
      ...session,
      status: 'error',
      lastError: message,
      lastHeartbeat: new Date().toISOString(),
    });
    await this.invalidateOverviewCache();
    await this.emitEvent({ sessionId, type: 'session.updated' });
  }

  private async bootstrapChats(sessionId: string) {
    const existing = await this.store.getConversationsBySession(sessionId);

    if (existing.length > 0) {
      return;
    }

    const session = await this.getSessionOrFail(sessionId);
    const chats = await this.engine.listChats(sessionId);
    const candidates = chats
      .filter((chat) => !chat.isGroup && !this.shouldIgnoreChatId(chat.id))
      .slice(0, 8);

    for (const [index, chat] of candidates.entries()) {
      const avatarUrl = await this.resolveParticipantAvatar(sessionId, chat.id);

      const conversation: ConversationRecord = {
        id: chat.id,
        sessionId,
        sessionName: session.name,
        contact: chat.name || `Contato ${index + 1}`,
        avatarUrl,
        participantId: chat.id,
        owner: 'Livre',
        status: 'Fila geral',
        channelName: session.channelName,
        waitingTime: 'agora',
        unread: chat.unreadCount,
        preview: chat.lastMessageBody || 'Conversa sincronizada.',
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

    if (!this.engine.hasSessionClient(sessionId)) {
      return conversation;
    }

    try {
      const avatarUrl =
        conversation.avatarUrl ??
        (await this.resolveParticipantAvatar(
          sessionId,
          conversation.participantId,
        ));

      const messages = await this.engine.listMessages(
        sessionId,
        conversation.participantId,
        40,
      );

      const normalizedMessages: MessageRecord[] = messages
        .map((message) => ({
          id: message.id,
          conversationId,
          direction: message.fromMe
            ? ('outgoing' as const)
            : ('incoming' as const),
          body: message.body || '[midia]',
          timestamp: new Date(message.timestamp * 1000).toISOString(),
          author: message.fromMe
            ? 'Operador'
            : message.chatName ||
              message.contactPushName ||
              message.contactName ||
              conversation.contact,
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

  private async ingestIncomingMessage(
    sessionId: string,
    message: WhatsappEngineMessage,
  ) {
    const session = await this.getSessionOrFail(sessionId);

    if (this.shouldIgnoreChatId(message.chatId)) {
      return;
    }

    const conversationId = message.chatId;
    const existing = await this.store.getConversation(
      sessionId,
      conversationId,
    );
    const avatarUrl = await this.resolveParticipantAvatar(
      sessionId,
      message.contactId,
    );

    if (!existing) {
      await this.store.saveConversation({
        id: conversationId,
        sessionId,
        sessionName: session.name,
        contact:
          message.contactPushName ||
          message.contactName ||
          message.chatName ||
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
      id: message.id,
      conversationId,
      direction: message.fromMe ? 'outgoing' : 'incoming',
      body: message.body,
      timestamp: new Date(message.timestamp * 1000).toISOString(),
      author: message.fromMe
        ? 'Operador'
        : message.contactPushName ||
          message.contactName ||
          message.chatName ||
          'Contato',
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

  private async resolveParticipantAvatar(
    sessionId: string,
    participantId: string,
  ) {
    if (this.shouldIgnoreChatId(participantId)) {
      return null;
    }

    return this.engine.getAvatarUrl(sessionId, participantId);
  }

  private shouldIgnoreChatId(chatId: string) {
    return chatId.endsWith('@broadcast') || chatId.includes('@newsletter');
  }
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
