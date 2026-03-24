import {
  Body,
  Controller,
  Get,
  MessageEvent,
  Param,
  Post,
  Sse,
} from '@nestjs/common';
import type { Observable } from 'rxjs';
import {
  type CreateWhatsappSessionDto,
  type SendConversationMessageDto,
} from './dto/create-session.dto';
import { WhatsappService } from './whatsapp.service';

@Controller('whatsapp')
export class WhatsappController {
  constructor(private readonly whatsappService: WhatsappService) {}

  @Get('sessions')
  getSessions() {
    return this.whatsappService.getSessions();
  }

  @Post('sessions')
  createSession(@Body() body: CreateWhatsappSessionDto) {
    return this.whatsappService.createSession(body);
  }

  @Post('sessions/:id/connect')
  connectSession(@Param('id') id: string) {
    return this.whatsappService.connectSession(id);
  }

  @Post('sessions/:id/disconnect')
  disconnectSession(@Param('id') id: string) {
    return this.whatsappService.disconnectSession(id);
  }

  @Get('sessions/:id/qr')
  getQrCode(@Param('id') id: string) {
    return this.whatsappService.getSessionQr(id);
  }

  @Get('sessions/:id/conversations')
  getConversations(@Param('id') id: string) {
    return this.whatsappService.getConversations(id);
  }

  @Get('sessions/:id/conversations/:conversationId/messages')
  getMessages(
    @Param('id') id: string,
    @Param('conversationId') conversationId: string,
  ) {
    return this.whatsappService.getMessages(id, conversationId);
  }

  @Post('sessions/:id/conversations/:conversationId/read')
  markConversationAsRead(
    @Param('id') id: string,
    @Param('conversationId') conversationId: string,
  ) {
    return this.whatsappService.markConversationAsRead(id, conversationId);
  }

  @Sse('sessions/:id/stream')
  streamSession(@Param('id') id: string): Observable<MessageEvent> {
    return this.whatsappService.streamSession(id);
  }

  @Post('sessions/:id/conversations/:conversationId/messages')
  sendMessage(
    @Param('id') id: string,
    @Param('conversationId') conversationId: string,
    @Body() body: SendConversationMessageDto,
  ) {
    return this.whatsappService.sendMessage(id, conversationId, body);
  }
}
