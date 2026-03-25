import { Module } from '@nestjs/common';
import { PersistenceModule } from '../persistence/persistence.module';
import { BaileysEngine } from './engine/baileys.engine';
import { WHATSAPP_ENGINE } from './engine/whatsapp-engine.token';
import { WhatsappWebEngine } from './engine/whatsapp-web.engine';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappService } from './whatsapp.service';
import { WhatsappStore } from './whatsapp.store';

@Module({
  imports: [PersistenceModule],
  controllers: [WhatsappController],
  providers: [
    WhatsappService,
    WhatsappStore,
    WhatsappWebEngine,
    BaileysEngine,
    {
      provide: WHATSAPP_ENGINE,
      useFactory: (
        whatsappWebEngine: WhatsappWebEngine,
        baileysEngine: BaileysEngine,
      ) => {
        const configuredEngine =
          process.env.WHATSAPP_ENGINE?.trim().toLowerCase() ?? 'webjs';

        return configuredEngine === 'baileys'
          ? baileysEngine
          : whatsappWebEngine;
      },
      inject: [WhatsappWebEngine, BaileysEngine],
    },
  ],
  exports: [WhatsappService, WhatsappStore],
})
export class WhatsappModule {}
