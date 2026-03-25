export type WhatsappEngineMessage = {
  id: string;
  chatId: string;
  contactId: string;
  body: string;
  timestamp: number;
  fromMe: boolean;
  chatName?: string | null;
  contactName?: string | null;
  contactPushName?: string | null;
};

export type WhatsappEngineChat = {
  id: string;
  name: string;
  unreadCount: number;
  lastMessageBody: string | null;
  isGroup: boolean;
};

export type WhatsappSessionCallbacks = {
  onQr: (qr: string) => Promise<void> | void;
  onAuthenticated: () => Promise<void> | void;
  onReady: () => Promise<void> | void;
  onAuthFailure: (message: string) => Promise<void> | void;
  onDisconnected: (reason: string | null) => Promise<void> | void;
  onMessage: (message: WhatsappEngineMessage) => Promise<void> | void;
  onInitError: (message: string) => Promise<void> | void;
};
