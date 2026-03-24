import { Module } from '@nestjs/common';
import { PersistenceModule } from '../persistence/persistence.module';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappService } from './whatsapp.service';
import { WhatsappStore } from './whatsapp.store';

@Module({
  imports: [PersistenceModule],
  controllers: [WhatsappController],
  providers: [WhatsappService, WhatsappStore],
  exports: [WhatsappService, WhatsappStore],
})
export class WhatsappModule {}
