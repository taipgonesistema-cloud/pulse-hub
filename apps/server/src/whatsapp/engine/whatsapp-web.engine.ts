import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { Client, LocalAuth, type Message } from 'whatsapp-web.js';
import type { WhatsappEngine } from './whatsapp-engine.interface';
import type {
  WhatsappEngineChat,
  WhatsappEngineMessage,
  WhatsappSessionCallbacks,
} from './whatsapp-engine.types';

const execFileAsync = promisify(execFile);

@Injectable()
export class WhatsappWebEngine implements WhatsappEngine {
  private readonly logger = new Logger(WhatsappWebEngine.name);
  private readonly clients = new Map<string, Client>();
  private readonly browserExecutablePath = this.resolveBrowserExecutablePath();
  private readonly isHeadless = process.env.PUPPETEER_HEADLESS !== 'false';

  hasSessionClient(sessionId: string) {
    return this.clients.has(sessionId);
  }

  async connectSession(sessionId: string, callbacks: WhatsappSessionCallbacks) {
    if (this.clients.has(sessionId)) {
      return;
    }

    await this.terminateSessionBrowserProcesses(sessionId);
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
    this.bindClientEvents(sessionId, client, callbacks);

    void client.initialize().catch(async (error: unknown) => {
      const message =
        error instanceof Error ? error.message : 'Falha ao inicializar sessao.';

      this.logger.error(`Falha ao conectar sessao ${sessionId}: ${message}`);
      await Promise.allSettled([client.destroy()]);
      this.clients.delete(sessionId);
      await callbacks.onInitError(message);
    });
  }

  async disconnectSession(sessionId: string) {
    const client = this.clients.get(sessionId);

    if (!client) {
      return;
    }

    await client.destroy();
    this.clients.delete(sessionId);
  }

  async destroyAll() {
    const clients = [...this.clients.values()];
    await Promise.allSettled(clients.map(async (client) => client.destroy()));
    this.clients.clear();
  }

  async sendMessage(sessionId: string, participantId: string, body: string) {
    const client = this.getClientOrThrow(sessionId);
    await client.sendMessage(participantId, body);
  }

  async markConversationAsRead(sessionId: string, participantId: string) {
    const client = this.getClientOrThrow(sessionId);
    await client.sendSeen(participantId);
  }

  async listChats(sessionId: string) {
    const client = this.getClientOrThrow(sessionId);
    const chats = await client.getChats();

    return chats.map((chat) => ({
      id: chat.id._serialized,
      name: chat.name || chat.id.user || 'Contato WhatsApp',
      unreadCount: chat.unreadCount,
      lastMessageBody: chat.lastMessage?.body || null,
      isGroup: chat.isGroup,
    })) satisfies WhatsappEngineChat[];
  }

  async listMessages(sessionId: string, participantId: string, limit: number) {
    const client = this.getClientOrThrow(sessionId);
    const chat = await client.getChatById(participantId);
    const messages = await chat.fetchMessages({ limit });

    return messages.map((message) =>
      this.mapMessage(participantId, message, {
        chatName: chat.name || null,
      }),
    );
  }

  async getAvatarUrl(sessionId: string, participantId: string) {
    const client = this.clients.get(sessionId);

    if (!client || this.shouldIgnoreChatId(participantId)) {
      return null;
    }

    try {
      return await client.getProfilePicUrl(participantId);
    } catch (error) {
      this.logger.debug(
        `Falha ao buscar avatar para ${participantId}: ${error instanceof Error ? error.message : 'Erro desconhecido'}`,
      );
      return null;
    }
  }

  private bindClientEvents(
    sessionId: string,
    client: Client,
    callbacks: WhatsappSessionCallbacks,
  ) {
    client.on('qr', (qr) => {
      this.logger.log(
        `[SESSION ${sessionId}] QR Code recebido. Usuário precisa escanear.`,
      );
      void callbacks.onQr(qr);
    });

    client.on('authenticated', () => {
      this.logger.log(`[SESSION ${sessionId}] Autenticado com sucesso.`);
      void callbacks.onAuthenticated();
    });

    client.on('ready', () => {
      this.logger.log(`[SESSION ${sessionId}] Cliente pronto e conectado.`);
      void callbacks.onReady();
    });

    client.on('auth_failure', (message) => {
      this.logger.error(
        `[SESSION ${sessionId}] Falha na autenticação: ${message}`,
      );
      void callbacks.onAuthFailure(message);
    });

    client.on('disconnected', (reason) => {
      this.logger.warn(
        `[SESSION ${sessionId}] Desconectado: ${String(reason)}`,
      );
      this.clients.delete(sessionId);
      void callbacks.onDisconnected(typeof reason === 'string' ? reason : null);
    });

    client.on('message', (message) => {
      void (async () => {
        try {
          const chat = await message.getChat();
          const contact = await message.getContact();

          this.logger.debug(
            `[SESSION ${sessionId}] Nova mensagem recebida de ${message.from}`,
          );

          await callbacks.onMessage(
            this.mapMessage(chat.id._serialized, message, {
              contactId: contact.id._serialized,
              chatName: chat.name || null,
              contactName: contact.name || null,
              contactPushName: contact.pushname || null,
            }),
          );
        } catch (error) {
          const detail =
            error instanceof Error
              ? error.message
              : 'Falha ao processar mensagem.';
          this.logger.warn(
            `[SESSION ${sessionId}] Erro ao processar mensagem recebida: ${detail}`,
          );
        }
      })();
    });
  }

  private mapMessage(
    chatId: string,
    message: Message,
    details?: {
      contactId?: string | null;
      chatName?: string | null;
      contactName?: string | null;
      contactPushName?: string | null;
    },
  ): WhatsappEngineMessage {
    return {
      id: message.id.id,
      chatId,
      contactId: details?.contactId || chatId,
      body: message.body || '[midia]',
      timestamp: message.timestamp,
      fromMe: message.fromMe,
      chatName: details?.chatName ?? null,
      contactName: details?.contactName ?? null,
      contactPushName: details?.contactPushName ?? null,
    };
  }

  private getClientOrThrow(sessionId: string) {
    const client = this.clients.get(sessionId);

    if (!client) {
      throw new Error(`Sessao ${sessionId} nao esta conectada na engine.`);
    }

    return client;
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
    const sessionPath = path.join(
      process.cwd(),
      '.wwebjs_auth',
      `session-${sessionId}`,
    );
    const defaultPath = path.join(sessionPath, 'Default');

    const lockPaths = [
      path.join(sessionPath, 'LOCK'),
      path.join(sessionPath, 'lockfile'),
      path.join(sessionPath, 'SingletonLock'),
      path.join(sessionPath, 'SingletonCookie'),
      path.join(sessionPath, 'SingletonSocket'),
      path.join(sessionPath, 'DevToolsActivePort'),
      path.join(defaultPath, 'LOCK'),
      path.join(defaultPath, 'lockfile'),
      path.join(defaultPath, 'SingletonLock'),
      path.join(defaultPath, 'SingletonCookie'),
      path.join(defaultPath, 'SingletonSocket'),
      path.join(defaultPath, 'DevToolsActivePort'),
    ];

    [sessionPath, defaultPath].forEach((directoryPath) => {
      if (!fs.existsSync(directoryPath)) {
        return;
      }

      try {
        const dynamicLockPaths = fs
          .readdirSync(directoryPath)
          .filter(
            (entry) =>
              entry.startsWith('Singleton') ||
              entry === 'LOCK' ||
              entry === 'lockfile' ||
              entry === 'DevToolsActivePort',
          )
          .map((entry) => path.join(directoryPath, entry));

        lockPaths.push(...dynamicLockPaths);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Falha ao listar locks.';
        this.logger.warn(
          `Nao foi possivel listar locks da sessao ${sessionId}: ${message}`,
        );
      }
    });

    [...new Set(lockPaths)].forEach((lockPath) => {
      try {
        fs.lstatSync(lockPath);
        fs.rmSync(lockPath, {
          force: true,
          recursive: true,
          maxRetries: 2,
          retryDelay: 120,
        });
      } catch (error) {
        if (
          error instanceof Error &&
          'code' in error &&
          (error as NodeJS.ErrnoException).code === 'ENOENT'
        ) {
          return;
        }

        const message =
          error instanceof Error ? error.message : 'Falha ao remover lock.';
        this.logger.warn(
          `Nao foi possivel limpar lock da sessao ${sessionId}: ${message}`,
        );
      }
    });
  }

  private async terminateSessionBrowserProcesses(sessionId: string) {
    if (process.platform === 'win32') {
      return;
    }

    const sessionPath = path.join(
      process.cwd(),
      '.wwebjs_auth',
      `session-${sessionId}`,
    );

    try {
      await execFileAsync('pkill', ['-f', sessionPath]);
      this.logger.warn(
        `Processos Chromium antigos da sessao ${sessionId} foram encerrados.`,
      );
    } catch (error) {
      const exitCode =
        typeof error === 'object' && error && 'code' in error
          ? (error as { code?: number | string }).code
          : undefined;

      if (exitCode === 1 || exitCode === '1') {
        return;
      }

      const message =
        error instanceof Error
          ? error.message
          : 'Falha ao encerrar processo Chromium antigo.';
      this.logger.warn(
        `Nao foi possivel encerrar processo antigo da sessao ${sessionId}: ${message}`,
      );
    }
  }

  private shouldIgnoreChatId(chatId: string) {
    return chatId.endsWith('@broadcast') || chatId.includes('@newsletter');
  }
}
