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

export type MessageReplyRecord = {
  messageId: string;
  author?: string;
  body?: string;
  kind?: 'text' | 'image' | 'video' | 'audio' | 'document' | 'sticker' | 'media';
};

export type MessageReaction = {
  emoji: string;
  count: number;
  fromMe?: boolean;
};

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
  replyTo?: MessageReplyRecord;
  reactions?: MessageReaction[];
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
  dashboard: {
    snapshot: {
      activeSessions: number;
      onlineUsers: number;
      recentConversations: number;
      teamCount: number;
    };
    leaderboard: Array<{
      id: string;
      label: string;
      avatarUrl?: string | null;
      score: number;
      volume: number;
      volumeLabel: string;
      rank: number;
    }>;
  };
  analytics: {
    responseVelocity: {
      averageSeconds: number;
      deltaSeconds: number;
      targetSeconds: number;
      peakLabel: string;
      points: Array<{
        label: string;
        averageSeconds: number;
      }>;
    };
    healthScore: number;
    resolvedRate: number;
    totalConversations: number;
    unreadVolume: number;
    waitingVolume: number;
    channelTotals: {
      whatsapp: number;
      instagram: number;
      facebook: number;
    };
    weeklyChannelSeries: Array<{
      day: string;
      channel: 'whatsapp' | 'instagram' | 'facebook';
      value: number;
    }>;
    heatmapRows: Array<{
      day: string;
      values: number[];
    }>;
    resolvedTickets: Array<{
      id: string;
      customer: string;
      customerAvatar?: string | null;
      channel: 'whatsapp' | 'instagram' | 'facebook';
      agent: string;
      lastActivityAt: string;
      statusLabel: string;
    }>;
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

export type AuthSessionRecord = {
  id: string;
  userId: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  userAgent?: string;
  remoteAddr?: string;
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

export type CreateUserPayload = {
  email: string;
  name: string;
  password: string;
  role: AuthUser['role'];
  isActive?: boolean;
};

export type UpdateUserPayload = {
  name: string;
  password?: string;
  role: AuthUser['role'];
  isActive?: boolean;
};

export type QuickReplyVisibilityScope = 'all' | 'user';
export type QuickReplyStatus = 'active' | 'inactive';

export type QuickReplyRecord = {
  id: string;
  name: string;
  shortcut: string;
  content: string;
  category?: string;
  visibilityScope: QuickReplyVisibilityScope;
  visibilityUserId?: string;
  status: QuickReplyStatus;
  createdByUserId?: string;
  createdBy?: string;
  updatedByUserId?: string;
  updatedBy?: string;
  createdAt: string;
  updatedAt: string;
};

export type SaveQuickReplyPayload = {
  name: string;
  shortcut: string;
  content: string;
  category?: string;
  visibilityScope: QuickReplyVisibilityScope;
  visibilityUserId?: string;
  status: QuickReplyStatus;
};

export const fallbackOverview: DashboardOverview = {
  product: 'Pulse Hub',
  phase: 'whatsapp-core',
  metrics: {
    connectedNumbers: 0,
    activeSessions: 0,
    onlineUsers: 0,
    waitingConversations: 0,
  },
  dashboard: {
    snapshot: {
      activeSessions: 0,
      onlineUsers: 0,
      recentConversations: 0,
      teamCount: 0,
    },
    leaderboard: [],
  },
  analytics: {
    responseVelocity: {
      averageSeconds: 102,
      deltaSeconds: 0,
      targetSeconds: 120,
      peakLabel: 'Sem dados',
      points: [
        { label: '08:00 AM', averageSeconds: 102 },
        { label: '10:00 AM', averageSeconds: 102 },
        { label: '12:00 PM', averageSeconds: 102 },
        { label: '02:00 PM', averageSeconds: 102 },
        { label: '04:00 PM', averageSeconds: 102 },
        { label: '06:00 PM', averageSeconds: 102 },
      ],
    },
    healthScore: 0,
    resolvedRate: 0,
    totalConversations: 0,
    unreadVolume: 0,
    waitingVolume: 0,
    channelTotals: {
      whatsapp: 0,
      instagram: 0,
      facebook: 0,
    },
    weeklyChannelSeries: [],
    heatmapRows: [],
    resolvedTickets: [],
  },
  channels: [],
  sessions: [],
  conversations: [],
};

export const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3333';

export const authTokenStorageKey = 'pulse-hub.auth-token';
export const authUserStorageKey = 'pulse-hub.auth-user';

export function getStoredAuthToken() {
  if (typeof window === 'undefined') {
    return '';
  }

  return window.localStorage.getItem(authTokenStorageKey) ?? '';
}

export function getStoredAuthUser() {
  if (typeof window === 'undefined') {
    return null;
  }

  const rawUser = window.localStorage.getItem(authUserStorageKey);
  if (!rawUser) {
    return null;
  }

  try {
    return JSON.parse(rawUser) as AuthUser;
  } catch {
    return null;
  }
}

export function persistAuthSession(result: SignInResponse) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(authTokenStorageKey, result.token);
  window.localStorage.setItem(authUserStorageKey, JSON.stringify(result.user));
}

export function clearStoredAuthSession() {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.removeItem(authTokenStorageKey);
  window.localStorage.removeItem(authUserStorageKey);
}

export async function authFetch(input: string, init?: RequestInit) {
  const token = getStoredAuthToken();
  const headers = new Headers(init?.headers ?? undefined);
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  return fetch(input, {
    ...init,
    headers,
  });
}

export function buildAuthenticatedWebSocketUrl(baseUrl: string) {
  const token = getStoredAuthToken();
  const url = new URL(baseUrl);
  if (token) {
    url.searchParams.set('token', token);
  }

  if (url.protocol === 'https:') {
    url.protocol = 'wss:';
  } else if (url.protocol === 'http:') {
    url.protocol = 'ws:';
  }

  return url.toString();
}

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

export async function getCurrentUser() {
  const response = await authFetch(`${apiUrl}/auth/me`, {
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error('Falha ao validar sessao atual.');
  }

  return (await response.json()) as AuthUser;
}

export async function signOutRequest() {
  const response = await authFetch(`${apiUrl}/auth/sign-out`, {
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error('Falha ao encerrar a sessao atual.');
  }
}

export async function listUsers() {
  const response = await authFetch(`${apiUrl}/auth/users`, {
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error('Falha ao carregar usuarios.');
  }

  return (await response.json()) as AuthUser[];
}

export async function createUser(payload: CreateUserPayload) {
  const response = await authFetch(`${apiUrl}/auth/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorPayload = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(errorPayload?.message ?? 'Falha ao criar usuario.');
  }

  return (await response.json()) as AuthUser;
}

export async function updateUser(userId: string, payload: UpdateUserPayload) {
  const response = await authFetch(`${apiUrl}/auth/users/${encodeURIComponent(userId)}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorPayload = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(errorPayload?.message ?? 'Falha ao atualizar usuario.');
  }

  return (await response.json()) as AuthUser;
}

export async function listUserSessions(userId: string) {
  const response = await authFetch(`${apiUrl}/auth/users/${encodeURIComponent(userId)}/sessions`, {
    cache: 'no-store',
  });

  if (!response.ok) {
    const errorPayload = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(errorPayload?.message ?? 'Falha ao carregar sessoes do usuario.');
  }

  return (await response.json()) as AuthSessionRecord[];
}

export async function revokeUserSession(userId: string, sessionId: string) {
  const response = await authFetch(
    `${apiUrl}/auth/users/${encodeURIComponent(userId)}/sessions/${encodeURIComponent(sessionId)}/revoke`,
    {
      method: 'POST',
    },
  );

  if (!response.ok) {
    const errorPayload = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(errorPayload?.message ?? 'Falha ao revogar a sessao.');
  }
}

export async function listQuickReplies(query?: string) {
  const url = new URL(`${apiUrl}/whatsapp/quick-replies`);
  if (query?.trim()) {
    url.searchParams.set('q', query.trim());
  }

  const response = await authFetch(url.toString(), {
    cache: 'no-store',
  });

  if (!response.ok) {
    const errorPayload = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(errorPayload?.message ?? 'Falha ao carregar respostas rapidas.');
  }

  return (await response.json()) as QuickReplyRecord[];
}

export async function autocompleteQuickReplies(query: string) {
  const url = new URL(`${apiUrl}/whatsapp/quick-replies/autocomplete`);
  if (query.trim()) {
    url.searchParams.set('q', query.trim());
  }

  const response = await authFetch(url.toString(), {
    cache: 'no-store',
  });

  if (!response.ok) {
    const errorPayload = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(errorPayload?.message ?? 'Falha ao buscar respostas rapidas.');
  }

  return (await response.json()) as QuickReplyRecord[];
}

export async function createQuickReply(payload: SaveQuickReplyPayload) {
  const response = await authFetch(`${apiUrl}/whatsapp/quick-replies`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorPayload = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(errorPayload?.message ?? 'Falha ao criar resposta rapida.');
  }

  return (await response.json()) as QuickReplyRecord;
}

export async function updateQuickReply(quickReplyId: string, payload: SaveQuickReplyPayload) {
  const response = await authFetch(`${apiUrl}/whatsapp/quick-replies/${encodeURIComponent(quickReplyId)}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorPayload = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(errorPayload?.message ?? 'Falha ao atualizar resposta rapida.');
  }

  return (await response.json()) as QuickReplyRecord;
}

export async function deleteQuickReply(quickReplyId: string) {
  const response = await authFetch(`${apiUrl}/whatsapp/quick-replies/${encodeURIComponent(quickReplyId)}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const errorPayload = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(errorPayload?.message ?? 'Falha ao excluir resposta rapida.');
  }
}
