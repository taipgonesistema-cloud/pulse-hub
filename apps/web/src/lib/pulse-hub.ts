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
  kanbanStage?: string;
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

export type ContactLabelRecord = {
  id: string;
  name: string;
  emoji?: string;
  color: string;
  createdBy?: string;
  updatedBy?: string;
  createdAt: string;
  updatedAt: string;
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
      sampleCount: number;
      previousSampleCount: number;
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

export type AuditLogRecord = {
  id: string;
  actorUserId?: string;
  actorName?: string;
  actorRole?: AuthUser['role'];
  action: string;
  resourceType: string;
  resourceId?: string;
  summary: string;
  details?: Record<string, unknown>;
  remoteAddr?: string;
  userAgent?: string;
  createdAt: string;
};

export type InstagramPublishStatus = {
  configured: boolean;
  imageHostingConfigured: boolean;
  userId?: string;
};

export type InstagramPublishResult = {
  mode: 'feed' | 'story';
  creationId: string;
  publishedId: string;
  imageUrl: string;
};

export type SignInPayload = {
  email: string;
  password: string;
};

export type SignInResponse = {
  user: AuthUser;
  csrfToken: string;
};

export type CurrentUserResponse = {
  user: AuthUser;
  csrfToken: string;
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
      averageSeconds: 0,
      deltaSeconds: 0,
      sampleCount: 0,
      previousSampleCount: 0,
      targetSeconds: 120,
      peakLabel: 'Sem dados',
      points: [],
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
export const authCsrfStorageKey = 'pulse-hub.auth-csrf';

export function getStoredAuthUser() {
  return null;
}

export function getStoredCsrfToken() {
  if (typeof window === 'undefined') {
    return '';
  }

  return window.localStorage.getItem(authCsrfStorageKey) ?? '';
}

export function persistCsrfToken(token: string) {
  if (typeof window === 'undefined') {
    return;
  }

  if (!token) {
    window.localStorage.removeItem(authCsrfStorageKey);
    return;
  }

  window.localStorage.setItem(authCsrfStorageKey, token);
}

export function persistAuthSession(result: SignInResponse) {
  persistCsrfToken(result.csrfToken);
}

export function clearStoredAuthSession() {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.removeItem(authCsrfStorageKey);
}

export async function authFetch(input: string, init?: RequestInit) {
  const method = (init?.method ?? 'GET').toUpperCase();
  const headers = new Headers(init?.headers ?? undefined);
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const csrfToken = getStoredCsrfToken();
    if (csrfToken) {
      headers.set('X-CSRF-Token', csrfToken);
    }
  }

  return fetch(input, {
    ...init,
    headers,
    credentials: init?.credentials ?? 'include',
  });
}

export function buildAuthenticatedWebSocketUrl(baseUrl: string) {
  const url = new URL(baseUrl);

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
      credentials: 'include',
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
    credentials: 'include',
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

  return (await response.json()) as CurrentUserResponse;
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

export async function listAuditLogs(limit = 50) {
  const url = new URL(`${apiUrl}/auth/audit-logs`);
  url.searchParams.set('limit', String(limit));

  const response = await authFetch(url.toString(), {
    cache: 'no-store',
  });

  if (!response.ok) {
    const errorPayload = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(errorPayload?.message ?? 'Falha ao carregar audit log.');
  }

  return (await response.json()) as AuditLogRecord[];
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

export async function getInstagramPublishStatus() {
	const response = await authFetch(`${apiUrl}/instagram/status`, {
		cache: 'no-store',
	});

	if (!response.ok) {
		const errorPayload = (await response.json().catch(() => null)) as { message?: string } | null;
		throw new Error(errorPayload?.message ?? 'Falha ao carregar integracao do Instagram.');
	}

	return (await response.json()) as InstagramPublishStatus;
}

export async function publishInstagramContent(payload: {
	mode: 'feed' | 'story';
	caption?: string;
	imageUrl?: string;
	file?: File | null;
}) {
	const formData = new FormData();
	if (payload.caption?.trim()) {
		formData.set('caption', payload.caption.trim());
	}
	if (payload.imageUrl?.trim()) {
		formData.set('imageUrl', payload.imageUrl.trim());
	}
	if (payload.file) {
		formData.set('file', payload.file);
	}

	const response = await authFetch(`${apiUrl}/instagram/${payload.mode}`, {
		method: 'POST',
		body: formData,
	});

	if (!response.ok) {
		const errorPayload = (await response.json().catch(() => null)) as { message?: string } | null;
		throw new Error(errorPayload?.message ?? 'Falha ao publicar no Instagram.');
	}

	return (await response.json()) as InstagramPublishResult;
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
