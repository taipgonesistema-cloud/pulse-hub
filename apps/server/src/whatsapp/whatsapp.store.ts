import { Injectable, OnModuleInit } from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';
import type { PoolClient } from 'pg';
import {
  type ChannelRecord,
  type ConversationRecord,
  type MessageRecord,
  type SessionRecord,
} from '../data/mock-data';
import { PostgresService } from '../persistence/postgres.service';

type SessionRow = {
  id: string;
  name: string;
  phone_number: string;
  channel_id: string;
  channel_name: string;
  status: SessionRecord['status'];
  attendants: number;
  waiting: number;
  unread: number;
  last_heartbeat: Date | string;
  is_demo: boolean;
  qr_code: string | null;
  qr_code_data_url: string | null;
  last_error: string | null;
  aggregated_waiting: number | null;
  aggregated_unread: number | null;
};

type ConversationRow = {
  id: string;
  session_id: string;
  session_name: string;
  contact: string;
  avatar_url: string | null;
  participant_id: string;
  owner: string;
  status: string;
  channel_name: string;
  waiting_time: string;
  unread: number;
  preview: string;
  last_message_at: Date | string;
};

type MessageRow = {
  id: string;
  conversation_id: string;
  direction: MessageRecord['direction'];
  body: string;
  message_timestamp: Date | string;
  author: string;
};

@Injectable()
export class WhatsappStore implements OnModuleInit {
  private readonly authDirectoryPath = path.join(process.cwd(), '.wwebjs_auth');

  constructor(private readonly postgres: PostgresService) {}

  async onModuleInit() {
    await this.restoreSessionsFromAuthDirectory();
  }

  async getChannels() {
    const { rows } = await this.postgres.query<{
      id: string;
      name: string;
      color: string;
      connected_numbers: number;
    }>(`
      SELECT
        channels.id,
        channels.name,
        channels.color,
        COUNT(whatsapp_sessions.id)::int AS connected_numbers
      FROM channels
      LEFT JOIN whatsapp_sessions
        ON whatsapp_sessions.channel_id = channels.id
      GROUP BY channels.id, channels.name, channels.color
      ORDER BY channels.name ASC
    `);

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      color: row.color,
      connectedNumbers: row.connected_numbers,
    })) satisfies ChannelRecord[];
  }

  async getSessions() {
    const { rows } = await this.postgres.query<SessionRow>(`
      ${this.sessionSelectQuery()}
      ORDER BY sessions.created_at DESC
    `);
    return rows.map((row) => this.mapSession(row));
  }

  async getSession(id: string) {
    const { rows } = await this.postgres.query<SessionRow>(
      `
        ${this.sessionSelectQuery()}
        WHERE sessions.id = $1
      `,
      [id],
    );

    return rows[0] ? this.mapSession(rows[0]) : null;
  }

  async saveSession(session: SessionRecord) {
    return this.postgres.withTransaction(async (client) => {
      const channel = await this.upsertChannel(
        client,
        session.channelId,
        session.channelName,
      );

      await client.query(
        `
          INSERT INTO whatsapp_sessions (
            id,
            name,
            phone_number,
            channel_id,
            channel_name,
            status,
            attendants,
            waiting,
            unread,
            last_heartbeat,
            is_demo,
            qr_code,
            qr_code_data_url,
            last_error,
            updated_at
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
            $11, $12, $13, $14, NOW()
          )
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            phone_number = EXCLUDED.phone_number,
            channel_id = EXCLUDED.channel_id,
            channel_name = EXCLUDED.channel_name,
            status = EXCLUDED.status,
            attendants = EXCLUDED.attendants,
            waiting = EXCLUDED.waiting,
            unread = EXCLUDED.unread,
            last_heartbeat = EXCLUDED.last_heartbeat,
            is_demo = EXCLUDED.is_demo,
            qr_code = EXCLUDED.qr_code,
            qr_code_data_url = EXCLUDED.qr_code_data_url,
            last_error = EXCLUDED.last_error,
            updated_at = NOW()
        `,
        [
          session.id,
          session.name,
          session.phoneNumber,
          channel.id,
          channel.name,
          session.status,
          session.attendants,
          session.waiting,
          session.unread,
          session.lastHeartbeat,
          session.isDemo,
          session.qrCode,
          session.qrCodeDataUrl,
          session.lastError,
        ],
      );

      return this.getSessionByIdWithClient(client, session.id);
    });
  }

  async getConversationsBySession(sessionId: string) {
    const { rows } = await this.postgres.query<ConversationRow>(
      `
        SELECT
          id,
          session_id,
          session_name,
          contact,
          avatar_url,
          participant_id,
          owner,
          status,
          channel_name,
          waiting_time,
          unread,
          preview,
          last_message_at
        FROM conversations
        WHERE session_id = $1
        ORDER BY last_message_at DESC
      `,
      [sessionId],
    );

    return rows.map((row) => this.mapConversation(row, []));
  }

  async getConversation(sessionId: string, conversationId: string) {
    const { rows } = await this.postgres.query<ConversationRow>(
      `
        SELECT
          id,
          session_id,
          session_name,
          contact,
          avatar_url,
          participant_id,
          owner,
          status,
          channel_name,
          waiting_time,
          unread,
          preview,
          last_message_at
        FROM conversations
        WHERE session_id = $1 AND id = $2
      `,
      [sessionId, conversationId],
    );

    const row = rows[0];

    if (!row) {
      return null;
    }

    const messages = await this.getMessagesForConversation(
      sessionId,
      conversationId,
    );
    return this.mapConversation(row, messages);
  }

  async getAllConversations() {
    const { rows } = await this.postgres.query<ConversationRow>(`
      SELECT
        id,
        session_id,
        session_name,
        contact,
        avatar_url,
        participant_id,
        owner,
        status,
        channel_name,
        waiting_time,
        unread,
        preview,
        last_message_at
      FROM conversations
      ORDER BY last_message_at DESC
    `);

    return rows.map((row) => this.mapConversation(row, []));
  }

  async saveConversation(conversation: ConversationRecord) {
    return this.postgres.withTransaction(async (client) => {
      await client.query(
        `
          INSERT INTO conversations (
            id,
            session_id,
            session_name,
            contact,
            avatar_url,
            participant_id,
            owner,
            status,
            channel_name,
            waiting_time,
            unread,
            preview,
            last_message_at,
            updated_at
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8,
            $9, $10, $11, $12, $13, NOW()
          )
          ON CONFLICT (session_id, id) DO UPDATE SET
            session_name = EXCLUDED.session_name,
            contact = EXCLUDED.contact,
            avatar_url = EXCLUDED.avatar_url,
            participant_id = EXCLUDED.participant_id,
            owner = EXCLUDED.owner,
            status = EXCLUDED.status,
            channel_name = EXCLUDED.channel_name,
            waiting_time = EXCLUDED.waiting_time,
            unread = EXCLUDED.unread,
            preview = EXCLUDED.preview,
            last_message_at = EXCLUDED.last_message_at,
            updated_at = NOW()
        `,
        [
          conversation.id,
          conversation.sessionId,
          conversation.sessionName,
          conversation.contact,
          conversation.avatarUrl ?? null,
          conversation.participantId,
          conversation.owner,
          conversation.status,
          conversation.channelName,
          conversation.waitingTime,
          conversation.unread,
          conversation.preview,
          conversation.lastMessageAt,
        ],
      );

      for (const message of conversation.messages) {
        await this.upsertMessage(client, conversation.sessionId, message);
      }

      return this.getConversationByIdWithClient(
        client,
        conversation.sessionId,
        conversation.id,
      );
    });
  }

  async appendMessage(
    sessionId: string,
    conversationId: string,
    message: MessageRecord,
  ) {
    return this.postgres.withTransaction(async (client) => {
      const conversation = await this.getConversationByIdWithClient(
        client,
        sessionId,
        conversationId,
      );

      if (!conversation) {
        return null;
      }

      await this.upsertMessage(client, sessionId, message);

      const unread =
        message.direction === 'incoming'
          ? conversation.unread + 1
          : conversation.unread;

      await client.query(
        `
          UPDATE conversations
          SET
            preview = $3,
            waiting_time = 'agora',
            unread = $4,
            last_message_at = $5,
            updated_at = NOW()
          WHERE session_id = $1 AND id = $2
        `,
        [sessionId, conversationId, message.body, unread, message.timestamp],
      );

      return this.getConversationByIdWithClient(
        client,
        sessionId,
        conversationId,
      );
    });
  }

  async markConversationAsRead(sessionId: string, conversationId: string) {
    await this.postgres.query(
      `
        UPDATE conversations
        SET unread = 0, updated_at = NOW()
        WHERE session_id = $1 AND id = $2
      `,
      [sessionId, conversationId],
    );

    return this.getConversation(sessionId, conversationId);
  }

  private async restoreSessionsFromAuthDirectory() {
    if (!fs.existsSync(this.authDirectoryPath)) {
      return;
    }

    const directories = fs
      .readdirSync(this.authDirectoryPath, { withFileTypes: true })
      .filter(
        (entry) => entry.isDirectory() && entry.name.startsWith('session-'),
      )
      .map((entry) => entry.name.replace(/^session-/, ''));

    for (const sessionId of directories) {
      const existing = await this.getSession(sessionId);

      if (existing) {
        continue;
      }

      await this.saveSession({
        id: sessionId,
        name: `Sessao ${sessionId.slice(-6)}`,
        phoneNumber: 'Numero restaurado',
        channelId: 'restored',
        channelName: 'Restaurada',
        status: 'disconnected',
        attendants: 0,
        waiting: 0,
        unread: 0,
        lastHeartbeat: new Date().toISOString(),
        isDemo: false,
        qrCode: null,
        qrCodeDataUrl: null,
        lastError: null,
      });
    }
  }

  private sessionSelectQuery() {
    return `
      SELECT
        sessions.id,
        sessions.name,
        sessions.phone_number,
        sessions.channel_id,
        sessions.channel_name,
        sessions.status,
        sessions.attendants,
        sessions.waiting,
        sessions.unread,
        sessions.last_heartbeat,
        sessions.is_demo,
        sessions.qr_code,
        sessions.qr_code_data_url,
        sessions.last_error,
        stats.waiting_count AS aggregated_waiting,
        stats.unread_count AS aggregated_unread
      FROM whatsapp_sessions AS sessions
      LEFT JOIN (
        SELECT
          session_id,
          COUNT(*)::int AS waiting_count,
          COALESCE(SUM(unread), 0)::int AS unread_count
        FROM conversations
        GROUP BY session_id
      ) AS stats
        ON stats.session_id = sessions.id
    `;
  }

  private mapSession(row: SessionRow): SessionRecord {
    return {
      id: row.id,
      name: row.name,
      phoneNumber: row.phone_number,
      channelId: row.channel_id,
      channelName: row.channel_name,
      status: row.status,
      attendants: row.attendants,
      waiting: row.aggregated_waiting ?? row.waiting,
      unread: row.aggregated_unread ?? row.unread,
      lastHeartbeat: new Date(row.last_heartbeat).toISOString(),
      isDemo: row.is_demo,
      qrCode: row.qr_code,
      qrCodeDataUrl: row.qr_code_data_url,
      lastError: row.last_error,
    };
  }

  private mapConversation(
    row: ConversationRow,
    messages: MessageRecord[],
  ): ConversationRecord {
    return {
      id: row.id,
      sessionId: row.session_id,
      sessionName: row.session_name,
      contact: row.contact,
      avatarUrl: row.avatar_url,
      participantId: row.participant_id,
      owner: row.owner,
      status: row.status,
      channelName: row.channel_name,
      waitingTime: row.waiting_time,
      unread: row.unread,
      preview: row.preview,
      lastMessageAt: new Date(row.last_message_at).toISOString(),
      messages,
    };
  }

  private mapMessage(row: MessageRow): MessageRecord {
    return {
      id: row.id,
      conversationId: row.conversation_id,
      direction: row.direction,
      body: row.body,
      timestamp: new Date(row.message_timestamp).toISOString(),
      author: row.author,
    };
  }

  private async getMessagesForConversation(
    sessionId: string,
    conversationId: string,
  ) {
    const { rows } = await this.postgres.query<MessageRow>(
      `
        SELECT id, conversation_id, direction, body, message_timestamp, author
        FROM messages
        WHERE session_id = $1 AND conversation_id = $2
        ORDER BY message_timestamp ASC
      `,
      [sessionId, conversationId],
    );

    return rows.map((row) => this.mapMessage(row));
  }

  private async getSessionByIdWithClient(
    client: PoolClient,
    sessionId: string,
  ) {
    const { rows } = await client.query<SessionRow>(
      `
        ${this.sessionSelectQuery()}
        WHERE sessions.id = $1
      `,
      [sessionId],
    );

    return rows[0] ? this.mapSession(rows[0]) : null;
  }

  private async getConversationByIdWithClient(
    client: PoolClient,
    sessionId: string,
    conversationId: string,
  ) {
    const { rows } = await client.query<ConversationRow>(
      `
        SELECT
          id,
          session_id,
          session_name,
          contact,
          avatar_url,
          participant_id,
          owner,
          status,
          channel_name,
          waiting_time,
          unread,
          preview,
          last_message_at
        FROM conversations
        WHERE session_id = $1 AND id = $2
      `,
      [sessionId, conversationId],
    );

    const row = rows[0];

    if (!row) {
      return null;
    }

    const messageRows = await client.query<MessageRow>(
      `
        SELECT id, conversation_id, direction, body, message_timestamp, author
        FROM messages
        WHERE session_id = $1 AND conversation_id = $2
        ORDER BY message_timestamp ASC
      `,
      [sessionId, conversationId],
    );

    return this.mapConversation(
      row,
      messageRows.rows.map((messageRow) => this.mapMessage(messageRow)),
    );
  }

  private async upsertChannel(
    client: PoolClient,
    channelId: string,
    channelName: string,
  ) {
    const { rows } = await client.query<{
      id: string;
      name: string;
      color: string;
    }>(
      `
        INSERT INTO channels (id, name, color, updated_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (name) DO UPDATE SET
          updated_at = NOW()
        RETURNING id, name, color
      `,
      [channelId, channelName, this.resolveChannelColor(channelName)],
    );

    return rows[0];
  }

  private async upsertMessage(
    client: PoolClient,
    sessionId: string,
    message: MessageRecord,
  ) {
    await client.query(
      `
        INSERT INTO messages (
          id,
          session_id,
          conversation_id,
          direction,
          body,
          message_timestamp,
          author
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (id) DO UPDATE SET
          direction = EXCLUDED.direction,
          body = EXCLUDED.body,
          message_timestamp = EXCLUDED.message_timestamp,
          author = EXCLUDED.author
      `,
      [
        message.id,
        sessionId,
        message.conversationId,
        message.direction,
        message.body,
        message.timestamp,
        message.author,
      ],
    );
  }

  private resolveChannelColor(channelName: string) {
    const palette = [
      '#7fafff',
      '#5dfd8a',
      '#ffb84d',
      '#ff7d7d',
      '#66d9ef',
      '#f6bd60',
    ];

    const hash = [...channelName].reduce(
      (sum, char) => sum + char.charCodeAt(0),
      0,
    );
    return palette[hash % palette.length];
  }
}
