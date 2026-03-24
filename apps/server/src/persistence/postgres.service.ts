import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';

@Injectable()
export class PostgresService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PostgresService.name);
  private readonly pool = new Pool({
    connectionString:
      process.env.DATABASE_URL ??
      'postgres://postgres:postgres@127.0.0.1:5432/pulse_hub',
  });

  async onModuleInit() {
    await this.pool.query('SELECT 1');
    await this.initializeSchema();
    this.logger.log('Postgres conectado e schema validado.');
  }

  async onModuleDestroy() {
    await this.pool.end();
  }

  async query<T extends QueryResultRow>(sql: string, params: unknown[] = []) {
    return this.pool.query<T>(sql, params);
  }

  async withTransaction<T>(callback: (client: PoolClient) => Promise<T>) {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async initializeSchema() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS channels (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        color TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS whatsapp_sessions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        phone_number TEXT NOT NULL,
        channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE RESTRICT,
        channel_name TEXT NOT NULL,
        status TEXT NOT NULL,
        attendants INTEGER NOT NULL DEFAULT 0,
        waiting INTEGER NOT NULL DEFAULT 0,
        unread INTEGER NOT NULL DEFAULT 0,
        last_heartbeat TIMESTAMPTZ NOT NULL,
        is_demo BOOLEAN NOT NULL DEFAULT FALSE,
        qr_code TEXT,
        qr_code_data_url TEXT,
        last_error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT NOT NULL,
        session_id TEXT NOT NULL REFERENCES whatsapp_sessions(id) ON DELETE CASCADE,
        session_name TEXT NOT NULL,
        contact TEXT NOT NULL,
        avatar_url TEXT,
        participant_id TEXT NOT NULL,
        owner TEXT NOT NULL,
        status TEXT NOT NULL,
        channel_name TEXT NOT NULL,
        waiting_time TEXT NOT NULL,
        unread INTEGER NOT NULL DEFAULT 0,
        preview TEXT NOT NULL,
        last_message_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (session_id, id)
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        direction TEXT NOT NULL,
        body TEXT NOT NULL,
        message_timestamp TIMESTAMPTZ NOT NULL,
        author TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        FOREIGN KEY (session_id, conversation_id)
          REFERENCES conversations(session_id, id)
          ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_channels_name ON channels(name);
      CREATE INDEX IF NOT EXISTS idx_sessions_channel_id ON whatsapp_sessions(channel_id);
      CREATE INDEX IF NOT EXISTS idx_conversations_session_id ON conversations(session_id);
      CREATE INDEX IF NOT EXISTS idx_conversations_last_message_at ON conversations(last_message_at DESC);
      CREATE INDEX IF NOT EXISTS idx_messages_lookup ON messages(session_id, conversation_id, message_timestamp ASC);
    `);
  }
}
