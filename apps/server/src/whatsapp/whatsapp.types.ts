import type {
  ChannelRecord,
  ConversationRecord,
  SessionRecord,
} from '../data/mock-data';

export type DashboardOverview = {
  product: string;
  phase: string;
  metrics: {
    connectedNumbers: number;
    activeSessions: number;
    onlineUsers: number;
    waitingConversations: number;
  };
  channels: ChannelRecord[];
  sessions: SessionRecord[];
  conversations: ConversationRecord[];
};

export type SessionQrPayload = {
  session: SessionRecord;
  qr: {
    code: string | null;
    imageDataUrl: string | null;
    expiresInSeconds: number;
  };
};
