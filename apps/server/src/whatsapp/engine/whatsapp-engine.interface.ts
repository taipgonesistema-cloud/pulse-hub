import type {
  WhatsappEngineChat,
  WhatsappEngineMessage,
  WhatsappSessionCallbacks,
} from './whatsapp-engine.types';

export interface WhatsappEngine {
  hasSessionClient(sessionId: string): boolean;
  connectSession(
    sessionId: string,
    callbacks: WhatsappSessionCallbacks,
  ): Promise<void>;
  disconnectSession(sessionId: string): Promise<void>;
  destroyAll(): Promise<void>;
  sendMessage(
    sessionId: string,
    participantId: string,
    body: string,
  ): Promise<void>;
  markConversationAsRead(
    sessionId: string,
    participantId: string,
  ): Promise<void>;
  listChats(sessionId: string): Promise<WhatsappEngineChat[]>;
  listMessages(
    sessionId: string,
    participantId: string,
    limit: number,
  ): Promise<WhatsappEngineMessage[]>;
  getAvatarUrl(
    sessionId: string,
    participantId: string,
  ): Promise<string | null>;
}
