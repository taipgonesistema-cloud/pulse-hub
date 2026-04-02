export type ChannelRecord = {
  id: string;
  name: string;
  color: string;
  connectedNumbers: number;
};

export type SessionStatus =
  | 'demo'
  | 'idle'
  | 'initializing'
  | 'qr_ready'
  | 'active'
  | 'syncing'
  | 'disconnected'
  | 'error';

export type MessageDirection = 'incoming' | 'outgoing' | 'internal';

export type MessageRecord = {
  id: string;
  conversationId: string;
  direction: MessageDirection;
  body: string;
  timestamp: string;
  author: string;
};

export type ConversationRecord = {
  id: string;
  sessionId: string;
  sessionName: string;
  contact: string;
  avatarUrl?: string | null;
  participantId: string;
  owner: string;
  status: string;
  channelName: string;
  waitingTime: string;
  unread: number;
  preview: string;
  lastMessageAt: string;
  messages: MessageRecord[];
};

export type SessionRecord = {
  id: string;
  name: string;
  phoneNumber: string;
  channelId: string;
  channelName: string;
  status: SessionStatus;
  attendants: number;
  waiting: number;
  unread: number;
  lastHeartbeat: string;
  isDemo: boolean;
  qrCode: string | null;
  qrCodeDataUrl: string | null;
  lastError: string | null;
};
