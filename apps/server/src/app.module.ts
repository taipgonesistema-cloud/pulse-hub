import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { WhatsappModule } from './whatsapp/whatsapp.module';

@Module({
  imports: [AuthModule, DashboardModule, WhatsappModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
