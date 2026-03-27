'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import {
  BarChart3,
  BadgeCheck,
  Bell,
  Briefcase,
  Camera,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  ContactRound,
  Grid3X3,
  Heart,
  Home,
  LayoutGrid,
  LogOut,
  Mail,
  MoreVertical,
  Mic,
  MessageCircle,
  MessageSquarePlus,
  Phone,
  Plus,
  QrCode,
  RefreshCw,
  Reply,
  Search,
  Send,
  Settings,
  SlidersHorizontal,
  Smile,
  Sparkles,
  Video,
  WalletCards,
  Wifi,
} from 'lucide-react';
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react';
import type {
  AuthUser,
  ChannelRecord,
  ConversationRecord,
  DashboardOverview,
  MessageRecord,
  SessionRecord,
} from '@/lib/pulse-hub';

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3333';

const statusLabel: Record<SessionRecord['status'], string> = {
  demo: 'Demo',
  idle: 'Pronta',
  initializing: 'Iniciando',
  qr_ready: 'QR pronto',
  active: 'Online',
  syncing: 'Sync',
  disconnected: 'Offline',
  error: 'Erro',
};

const statusTone: Record<SessionRecord['status'], string> = {
  demo: 'bg-zinc-800 text-zinc-300',
  idle: 'bg-zinc-800 text-zinc-300',
  initializing: 'bg-blue-500/15 text-blue-300',
  qr_ready: 'bg-blue-500/15 text-blue-300',
  active: 'bg-emerald-500/15 text-emerald-300',
  syncing: 'bg-sky-500/15 text-sky-300',
  disconnected: 'bg-zinc-800 text-zinc-400',
  error: 'bg-rose-500/15 text-rose-300',
};

const quickReplies = [
  'Check inventory',
  'Send pricing guide',
  'Confirm appointment',
];

const navigationItems: Array<{
  id: WorkspaceView;
  label: string;
  icon: typeof Home;
}> = [
  { id: 'dashboard', label: 'Dashboard', icon: Home },
  { id: 'conversations', label: 'Conversations', icon: MessageCircle },
  { id: 'contacts', label: 'Contacts', icon: ContactRound },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'settings', label: 'Settings', icon: Settings },
];

type WorkspaceView =
  | 'dashboard'
  | 'conversations'
  | 'contacts'
  | 'analytics'
  | 'settings';

type ConversationFilter = 'all' | 'direct' | 'groups' | 'unread';

type Props = {
  initialOverview: DashboardOverview;
};

type SessionStreamEvent = {
  sessionId: string;
  conversationId?: string;
  type:
    | 'session.updated'
    | 'conversation.synced'
    | 'message.created'
    | 'typing.started';
  direction?: 'incoming' | 'outgoing';
  emittedAt?: string;
};

export function DashboardClient({ initialOverview }: Props) {
  const router = useRouter();
  const [overview, setOverview] = useState(() => sanitizeOverview(initialOverview));
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [activeView, setActiveView] = useState<WorkspaceView>(
    initialOverview.sessions.length > 0 ? 'dashboard' : 'settings',
  );
  const [selectedSessionId, setSelectedSessionId] = useState(
    initialOverview.sessions[0]?.id ?? '',
  );
  const [selectedConversationId, setSelectedConversationId] = useState(
    initialOverview.conversations[0]?.id ?? '',
  );
  const [messages, setMessages] = useState<MessageRecord[]>([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [conversationFilter, setConversationFilter] = useState<ConversationFilter>('all');
  const [contactsFilter, setContactsFilter] = useState<ConversationFilter>('all');
  const [contactsAudienceFilter, setContactsAudienceFilter] = useState<'all' | 'verified'>('all');
  const [contactsChannelFilter, setContactsChannelFilter] = useState<
    'all' | 'whatsapp' | 'instagram' | 'facebook'
  >('all');
  const [showAdvancedContactsFilters, setShowAdvancedContactsFilters] = useState(false);
  const [contactsSearch, setContactsSearch] = useState('');
  const [globalSearch, setGlobalSearch] = useState('');
  const [selectedContactId, setSelectedContactId] = useState(
    initialOverview.conversations[0]?.id ?? '',
  );
  const [typingConversationId, setTypingConversationId] = useState<string | null>(
    null,
  );
  const [sessionForm, setSessionForm] = useState({
    name: '',
    phoneNumber: '',
    channelName: '',
  });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const shouldStickToBottomRef = useRef(true);
  const lastConversationAnchorRef = useRef<string | null>(null);
  const isDashboardView = activeView === 'dashboard';
  const isAnalyticsView = activeView === 'analytics';
  const isContactsView = activeView === 'contacts';
  const isConversationsView = activeView === 'conversations';

  const selectedSession = useMemo(
    () =>
      overview.sessions.find((session) => session.id === selectedSessionId) ??
      overview.sessions[0],
    [overview.sessions, selectedSessionId],
  );

  const allSessionConversations = useMemo(
    () => {
      if (!isConversationsView) {
        return [] as ConversationRecord[];
      }

      return overview.conversations.filter(
        (conversation) => conversation.sessionId === selectedSession?.id,
      );
    },
    [isConversationsView, overview.conversations, selectedSession?.id],
  );

  const sessionConversations = useMemo(
    () => filterConversations(allSessionConversations, conversationFilter),
    [allSessionConversations, conversationFilter],
  );

  const selectedConversation = useMemo(
    () => {
      if (!isConversationsView) {
        return undefined;
      }

      return (
        sessionConversations.find(
          (conversation) => conversation.id === selectedConversationId,
        ) ?? sessionConversations[0]
      );
    },
    [isConversationsView, selectedConversationId, sessionConversations],
  );

  const contacts = useMemo(
    () => (isContactsView ? overview.conversations : ([] as ConversationRecord[])),
    [isContactsView, overview.conversations],
  );

  const filteredContacts = useMemo(() => {
    if (!isContactsView) {
      return [] as ConversationRecord[];
    }

    const baseContacts = filterConversations(contacts, contactsFilter);
    const searchFiltered = baseContacts.filter((contact) => {
      const term = contactsSearch.trim().toLowerCase();
      if (!term) {
        return true;
      }

      return [contact.contact, contact.participantId, contact.channelName, contact.owner]
        .join(' ')
        .toLowerCase()
        .includes(term);
    });

    return searchFiltered.filter((contact) => {
      if (contactsAudienceFilter === 'verified' && !isVerifiedContact(contact)) {
        return false;
      }

      if (contactsChannelFilter !== 'all' && getContactChannelKey(contact) !== contactsChannelFilter) {
        return false;
      }

      return true;
    });
  }, [
    contacts,
    contactsAudienceFilter,
    contactsChannelFilter,
    contactsFilter,
    contactsSearch,
    isContactsView,
  ]);

  const selectedContact = useMemo(
    () => {
      if (!isContactsView) {
        return undefined;
      }

      return filteredContacts.find((contact) => contact.id === selectedContactId) ?? filteredContacts[0];
    },
    [filteredContacts, isContactsView, selectedContactId],
  );

  const conversationFilterOptions = useMemo(
    () => {
      if (!isConversationsView) {
        return [] as Array<{ id: ConversationFilter; label: string; count: number }>;
      }

      return [
      {
        id: 'all' as const,
        label: 'Todas',
        count: allSessionConversations.length,
      },
      {
        id: 'direct' as const,
        label: 'Conversas',
        count: allSessionConversations.filter((conversation) => !isGroupConversation(conversation))
          .length,
      },
      {
        id: 'groups' as const,
        label: 'Grupos',
        count: allSessionConversations.filter((conversation) => isGroupConversation(conversation))
          .length,
      },
      {
        id: 'unread' as const,
        label: 'Nao lidas',
        count: allSessionConversations.filter((conversation) => conversation.unread > 0).length,
      },
      ];
    },
    [allSessionConversations, isConversationsView],
  );

  const contactFilterOptions = useMemo(
    () => {
      if (!isContactsView) {
        return [] as Array<{ id: ConversationFilter; label: string; count: number }>;
      }

      return [
      {
        id: 'all' as const,
        label: 'Todos',
        count: contacts.length,
      },
      {
        id: 'direct' as const,
        label: 'Conversas',
        count: contacts.filter((contact) => !isGroupConversation(contact)).length,
      },
      {
        id: 'groups' as const,
        label: 'Grupos',
        count: contacts.filter((contact) => isGroupConversation(contact)).length,
      },
      {
        id: 'unread' as const,
        label: 'Nao lidos',
        count: contacts.filter((contact) => contact.unread > 0).length,
      },
      ];
    },
    [contacts, isContactsView],
  );

  const activeSessionId = selectedSession?.id ?? null;
  const activeSessionStatus = selectedSession?.status ?? null;
  const activeConversationId = selectedConversation?.id ?? null;

  const dashboardConversations = useMemo(
    () => (isDashboardView ? overview.conversations.slice(0, 3) : []),
    [isDashboardView, overview.conversations],
  );

  const dashboardLeaderboard = useMemo(
    () =>
      (isDashboardView ? overview.conversations.slice(0, 3) : []).map((conversation, index) => ({
        id: conversation.id,
        label: conversation.contact,
        avatarUrl: conversation.avatarUrl,
        score: [94, 88, 82][index] ?? 79,
        closed: [142, 128, 115][index] ?? 96,
        rank: index + 1,
      })),
    [isDashboardView, overview.conversations],
  );

  const queueBreakdown = useMemo(() => {
    if (!isDashboardView) {
      return { whatsapp: 0, facebook: 0, instagram: 0 };
    }

    const channels = { whatsapp: 0, facebook: 0, instagram: 0 };
    for (const conversation of overview.conversations) {
      const key = getContactChannelKey(conversation);
      channels[key] += 1;
    }
    return channels;
  }, [isDashboardView, overview.conversations]);

  const analyticsModel = useMemo(() => {
    if (!isAnalyticsView) {
      return null;
    }

    const conversations = overview.conversations;
    const totalConversations = conversations.length;
    const unreadVolume = conversations.reduce((sum, conversation) => sum + conversation.unread, 0);
    const waitingVolume = overview.sessions.reduce((sum, session) => sum + session.waiting, 0);
    const resolvedRate = totalConversations === 0
      ? 94.2
      : Number((Math.max(totalConversations - unreadVolume, 0) / totalConversations * 100).toFixed(1));
    const csat = Math.min(4.9, Math.max(4.2, 4.5 + resolvedRate / 200));
    const responseMinutes = Math.max(1.2, Number((1.2 + waitingVolume / 120).toFixed(1)));

    const channelTotals = {
      whatsapp: 0,
      instagram: 0,
      facebook: 0,
    };
    for (const conversation of conversations) {
      channelTotals[getContactChannelKey(conversation)] += 1;
    }

    const weeklyChannelSeries = [
      { day: 'MON', channel: 'whatsapp', value: Math.max(30, Math.min(95, channelTotals.whatsapp + 18)) },
      { day: 'TUE', channel: 'whatsapp', value: Math.max(24, Math.min(88, channelTotals.whatsapp + 5)) },
      { day: 'WED', channel: 'whatsapp', value: Math.max(42, Math.min(100, channelTotals.whatsapp + 28)) },
      { day: 'THU', channel: 'instagram', value: Math.max(18, Math.min(72, channelTotals.instagram + 26)) },
      { day: 'FRI', channel: 'whatsapp', value: Math.max(28, Math.min(92, channelTotals.whatsapp + 12)) },
      { day: 'SAT', channel: 'instagram', value: Math.max(14, Math.min(60, channelTotals.instagram + 18)) },
      { day: 'SUN', channel: 'instagram', value: Math.max(12, Math.min(48, channelTotals.instagram + 10)) },
    ];

    const heatmapRows = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].map((day, dayIndex) => ({
      day,
      values: Array.from({ length: 12 }, (_, slotIndex) => {
        const seed = (dayIndex * 17 + slotIndex * 13 + totalConversations * 3) % 100;
        return Math.max(6, Math.min(100, dayIndex < 5 ? seed + 12 : seed - 8));
      }),
    }));

    const resolvedTickets = conversations.slice(0, 5).map((conversation, index) => ({
      id: `#TKT-${98421 + index}`,
      customer: conversation.contact,
      customerAvatar: conversation.avatarUrl,
      channel: getContactChannelMeta(conversation),
      agent: ['Alex Rivera', 'Sarah Chen', 'Marcus Thorne', 'Avery Chen', 'Liam Vance'][index] ?? 'Ops Agent',
      resolutionTime: ['14m 20s', '08m 15s', '22m 45s', '11m 05s', '17m 32s'][index] ?? '09m 40s',
    }));

    return {
      csat: Number(csat.toFixed(1)),
      responseMinutes,
      resolvedRate,
      totalConversations,
      unreadVolume,
      waitingVolume,
      weeklyChannelSeries,
      heatmapRows,
      resolvedTickets,
    };
  }, [isAnalyticsView, overview.conversations, overview.sessions]);

  const queueLabel = useMemo(() => {
    if (!isConversationsView) {
      return 'No session selected';
    }

    if (!selectedSession) {
      return 'No session selected';
    }

    return `${selectedSession.channelName} queue`;
  }, [isConversationsView, selectedSession]);

  const contactInfo = useMemo(() => {
    if (!isConversationsView) {
      return {
        email: 'contact@pulsehub.local',
        phone: selectedSession?.phoneNumber ?? 'No phone linked',
      };
    }

    if (!selectedConversation) {
      return {
        email: 'contact@pulsehub.local',
        phone: selectedSession?.phoneNumber ?? 'No phone linked',
      };
    }

    const safeName = selectedConversation.contact
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '.');

    return {
      email: `${safeName}@pulsehub.local`,
      phone: selectedConversation.participantId,
    };
  }, [isConversationsView, selectedConversation, selectedSession?.phoneNumber]);

  const signOut = useCallback(() => {
    window.localStorage.removeItem('pulse-hub.auth-token');
    window.localStorage.removeItem('pulse-hub.auth-user');
    router.push('/login');
  }, [router]);

  useEffect(() => {
    const token = window.localStorage.getItem('pulse-hub.auth-token');
    const rawUser = window.localStorage.getItem('pulse-hub.auth-user');

    if (!token || !rawUser) {
      router.replace('/login');
      return;
    }

    try {
      setAuthUser(JSON.parse(rawUser) as AuthUser);
      setIsAuthReady(true);
    } catch {
      window.localStorage.removeItem('pulse-hub.auth-token');
      window.localStorage.removeItem('pulse-hub.auth-user');
      router.replace('/login');
    }
  }, [router]);

  const loadOverview = useCallback(async () => {
    const response = await fetch(`${apiUrl}/dashboard/overview`, {
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error('Nao foi possivel atualizar a dashboard.');
    }

        const data = (await response.json()) as DashboardOverview;
        setOverview(sanitizeOverview(data));
  }, []);

  const loadMessages = useCallback(
    async (
      sessionId: string,
      conversationId: string,
      options?: { showLoading?: boolean },
    ) => {
      if (options?.showLoading ?? true) {
        setIsLoadingMessages(true);
      }

      try {
        const response = await fetch(
          `${apiUrl}/whatsapp/sessions/${sessionId}/conversations/${conversationId}/messages`,
          { cache: 'no-store' },
        );

        if (!response.ok) {
          throw new Error('Nao foi possivel carregar as mensagens.');
        }

        const data = (await response.json()) as MessageRecord[];
        setMessages(data);
        setOverview((current) => {
          let hasChanges = false;

          const conversations = current.conversations.map((conversation) => {
            if (
              conversation.sessionId !== sessionId ||
              conversation.id !== conversationId ||
              conversation.unread === 0
            ) {
              return conversation;
            }

            hasChanges = true;
            return {
              ...conversation,
              unread: 0,
            };
          });

          if (!hasChanges) {
            return current;
          }

          return {
            ...current,
            conversations,
          };
        });
      } finally {
        if (options?.showLoading ?? true) {
          setIsLoadingMessages(false);
        }
      }
    },
    [],
  );

  const markConversationAsRead = useCallback(
    async (sessionId: string, conversationId: string) => {
      setOverview((current) => {
        let hasChanges = false;

        const conversations = current.conversations.map((conversation) => {
          if (
            conversation.sessionId !== sessionId ||
            conversation.id !== conversationId ||
            conversation.unread === 0
          ) {
            return conversation;
          }

          hasChanges = true;
          return {
            ...conversation,
            unread: 0,
          };
        });

        if (!hasChanges) {
          return current;
        }

        return {
          ...current,
          conversations,
        };
      });

      try {
        await fetch(
          `${apiUrl}/whatsapp/sessions/${sessionId}/conversations/${conversationId}/read`,
          {
            method: 'POST',
          },
        );
      } catch {
        void loadOverview().catch(() => undefined);
      }
    },
    [loadOverview],
  );

  useEffect(() => {
    if (!isConversationsView) {
      return;
    }

    if (!selectedSession) {
      setSelectedConversationId('');
      return;
    }

    const currentConversationExists = sessionConversations.some(
      (conversation) => conversation.id === selectedConversationId,
    );

    if (!currentConversationExists) {
      setSelectedConversationId(sessionConversations[0]?.id ?? '');
    }
  }, [isConversationsView, selectedConversationId, selectedSession, sessionConversations]);

  useEffect(() => {
    if (!isContactsView) {
      return;
    }

    const currentContactExists = filteredContacts.some(
      (contact) => contact.id === selectedContactId,
    );

    if (!currentContactExists) {
      setSelectedContactId(filteredContacts[0]?.id ?? '');
    }
  }, [filteredContacts, isContactsView, selectedContactId]);

  useEffect(() => {
    if (!isConversationsView) {
      return;
    }

    if (!isAuthReady) {
      return;
    }

    if (!selectedSession) {
      return;
    }

    const intervalMs =
      selectedSession.status === 'active'
        ? 2000
        : ['initializing', 'qr_ready', 'syncing'].includes(selectedSession.status)
          ? 2500
          : null;

    if (!intervalMs) {
      return;
    }

    const interval = window.setInterval(() => {
      void loadOverview().catch(() => undefined);
    }, intervalMs);

    return () => window.clearInterval(interval);
  }, [isAuthReady, loadOverview, selectedSession]);

  useEffect(() => {
    if (!isAuthReady) {
      return;
    }

    if (!activeSessionId || !activeConversationId) {
      setMessages([]);
      return;
    }

    void markConversationAsRead(activeSessionId, activeConversationId).catch(
      () => undefined,
    );

    void loadMessages(activeSessionId, activeConversationId).catch(() => {
      setMessages([]);
    });
  }, [
    activeConversationId,
    activeSessionId,
    isConversationsView,
    isAuthReady,
    loadMessages,
    markConversationAsRead,
  ]);

  useEffect(() => {
    if (!isConversationsView) {
      return;
    }

    if (!activeSessionId || !activeConversationId || activeSessionStatus !== 'active') {
      return;
    }

    const interval = window.setInterval(() => {
      void loadMessages(activeSessionId, activeConversationId, {
        showLoading: false,
      }).catch(() => undefined);
    }, 4000);

    return () => window.clearInterval(interval);
  }, [
    activeConversationId,
    activeSessionId,
    activeSessionStatus,
    isConversationsView,
    loadMessages,
  ]);

  useEffect(() => {
    if (!isConversationsView) {
      return;
    }

    if (!activeSessionId) {
      return;
    }

    const eventSource = new EventSource(
      `${apiUrl}/whatsapp/sessions/${activeSessionId}/stream`,
    );
    let typingTimeout: number | null = null;

    eventSource.onmessage = (event) => {
      const payload = JSON.parse(event.data) as SessionStreamEvent;

      if (
        payload.type === 'session.updated' ||
        payload.type === 'conversation.synced' ||
        payload.type === 'message.created'
      ) {
        void loadOverview().catch(() => undefined);

        if (
          payload.type === 'message.created' &&
          payload.conversationId &&
          payload.conversationId === activeConversationId
        ) {
          const conversationId = payload.conversationId;
          const delay = payload.direction === 'incoming' ? 900 : 0;

          window.setTimeout(() => {
            void loadMessages(activeSessionId, conversationId, {
              showLoading: false,
            }).catch(() => undefined);
          }, delay);
        }

        return;
      }

      if (!payload.conversationId) {
        return;
      }

      if (payload.type === 'typing.started' && payload.direction === 'incoming') {
        setTypingConversationId(payload.conversationId);

        if (typingTimeout) {
          window.clearTimeout(typingTimeout);
        }

        typingTimeout = window.setTimeout(() => {
          setTypingConversationId((current) =>
            current === payload.conversationId ? null : current,
          );
        }, 1800);
        return;
      }
    };

    eventSource.onerror = () => {
      void loadOverview().catch(() => undefined);

      if (activeConversationId) {
        void loadMessages(activeSessionId, activeConversationId, {
          showLoading: false,
        }).catch(() => undefined);
      }
    };

    return () => {
      if (typingTimeout) {
        window.clearTimeout(typingTimeout);
      }
      eventSource.close();
    };
  }, [activeConversationId, activeSessionId, isAuthReady, isConversationsView, loadMessages, loadOverview]);

  useEffect(() => {
    if (!isConversationsView) {
      return;
    }

    shouldStickToBottomRef.current = true;
  }, [activeConversationId, isConversationsView]);

  useLayoutEffect(() => {
    if (!isConversationsView) {
      return;
    }

    if (!messagesRef.current) {
      return;
    }

    const conversationAnchor = `${activeSessionId ?? ''}:${activeConversationId ?? ''}`;
    const conversationChanged =
      lastConversationAnchorRef.current !== conversationAnchor;

    if (conversationChanged) {
      lastConversationAnchorRef.current = conversationAnchor;
    }

    if (!conversationChanged && !shouldStickToBottomRef.current) {
      return;
    }

    messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [activeConversationId, activeSessionId, isConversationsView, messages, typingConversationId]);

  const handleMessagesScroll = useCallback(() => {
    const container = messagesRef.current;

    if (!container) {
      return;
    }

    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;

    shouldStickToBottomRef.current = distanceFromBottom <= 96;
  }, []);

  const runAction = (handler: () => Promise<void>) => {
    setErrorMessage(null);

    startTransition(() => {
      void handler().catch((error: unknown) => {
        setErrorMessage(error instanceof Error ? error.message : 'Falha inesperada.');
      });
    });
  };

  const createSession = () => {
    runAction(async () => {
      const response = await fetch(`${apiUrl}/whatsapp/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sessionForm),
      });

      if (!response.ok) {
        throw new Error('Nao foi possivel criar a sessao.');
      }

      const createdSession = (await response.json()) as SessionRecord;

      setSessionForm({ name: '', phoneNumber: '', channelName: '' });
      await loadOverview();
      setSelectedSessionId(createdSession.id);
      setActiveView('settings');
    });
  };

  const connectSession = (sessionId: string) => {
    runAction(async () => {
      const response = await fetch(
        `${apiUrl}/whatsapp/sessions/${sessionId}/connect`,
        { method: 'POST' },
      );

      if (!response.ok) {
        throw new Error('Nao foi possivel iniciar a sessao.');
      }

      await loadOverview();
    });
  };

  const disconnectSession = (sessionId: string) => {
    runAction(async () => {
      const response = await fetch(
        `${apiUrl}/whatsapp/sessions/${sessionId}/disconnect`,
        { method: 'POST' },
      );

      if (!response.ok) {
        throw new Error('Nao foi possivel desconectar a sessao.');
      }

      await loadOverview();
    });
  };

  const sendMessage = useCallback((text: string) => {
    if (!selectedSession || !selectedConversation || !text.trim()) {
      return Promise.resolve(false);
    }

    const payload = text.trim();
    runAction(async () => {
      const response = await fetch(
        `${apiUrl}/whatsapp/sessions/${selectedSession.id}/conversations/${selectedConversation.id}/messages`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: payload, author: 'Operador' }),
        },
      );

      if (!response.ok) {
        throw new Error('Nao foi possivel enviar a mensagem.');
      }

      await loadMessages(selectedSession.id, selectedConversation.id);
      await loadOverview();
    });
    return Promise.resolve(true);
  }, [loadMessages, loadOverview, selectedConversation, selectedSession]);

  if (!isAuthReady) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[linear-gradient(180deg,#050505_0%,#111111_100%)] px-6 text-white">
        <div className="rounded-[2rem] border border-white/10 bg-white/5 px-6 py-5 text-sm text-white/70 backdrop-blur-xl">
          Validando sua sessao...
        </div>
      </main>
    );
  }

  const renderDashboardView = () => (
    <section className="min-h-0 flex-1 overflow-y-auto px-5 py-6 md:px-8">
      <div className="mx-auto max-w-7xl space-y-8">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <h1 className="font-headline text-5xl font-extrabold tracking-tight text-white md:text-6xl">
              Command Central
            </h1>
            <p className="mt-3 flex items-center gap-3 text-xl text-[var(--muted)]">
              <span className="h-3 w-3 rounded-full bg-[var(--secondary)] shadow-[0_0_8px_#5dfd8a]" />
              System nominal. {overview.metrics.onlineUsers || 42} active agents processing {Math.max(overview.metrics.waitingConversations, 12) / 10}k events/hr.
            </p>
          </div>

          <div className="flex items-center gap-3 rounded-[1.6rem] border border-white/8 bg-[var(--surface-low)] px-5 py-3">
            <div className="flex -space-x-2">
              {dashboardLeaderboard.slice(0, 2).map((agent) => (
                <AvatarBadge
                  key={agent.id}
                  className="border-2 border-[var(--surface-low)]"
                  label={agent.label}
                  small
                  src={agent.avatarUrl}
                />
              ))}
              <div className="grid h-8 w-8 place-items-center rounded-full border-2 border-[var(--surface-low)] bg-[var(--primary-container)] text-[11px] font-bold text-black">
                +{Math.max(overview.metrics.onlineUsers, 8)}
              </div>
            </div>
            <span className="text-lg font-semibold text-white">Active Teams</span>
          </div>
        </div>

        <div className="grid grid-cols-12 gap-6">
          <div className="group col-span-12 overflow-hidden rounded-[2rem] border border-white/5 bg-[var(--surface-low)] p-8 lg:col-span-5">
            <div className="relative">
              <div className="absolute -right-24 -top-24 h-64 w-64 rounded-full bg-[var(--primary)]/10 blur-[80px]" />
              <div className="relative z-10">
                <div className="mb-12 flex items-start justify-between">
                  <div>
                    <h3 className="text-sm font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
                      Queue Health
                    </h3>
                    <p className="mt-2 font-headline text-7xl font-extrabold text-white">
                      {overview.metrics.waitingConversations.toLocaleString('pt-BR')}
                    </p>
                    <p className="mt-3 text-3xl font-semibold text-[var(--primary)]">
                      +12% from last hour
                    </p>
                  </div>
                  <LayoutGrid className="h-12 w-12 text-zinc-700" strokeWidth={1.8} />
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <DashboardChannelStatCard
                    icon={MessageCircle}
                    label="WhatsApp"
                    tone="secondary"
                    value={queueBreakdown.whatsapp}
                  />
                  <DashboardChannelStatCard
                    icon={ContactRound}
                    label="Facebook"
                    tone="primary"
                    value={queueBreakdown.facebook}
                  />
                  <DashboardChannelStatCard
                    icon={Camera}
                    label="Instagram"
                    tone="tertiary"
                    value={queueBreakdown.instagram}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="col-span-12 overflow-hidden rounded-[2rem] border border-white/5 bg-[var(--surface-low)] p-8 lg:col-span-7">
            <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
              <div>
                <h3 className="text-sm font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
                  Average Response Velocity
                </h3>
                <div className="mt-2 flex items-baseline gap-4">
                  <p className="font-headline text-6xl font-extrabold text-white">1m 42s</p>
                  <p className="text-3xl font-bold text-[var(--secondary)]">↓ 15s improved</p>
                </div>
              </div>
              <div className="flex gap-2">
                <span className="rounded-full bg-[var(--surface-highest)] px-4 py-2 text-xs font-bold text-zinc-400">
                  Live View
                </span>
                <span className="rounded-full bg-[var(--primary)]/10 px-4 py-2 text-xs font-bold text-[var(--primary)]">
                  Target: &lt;2m
                </span>
              </div>
            </div>

            <DashboardResponseChart />
          </div>

          <div className="col-span-12 space-y-4 lg:col-span-8">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-headline text-4xl font-bold text-white">Live Stream</h3>
              <button
                className="text-sm font-bold text-[var(--primary)] transition hover:underline"
                onClick={() => setActiveView('conversations')}
                type="button"
              >
                View All Messages
              </button>
            </div>

            <div className="space-y-3">
              {dashboardConversations.length > 0 ? (
                dashboardConversations.map((conversation, index) => (
                  <DashboardLiveStreamCard
                    key={conversation.id}
                    conversation={conversation}
                    dimmed={index > 0}
                    onOpen={() => {
                      setSelectedSessionId(conversation.sessionId);
                      setSelectedConversationId(conversation.id);
                      setActiveView('conversations');
                    }}
                  />
                ))
              ) : (
                <GhostPanel>
                  Nenhuma mensagem recente ainda. Conecte uma sessao e abra conversas reais para alimentar o feed.
                </GhostPanel>
              )}
            </div>
          </div>

          <div className="col-span-12 self-start rounded-[2rem] border border-white/5 bg-[var(--surface-low)] p-6 lg:col-span-4">
            <h3 className="mb-6 text-sm font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
              Top Performers
            </h3>
            <div className="space-y-6">
              {dashboardLeaderboard.length > 0 ? (
                dashboardLeaderboard.map((agent) => (
                  <DashboardPerformerItem key={agent.id} performer={agent} />
                ))
              ) : (
                <GhostPanel>A leaderboard vai aparecer quando a operacao tiver conversas sincronizadas.</GhostPanel>
              )}
            </div>
            <button
              className="mt-8 w-full rounded-[1.2rem] border border-white/5 bg-[var(--surface-highest)] py-4 text-xs font-bold uppercase tracking-[0.24em] text-white transition hover:bg-white/5"
              onClick={() => setActiveView('analytics')}
              type="button"
            >
              Full Performance Audit
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <ConnectivityStripItem label="WhatsApp API" status="2ms" tone="good" />
          <ConnectivityStripItem label="Meta Graph" status="14ms" tone="good" />
          <ConnectivityStripItem label="AI Engine" status="110ms" tone="good" />
          <ConnectivityStripItem label="Shopify Sync" status="Latency" tone="error" />
        </div>
      </div>
    </section>
  );

  const renderContactsView = () => (
    <section className="min-h-0 flex-1 overflow-y-auto px-5 py-6 md:px-8">
      <div className="mx-auto max-w-7xl space-y-8">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
              stitch_contacts_crm
            </p>
            <h2 className="font-headline mt-3 text-5xl font-extrabold tracking-tight text-white md:text-[4.5rem]">
              Contacts
            </h2>
            <p className="mt-3 max-w-3xl text-lg text-[var(--muted)]">
              Manage your multi-channel relationships across the Ether network.
            </p>
          </div>

          <div className="inline-flex items-center rounded-full border border-white/8 bg-[var(--surface-low)] p-1">
            <button
              className={`rounded-full px-5 py-3 text-sm font-semibold transition ${
                contactsAudienceFilter === 'all'
                  ? 'bg-[var(--surface-highest)] text-white'
                  : 'text-[var(--muted)] hover:text-white'
              }`}
              onClick={() => setContactsAudienceFilter('all')}
              type="button"
            >
              All Users
            </button>
            <button
              className={`inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-semibold transition ${
                contactsAudienceFilter === 'verified'
                  ? 'bg-[var(--surface-highest)] text-white'
                  : 'text-[var(--muted)] hover:text-white'
              }`}
              onClick={() => setContactsAudienceFilter('verified')}
              type="button"
            >
              <BadgeCheck className="h-4 w-4" strokeWidth={2.1} />
              Meta Verified
            </button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-[minmax(0,1.7fr)_minmax(0,0.9fr)_minmax(0,0.9fr)]">
          <div className="rounded-[28px] bg-[var(--surface-low)] px-5 py-4">
            <div className="flex items-center gap-3 text-sm text-[var(--muted)]">
              <Search className="h-5 w-5" strokeWidth={2.2} />
              <input
                className="min-w-0 flex-1 bg-transparent text-base text-white outline-none placeholder:text-zinc-500"
                onChange={(event) => setContactsSearch(event.target.value)}
                placeholder="Search by name, ID, or channel handle..."
                value={contactsSearch}
              />
            </div>
          </div>

          <div className="rounded-[28px] bg-[var(--surface-low)] px-5 py-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-[var(--muted)]">Channel</span>
              <div className="flex items-center gap-2">
                {([
                  { id: 'whatsapp', icon: MessageCircle, color: 'text-[var(--secondary)]' },
                  { id: 'facebook', icon: ContactRound, color: 'text-[var(--primary)]' },
                  { id: 'instagram', icon: Camera, color: 'text-[var(--tertiary)]' },
                ] as const).map(({ id, icon: Icon, color }) => {
                  const active = contactsChannelFilter === id;

                  return (
                    <button
                      key={id}
                      className={`grid h-10 w-10 place-items-center rounded-full transition ${
                        active ? 'bg-white/8 text-white' : 'hover:bg-white/5'
                      }`}
                      onClick={() =>
                        setContactsChannelFilter((current) => (current === id ? 'all' : id))
                      }
                      type="button"
                    >
                      <Icon className={`h-4 w-4 ${active ? 'text-white' : color}`} strokeWidth={2.2} />
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <button
            className="inline-flex items-center justify-center gap-3 rounded-[28px] bg-[linear-gradient(135deg,#7fafff,#64a1ff)] px-6 py-4 text-lg font-bold text-black transition hover:scale-[1.01]"
            onClick={() => setShowAdvancedContactsFilters((current) => !current)}
            type="button"
          >
            <SlidersHorizontal className="h-5 w-5" strokeWidth={2.2} />
            Advanced Filters
          </button>
        </div>

        {showAdvancedContactsFilters ? (
          <div className="flex flex-wrap gap-2">
            {contactFilterOptions.map((option) => {
              const active = contactsFilter === option.id;

              return (
                <button
                  key={option.id}
                  className={`rounded-full border px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] transition-all ${
                    active
                      ? 'border-[var(--primary)]/30 bg-[var(--primary)]/12 text-[var(--primary)]'
                      : 'border-white/8 bg-white/5 text-[var(--muted)] hover:text-white'
                  }`}
                  onClick={() => setContactsFilter(option.id)}
                  type="button"
                >
                  {option.label} · {option.count}
                </button>
              );
            })}
          </div>
        ) : null}

        <div className="overflow-hidden rounded-[2rem] border border-white/5 bg-[linear-gradient(180deg,rgba(19,19,19,0.96),rgba(15,15,15,0.98))]">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse text-left">
              <thead>
                <tr className="border-b border-white/5 bg-[var(--surface-low)]/60">
                  <th className="px-8 py-6 text-[10px] font-black uppercase tracking-[0.24em] text-[var(--muted)]">
                    Identity
                  </th>
                  <th className="px-6 py-6 text-[10px] font-black uppercase tracking-[0.24em] text-[var(--muted)]">
                    Primary Channel
                  </th>
                  <th className="px-6 py-6 text-center text-[10px] font-black uppercase tracking-[0.24em] text-[var(--muted)]">
                    Interactions
                  </th>
                  <th className="px-6 py-6 text-[10px] font-black uppercase tracking-[0.24em] text-[var(--muted)]">
                    Last Pulse
                  </th>
                  <th className="px-6 py-6 text-[10px] font-black uppercase tracking-[0.24em] text-[var(--muted)]">
                    Connectivity
                  </th>
                  <th className="px-8 py-6 text-right text-[10px] font-black uppercase tracking-[0.24em] text-[var(--muted)]">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredContacts.length > 0 ? (
                  filteredContacts.map((contact) => {
                    const active = selectedContact?.id === contact.id;
                    const channel = getContactChannelMeta(contact);
                    const interactionMetric = getContactInteractionMetric(contact);
                    const relativePulse = formatRelativePulse(contact.lastMessageAt);
                    const connectivity = getContactConnectivity(contact, selectedSession?.status);

                    return (
                      <tr
                        key={`${contact.sessionId}:${contact.id}`}
                        className={`cursor-pointer border-b border-white/5 transition last:border-b-0 ${
                          active ? 'bg-white/[0.04]' : 'hover:bg-white/[0.02]'
                        }`}
                        onClick={() => setSelectedContactId(contact.id)}
                      >
                        <td className="px-8 py-5">
                          <div className="flex items-center gap-4">
                            <div className="relative">
                              <AvatarBadge label={contact.contact} src={contact.avatarUrl} />
                              {connectivity.active ? (
                                <div className="absolute -bottom-1 -right-1 h-4 w-4 rounded-full border-2 border-[var(--background)] bg-[var(--secondary)] shadow-[0_0_8px_rgba(93,253,138,0.5)]" />
                              ) : null}
                            </div>
                            <div className="min-w-0">
                              <div className="font-headline text-xl font-semibold text-white">
                                {contact.contact}
                              </div>
                              <div className="truncate text-sm text-[var(--muted)]">
                                {isVerifiedContact(contact)
                                  ? `@${slugifyContact(contact.contact)}`
                                  : toContactEmail(contact.contact)}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-5">
                          <span className={`inline-flex w-fit items-center gap-2 rounded-full border px-4 py-2 text-xs font-bold ${channel.tone}`}>
                            <channel.icon className="h-4 w-4" strokeWidth={2.1} />
                            {channel.label}
                          </span>
                        </td>
                        <td className="px-6 py-5 text-center">
                          <div className="font-mono text-4xl font-bold text-white">
                            {interactionMetric.value}
                          </div>
                          <div className={`mt-1 text-[11px] font-bold ${interactionMetric.tone}`}>
                            {interactionMetric.label}
                          </div>
                        </td>
                        <td className="px-6 py-5">
                          <div className="text-base text-white">{relativePulse.primary}</div>
                          <div className="text-[11px] text-[var(--muted)]">{relativePulse.secondary}</div>
                        </td>
                        <td className="px-6 py-5">
                          <div className="flex items-center gap-2">
                            <div className={`h-2.5 w-2.5 rounded-full ${connectivity.dot}`} />
                            <span className={`text-sm font-medium ${connectivity.tone}`}>
                              {connectivity.label}
                            </span>
                          </div>
                        </td>
                        <td className="px-8 py-5">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              className="rounded-full bg-white/5 px-4 py-2 text-xs font-semibold text-[var(--muted)] transition hover:text-white"
                              onClick={(event) => {
                                event.stopPropagation();
                                setSelectedSessionId(contact.sessionId);
                                setSelectedConversationId(contact.id);
                                setActiveView('conversations');
                              }}
                              type="button"
                            >
                              Open
                            </button>
                            <button
                              className="grid h-10 w-10 place-items-center rounded-full text-[var(--muted)] transition hover:bg-white/5 hover:text-white"
                              onClick={(event) => {
                                event.stopPropagation();
                                void navigator.clipboard?.writeText(contact.participantId);
                              }}
                              type="button"
                            >
                              <MoreVertical className="h-4 w-4" strokeWidth={2.1} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td className="px-8 py-12" colSpan={6}>
                      <GhostPanel>
                        Nenhum contato encontrado com os filtros atuais. Ajuste a busca ou sincronize mais conversas.
                      </GhostPanel>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-white/5 bg-[var(--surface-low)]/60 px-8 py-4">
            <div className="text-xs font-medium text-[var(--muted)]">
              Showing {filteredContacts.length === 0 ? 0 : 1}-{filteredContacts.length} of {contacts.length} contacts
            </div>
            <div className="flex items-center gap-2">
              <button className="grid h-10 w-10 place-items-center rounded-xl bg-[var(--surface-highest)] text-white transition hover:bg-white/10" type="button">
                <ChevronLeft className="h-4 w-4" strokeWidth={2.1} />
              </button>
              <button className="h-10 rounded-xl bg-[var(--primary)] px-4 text-sm font-bold text-black" type="button">
                1
              </button>
              <button className="h-10 rounded-xl px-4 text-sm font-bold text-[var(--muted)] transition hover:text-white" type="button">
                2
              </button>
              <button className="h-10 rounded-xl px-4 text-sm font-bold text-[var(--muted)] transition hover:text-white" type="button">
                3
              </button>
              <button className="grid h-10 w-10 place-items-center rounded-xl bg-[var(--surface-highest)] text-white transition hover:bg-white/10" type="button">
                <ChevronRight className="h-4 w-4" strokeWidth={2.1} />
              </button>
            </div>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[0.85fr_1.15fr]">
          <div className="rounded-[2rem] bg-[var(--surface-low)] p-6">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-[0.28em] text-[var(--muted)]">
                Channel Health
              </span>
              <BarChart3 className="h-5 w-5 text-[var(--secondary)]" strokeWidth={2.1} />
            </div>
            <div className="mt-6 space-y-5">
              {contactChannelHealth(contacts).map((item) => (
                <div key={item.label} className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-white">{item.label}</span>
                    <span className="text-[var(--muted)]">{item.value}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-[var(--surface-highest)]">
                    <div className={`h-2 rounded-full ${item.bar}`} style={{ width: `${item.value}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="relative overflow-hidden rounded-[2rem] border border-[var(--primary)]/20 bg-[linear-gradient(135deg,rgba(127,175,255,0.12),rgba(14,14,14,1))] p-6">
            <div className="relative z-10 max-w-xl">
              <h3 className="font-headline text-4xl font-bold text-white">Sync Real-time CRM</h3>
              <p className="mt-3 text-base leading-8 text-[var(--muted)]">
                Your meta-connections are automatically synced every 30 seconds. Click here to force a deep refresh of all metadata and customer tags.
              </p>
              <button
                className="mt-6 inline-flex items-center gap-3 rounded-full bg-[linear-gradient(135deg,#7fafff,#64a1ff)] px-6 py-3 text-sm font-bold text-black shadow-[0_0_20px_rgba(127,175,255,0.35)] transition hover:scale-[1.01]"
                onClick={() => runAction(loadOverview)}
                type="button"
              >
                <RefreshCw className="h-4 w-4" strokeWidth={2.2} />
                Run Deep Sync
              </button>
            </div>
            <div className="pointer-events-none absolute -bottom-8 right-4 text-[12rem] font-black leading-none text-white/5">
              ↻
            </div>
          </div>
        </div>
      </div>
    </section>
  );

  const renderAnalyticsView = () => (
    <section className="min-h-0 flex-1 overflow-y-auto px-5 py-6 md:px-8">
      <div className="mx-auto max-w-7xl space-y-8">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
              Operational signal
            </p>
            <h2 className="font-headline mt-3 text-5xl font-extrabold tracking-tight text-white md:text-6xl">
              Service Intelligence
            </h2>
            <p className="mt-2 text-lg text-[var(--muted)]">
              Real-time performance metrics across all Meta channels.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <div className="flex items-center gap-2 rounded-xl border border-white/5 bg-[var(--surface-high)] px-4 py-2">
              <span className="h-2 w-2 rounded-full bg-[var(--secondary)] shadow-[0_0_8px_#5dfd8a]" />
              <span className="text-sm font-medium text-white">Live Systems Online</span>
            </div>
            <button className="inline-flex items-center gap-2 rounded-xl bg-[var(--surface-highest)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-700" type="button">
              <CalendarDays className="h-4 w-4" strokeWidth={2.1} />
              Last 30 Days
            </button>
          </div>
        </div>

        {analyticsModel ? (
          <div className="grid grid-cols-12 gap-6">
            <div className="col-span-12 overflow-hidden rounded-xl bg-[var(--surface-low)] p-6 lg:col-span-4">
              <div className="relative">
                <div className="absolute right-0 top-0 p-4">
                  <BadgeCheck className="h-16 w-16 text-white/15" strokeWidth={1.8} />
                </div>
                <h3 className="mb-8 text-sm font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
                  Global CSAT Score
                </h3>
                <div className="relative mx-auto flex h-48 w-48 items-center justify-center">
                  <svg className="h-full w-full -rotate-90" viewBox="0 0 200 200">
                    <circle cx="100" cy="100" fill="transparent" r="88" stroke="currentColor" strokeWidth="8" className="text-[var(--surface-highest)]" />
                    <circle
                      cx="100"
                      cy="100"
                      fill="transparent"
                      r="88"
                      stroke="currentColor"
                      strokeDasharray="552.92"
                      strokeDashoffset={552.92 - (analyticsModel.csat / 5) * 552.92}
                      strokeLinecap="round"
                      strokeWidth="12"
                      className="text-[var(--primary-fixed)] drop-shadow-[0_0_12px_rgba(100,161,255,0.6)]"
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="font-headline text-6xl font-black text-white">
                      {analyticsModel.csat.toFixed(1)}
                    </span>
                    <span className="mt-1 text-sm font-bold text-[var(--secondary)]">
                      +12% vs last month
                    </span>
                  </div>
                </div>
                <div className="mt-8 grid grid-cols-2 gap-8">
                  <div className="text-center">
                    <p className="mb-1 text-xs text-[var(--muted)]">Response Time</p>
                    <p className="text-3xl font-bold text-white">{analyticsModel.responseMinutes.toFixed(1)}m</p>
                  </div>
                  <div className="text-center">
                    <p className="mb-1 text-xs text-[var(--muted)]">Resolution Rate</p>
                    <p className="text-3xl font-bold text-white">{analyticsModel.resolvedRate.toFixed(1)}%</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="col-span-12 rounded-xl bg-[var(--surface-low)] p-6 lg:col-span-8">
              <div className="mb-10 flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h3 className="text-sm font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
                    Conversations per Channel
                  </h3>
                  <p className="mt-1 font-headline text-5xl font-bold text-white">
                    {(analyticsModel.totalConversations / 10).toFixed(1)}k Total
                  </p>
                </div>
                <div className="flex gap-3 text-xs text-[var(--muted)]">
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[var(--primary)]" />WhatsApp</span>
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[var(--tertiary)]" />Instagram</span>
                </div>
              </div>

              <div className="flex h-48 items-end justify-between gap-4 px-4">
                {analyticsModel.weeklyChannelSeries.map((item) => (
                  <div key={item.day} className="flex-1 space-y-2">
                    <div className={`relative h-32 w-full rounded-t-lg ${item.channel === 'whatsapp' ? 'bg-[var(--primary)]/20' : 'bg-[var(--tertiary)]/20'}`}>
                      <div
                        className={`absolute bottom-0 w-full rounded-t-lg transition-all duration-300 ${item.channel === 'whatsapp' ? 'bg-[var(--primary)]' : 'bg-[var(--tertiary)]'}`}
                        style={{ height: `${item.value}%` }}
                      />
                    </div>
                    <p className="text-center text-[10px] font-medium text-[var(--muted)]">{item.day}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="col-span-12 rounded-xl bg-[var(--surface-low)] p-6">
              <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h3 className="text-sm font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
                    Peak Service Hours
                  </h3>
                  <p className="mt-1 text-xs italic text-[var(--muted)]">
                    Average customer engagement intensity by hour and day.
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-1 text-[10px] text-[var(--muted)]">
                    <span>Low</span>
                    <div className="flex gap-1">
                      <div className="h-3 w-3 rounded-sm bg-zinc-800" />
                      <div className="h-3 w-3 rounded-sm bg-[var(--primary)]/30" />
                      <div className="h-3 w-3 rounded-sm bg-[var(--primary)]/60" />
                      <div className="h-3 w-3 rounded-sm bg-[var(--primary)]" />
                    </div>
                    <span>Peak</span>
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto">
                <div className="min-w-[800px] space-y-2">
                  <div className="grid grid-cols-[3rem_repeat(12,minmax(0,1fr))] items-center gap-1">
                    <div />
                    {['00', '02', '04', '06', '08', '10', '12', '14', '16', '18', '20', '22'].map((hour) => (
                      <div key={hour} className={`text-center text-[10px] ${hour === '12' ? 'font-bold text-[var(--primary)]' : 'text-[var(--muted)]'}`}>
                        {hour}
                      </div>
                    ))}
                  </div>
                  {analyticsModel.heatmapRows.map((row) => (
                    <div key={row.day} className="grid grid-cols-[3rem_repeat(12,minmax(0,1fr))] items-center gap-1">
                      <span className="pr-2 text-right text-[10px] font-bold text-[var(--muted)]">{row.day}</span>
                      {row.values.map((value, index) => (
                        <div
                          key={`${row.day}-${index}`}
                          className={`h-8 rounded-sm transition-transform hover:scale-110 ${value > 80 ? 'bg-[var(--primary)] shadow-[0_0_8px_rgba(127,175,255,0.4)]' : value > 60 ? 'bg-[var(--primary)]/80' : value > 35 ? 'bg-[var(--primary)]/40' : value > 20 ? 'bg-[var(--primary)]/20' : 'bg-zinc-800'}`}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="col-span-12 overflow-hidden rounded-xl bg-[var(--surface-low)]">
              <div className="flex flex-col gap-4 border-b border-white/5 p-6 md:flex-row md:items-center md:justify-between">
                <h3 className="text-sm font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
                  Recent Resolved Tickets
                </h3>
                <div className="flex flex-wrap items-center gap-2">
                  <button className="rounded-lg bg-[var(--surface-highest)] px-4 py-2 text-xs text-white">All Channels</button>
                  <button className="rounded-lg bg-[var(--surface-highest)] px-4 py-2 text-xs text-white">All Agents</button>
                  <button className="grid h-8 w-8 place-items-center rounded-lg hover:bg-white/5" type="button">
                    <SlidersHorizontal className="h-4 w-4" strokeWidth={2.1} />
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-[var(--surface-high)] font-medium text-[var(--muted)]">
                    <tr>
                      <th className="px-6 py-4">Ticket ID</th>
                      <th className="px-6 py-4">Customer</th>
                      <th className="px-6 py-4">Channel</th>
                      <th className="px-6 py-4">Agent</th>
                      <th className="px-6 py-4">Resolution Time</th>
                      <th className="px-6 py-4">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {analyticsModel.resolvedTickets.map((ticket) => (
                      <tr key={ticket.id} className="transition-colors hover:bg-white/5">
                        <td className="px-6 py-4 font-mono text-xs text-white">{ticket.id}</td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <AvatarBadge label={ticket.customer} small src={ticket.customerAvatar} />
                            <span className="text-white">{ticket.customer}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2 text-white">
                            <span className={`h-2 w-2 rounded-full ${ticket.channel.label === 'WhatsApp' ? 'bg-[var(--secondary)]' : ticket.channel.label === 'Instagram' ? 'bg-[var(--tertiary)]' : 'bg-[var(--primary)]'}`} />
                            <span>{ticket.channel.label}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-white">{ticket.agent}</td>
                        <td className="px-6 py-4 text-white">{ticket.resolutionTime}</td>
                        <td className="px-6 py-4">
                          <span className="rounded-full border border-[var(--secondary)]/20 bg-[var(--secondary)]/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--secondary)]">
                            Resolved
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );

  const renderSettingsView = () => (
    <section className="min-h-0 flex-1 overflow-y-auto px-5 py-6 md:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
              WhatsApp configuration
            </p>
            <h2 className="font-headline mt-3 text-3xl font-semibold text-white">
              Conectar e gerenciar sessoes
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
              Crie uma sessao operacional, gere QR code, reconecte numeros e acompanhe o
              estado da autenticacao sem sair do painel.
            </p>
          </div>
          <button
            className="rounded-full bg-white/5 px-4 py-2 text-xs text-[var(--muted)] hover:text-white"
            onClick={() => runAction(loadOverview)}
            type="button"
          >
            Refresh settings
          </button>
        </div>

        <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
          <div className="space-y-6">
            <div className="glass-panel rounded-[30px] p-6">
              <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
                Provision new session
              </p>
              <div className="mt-5 space-y-3">
                <Field
                  onChange={(value) =>
                    setSessionForm((current) => ({ ...current, name: value }))
                  }
                  placeholder="Nome operacional"
                  value={sessionForm.name}
                />
                <Field
                  onChange={(value) =>
                    setSessionForm((current) => ({ ...current, phoneNumber: value }))
                  }
                  placeholder="Numero do WhatsApp"
                  value={sessionForm.phoneNumber}
                />
                <Field
                  onChange={(value) =>
                    setSessionForm((current) => ({ ...current, channelName: value }))
                  }
                  placeholder="Fila / canal"
                  value={sessionForm.channelName}
                />
                <button
                  className="w-full rounded-2xl bg-[linear-gradient(135deg,#7fafff,#64a1ff)] px-4 py-3 text-sm font-semibold text-black"
                  onClick={createSession}
                  type="button"
                >
                  Criar sessao
                </button>
              </div>
            </div>

            <div className="glass-panel rounded-[30px] p-6">
              <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
                Session stack
              </p>
              <div className="mt-5 space-y-3">
                {overview.sessions.length > 0 ? (
                  overview.sessions.map((session) => {
                    const active = session.id === selectedSession?.id;

                    return (
                      <button
                        key={session.id}
                        className={`flex w-full items-center justify-between rounded-[24px] border px-4 py-4 text-left transition ${
                          active
                            ? 'border-[var(--primary)]/30 bg-[var(--primary)]/10'
                            : 'border-white/6 bg-white/4 hover:bg-white/6'
                        }`}
                        onClick={() => setSelectedSessionId(session.id)}
                        type="button"
                      >
                        <div>
                          <p className="text-base font-semibold text-white">{session.name}</p>
                          <p className="mt-1 text-sm text-[var(--muted)]">
                            {session.phoneNumber} · {session.channelName}
                          </p>
                        </div>
                        <span className={`rounded-full px-3 py-1 text-xs ${statusTone[session.status]}`}>
                          {statusLabel[session.status]}
                        </span>
                      </button>
                    );
                  })
                ) : (
                  <GhostPanel>
                    Nenhuma sessao criada ainda. Preencha os campos acima para conectar o
                    primeiro numero.
                  </GhostPanel>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-6">
            {selectedSession ? (
              <>
                <div className="glass-panel rounded-[30px] p-6">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
                        Session control
                      </p>
                      <h3 className="font-headline mt-3 text-3xl font-semibold text-white">
                        {selectedSession.name}
                      </h3>
                      <p className="mt-2 text-sm text-[var(--muted)]">
                        {selectedSession.phoneNumber} · {selectedSession.channelName}
                      </p>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs ${statusTone[selectedSession.status]}`}>
                      {statusLabel[selectedSession.status]}
                    </span>
                  </div>

                  <div className="mt-6 grid gap-4 md:grid-cols-3">
                    <MetricCard
                      label="Unread"
                      value={selectedSession.unread}
                      detail="Mensagens pendentes"
                      tone="primary"
                      compact
                    />
                    <MetricCard
                      label="Waiting"
                      value={selectedSession.waiting}
                      detail="Conversas na fila"
                      tone="tertiary"
                      compact
                    />
                    <MetricCard
                      label="Attendants"
                      value={selectedSession.attendants}
                      detail="Atendentes vinculados"
                      tone="secondary"
                      compact
                    />
                  </div>

                  <div className="mt-6 flex flex-wrap gap-3">
                    <button
                      className="inline-flex items-center gap-2 rounded-full bg-[linear-gradient(135deg,#7fafff,#64a1ff)] px-4 py-2 text-sm font-semibold text-black"
                      onClick={() => connectSession(selectedSession.id)}
                      type="button"
                    >
                      <QrCode className="h-4 w-4" strokeWidth={2.1} />
                      Gerar QR / conectar
                    </button>
                    <button
                      className="inline-flex items-center gap-2 rounded-full bg-white/5 px-4 py-2 text-sm text-[var(--muted)] hover:text-white"
                      onClick={() => disconnectSession(selectedSession.id)}
                      type="button"
                    >
                      <Wifi className="h-4 w-4" strokeWidth={2.1} />
                      Desconectar
                    </button>
                  </div>

                  {selectedSession.lastError ? (
                    <div className="mt-6 rounded-[24px] border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                      {selectedSession.lastError}
                    </div>
                  ) : null}
                </div>

                <div className="glass-panel rounded-[30px] p-6">
                  <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
                    QR authentication
                  </p>
                  <div className="mt-5 flex min-h-[320px] items-center justify-center rounded-[28px] border border-dashed border-white/10 bg-black/20 p-6">
                    {selectedSession.qrCodeDataUrl ? (
                      <div className="rounded-[28px] bg-white p-4">
                        <Image
                          alt={`QR code da sessao ${selectedSession.name}`}
                          className="mx-auto rounded-[20px]"
                          height={260}
                          src={selectedSession.qrCodeDataUrl}
                          unoptimized
                          width={260}
                        />
                      </div>
                    ) : (
                      <GhostPanel>
                        Gere ou reconecte a sessao para exibir o QR code aqui. Se existir
                        autenticacao persistida, a sessao pode voltar sem novo QR.
                      </GhostPanel>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <GhostPanel>
                Selecione uma sessao para abrir as configuracoes, gerar QR code e conectar
                seu WhatsApp.
              </GhostPanel>
            )}

            {errorMessage ? <GhostPanel>{errorMessage}</GhostPanel> : null}
            {isPending ? <GhostPanel>Syncing operation...</GhostPanel> : null}
          </div>
        </div>
      </div>
    </section>
  );

  const renderConversationsView = () => (
    <div className="grid min-h-0 flex-1 overflow-hidden grid-cols-1 xl:grid-cols-[21rem_minmax(0,1fr)_21rem]">
      <section className="min-h-0 overflow-hidden border-r border-white/5 bg-[var(--surface-low)]/35 px-4 py-5 xl:px-3">
        <div className="mb-5 flex items-center justify-between px-2">
          <div>
            <h2 className="font-headline text-3xl font-bold text-white">Active Queues</h2>
            <p className="mt-1 text-xs uppercase tracking-[0.22em] text-[var(--muted)]">
              {queueLabel}
            </p>
          </div>
          <button
            className="rounded-full bg-white/5 px-4 py-2 text-xs text-[var(--muted)] hover:text-white"
            onClick={() => runAction(loadOverview)}
            type="button"
          >
            Refresh
          </button>
        </div>

        <div className="mb-4 flex flex-wrap gap-2 px-2">
          {overview.channels.length > 0 ? (
            overview.channels.map((channel) => <ChannelPill key={channel.id} channel={channel} />)
          ) : (
            <span className="rounded-full bg-white/5 px-3 py-1.5 text-[11px] text-[var(--muted)]">
              No channel tags yet
            </span>
          )}
        </div>

        <div className="mb-4 flex flex-wrap gap-2 px-2">
          {conversationFilterOptions.map((option) => {
            const active = conversationFilter === option.id;

            return (
              <button
                key={option.id}
                className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] transition-all ${
                  active
                    ? 'border-[var(--primary)]/30 bg-[var(--primary)]/12 text-[var(--primary)]'
                    : 'border-white/8 bg-white/5 text-[var(--muted)] hover:text-white'
                }`}
                onClick={() => setConversationFilter(option.id)}
                type="button"
              >
                {option.label} · {option.count}
              </button>
            );
          })}
        </div>

        <div className="h-[calc(100vh-13.5rem)] space-y-2 overflow-y-auto pr-1 xl:h-[calc(100vh-10.5rem)]">
          {sessionConversations.map((conversation) => {
            const active = selectedConversation?.id === conversation.id;

            return (
              <button
                key={conversation.id}
                className={`w-full rounded-[24px] p-3 text-left transition-all ${
                  active
                    ? 'bg-[var(--surface-highest)] shadow-[0_0_0_1px_rgba(255,255,255,0.05)]'
                    : 'hover:bg-white/5'
                }`}
                onClick={() => setSelectedConversationId(conversation.id)}
                type="button"
              >
                <div className="flex gap-3">
                  <AvatarBadge label={conversation.contact} src={conversation.avatarUrl} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="truncate text-lg font-semibold text-white">
                          {conversation.contact}
                        </p>
                        <p className="mt-0.5 text-xs text-[var(--muted)]">
                          {formatClock(conversation.lastMessageAt)}
                        </p>
                      </div>
                      {conversation.unread > 0 ? (
                        <span className="rounded-full bg-[var(--secondary)] px-2 py-1 text-[10px] font-bold text-black shadow-[0_0_12px_rgba(93,253,138,0.35)]">
                          {conversation.unread}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 truncate text-sm text-[var(--primary)]">
                      {conversation.preview || 'No preview yet'}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <span className="inline-flex items-center gap-1 rounded-full bg-[var(--secondary)]/14 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--secondary)]">
                        <MessageCircle className="h-3 w-3" strokeWidth={2.1} />
                        WhatsApp
                      </span>
                      <span className="rounded-full bg-white/5 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--primary)]">
                        {isGroupConversation(conversation) ? 'Grupo' : 'Conversa'}
                      </span>
                      <span className="rounded-full bg-white/5 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--muted)]">
                        {conversation.status}
                      </span>
                    </div>
                  </div>
                </div>
              </button>
            );
          })}

          {selectedSession && sessionConversations.length === 0 ? (
            <GhostPanel>
              Nenhuma conversa encontrada para esse filtro. Troque o filtro ou atualize a fila.
            </GhostPanel>
          ) : null}
        </div>
      </section>

      <section className="flex min-h-0 flex-col overflow-hidden bg-[var(--surface)]">
        {selectedSession ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/5 bg-black/10 px-5 py-4 backdrop-blur-md">
              <div className="flex items-center gap-3">
                {selectedConversation ? (
                  <AvatarBadge
                    label={selectedConversation.contact}
                    src={selectedConversation.avatarUrl}
                  />
                ) : (
                  <span className="h-3 w-3 rounded-full bg-[var(--secondary)] shadow-[0_0_16px_rgba(93,253,138,0.8)]" />
                )}
                <div>
                  <p className="font-headline text-3xl font-semibold text-white">
                    {selectedConversation?.contact ?? selectedSession.name}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
                    <span className="rounded-full bg-[var(--surface-high)] px-3 py-1">
                      {selectedSession.phoneNumber}
                    </span>
                    <span className={`rounded-full px-3 py-1 ${statusTone[selectedSession.status]}`}>
                      {statusLabel[selectedSession.status]}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button className="inline-flex items-center gap-2 rounded-full bg-white/5 px-4 py-2 text-sm text-[var(--muted)] hover:text-white">
                  <Video className="h-4 w-4" strokeWidth={2.1} />
                  Video
                </button>
                <button className="inline-flex items-center gap-2 rounded-full bg-white/5 px-4 py-2 text-sm text-[var(--muted)] hover:text-white">
                  <Phone className="h-4 w-4" strokeWidth={2.1} />
                  Call
                </button>
                <button
                  className="inline-flex items-center gap-2 rounded-full bg-[linear-gradient(135deg,#7fafff,#64a1ff)] px-4 py-2 text-sm font-semibold text-black"
                  onClick={() => connectSession(selectedSession.id)}
                  type="button"
                >
                  <QrCode className="h-4 w-4" strokeWidth={2.1} />
                  Connect
                </button>
                <button
                  className="inline-flex items-center gap-2 rounded-full bg-white/5 px-4 py-2 text-sm text-[var(--muted)] hover:text-white"
                  onClick={() => disconnectSession(selectedSession.id)}
                  type="button"
                >
                  <Wifi className="h-4 w-4" strokeWidth={2.1} />
                  Disconnect
                </button>
              </div>
            </div>

            <div
              ref={messagesRef}
              className="min-h-0 flex-1 overflow-y-auto px-5 py-6"
              onScroll={handleMessagesScroll}
            >
              <div className="mx-auto flex max-w-5xl flex-col gap-6">
                {isLoadingMessages ? <GhostPanel>Loading conversation history...</GhostPanel> : null}

                {messages.map((message) => (
                  <MessageBubble
                    key={message.id}
                    avatarUrl={selectedConversation?.avatarUrl}
                    message={message}
                  />
                ))}

                {typingConversationId === selectedConversation?.id ? (
                  <div className="flex max-w-[80%] gap-4">
                    <AvatarBadge
                      label={selectedConversation.contact}
                      small
                      src={selectedConversation.avatarUrl}
                    />
                    <div className="glass-panel rounded-[26px] rounded-tl-none px-5 py-4 text-sm text-[var(--muted)]">
                      <div className="flex items-center gap-3">
                        <span>digitando</span>
                        <span className="flex gap-1">
                          <span className="h-2 w-2 animate-bounce rounded-full bg-[var(--primary)] [animation-delay:-0.2s]" />
                          <span className="h-2 w-2 animate-bounce rounded-full bg-[var(--primary)] [animation-delay:-0.1s]" />
                          <span className="h-2 w-2 animate-bounce rounded-full bg-[var(--primary)]" />
                        </span>
                      </div>
                    </div>
                  </div>
                ) : null}

                {!isLoadingMessages && messages.length === 0 ? (
                  <GhostPanel>Open a real chat thread to load the message timeline here.</GhostPanel>
                ) : null}
              </div>
            </div>

            <div className="border-t border-white/5 bg-[var(--surface-low)]/45 px-4 py-4 backdrop-blur-xl md:px-6">
              <ConversationComposer
                conversationKey={`${selectedSession.id}:${selectedConversation?.id ?? 'none'}`}
                disabled={!selectedConversation || isPending}
                onSend={sendMessage}
                quickReplies={quickReplies}
              />
            </div>
          </>
        ) : (
          <div className="grid flex-1 place-items-center p-6">
            <div className="space-y-4 text-center">
              <GhostPanel>Create or restore a WhatsApp session to begin.</GhostPanel>
              <button
                className="rounded-full bg-[linear-gradient(135deg,#7fafff,#64a1ff)] px-5 py-3 text-sm font-semibold text-black"
                onClick={() => setActiveView('settings')}
                type="button"
              >
                Abrir configuracoes
              </button>
            </div>
          </div>
        )}
      </section>

      <aside className="hidden min-h-0 overflow-y-auto bg-[var(--surface-low)]/20 px-6 py-6 xl:block">
        {selectedConversation && selectedSession ? (
          <div className="space-y-7">
            <div className="flex flex-col items-center text-center">
              <div className="relative">
                <AvatarBadge
                  className="h-28 w-28 rounded-[28px] text-4xl"
                  label={selectedConversation.contact}
                  src={selectedConversation.avatarUrl}
                />
                <div className="absolute -bottom-2 -right-2 grid h-12 w-12 place-items-center rounded-full bg-[var(--secondary)] text-black shadow-[0_0_22px_rgba(93,253,138,0.5)]">
                  <MessageCircle className="h-5 w-5" strokeWidth={2.4} />
                </div>
              </div>

              <h3 className="mt-6 font-headline text-5xl font-bold tracking-tight text-white">
                {selectedConversation.contact}
              </h3>
              <p className="mt-2 text-sm text-[var(--muted)]">
                {selectedConversation.owner} · {selectedConversation.channelName}
              </p>
            </div>

            <ProfileSection title="Contact Info">
              <ProfileRow label="Email" value={contactInfo.email} />
              <ProfileRow label="Phone" value={contactInfo.phone} />
              <ProfileRow label="Session" value={selectedSession.name} />
            </ProfileSection>

            <ProfileSection title="Customer Tags">
              <div className="flex flex-wrap gap-2">
                <Tag tone="primary">{selectedConversation.channelName}</Tag>
                <Tag tone="tertiary">{selectedConversation.status}</Tag>
                <Tag tone="neutral">{selectedConversation.owner}</Tag>
              </div>
            </ProfileSection>

            <ProfileSection title="Conversation History">
              <div className="space-y-4">
                <MiniTimelineItem
                  label="Current WhatsApp thread"
                  meta={formatDateLabel(selectedConversation.lastMessageAt)}
                  tone="primary"
                />
                <MiniTimelineItem
                  label="Realtime session online"
                  meta={statusLabel[selectedSession.status]}
                  tone="secondary"
                />
              </div>
            </ProfileSection>

            <ProfileSection title="Session Control">
              <div className="space-y-3">
                <button
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[linear-gradient(135deg,#7fafff,#64a1ff)] px-4 py-3 text-sm font-semibold text-black"
                  onClick={() => {
                    setActiveView('settings');
                    connectSession(selectedSession.id);
                  }}
                  type="button"
                >
                  <QrCode className="h-4 w-4" strokeWidth={2.1} />
                  Generate QR / reconnect
                </button>
                <button
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[var(--surface-highest)] px-4 py-3 text-sm font-semibold text-white"
                  onClick={() => disconnectSession(selectedSession.id)}
                  type="button"
                >
                  <Wifi className="h-4 w-4" strokeWidth={2.1} />
                  Disconnect session
                </button>
              </div>
            </ProfileSection>

            {selectedSession.qrCodeDataUrl ? (
              <ProfileSection title="QR Code">
                <div className="rounded-[28px] bg-white p-4">
                  <Image
                    alt={`QR code da sessao ${selectedSession.name}`}
                    className="mx-auto rounded-[20px]"
                    height={220}
                    src={selectedSession.qrCodeDataUrl}
                    unoptimized
                    width={220}
                  />
                </div>
              </ProfileSection>
            ) : null}

            {errorMessage ? <GhostPanel>{errorMessage}</GhostPanel> : null}
            {isPending ? <GhostPanel>Syncing operation...</GhostPanel> : null}
          </div>
        ) : (
          <GhostPanel>Select a contact to reveal the profile rail.</GhostPanel>
        )}
      </aside>
    </div>
  );

  return (
    <main className="h-screen overflow-hidden bg-[var(--background)] text-[var(--foreground)]">
      <div className="flex h-full overflow-hidden">
        <aside className="hidden h-full w-64 flex-col overflow-hidden border-r border-white/5 bg-zinc-950/80 px-4 py-8 pt-24 backdrop-blur-xl md:flex">
          <div className="mb-8 px-2">
            <div className="mb-2 flex items-center gap-3">
              <div className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--primary-container)] text-[var(--on-primary-container)]">
                <Sparkles className="h-4 w-4" strokeWidth={2.4} />
              </div>
              <div>
                <h2 className="font-headline text-lg font-black text-white">Ether OS</h2>
                <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-zinc-500">
                  Omni-channel v2.4
                </p>
              </div>
            </div>
          </div>

          <nav className="flex-1 space-y-1">
            {navigationItems.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition-all ${
                  activeView === id
                    ? 'border-r-2 border-blue-500 bg-blue-600/10 text-blue-400 shadow-[0_0_15px_rgba(59,130,246,0.3)]'
                    : 'text-zinc-500 hover:bg-zinc-800/50 hover:text-zinc-300'
                }`}
                onClick={() => setActiveView(id)}
                type="button"
              >
                <Icon className="h-5 w-5" strokeWidth={activeView === id ? 2.4 : 2.1} />
                <span className="text-sm font-medium">{label}</span>
              </button>
            ))}
          </nav>

          <div className="mt-auto space-y-1 border-t border-white/5 pt-6">
            <button
              className="mb-6 flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--primary-container)] px-4 py-3 text-sm font-bold text-[var(--on-primary-container)] transition-transform active:scale-95"
              onClick={() => setActiveView(selectedSession ? 'conversations' : 'settings')}
              type="button"
            >
              <MessageSquarePlus className="h-4 w-4" strokeWidth={2.2} />
              New Message
            </button>
            <button
              className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-zinc-500 transition-all hover:bg-zinc-800/50 hover:text-zinc-300"
              onClick={() => setActiveView('settings')}
              type="button"
            >
              <CircleHelp className="h-5 w-5" strokeWidth={2.1} />
              <span className="text-sm font-medium">Support</span>
            </button>
            <button
              className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-[var(--error-dim)] transition-all hover:bg-white/5"
              onClick={signOut}
              type="button"
            >
              <LogOut className="h-5 w-5" strokeWidth={2.1} />
              <span className="text-sm font-medium">Sign Out</span>
            </button>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <header className="sticky top-0 z-20 flex items-center justify-between border-b border-white/10 bg-zinc-950/60 px-6 py-3 backdrop-blur-2xl shadow-[0_8px_32px_0_rgba(0,0,0,0.8)]">
            <div className="flex items-center gap-8">
              <span className="font-headline text-2xl font-bold tracking-tight text-transparent bg-gradient-to-br from-blue-400 to-blue-600 bg-clip-text">
                EtherCommand
              </span>
              <div className="hidden items-center gap-3 rounded-full border border-white/5 bg-white/5 px-4 py-1.5 transition-all duration-300 focus-within:border-[var(--primary)]/50 md:flex">
                <Search className="h-4 w-4 text-zinc-400" strokeWidth={2.1} />
                <input
                  className="w-64 border-none bg-transparent text-sm text-white outline-none placeholder:text-zinc-500"
                  onChange={(event) => setGlobalSearch(event.target.value)}
                  placeholder="Search interactions..."
                  value={globalSearch}
                />
              </div>
            </div>

            <div className="flex items-center gap-4">
              <button className="rounded-full p-2 text-zinc-400 transition-all duration-300 hover:bg-white/5 active:scale-95">
                <Bell className="h-5 w-5" strokeWidth={2.1} />
              </button>
              <button className="rounded-full p-2 text-zinc-400 transition-all duration-300 hover:bg-white/5 active:scale-95">
                <Grid3X3 className="h-5 w-5" strokeWidth={2.1} />
              </button>
              <div className="mx-2 h-8 w-px bg-white/10" />
              <button
                className="flex items-center gap-2 rounded-full bg-[var(--primary-container)] px-4 py-1.5 font-semibold text-[var(--on-primary-container)] transition-all duration-200 hover:brightness-110 active:scale-95"
                onClick={() => setActiveView(selectedSession ? 'conversations' : 'settings')}
                type="button"
              >
                <Plus className="h-4 w-4" strokeWidth={2.2} />
                <span className="text-sm">Broadcast</span>
              </button>
              <div className="flex items-center gap-3">
                <div className="grid h-9 w-9 place-items-center overflow-hidden rounded-full border border-white/20 bg-[var(--surface-high)] text-xs font-bold text-white">
                  {authUser?.name
                    ?.split(' ')
                    .map((part) => part[0])
                    .join('')
                    .slice(0, 2)
                    .toUpperCase() ?? 'PH'}
                </div>
              </div>
            </div>
          </header>

          {activeView === 'dashboard'
            ? renderDashboardView()
            : activeView === 'contacts'
              ? renderContactsView()
              : activeView === 'analytics'
                ? renderAnalyticsView()
                : activeView === 'settings'
                  ? renderSettingsView()
                  : renderConversationsView()}
        </div>
      </div>
    </main>
  );
}

function ChannelPill({ channel }: { channel: ChannelRecord }) {
  return (
    <span className="rounded-full bg-white/5 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">
      {channel.name} · {channel.connectedNumbers}
    </span>
  );
}

function MetricCard({
  label,
  value,
  detail,
  tone,
  compact = false,
}: {
  label: string;
  value: number;
  detail: string;
  tone: 'primary' | 'secondary' | 'tertiary' | 'neutral';
  compact?: boolean;
}) {
  const tones = {
    primary: 'border-[var(--primary)]/18 bg-[var(--primary)]/10 text-[var(--primary)]',
    secondary:
      'border-[var(--secondary)]/18 bg-[var(--secondary)]/10 text-[var(--secondary)]',
    tertiary:
      'border-[var(--tertiary)]/18 bg-[var(--tertiary)]/10 text-[var(--tertiary)]',
    neutral: 'border-white/10 bg-white/5 text-white',
  };

  return (
    <div
      className={`rounded-[28px] border px-5 py-5 ${tones[tone]} ${compact ? '' : 'shadow-[0_20px_40px_-28px_rgba(0,0,0,0.9)]'}`}
    >
      <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/55">
        {label}
      </p>
      <p className={`font-headline mt-4 font-semibold text-white ${compact ? 'text-3xl' : 'text-4xl'}`}>
        {value}
      </p>
      <p className="mt-2 text-sm leading-6 text-white/60">{detail}</p>
    </div>
  );
}

function DashboardChannelStatCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof MessageCircle;
  label: string;
  value: number;
  tone: 'primary' | 'secondary' | 'tertiary';
}) {
  const styles = {
    primary: 'bg-[var(--primary)]/20 text-[var(--primary)]',
    secondary: 'bg-[var(--secondary)]/20 text-[var(--secondary)]',
    tertiary: 'bg-[var(--tertiary)]/20 text-[var(--tertiary)]',
  };

  return (
    <div className="rounded-[1.5rem] bg-[var(--surface-highest)] p-4 transition-transform duration-300 group-hover:-translate-y-1">
      <div className="mb-2 flex items-center gap-2">
        <div className={`grid h-6 w-6 place-items-center rounded-full ${styles[tone]}`}>
          <Icon className="h-3.5 w-3.5" strokeWidth={2.1} />
        </div>
        <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">
          {label}
        </span>
      </div>
      <p className="text-5xl font-bold text-white">{value}</p>
    </div>
  );
}

function DashboardResponseChart() {
  return (
    <>
      <div className="relative h-48 w-full">
        <svg className="h-full w-full drop-shadow-[0_0_15px_rgba(127,175,255,0.4)]" viewBox="0 0 400 100">
          <defs>
            <linearGradient id="dashboardChartGradient" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#7fafff" stopOpacity="0.2" />
              <stop offset="100%" stopColor="#7fafff" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path
            d="M0,80 Q50,40 100,60 T200,30 T300,50 T400,20"
            fill="none"
            stroke="#7fafff"
            strokeLinecap="round"
            strokeWidth="4"
          />
          <path
            d="M0,80 Q50,40 100,60 T200,30 T300,50 T400,20 L400,100 L0,100 Z"
            fill="url(#dashboardChartGradient)"
          />
          <circle cx="200" cy="30" fill="#7fafff" r="5" stroke="#0e0e0e" strokeWidth="2" />
        </svg>
        <div className="absolute left-1/2 top-4 -translate-x-1/2 rounded-lg border border-white/10 bg-[var(--surface-highest)] px-3 py-1 text-[10px] font-bold text-white">
          <span className="mr-2 inline-block h-2 w-2 rounded-full bg-[var(--primary)]" />
          Peak Efficiency: 2:15 PM
        </div>
      </div>
      <div className="mt-4 flex justify-between text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-600">
        <span>08:00 AM</span>
        <span>10:00 AM</span>
        <span>12:00 PM</span>
        <span>02:00 PM</span>
        <span>04:00 PM</span>
        <span>06:00 PM</span>
      </div>
    </>
  );
}

function DashboardLiveStreamCard({
  conversation,
  dimmed,
  onOpen,
}: {
  conversation: ConversationRecord;
  dimmed?: boolean;
  onOpen: () => void;
}) {
  const channel = getContactChannelMeta(conversation);
  const ActionIcon = getContactChannelKey(conversation) === 'instagram' ? Heart : Reply;

  return (
    <button
      className={`glass-panel flex w-full items-center gap-4 rounded-[1.4rem] border border-white/5 p-4 text-left transition-all duration-300 hover:bg-white/5 ${
        dimmed ? 'scale-[0.99] opacity-90' : ''
      }`}
      onClick={onOpen}
      type="button"
    >
      <div className="relative">
        <AvatarBadge label={conversation.contact} src={conversation.avatarUrl} />
        <div className={`absolute -bottom-1 -right-1 grid h-6 w-6 place-items-center rounded-full border-4 border-[var(--surface)] ${channel.tone}`}>
          <channel.icon className="h-3.5 w-3.5" strokeWidth={2.1} />
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex items-center justify-between gap-3">
          <span className="truncate text-2xl font-bold text-white">{conversation.contact}</span>
          <span className="text-[10px] font-medium uppercase tracking-tight text-zinc-500">
            {formatRelativePulse(conversation.lastMessageAt).primary}
          </span>
        </div>
        <p className="max-w-md truncate text-sm text-[var(--muted)]">
          {conversation.preview || 'No message preview available yet.'}
        </p>
      </div>
      <div className="flex gap-2">
        <button
          className="rounded-xl bg-[var(--surface-highest)] p-2 text-zinc-400 transition-all hover:text-white"
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
          type="button"
        >
          <ActionIcon className="h-5 w-5" strokeWidth={2.1} />
        </button>
        <button
          className="rounded-xl bg-[var(--surface-highest)] p-2 text-zinc-400 transition-all hover:text-white"
          onClick={(event) => {
            event.stopPropagation();
          }}
          type="button"
        >
          <MoreVertical className="h-5 w-5" strokeWidth={2.1} />
        </button>
      </div>
    </button>
  );
}

function DashboardPerformerItem({
  performer,
}: {
  performer: {
    id: string;
    label: string;
    avatarUrl?: string | null;
    score: number;
    closed: number;
    rank: number;
  };
}) {
  const badgeTone = performer.rank === 1 ? 'bg-yellow-500 text-black' : performer.rank === 2 ? 'bg-zinc-400 text-black' : 'bg-orange-700 text-white';

  return (
    <div className="flex items-center gap-4">
      <div className="relative">
        <AvatarBadge className="border border-white/10" label={performer.label} small src={performer.avatarUrl} />
        <div className={`absolute -right-1 -top-1 grid h-4 w-4 place-items-center rounded-full text-[8px] font-black ${badgeTone}`}>
          {performer.rank}
        </div>
      </div>
      <div className="flex-1">
        <h4 className="text-sm font-bold text-white">{performer.label}</h4>
        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/5">
          <div className="h-full rounded-full bg-[var(--primary)]" style={{ width: `${performer.score}%` }} />
        </div>
      </div>
      <div className="text-right">
        <p className="text-xs font-bold text-white">{performer.score}% CSAT</p>
        <p className="text-[10px] text-zinc-500">{performer.closed} closed</p>
      </div>
    </div>
  );
}

function ConnectivityStripItem({
  label,
  status,
  tone,
}: {
  label: string;
  status: string;
  tone: 'good' | 'error';
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-white/5 bg-[var(--surface-low)] p-4">
      <div
        className={`h-3 w-3 rounded-full ${
          tone === 'good'
            ? 'bg-[var(--secondary)] shadow-[0_0_8px_#5dfd8a]'
            : 'animate-pulse bg-[var(--error-dim)] shadow-[0_0_8px_#d7383b]'
        }`}
      />
      <span className="text-xs font-bold uppercase tracking-[0.16em] text-zinc-500">{label}</span>
      <span className={`ml-auto text-xs font-bold ${tone === 'error' ? 'text-[var(--error)]' : 'text-white'}`}>
        {status}
      </span>
    </div>
  );
}

function AvatarBadge({
  label,
  small = false,
  src,
  className = '',
}: {
  label: string;
  small?: boolean;
  src?: string | null;
  className?: string;
}) {
  const [hasError, setHasError] = useState(false);
  const sizeClass = small ? 'h-8 w-8 text-xs' : 'h-12 w-12 text-sm';
  const resolvedSrc = resolveAvatarSrc(src);

  useEffect(() => {
    setHasError(false);
  }, [resolvedSrc]);

  if (resolvedSrc && !hasError) {
    return (
      <div
        className={`shrink-0 overflow-hidden rounded-2xl bg-[linear-gradient(135deg,#2f2f2f,#5d5d5d)] ${sizeClass} ${className}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          alt={label}
          className="h-full w-full object-cover"
          onError={() => setHasError(true)}
          referrerPolicy="no-referrer"
          src={resolvedSrc}
        />
      </div>
    );
  }

  return (
    <div
      className={`grid shrink-0 place-items-center rounded-2xl bg-[linear-gradient(135deg,#2f2f2f,#5d5d5d)] font-bold text-white ${sizeClass} ${className}`}
    >
      {getInitials(label)}
    </div>
  );
}

function ConversationComposer({
  conversationKey,
  disabled,
  onSend,
  quickReplies,
}: {
  conversationKey: string;
  disabled: boolean;
  onSend: (text: string) => Promise<boolean>;
  quickReplies: string[];
}) {
  const [draft, setDraft] = useState('');

  useEffect(() => {
    setDraft('');
  }, [conversationKey]);

  const submit = useCallback(async () => {
    if (disabled) {
      return;
    }

    const payload = draft.trim();
    if (!payload) {
      return;
    }

    const sent = await onSend(payload);
    if (sent) {
      setDraft('');
    }
  }, [disabled, draft, onSend]);

  return (
    <>
      <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
        {quickReplies.map((reply) => (
          <button
            key={reply}
            className="shrink-0 rounded-full bg-[var(--surface-highest)] px-4 py-2 text-[11px] font-medium text-zinc-300 transition hover:text-white"
            onClick={() => setDraft(reply)}
            type="button"
          >
            {reply}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-3 rounded-[30px] bg-[var(--surface-high)] px-3 py-3 shadow-[0_18px_36px_-18px_rgba(0,0,0,0.9)]">
        <button className="grid h-11 w-11 place-items-center rounded-full bg-white/5 text-[var(--muted)]">
          <Plus className="h-5 w-5" strokeWidth={2.1} />
        </button>
        <button className="grid h-11 w-11 place-items-center rounded-full bg-white/5 text-[var(--muted)]">
          <Smile className="h-5 w-5" strokeWidth={2.1} />
        </button>
        <input
          className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-zinc-500"
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.nativeEvent.isComposing) {
              return;
            }

            event.preventDefault();
            void submit();
          }}
          placeholder={disabled ? 'Selecione uma conversa...' : 'Type a message...'}
          value={draft}
        />
        <button className="grid h-11 w-11 place-items-center rounded-full bg-white/5 text-[var(--muted)]">
          <Mic className="h-5 w-5" strokeWidth={2.1} />
        </button>
        <button
          className="grid h-12 w-12 place-items-center rounded-full bg-[linear-gradient(135deg,#7fafff,#64a1ff)] text-black shadow-[0_0_22px_rgba(127,175,255,0.32)] transition hover:scale-105 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled || !draft.trim()}
          onClick={() => void submit()}
          type="button"
        >
          <Send className="h-5 w-5" strokeWidth={2.2} />
        </button>
      </div>
    </>
  );
}

const MessageBubble = memo(function MessageBubble({
  message,
  avatarUrl,
}: {
  message: MessageRecord;
  avatarUrl?: string | null;
}) {
  const incoming = message.direction !== 'outgoing';

  if (incoming) {
    return (
      <div className="flex max-w-[80%] gap-4">
        <AvatarBadge label={message.author} small src={avatarUrl} />
        <div className="glass-panel rounded-[26px] rounded-tl-none px-5 py-4">
          <p className="text-lg leading-9 text-white/95">{message.body}</p>
          <span className="mt-3 block text-xs text-zinc-500">
            {formatClock(message.timestamp)}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="ml-auto flex max-w-[80%] justify-end">
      <div className="rounded-[26px] rounded-tr-none border border-[rgba(127,175,255,0.2)] bg-[linear-gradient(180deg,rgba(100,161,255,0.16),rgba(100,161,255,0.08))] px-5 py-4 shadow-[inset_0_0_18px_rgba(127,175,255,0.08)]">
        <p className="text-lg leading-9 text-white/95">{message.body}</p>
        <div className="mt-3 flex items-center justify-end gap-2 text-xs text-[var(--primary)]">
          <span>{formatClock(message.timestamp)}</span>
          <span>••</span>
        </div>
      </div>
    </div>
  );
});

function ProfileSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.28em] text-zinc-500">
        {title}
      </p>
      {children}
    </section>
  );
}

function ProfileRow({ label, value }: { label: string; value: string }) {
  const Icon =
    label === 'Email' ? Mail : label === 'Phone' ? Phone : Briefcase;

  return (
    <div className="flex items-center justify-between gap-4 py-2 text-sm">
      <span className="inline-flex items-center gap-2 text-[var(--primary)]">
        <Icon className="h-4 w-4" strokeWidth={2.1} />
        {label}
      </span>
      <span className="text-right text-zinc-300">{value}</span>
    </div>
  );
}

function Tag({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: 'primary' | 'secondary' | 'tertiary' | 'neutral';
}) {
  const tones = {
    primary: 'bg-[var(--primary)]/12 text-[var(--primary)] border-[var(--primary)]/20',
    secondary:
      'bg-[var(--secondary)]/12 text-[var(--secondary)] border-[var(--secondary)]/20',
    tertiary:
      'bg-[var(--tertiary)]/12 text-[var(--tertiary)] border-[var(--tertiary)]/20',
    neutral: 'bg-white/5 text-zinc-300 border-white/10',
  };

  return (
    <span
      className={`rounded-full border px-4 py-2 text-[11px] font-bold uppercase tracking-[0.14em] ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

function MiniTimelineItem({
  label,
  meta,
  tone,
}: {
  label: string;
  meta: string;
  tone: 'primary' | 'secondary';
}) {
  const bg =
    tone === 'primary'
      ? 'text-[var(--primary)] bg-[var(--surface-high)]'
      : 'text-[var(--secondary)] bg-[var(--surface-high)]';
  const Icon = tone === 'primary' ? MessageCircle : Wifi;

  return (
    <div className="flex gap-3">
      <div className={`grid h-10 w-10 place-items-center rounded-2xl ${bg}`}>
        <Icon className="h-4 w-4" strokeWidth={2.1} />
      </div>
      <div>
        <p className="text-sm font-semibold text-white">{label}</p>
        <p className="mt-1 text-xs text-zinc-500">{meta}</p>
      </div>
    </div>
  );
}

function Field({
  value,
  placeholder,
  onChange,
}: {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <input
      className="w-full rounded-2xl border-0 border-b-2 border-transparent bg-[var(--surface-high)] px-4 py-3 text-sm text-white outline-none transition focus:border-[var(--primary)]"
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      value={value}
    />
  );
}

function GhostPanel({ children }: { children: React.ReactNode }) {
  return (
    <div className="glass-panel rounded-[26px] px-5 py-4 text-sm leading-7 text-[var(--muted)]">
      {children}
    </div>
  );
}

function getInitials(label: string) {
  const parts = label.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? '').join('') || 'PH';
}

function formatClock(timestamp: string) {
  return new Date(timestamp).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDateLabel(timestamp: string) {
  return new Date(timestamp).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function formatRelativePulse(timestamp: string) {
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) {
    return {
      primary: 'Unknown',
      secondary: 'No pulse available',
    };
  }

  const distance = Date.now() - parsed;
  const minutes = Math.max(1, Math.floor(distance / 60000));

  if (minutes < 2) {
    return {
      primary: 'Just now',
      secondary: 'Realtime activity',
    };
  }

  if (minutes < 60) {
    return {
      primary: `${minutes} mins ago`,
      secondary: 'Active session',
    };
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return {
      primary: `${hours}h ago`,
      secondary: formatClock(timestamp),
    };
  }

  const days = Math.floor(hours / 24);
  return {
    primary: `${days} days ago`,
    secondary: formatDateLabel(timestamp),
  };
}

function toContactEmail(label: string) {
  const safeName = label.toLowerCase().replace(/[^a-z0-9]+/g, '.');
  return `${safeName}@pulsehub.local`;
}

function slugifyContact(label: string) {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 18);
}

function isVerifiedContact(contact: ConversationRecord) {
  return Boolean(contact.avatarUrl && !isGroupConversation(contact));
}

function getContactChannelKey(contact: ConversationRecord) {
  const value = `${contact.channelName} ${contact.status} ${contact.contact}`.toLowerCase();
  if (value.includes('insta')) {
    return 'instagram';
  }
  if (value.includes('face') || value.includes('messenger')) {
    return 'facebook';
  }
  return 'whatsapp';
}

function getContactChannelMeta(contact: ConversationRecord) {
  const channelKey = getContactChannelKey(contact);

  switch (channelKey) {
    case 'instagram':
      return {
        label: 'Instagram',
        icon: Camera,
        tone: 'border-[var(--tertiary)]/20 bg-[var(--tertiary)]/10 text-[var(--tertiary)]',
      };
    case 'facebook':
      return {
        label: 'Facebook',
        icon: ContactRound,
        tone: 'border-[var(--primary)]/20 bg-[var(--primary)]/10 text-[var(--primary)]',
      };
    default:
      return {
        label: 'WhatsApp',
        icon: MessageCircle,
        tone: 'border-[var(--secondary)]/20 bg-[var(--secondary)]/10 text-[var(--secondary)]',
      };
  }
}

function getContactInteractionMetric(contact: ConversationRecord) {
  if (contact.unread > 0) {
    return {
      value: contact.unread.toLocaleString('pt-BR'),
      label: `+${Math.max(contact.unread, 1)}%`,
      tone: 'text-[var(--secondary)]',
    };
  }

  if (isGroupConversation(contact)) {
    return {
      value: '842',
      label: 'Steady',
      tone: 'text-[var(--muted)]',
    };
  }

  return {
    value: '512',
    label: 'Stable',
    tone: 'text-[var(--muted)]',
  };
}

function getContactConnectivity(
  contact: ConversationRecord,
  sessionStatus?: SessionRecord['status'] | null,
) {
  if (contact.unread > 0 || sessionStatus === 'active') {
    return {
      active: true,
      label: 'Active',
      dot: 'bg-[var(--secondary)]',
      tone: 'text-white',
    };
  }

  return {
    active: false,
    label: 'Inactive',
    dot: 'bg-white/20',
    tone: 'text-[var(--muted)]',
  };
}

function contactChannelHealth(conversations: ConversationRecord[]) {
  const total = Math.max(conversations.length, 1);
  const counts = conversations.reduce(
    (accumulator, conversation) => {
      const key = getContactChannelKey(conversation);
      accumulator[key] += 1;
      return accumulator;
    },
    { whatsapp: 0, instagram: 0, facebook: 0 },
  );

  return [
    {
      label: 'WhatsApp',
      value: Math.round((counts.whatsapp / total) * 100),
      bar: 'bg-[var(--secondary)]',
    },
    {
      label: 'Instagram',
      value: Math.round((counts.instagram / total) * 100),
      bar: 'bg-[var(--tertiary)]',
    },
    {
      label: 'Messenger',
      value: Math.round((counts.facebook / total) * 100),
      bar: 'bg-[var(--primary)]',
    },
  ];
}

function resolveAvatarSrc(src?: string | null) {
  if (!src) {
    return undefined;
  }
  if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('data:')) {
    return src;
  }
  if (src.startsWith('/')) {
    return `${apiUrl}${src}`;
  }
  return src;
}

function sanitizeOverview(overview: DashboardOverview): DashboardOverview {
  return {
    ...overview,
    conversations: dedupeConversations(overview.conversations),
  };
}

function dedupeConversations(conversations: ConversationRecord[]) {
  const deduped = new Map<string, ConversationRecord>();

  for (const conversation of conversations) {
    const key = [
      conversation.sessionId,
      normalizeConversationKey(conversation.participantId || conversation.id),
    ].join(':');
    const existing = deduped.get(key);

    if (!existing) {
      deduped.set(key, conversation);
      continue;
    }

    const existingTime = Date.parse(existing.lastMessageAt || '') || 0;
    const incomingTime = Date.parse(conversation.lastMessageAt || '') || 0;
    const newest = incomingTime >= existingTime ? conversation : existing;
    const fallback = newest === conversation ? existing : conversation;

    deduped.set(key, {
      ...newest,
      avatarUrl: newest.avatarUrl || fallback.avatarUrl,
      preview: newest.preview || fallback.preview,
      unread: Math.max(existing.unread, conversation.unread),
      messages: newest.messages.length > 0 ? newest.messages : fallback.messages,
    });
  }

  return Array.from(deduped.values()).sort((left, right) => {
    const leftTime = Date.parse(left.lastMessageAt || '') || 0;
    const rightTime = Date.parse(right.lastMessageAt || '') || 0;

    if (leftTime === rightTime) {
      return left.contact.localeCompare(right.contact, 'pt-BR');
    }

    return rightTime - leftTime;
  });
}

function filterConversations(
  conversations: ConversationRecord[],
  filter: ConversationFilter,
) {
  switch (filter) {
    case 'direct':
      return conversations.filter((conversation) => !isGroupConversation(conversation));
    case 'groups':
      return conversations.filter((conversation) => isGroupConversation(conversation));
    case 'unread':
      return conversations.filter((conversation) => conversation.unread > 0);
    default:
      return conversations;
  }
}

function isGroupConversation(conversation: ConversationRecord) {
  return conversation.participantId.endsWith('@g.us') || conversation.id.endsWith('@g.us');
}

function normalizeConversationKey(value: string) {
  return value.trim().toLowerCase();
}
