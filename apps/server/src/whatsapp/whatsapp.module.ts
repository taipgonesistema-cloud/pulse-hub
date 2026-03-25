import { Module } from '@nestjs/common';
import { PersistenceModule } from '../persistence/persistence.module';
import { WHATSAPP_ENGINE } from './engine/whatsapp-engine.token';
import { WppConnectEngine } from './engine/wppconnect.engine';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappService } from './whatsapp.service';
import { WhatsappStore } from './whatsapp.store';

@Module({
  imports: [PersistenceModule],
  controllers: [WhatsappController],
  providers: [
    WhatsappService,
    WhatsappStore,
    WppConnectEngine,
    {
      provide: WHATSAPP_ENGINE,
      useExisting: WppConnectEngine,
    },
  ],
  exports: [WhatsappService, WhatsappStore],
})
export class WhatsappModule {}
