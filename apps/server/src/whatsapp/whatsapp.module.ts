import { Module } from '@nestjs/common';
import { PersistenceModule } from '../persistence/persistence.module';
import { BaileysEngine } from './engine/baileys.engine';
import { WHATSAPP_ENGINE } from './engine/whatsapp-engine.token';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappService } from './whatsapp.service';
import { WhatsappStore } from './whatsapp.store';

@Module({
  imports: [PersistenceModule],
  controllers: [WhatsappController],
  providers: [
    WhatsappService,
    WhatsappStore,
    BaileysEngine,
    {
      provide: WHATSAPP_ENGINE,
      useExisting: BaileysEngine,
    },
  ],
  exports: [WhatsappService, WhatsappStore],
})
export class WhatsappModule {}
