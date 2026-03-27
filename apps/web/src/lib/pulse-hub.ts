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

export type MessageRecord = {
  id: string;
  conversationId: string;
  direction: 'incoming' | 'outgoing' | 'internal';
  kind?: 'text' | 'image' | 'video' | 'audio' | 'document' | 'sticker' | 'media';
  body: string;
  mediaUrl?: string;
  mimeType?: string;
  fileName?: string;
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

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'supervisor' | 'attendant';
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SignInPayload = {
  email: string;
  password: string;
};

export type SignInResponse = {
  user: AuthUser;
  token: string;
};

const fallbackOverview: DashboardOverview = {
  product: 'Pulse Hub',
  phase: 'whatsapp-core',
  metrics: {
    connectedNumbers: 0,
    activeSessions: 0,
    onlineUsers: 0,
    waitingConversations: 0,
  },
  channels: [],
  sessions: [],
  conversations: [],
};

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3333';

export async function getDashboardOverview() {
  try {
    const response = await fetch(`${apiUrl}/dashboard/overview`, {
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error('Falha ao carregar dashboard.');
    }

    return (await response.json()) as DashboardOverview;
  } catch {
    return fallbackOverview;
  }
}

export async function signIn(payload: SignInPayload) {
  const response = await fetch(`${apiUrl}/auth/sign-in`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorPayload = (await response.json().catch(() => null)) as {
      message?: string | string[];
    } | null;
    const message = Array.isArray(errorPayload?.message)
      ? errorPayload.message[0]
      : errorPayload?.message;

    throw new Error(message ?? 'Falha ao autenticar usuario.');
  }

  return (await response.json()) as SignInResponse;
}
