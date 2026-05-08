import { Injectable, Logger } from '@nestjs/common';
import {
  Browsers,
  DisconnectReason,
  extractMessageContent,
  getContentType,
  makeWASocket,
  type ConnectionState,
  type WASocket,
  type WAMessage,
  type WAMessageKey,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import path from 'node:path';
import pino from 'pino';
import type { WhatsappEngine } from './whatsapp-engine.interface';
import type {
  WhatsappEngineChat,
  WhatsappEngineMessage,
  WhatsappSessionCallbacks,
} from './whatsapp-engine.types';

type StoredChat = WhatsappEngineChat;

type StoredMessage = {
  data: WhatsappEngineMessage;
  key: WAMessageKey;
};

type StoredContact = {
  id: string;
  name: string | null;
  pushName: string | null;
};

@Injectable()
export class BaileysEngine implements WhatsappEngine {
  private readonly logger = new Logger(BaileysEngine.name);
  private readonly sockets = new Map<string, WASocket>();
  private readonly chats = new Map<string, Map<string, StoredChat>>();
  private readonly messages = new Map<string, Map<string, StoredMessage[]>>();
  private readonly contacts = new Map<string, Map<string, StoredContact>>();
  private readonly reconnectingSessions = new Set<string>();

  hasSessionClient(sessionId: string) {
    return this.sockets.has(sessionId);
  }

  async connectSession(sessionId: string, callbacks: WhatsappSessionCallbacks) {
    if (this.sockets.has(sessionId)) {
      return;
    }

    const authFolder = path.join(
      process.cwd(),
      '.baileys_auth',
      `session-${sessionId}`,
    );
    const { state, saveCreds } = await useMultiFileAuthState(authFolder);

    const socket = makeWASocket({
      auth: state,
      browser: Browsers.ubuntu('ether command'),
      syncFullHistory: true,
      markOnlineOnConnect: false,
      emitOwnEvents: true,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
    });

    this.sockets.set(sessionId, socket);
    this.ensureSessionCaches(sessionId);

    socket.ev.on('creds.update', () => {
      void saveCreds();
    });
    socket.ev.on('connection.update', (update) => {
      void this.handleConnectionUpdate(sessionId, update, callbacks);
    });
    socket.ev.on('chats.upsert', (items) => {
      this.upsertChats(sessionId, items as Array<Record<string, unknown>>);
    });
    socket.ev.on('chats.update', (items) => {
      this.updateChats(sessionId, items as Array<Record<string, unknown>>);
    });
    socket.ev.on('contacts.upsert', (items) => {
      this.upsertContacts(
        sessionId,
        items as unknown as Array<Record<string, unknown>>,
      );
    });
    socket.ev.on('contacts.update', (items) => {
      this.upsertContacts(
        sessionId,
        items as unknown as Array<Record<string, unknown>>,
      );
    });
    socket.ev.on('messaging-history.set', (payload) => {
      this.applyHistoryPayload(sessionId, payload as Record<string, unknown>);
    });
    socket.ev.on('messages.upsert', (payload) => {
      void this.handleMessagesUpsert(
        sessionId,
        payload as { messages?: WAMessage[]; type?: string },
        callbacks,
      );
    });
  }

  disconnectSession(sessionId: string) {
    const socket = this.sockets.get(sessionId);

    if (!socket) {
      return Promise.resolve();
    }

    socket.ev.removeAllListeners('creds.update');
    socket.end(undefined);
    this.sockets.delete(sessionId);
    return Promise.resolve();
  }

  async destroyAll() {
    for (const sessionId of [...this.sockets.keys()]) {
      await this.disconnectSession(sessionId);
    }
  }

  async sendMessage(sessionId: string, participantId: string, body: string) {
    const socket = this.getSocketOrThrow(sessionId);
    const result = await socket.sendMessage(participantId, { text: body });

    if (result) {
      this.upsertMessageRecord(sessionId, result);
    }
  }

  async markConversationAsRead(sessionId: string, participantId: string) {
    const socket = this.getSocketOrThrow(sessionId);
    const conversationMessages =
      this.messages.get(sessionId)?.get(participantId) ?? [];
    const unreadKeys = conversationMessages
      .slice(-20)
      .map((message) => message.key)
      .filter((key) => key.id && key.remoteJid);

    if (unreadKeys.length === 0) {
      return;
    }

    await socket.readMessages(unreadKeys);

    const chat = this.chats.get(sessionId)?.get(participantId);

    if (chat) {
      chat.unreadCount = 0;
    }
  }

  listChats(sessionId: string) {
    return Promise.resolve(
      [...(this.chats.get(sessionId)?.values() ?? [])].sort((left, right) => {
        return right.unreadCount - left.unreadCount;
      }),
    );
  }

  listMessages(sessionId: string, participantId: string, limit: number) {
    const messages = this.messages.get(sessionId)?.get(participantId) ?? [];

    return Promise.resolve(messages.slice(-limit).map((item) => item.data));
  }

  async getAvatarUrl(sessionId: string, participantId: string) {
    const socket = this.sockets.get(sessionId);

    if (!socket) {
      return null;
    }

    try {
      return (await socket.profilePictureUrl(participantId, 'image')) ?? null;
    } catch (error) {
      this.logger.debug(
        `Failed to fetch Baileys avatar for ${participantId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return null;
    }
  }

  private async handleConnectionUpdate(
    sessionId: string,
    update: Partial<ConnectionState>,
    callbacks: WhatsappSessionCallbacks,
  ) {
    if (update.qr) {
      await callbacks.onQr(update.qr);
    }

    if (update.connection === 'open') {
      await callbacks.onAuthenticated();
      await callbacks.onReady();
      return;
    }

    if (update.connection !== 'close') {
      return;
    }

    this.sockets.delete(sessionId);

    const statusCode = this.getDisconnectStatusCode(
      update.lastDisconnect?.error,
    );
    const reasonMessage =
      update.lastDisconnect?.error instanceof Error
        ? update.lastDisconnect.error.message
        : 'Session closed.';

    if (statusCode === DisconnectReason.loggedOut) {
      await callbacks.onAuthFailure(reasonMessage);
      return;
    }

    if (this.shouldReconnect(statusCode)) {
      await this.reconnectSession(sessionId, callbacks);
      return;
    }

    await callbacks.onDisconnected(reasonMessage);
  }

  private async handleMessagesUpsert(
    sessionId: string,
    payload: { messages?: WAMessage[]; type?: string },
    callbacks: WhatsappSessionCallbacks,
  ) {
    for (const message of payload.messages ?? []) {
      const stored = this.upsertMessageRecord(sessionId, message);

      if (!stored) {
        continue;
      }

      if (stored.data.fromMe) {
        continue;
      }

      await callbacks.onMessage(stored.data);
    }
  }

  private applyHistoryPayload(
    sessionId: string,
    payload: Record<string, unknown>,
  ) {
    const chats = Array.isArray(payload.chats) ? payload.chats : [];
    const contacts = Array.isArray(payload.contacts) ? payload.contacts : [];
    const messages = Array.isArray(payload.messages) ? payload.messages : [];

    this.upsertChats(sessionId, chats as Array<Record<string, unknown>>);
    this.upsertContacts(sessionId, contacts as Array<Record<string, unknown>>);

    for (const item of messages as WAMessage[]) {
      this.upsertMessageRecord(sessionId, item);
    }
  }

  private upsertChats(
    sessionId: string,
    items: Array<Record<string, unknown>>,
  ) {
    const cache = this.chats.get(sessionId) ?? new Map<string, StoredChat>();
    this.chats.set(sessionId, cache);

    for (const item of items) {
      const chatId = this.readString(item.id);

      if (!chatId) {
        continue;
      }

      const existing = cache.get(chatId);
      cache.set(chatId, {
        id: chatId,
        name:
          this.readString(item.name) || existing?.name || 'Contato WhatsApp',
        unreadCount:
          this.readNumber(item.unreadCount) ?? existing?.unreadCount ?? 0,
        lastMessageBody: this.readString(item.conversationTimestamp)
          ? (existing?.lastMessageBody ?? null)
          : (existing?.lastMessageBody ?? null),
        isGroup:
          this.readString(item.id)?.endsWith('@g.us') ??
          existing?.isGroup ??
          false,
      });
    }
  }

  private updateChats(
    sessionId: string,
    items: Array<Record<string, unknown>>,
  ) {
    const cache = this.chats.get(sessionId) ?? new Map<string, StoredChat>();
    this.chats.set(sessionId, cache);

    for (const item of items) {
      const chatId = this.readString(item.id);

      if (!chatId) {
        continue;
      }

      const existing = cache.get(chatId) ?? {
        id: chatId,
        name: 'Contato WhatsApp',
        unreadCount: 0,
        lastMessageBody: null,
        isGroup: chatId.endsWith('@g.us'),
      };

      cache.set(chatId, {
        ...existing,
        name: this.readString(item.name) || existing.name,
        unreadCount: this.readNumber(item.unreadCount) ?? existing.unreadCount,
      });
    }
  }

  private upsertContacts(
    sessionId: string,
    items: Array<Record<string, unknown>>,
  ) {
    const cache =
      this.contacts.get(sessionId) ?? new Map<string, StoredContact>();
    this.contacts.set(sessionId, cache);

    for (const item of items) {
      const id = this.readString(item.id);

      if (!id) {
        continue;
      }

      cache.set(id, {
        id,
        name: this.readString(item.name),
        pushName:
          this.readString(item.notify) || this.readString(item.verifiedName),
      });
    }
  }

  private upsertMessageRecord(sessionId: string, message: WAMessage) {
    const chatId = message.key.remoteJid;

    if (!chatId) {
      return null;
    }

    const normalized = this.normalizeMessage(sessionId, message);

    if (!normalized) {
      return null;
    }

    const messageMap =
      this.messages.get(sessionId) ?? new Map<string, StoredMessage[]>();
    this.messages.set(sessionId, messageMap);

    const thread = messageMap.get(chatId) ?? [];
    const existingIndex = thread.findIndex(
      (item) => item.data.id === normalized.data.id,
    );

    if (existingIndex >= 0) {
      thread[existingIndex] = normalized;
    } else {
      thread.push(normalized);
      thread.sort((left, right) => left.data.timestamp - right.data.timestamp);
    }

    messageMap.set(chatId, thread);

    const chatCache =
      this.chats.get(sessionId) ?? new Map<string, StoredChat>();
    this.chats.set(sessionId, chatCache);
    const existingChat = chatCache.get(chatId);
    chatCache.set(chatId, {
      id: chatId,
      name:
        normalized.data.chatName || existingChat?.name || 'Contato WhatsApp',
      unreadCount: normalized.data.fromMe
        ? (existingChat?.unreadCount ?? 0)
        : (existingChat?.unreadCount ?? 0) + 1,
      lastMessageBody: normalized.data.body,
      isGroup: chatId.endsWith('@g.us'),
    });

    return normalized;
  }

  private normalizeMessage(
    sessionId: string,
    message: WAMessage,
  ): StoredMessage | null {
    const chatId = message.key.remoteJid;

    if (!chatId || !message.key.id) {
      return null;
    }

    const contactId = message.key.participant || chatId;
    const contact = this.contacts.get(sessionId)?.get(contactId);
    const chat = this.chats.get(sessionId)?.get(chatId);

    return {
      key: {
        id: message.key.id,
        remoteJid: chatId,
        fromMe: message.key.fromMe,
        participant: message.key.participant,
      },
      data: {
        id: message.key.id,
        chatId,
        contactId,
        body: this.extractMessageBody(message),
        timestamp: Number(
          message.messageTimestamp || Math.floor(Date.now() / 1000),
        ),
        fromMe: !!message.key.fromMe,
        chatName: chat?.name || contact?.pushName || contact?.name || null,
        contactName: contact?.name || null,
        contactPushName: contact?.pushName || null,
      },
    };
  }

  private extractMessageBody(message: WAMessage) {
    const content = extractMessageContent(message.message);
    const contentType = getContentType(content);

    if (!content || !contentType) {
      return '[midia]';
    }

    if (contentType === 'conversation') {
      const body = content.conversation;
      return typeof body === 'string' && body.length > 0 ? body : '[mensagem]';
    }

    const payload = content[contentType] as Record<string, unknown> | undefined;

    if (!payload) {
      return `[${contentType}]`;
    }

    const textCandidate = payload.text;
    if (typeof textCandidate === 'string' && textCandidate.length > 0) {
      return textCandidate;
    }

    const captionCandidate = payload.caption;
    if (typeof captionCandidate === 'string' && captionCandidate.length > 0) {
      return captionCandidate;
    }

    const nameCandidate = payload.name;
    if (typeof nameCandidate === 'string' && nameCandidate.length > 0) {
      return nameCandidate;
    }

    return `[${contentType}]`;
  }

  private ensureSessionCaches(sessionId: string) {
    if (!this.chats.has(sessionId)) {
      this.chats.set(sessionId, new Map());
    }

    if (!this.messages.has(sessionId)) {
      this.messages.set(sessionId, new Map());
    }

    if (!this.contacts.has(sessionId)) {
      this.contacts.set(sessionId, new Map());
    }
  }

  private getSocketOrThrow(sessionId: string) {
    const socket = this.sockets.get(sessionId);

    if (!socket) {
      throw new Error(
        `Session ${sessionId} is not connected in the Baileys engine.`,
      );
    }

    return socket;
  }

  private getDisconnectStatusCode(error: unknown) {
    if (!error || typeof error !== 'object') {
      return undefined;
    }

    if ('output' in error) {
      const boom = error as {
        output?: { statusCode?: number };
      };
      return boom.output?.statusCode;
    }

    return undefined;
  }

  private shouldReconnect(statusCode: number | undefined) {
    return [
      DisconnectReason.restartRequired,
      DisconnectReason.connectionClosed,
      DisconnectReason.connectionLost,
      DisconnectReason.timedOut,
      DisconnectReason.unavailableService,
    ].includes(statusCode as DisconnectReason);
  }

  private async reconnectSession(
    sessionId: string,
    callbacks: WhatsappSessionCallbacks,
  ) {
    if (this.reconnectingSessions.has(sessionId)) {
      return;
    }

    this.reconnectingSessions.add(sessionId);

    try {
      this.logger.warn(
        `[SESSION ${sessionId}] Baileys solicitou reinicio da conexao. Tentando novamente...`,
      );
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await callbacks.onDisconnected('Reiniciando conexao Baileys...');
      await this.connectSession(sessionId, callbacks);
    } finally {
      this.reconnectingSessions.delete(sessionId);
    }
  }

  private readString(value: unknown) {
    return typeof value === 'string' && value.length > 0 ? value : null;
  }

  private readNumber(value: unknown) {
    return typeof value === 'number' && Number.isFinite(value)
      ? value
      : undefined;
  }
}
