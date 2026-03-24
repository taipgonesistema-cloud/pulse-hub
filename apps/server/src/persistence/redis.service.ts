import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  createClient,
  type RedisClientType,
  type RedisFunctions,
  type RedisModules,
  type RedisScripts,
} from 'redis';

type RedisClient = RedisClientType<RedisModules, RedisFunctions, RedisScripts>;

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly url = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
  private readonly publisher: RedisClient;
  private readonly subscriber: RedisClient;

  constructor() {
    this.publisher = createClient({ url: this.url });
    this.subscriber = this.publisher.duplicate();
  }

  async onModuleInit() {
    await Promise.all([this.publisher.connect(), this.subscriber.connect()]);
    this.logger.log('Redis conectado.');
  }

  async onModuleDestroy() {
    await Promise.allSettled([this.publisher.quit(), this.subscriber.quit()]);
  }

  async getJson<T>(key: string) {
    const raw = await this.publisher.get(key);

    if (!raw) {
      return null;
    }

    return JSON.parse(raw) as T;
  }

  async setJson(key: string, value: unknown, ttlSeconds?: number) {
    const payload = JSON.stringify(value);

    if (ttlSeconds) {
      await this.publisher.set(key, payload, { EX: ttlSeconds });
      return;
    }

    await this.publisher.set(key, payload);
  }

  async delete(key: string) {
    await this.publisher.del(key);
  }

  async publish(channel: string, payload: unknown) {
    await this.publisher.publish(channel, JSON.stringify(payload));
  }

  async subscribe<T>(
    channel: string,
    handler: (payload: T) => void | Promise<void>,
  ) {
    await this.subscriber.subscribe(channel, async (message) => {
      await handler(JSON.parse(message) as T);
    });
  }
}
