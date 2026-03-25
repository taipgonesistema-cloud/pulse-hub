import { Injectable, Logger } from '@nestjs/common';
import type { WhatsappEngine } from './whatsapp-engine.interface';
import type {
  WhatsappEngineChat,
  WhatsappEngineMessage,
  WhatsappSessionCallbacks,
} from './whatsapp-engine.types';

type SessionRuntime = {
  token: string;
  callbacks: WhatsappSessionCallbacks;
  isAuthenticated: boolean;
  isReady: boolean;
  stateTimer: NodeJS.Timeout | null;
  qrTimer: NodeJS.Timeout | null;
  messageTimer: NodeJS.Timeout | null;
  seenMessageIds: Set<string>;
};

@Injectable()
export class WppConnectEngine implements WhatsappEngine {
  private readonly logger = new Logger(WppConnectEngine.name);
  private readonly apiUrl = this.resolveApiUrl();
  private readonly secretKey = process.env.WPPCONNECT_SECRET_KEY?.trim() ?? '';
  private readonly sessions = new Map<string, SessionRuntime>();

  hasSessionClient(sessionId: string) {
    return this.sessions.has(sessionId);
  }

  async connectSession(sessionId: string, callbacks: WhatsappSessionCallbacks) {
    if (this.sessions.has(sessionId)) {
      return;
    }

    this.assertConfig();

    const token = await this.generateSessionToken(sessionId);
    const runtime: SessionRuntime = {
      token,
      callbacks,
      isAuthenticated: false,
      isReady: false,
      stateTimer: null,
      qrTimer: null,
      messageTimer: null,
      seenMessageIds: new Set<string>(),
    };

    this.sessions.set(sessionId, runtime);

    try {
      const startPayload = await this.requestJson<unknown>(
        sessionId,
        runtime,
        `/api/${encodeURIComponent(sessionId)}/start-session`,
        {
          method: 'POST',
          body: JSON.stringify({ waitQrCode: true }),
        },
      );

      const initialQr = this.extractQrValue(startPayload);

      if (initialQr) {
        await callbacks.onQr(initialQr);
      }

      this.startPolling(sessionId, runtime);
      await this.syncSessionState(sessionId, runtime);
      await this.pullQrCode(sessionId, runtime);
    } catch (error) {
      this.stopPolling(sessionId);
      this.sessions.delete(sessionId);
      const message =
        error instanceof Error ? error.message : 'Falha ao iniciar sessao WPP.';
      await callbacks.onInitError(message);
    }
  }

  async disconnectSession(sessionId: string) {
    const runtime = this.sessions.get(sessionId);

    if (!runtime) {
      return;
    }

    try {
      await this.requestJson(
        sessionId,
        runtime,
        `/api/${encodeURIComponent(sessionId)}/close-session`,
        { method: 'POST' },
      );
    } catch (error) {
      this.logger.warn(
        `Falha ao fechar sessao ${sessionId} no WPPConnect: ${error instanceof Error ? error.message : 'Erro desconhecido'}`,
      );
    } finally {
      this.stopPolling(sessionId);
      this.sessions.delete(sessionId);
    }
  }

  async destroyAll() {
    await Promise.allSettled(
      [...this.sessions.keys()].map(async (sessionId) =>
        this.disconnectSession(sessionId),
      ),
    );
  }

  async sendMessage(sessionId: string, participantId: string, body: string) {
    const runtime = this.getRuntimeOrThrow(sessionId);
    const target = this.toTarget(participantId);

    await this.requestJson(
      sessionId,
      runtime,
      `/api/${encodeURIComponent(sessionId)}/send-message`,
      {
        method: 'POST',
        body: JSON.stringify({
          phone: target.phone,
          isGroup: target.isGroup,
          isNewsletter: false,
          isLid: false,
          message: body,
        }),
      },
    );
  }

  async markConversationAsRead(sessionId: string, participantId: string) {
    const runtime = this.getRuntimeOrThrow(sessionId);
    const target = this.toTarget(participantId);

    await this.requestJson(
      sessionId,
      runtime,
      `/api/${encodeURIComponent(sessionId)}/send-seen`,
      {
        method: 'POST',
        body: JSON.stringify({
          phone: target.phone,
          isGroup: target.isGroup,
        }),
      },
    );
  }

  async listChats(sessionId: string) {
    const runtime = this.getRuntimeOrThrow(sessionId);
    const payload = await this.requestJson<unknown>(
      sessionId,
      runtime,
      `/api/${encodeURIComponent(sessionId)}/list-chats`,
      {
        method: 'POST',
        body: JSON.stringify({
          count: 100,
          onlyUsers: true,
          onlyGroups: false,
          onlyWithUnreadMessage: false,
        }),
      },
    );

    const items = this.asArray(payload);
    const chats = items
      .map((item) => this.normalizeChat(item))
      .filter((chat): chat is WhatsappEngineChat => Boolean(chat));

    return chats;
  }

  async listMessages(sessionId: string, participantId: string, limit: number) {
    const runtime = this.getRuntimeOrThrow(sessionId);
    const target = this.toTarget(participantId);
    const payload = await this.requestJson<unknown>(
      sessionId,
      runtime,
      `/api/${encodeURIComponent(sessionId)}/all-messages-in-chat/${encodeURIComponent(target.phone)}?isGroup=${String(target.isGroup)}&includeMe=true&includeNotifications=false`,
      { method: 'GET' },
    );

    const items = this.asArray(payload);
    const messages = items
      .map((item) => this.normalizeMessage(item, participantId))
      .filter((message): message is WhatsappEngineMessage => Boolean(message))
      .sort((left, right) => left.timestamp - right.timestamp);

    return messages.slice(-limit);
  }

  async getAvatarUrl(sessionId: string, participantId: string) {
    const runtime = this.getRuntimeOrThrow(sessionId);
    const target = this.toTarget(participantId);
    const payload = await this.requestJson<unknown>(
      sessionId,
      runtime,
      `/api/${encodeURIComponent(sessionId)}/profile-pic/${encodeURIComponent(target.phone)}?isGroup=${String(target.isGroup)}`,
      { method: 'GET' },
    );

    return this.extractUrl(payload);
  }

  private startPolling(sessionId: string, runtime: SessionRuntime) {
    runtime.stateTimer = setInterval(() => {
      void this.syncSessionState(sessionId, runtime);
    }, 3500);

    runtime.qrTimer = setInterval(() => {
      void this.pullQrCode(sessionId, runtime);
    }, 2200);

    runtime.messageTimer = setInterval(() => {
      void this.pollNewMessages(sessionId, runtime);
    }, 4500);
  }

  private stopPolling(sessionId: string) {
    const runtime = this.sessions.get(sessionId);

    if (!runtime) {
      return;
    }

    if (runtime.stateTimer) {
      clearInterval(runtime.stateTimer);
      runtime.stateTimer = null;
    }

    if (runtime.qrTimer) {
      clearInterval(runtime.qrTimer);
      runtime.qrTimer = null;
    }

    if (runtime.messageTimer) {
      clearInterval(runtime.messageTimer);
      runtime.messageTimer = null;
    }
  }

  private async syncSessionState(sessionId: string, runtime: SessionRuntime) {
    try {
      const checkPayload = await this.requestJson<unknown>(
        sessionId,
        runtime,
        `/api/${encodeURIComponent(sessionId)}/check-connection-session`,
        { method: 'GET' },
      );

      const state = this.readConnectionState(checkPayload);

      if (state === 'connected') {
        if (!runtime.isAuthenticated) {
          runtime.isAuthenticated = true;
          await runtime.callbacks.onAuthenticated();
        }

        if (!runtime.isReady) {
          runtime.isReady = true;
          if (runtime.qrTimer) {
            clearInterval(runtime.qrTimer);
            runtime.qrTimer = null;
          }
          await runtime.callbacks.onReady();
        }

        return;
      }

      if (state === 'auth_failure') {
        await runtime.callbacks.onAuthFailure(
          'Falha de autenticacao no WPPConnect.',
        );
        this.stopPolling(sessionId);
        this.sessions.delete(sessionId);
      }
    } catch (error) {
      this.logger.debug(
        `Falha ao sincronizar estado da sessao ${sessionId}: ${error instanceof Error ? error.message : 'Erro desconhecido'}`,
      );
    }
  }

  private async pullQrCode(sessionId: string, runtime: SessionRuntime) {
    if (runtime.isReady) {
      return;
    }

    try {
      const payload = await this.requestJson<unknown>(
        sessionId,
        runtime,
        `/api/${encodeURIComponent(sessionId)}/qrcode-session`,
        { method: 'GET' },
      );

      const qrValue = this.extractQrValue(payload);

      if (qrValue) {
        await runtime.callbacks.onQr(qrValue);
      }
    } catch (error) {
      this.logger.debug(
        `Falha ao obter QR da sessao ${sessionId}: ${error instanceof Error ? error.message : 'Erro desconhecido'}`,
      );
    }
  }

  private async pollNewMessages(sessionId: string, runtime: SessionRuntime) {
    if (!runtime.isReady) {
      return;
    }

    try {
      const payload = await this.requestJson<unknown>(
        sessionId,
        runtime,
        `/api/${encodeURIComponent(sessionId)}/all-new-messages`,
        { method: 'GET' },
      );

      const messages = this.asArray(payload)
        .map((item) => this.normalizeMessage(item))
        .filter((message): message is WhatsappEngineMessage =>
          Boolean(message),
        );

      for (const message of messages) {
        if (runtime.seenMessageIds.has(message.id) || message.fromMe) {
          continue;
        }

        runtime.seenMessageIds.add(message.id);
        await runtime.callbacks.onMessage(message);
      }
    } catch (error) {
      this.logger.debug(
        `Falha ao buscar mensagens novas da sessao ${sessionId}: ${error instanceof Error ? error.message : 'Erro desconhecido'}`,
      );
    }
  }

  private async generateSessionToken(sessionId: string) {
    const response = await fetch(
      `${this.apiUrl}/api/${encodeURIComponent(sessionId)}/${encodeURIComponent(this.secretKey)}/generate-token`,
      { method: 'POST' },
    );

    if (!response.ok) {
      throw new Error(`WPPConnect recusou token da sessao ${sessionId}.`);
    }

    const payload = (await response.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;

    const tokenCandidate =
      this.readString(payload?.token) ?? this.readString(payload?.full);

    if (!tokenCandidate) {
      throw new Error(`WPPConnect nao retornou token da sessao ${sessionId}.`);
    }

    return tokenCandidate;
  }

  private async requestJson<T>(
    sessionId: string,
    runtime: SessionRuntime,
    route: string,
    init: RequestInit,
  ) {
    const response = await fetch(`${this.apiUrl}${route}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${runtime.token}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(
        `WPPConnect ${response.status} na sessao ${sessionId}: ${errorText || response.statusText}`,
      );
    }

    const text = await response.text();

    if (!text) {
      return null as T;
    }

    try {
      return JSON.parse(text) as T;
    } catch {
      return text as T;
    }
  }

  private normalizeChat(value: unknown): WhatsappEngineChat | null {
    if (!value || typeof value !== 'object') {
      return null;
    }

    const source = value as Record<string, unknown>;
    const serializedId =
      this.extractSerializedId(source.id) ?? this.readString(source.chatId);

    if (!serializedId) {
      return null;
    }

    return {
      id: serializedId,
      name:
        this.readString(source.name) ||
        this.readString(source.formattedTitle) ||
        this.readString(source.contactName) ||
        serializedId,
      unreadCount: this.readNumber(source.unreadCount) ?? 0,
      lastMessageBody:
        this.readString(source.lastMessage) ||
        this.readString(source.lastMessageBody) ||
        this.readString(source.body) ||
        null,
      isGroup:
        (this.readBoolean(source.isGroup) ?? serializedId.endsWith('@g.us')) ||
        false,
    };
  }

  private normalizeMessage(
    value: unknown,
    fallbackChatId?: string,
  ): WhatsappEngineMessage | null {
    if (!value || typeof value !== 'object') {
      return null;
    }

    const source = value as Record<string, unknown>;
    const id =
      this.readString(source.id) ||
      this.extractSerializedId(source.id) ||
      this.readString(source.messageId);
    const chatId =
      this.readString(source.from) ||
      this.readString(source.chatId) ||
      this.extractSerializedId(source.chatId) ||
      fallbackChatId;

    if (!id || !chatId) {
      return null;
    }

    const contactId =
      this.readString(source.author) || this.readString(source.from) || chatId;

    const timestampSource =
      this.readNumber(source.timestamp) ??
      this.readNumber(source.t) ??
      this.readNumber(source.time) ??
      Math.floor(Date.now() / 1000);

    return {
      id,
      chatId,
      contactId,
      body:
        this.readString(source.body) ||
        this.readString(source.content) ||
        this.readString(source.text) ||
        '[midia]',
      timestamp:
        timestampSource > 1_000_000_000_000
          ? Math.floor(timestampSource / 1000)
          : timestampSource,
      fromMe:
        this.readBoolean(source.fromMe) ??
        this.readBoolean(source.self) ??
        false,
      chatName:
        this.readString(source.senderName) ||
        this.readString(source.chatName) ||
        null,
      contactName: this.readString(source.notifyName) || null,
      contactPushName: this.readString(source.senderName) || null,
    };
  }

  private readConnectionState(value: unknown) {
    const source =
      value && typeof value === 'object'
        ? (value as Record<string, unknown>)
        : null;

    if (!source) {
      return 'unknown';
    }

    if (
      this.readBoolean(source.connected) ||
      this.readBoolean(source.isConnected)
    ) {
      return 'connected';
    }

    const stateText = (
      this.readString(source.state) ||
      this.readString(source.status) ||
      this.readString(source.message) ||
      ''
    ).toLowerCase();

    if (
      stateText.includes('connected') ||
      stateText.includes('open') ||
      stateText.includes('is logged')
    ) {
      return 'connected';
    }

    if (
      stateText.includes('not logged') ||
      stateText.includes('auth') ||
      stateText.includes('failure')
    ) {
      return 'auth_failure';
    }

    return 'unknown';
  }

  private extractQrValue(value: unknown): string | null {
    if (typeof value === 'string') {
      return value.length > 0 ? value : null;
    }

    if (!value || typeof value !== 'object') {
      return null;
    }

    const source = value as Record<string, unknown>;
    const candidates = [
      source.qrcode,
      source.qrCode,
      source.base64,
      source.urlCode,
      source.qrcodebase64,
      source.qrcodeBase64,
      source.image,
    ];

    for (const candidate of candidates) {
      const text = this.readString(candidate);

      if (!text) {
        continue;
      }

      if (text.startsWith('data:image')) {
        return text;
      }

      if (text.startsWith('http')) {
        return null;
      }

      if (text.includes('base64,')) {
        return text;
      }

      if (text.length > 40) {
        return text;
      }
    }

    return null;
  }

  private extractUrl(value: unknown): string | null {
    if (typeof value === 'string' && value.startsWith('http')) {
      return value;
    }

    if (!value || typeof value !== 'object') {
      return null;
    }

    const source = value as Record<string, unknown>;
    return (
      this.readString(source.url) ||
      this.readString(source.eurl) ||
      this.readString(source.profilePicThumbObj) ||
      null
    );
  }

  private asArray(value: unknown): unknown[] {
    if (Array.isArray(value)) {
      const items: unknown[] = [];

      for (const item of value) {
        items.push(item);
      }

      return items;
    }

    if (value && typeof value === 'object') {
      const source = value as Record<string, unknown>;
      const nested =
        source.response ??
        source.data ??
        source.result ??
        source.chats ??
        source.messages;

      if (Array.isArray(nested)) {
        const items: unknown[] = [];

        for (const item of nested) {
          items.push(item);
        }

        return items;
      }
    }

    return [];
  }

  private toTarget(participantId: string) {
    if (participantId.endsWith('@g.us')) {
      return {
        phone: participantId.replace('@g.us', ''),
        isGroup: true,
      };
    }

    if (participantId.endsWith('@c.us')) {
      return {
        phone: participantId.replace('@c.us', ''),
        isGroup: false,
      };
    }

    return {
      phone: participantId,
      isGroup: false,
    };
  }

  private extractSerializedId(value: unknown): string | null {
    if (!value) {
      return null;
    }

    if (typeof value === 'string') {
      return value;
    }

    if (typeof value === 'object') {
      const source = value as Record<string, unknown>;
      return (
        this.readString(source._serialized) ||
        this.readString(source.user) ||
        this.readString(source.server)
      );
    }

    return null;
  }

  private getRuntimeOrThrow(sessionId: string) {
    const runtime = this.sessions.get(sessionId);

    if (!runtime) {
      throw new Error(
        `Sessao ${sessionId} nao esta ativa na engine WPPConnect.`,
      );
    }

    return runtime;
  }

  private assertConfig() {
    if (!this.apiUrl) {
      throw new Error('WPPCONNECT_API_URL nao configurado.');
    }

    if (!this.secretKey) {
      throw new Error('WPPCONNECT_SECRET_KEY nao configurado.');
    }
  }

  private resolveApiUrl() {
    return process.env.WPPCONNECT_API_URL?.trim().replace(/\/$/, '') ?? '';
  }

  private readString(value: unknown) {
    return typeof value === 'string' && value.length > 0 ? value : null;
  }

  private readNumber(value: unknown) {
    return typeof value === 'number' && Number.isFinite(value)
      ? value
      : undefined;
  }

  private readBoolean(value: unknown) {
    return typeof value === 'boolean' ? value : undefined;
  }
}
