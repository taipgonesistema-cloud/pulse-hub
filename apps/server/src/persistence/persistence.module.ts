import { Global, Module } from '@nestjs/common';
import { PostgresService } from './postgres.service';
import { RedisService } from './redis.service';

@Global()
@Module({
  providers: [PostgresService, RedisService],
  exports: [PostgresService, RedisService],
})
export class PersistenceModule {}
