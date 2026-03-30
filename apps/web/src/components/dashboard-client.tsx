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
  Paperclip,
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
  Wifi,
  X,
} from 'lucide-react';
import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useDeferredValue,
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

const composerEmojis = ['🙂', '😂', '😍', '🙏', '🎉', '🔥', '✅', '❤️'];

const contactsKanbanStages = [
  {
    id: 'new' as const,
    label: 'Novos Leads',
    accent: 'bg-sky-400',
    surface: 'from-sky-500/12 to-transparent',
  },
  {
    id: 'qualified' as const,
    label: 'Qualificados',
    accent: 'bg-violet-400',
    surface: 'from-violet-500/12 to-transparent',
  },
  {
    id: 'active' as const,
    label: 'Em Atendimento',
    accent: 'bg-emerald-400',
    surface: 'from-emerald-500/12 to-transparent',
  },
  {
    id: 'followup' as const,
    label: 'Follow-up',
    accent: 'bg-amber-400',
    surface: 'from-amber-500/12 to-transparent',
  },
  {
    id: 'won' as const,
    label: 'Fechados',
    accent: 'bg-pink-400',
    surface: 'from-pink-500/12 to-transparent',
  },
];

const contactsBoards = [
  {
    id: 'contacts' as const,
    label: 'Contatos',
    description: 'Toda a base sincronizada',
    icon: LayoutGrid,
  },
  {
    id: 'unread' as const,
    label: 'Nao lidos',
    description: 'Com novas mensagens',
    icon: Bell,
  },
  {
    id: 'verified' as const,
    label: 'Verificados',
    description: 'Perfis prioritarios',
    icon: BadgeCheck,
  },
  {
    id: 'groups' as const,
    label: 'Grupos',
    description: 'Fluxos coletivos',
    icon: ContactRound,
  },
];

const contactsKanbanBoardStorageKey = 'pulse-hub.contacts-kanban-board';

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

type RealtimeSocketEvent = {
  sessionId: string;
  chatJid?: string;
  kind:
    | 'connection'
    | 'chat.new'
    | 'message.new'
    | 'message.ack'
    | 'kanban.stage.updated'
    | 'kanban.board.updated'
    | 'kanban.contact.updated';
  direction?: 'incoming' | 'outgoing';
  text?: string;
  payload?: string;
  occurredAt?: string;
};

type ToastItem = {
  id: number;
  tone: 'success' | 'error' | 'info';
  title: string;
  description?: string;
};

type ComposerAttachment = {
  file: File;
  previewUrl: string | null;
  sticker: boolean;
};

type SystemContactsBoardId = 'contacts' | 'unread' | 'verified' | 'groups';

type ContactsBoardId = SystemContactsBoardId | `custom:${string}`;

type CustomContactsBoard = {
  id: `custom:${string}`;
  label: string;
  description: string;
  contactsFilter: ConversationFilter;
  contactsAudienceFilter: 'all' | 'verified';
  contactsChannelFilter: 'all' | 'whatsapp' | 'instagram' | 'facebook';
};

type ContactKanbanBoardRecord = CustomContactsBoard & {
  createdBy?: string;
  updatedBy?: string;
  createdAt: string;
  updatedAt: string;
};

type ContactCRMProfileRecord = {
  sessionId: string;
  conversationId: string;
  assignee?: string;
  priority?: '' | 'low' | 'medium' | 'high' | 'urgent';
  notes?: string;
  tags?: string[];
  updatedBy?: string;
  updatedAt: string;
};

type ContactKanbanStageId = 'new' | 'qualified' | 'active' | 'followup' | 'won';

type ContactKanbanStageRecord = {
  sessionId: string;
  conversationId: string;
  stage: ContactKanbanStageId;
  updatedBy?: string;
  updatedAt: string;
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
  const [pendingConversationId, setPendingConversationId] = useState<string | null>(null);
  const [conversationFilter, setConversationFilter] = useState<ConversationFilter>('all');
  const [contactsFilter, setContactsFilter] = useState<ConversationFilter>('all');
  const [contactsAudienceFilter, setContactsAudienceFilter] = useState<'all' | 'verified'>('all');
  const [contactsChannelFilter, setContactsChannelFilter] = useState<
    'all' | 'whatsapp' | 'instagram' | 'facebook'
  >('all');
  const [showAdvancedContactsFilters, setShowAdvancedContactsFilters] = useState(false);
  const [contactsSearch, setContactsSearch] = useState('');
  const [activeContactsBoard, setActiveContactsBoard] = useState<ContactsBoardId>('contacts');
  const [customContactsBoards, setCustomContactsBoards] = useState<ContactKanbanBoardRecord[]>([]);
  const [showCreateBoardModal, setShowCreateBoardModal] = useState(false);
  const [newBoardForm, setNewBoardForm] = useState({ label: '', description: '' });
  const [contactKanbanStageMap, setContactKanbanStageMap] = useState<
    Record<string, ContactKanbanStageId>
  >({});
  const [contactCrmProfileMap, setContactCrmProfileMap] = useState<
    Record<string, ContactCRMProfileRecord>
  >({});
  const [isLoadingContactKanban, setIsLoadingContactKanban] = useState(true);
  const [isLoadingContactBoards, setIsLoadingContactBoards] = useState(true);
  const [isLoadingContactCRM, setIsLoadingContactCRM] = useState(true);
  const [draggedContactKey, setDraggedContactKey] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<ContactKanbanStageId | null>(null);
  const [showCreateContactModal, setShowCreateContactModal] = useState(false);
  const [createContactStage, setCreateContactStage] = useState<ContactKanbanStageId>('new');
  const [newContactForm, setNewContactForm] = useState({ name: '', phone: '' });
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
  const globalSearchInputRef = useRef<HTMLInputElement | null>(null);
  const messageCacheRef = useRef(new Map<string, MessageRecord[]>());
  const messagePrefetchRef = useRef(new Set<string>());
  const shouldStickToBottomRef = useRef(true);
  const lastConversationAnchorRef = useRef<string | null>(null);
  const viewTransitionTimerRef = useRef<number | null>(null);
  const [viewTransition, setViewTransition] = useState<WorkspaceView | null>(null);
  const [openedUnreadMarker, setOpenedUnreadMarker] = useState<{
    conversationId: string;
    unreadCount: number;
  } | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastTimersRef = useRef(new Map<number, number>());
  const toastIdRef = useRef(0);
  const currentView = viewTransition ?? activeView;
  const hasWorkspaceData = overview.sessions.length > 0 || overview.conversations.length > 0;
  const shouldShowInitialSkeleton = isPending && !hasWorkspaceData && !errorMessage;
  const shouldShowContactsSkeleton =
    shouldShowInitialSkeleton || isLoadingContactKanban || isLoadingContactBoards || isLoadingContactCRM;
  const deferredContactsSearch = useDeferredValue(contactsSearch);
  const isConversationSwitching = pendingConversationId !== null;
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

  const conversationSearchTerm = globalSearch.trim().toLowerCase();

  const visibleSessionConversations = useMemo(
    () => {
      if (!isConversationsView) {
        return [] as ConversationRecord[];
      }

      if (!conversationSearchTerm) {
        return sessionConversations;
      }

      return sessionConversations.filter((conversation) =>
        [
          conversation.contact,
          conversation.participantId,
          conversation.channelName,
          conversation.owner,
          conversation.preview,
        ]
          .join(' ')
          .toLowerCase()
          .includes(conversationSearchTerm),
      );
    },
    [conversationSearchTerm, isConversationsView, sessionConversations],
  );

  const selectedConversation = useMemo(
    () => {
      if (!isConversationsView) {
        return undefined;
      }

      return (
        visibleSessionConversations.find(
          (conversation) => conversation.id === selectedConversationId,
        ) ?? visibleSessionConversations[0]
      );
    },
    [isConversationsView, selectedConversationId, visibleSessionConversations],
  );

  const contacts = useMemo(
    () => (isContactsView ? overview.conversations : ([] as ConversationRecord[])),
    [isContactsView, overview.conversations],
  );

  const contactsBase = useMemo(() => {
    if (!isContactsView) {
      return [] as ConversationRecord[];
    }

    return applyContactsWorkspaceFilters(contacts, {
      contactsFilter,
      contactsAudienceFilter,
      contactsChannelFilter,
      searchTerm: deferredContactsSearch,
    });
  }, [
    contacts,
    contactsAudienceFilter,
    contactsChannelFilter,
    contactsFilter,
    deferredContactsSearch,
    isContactsView,
  ]);

  const activeCustomContactsBoard = useMemo(
    () => customContactsBoards.find((board) => board.id === activeContactsBoard),
    [activeContactsBoard, customContactsBoards],
  );

  const filteredContacts = useMemo(() => {
    if (activeCustomContactsBoard) {
      return applyContactsWorkspaceFilters(contacts, {
        contactsFilter: activeCustomContactsBoard.contactsFilter,
        contactsAudienceFilter: activeCustomContactsBoard.contactsAudienceFilter,
        contactsChannelFilter: activeCustomContactsBoard.contactsChannelFilter,
        searchTerm: deferredContactsSearch,
      });
    }

    return filterContactsBoard(contactsBase, activeContactsBoard);
  }, [
    activeContactsBoard,
    activeCustomContactsBoard,
    contacts,
    contactsBase,
    deferredContactsSearch,
  ]);

  const contactsBoardOptions = useMemo(
    () => [
      ...contactsBoards.map((board) => ({
        ...board,
        count: filterContactsBoard(contactsBase, board.id).length,
        isCustom: false,
      })),
      ...customContactsBoards.map((board) => ({
        ...board,
        icon: LayoutGrid,
        count: applyContactsWorkspaceFilters(contacts, {
          contactsFilter: board.contactsFilter,
          contactsAudienceFilter: board.contactsAudienceFilter,
          contactsChannelFilter: board.contactsChannelFilter,
          searchTerm: deferredContactsSearch,
        }).length,
        isCustom: true,
      })),
    ],
    [contacts, contactsBase, customContactsBoards, deferredContactsSearch],
  );

  const kanbanColumns = useMemo(() => {
    const sortedContacts = [...filteredContacts].sort((left, right) => {
      if (right.unread !== left.unread) {
        return right.unread - left.unread;
      }

      return new Date(right.lastMessageAt).getTime() - new Date(left.lastMessageAt).getTime();
    });

    return contactsKanbanStages.map((stage) => ({
      ...stage,
      contacts: sortedContacts.filter(
        (contact) =>
          resolveContactKanbanStage(contact, contactKanbanStageMap) === stage.id,
      ),
    }));
  }, [contactKanbanStageMap, filteredContacts]);

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

  const unreadSeparatorIndex = useMemo(() => {
    if (!activeConversationId || openedUnreadMarker?.conversationId !== activeConversationId) {
      return -1;
    }

    const unreadCount = Math.min(openedUnreadMarker.unreadCount, messages.length);
    if (unreadCount <= 0) {
      return -1;
    }

    return Math.max(messages.length - unreadCount, 0);
  }, [activeConversationId, messages.length, openedUnreadMarker]);

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

  const dismissToast = useCallback((toastId: number) => {
    const timer = toastTimersRef.current.get(toastId);
    if (timer) {
      window.clearTimeout(timer);
      toastTimersRef.current.delete(toastId);
    }

    setToasts((current) => current.filter((toast) => toast.id !== toastId));
  }, []);

  const pushToast = useCallback(
    (toast: Omit<ToastItem, 'id'>) => {
      const nextToastKey = buildToastKey(toast);
      const existingToast = toasts.find((item) => buildToastKey(item) === nextToastKey);
      const id = existingToast ? existingToast.id : toastIdRef.current + 1;

      if (!existingToast) {
        toastIdRef.current = id;
      }

      const existingTimer = toastTimersRef.current.get(id);
      if (existingTimer) {
        window.clearTimeout(existingTimer);
      }

      setToasts((current) => {
        const nextItem = { ...toast, id };
        const withoutDuplicate = current.filter((item) => item.id !== id);
        return [...withoutDuplicate.slice(-2), nextItem];
      });

      const timer = window.setTimeout(() => {
        dismissToast(id);
      }, 3600);
      toastTimersRef.current.set(id, timer);
    },
    [dismissToast, toasts],
  );

  const resetContactsView = useCallback(() => {
    setContactsSearch('');
    setContactsFilter('all');
    setContactsAudienceFilter('all');
    setContactsChannelFilter('all');
    setActiveContactsBoard('contacts');
    setShowAdvancedContactsFilters(false);
  }, []);

  const resetConversationView = useCallback(() => {
    setGlobalSearch('');
    setConversationFilter('all');
  }, []);

  const navigateToView = useCallback(
    (nextView: WorkspaceView) => {
      if (nextView === activeView && viewTransition === null) {
        return;
      }

      if (viewTransitionTimerRef.current) {
        window.clearTimeout(viewTransitionTimerRef.current);
      }

      setViewTransition(nextView);
      viewTransitionTimerRef.current = window.setTimeout(() => {
        setActiveView(nextView);
        window.requestAnimationFrame(() => {
          setViewTransition(null);
        });
      }, 180);
    },
    [activeView, viewTransition],
  );

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

  useEffect(() => {
    const toastTimers = toastTimersRef.current;

    return () => {
      if (viewTransitionTimerRef.current) {
        window.clearTimeout(viewTransitionTimerRef.current);
      }

      for (const timer of toastTimers.values()) {
        window.clearTimeout(timer);
      }
      toastTimers.clear();
    };
  }, []);

  useEffect(() => {
    const rawBoard = window.localStorage.getItem(contactsKanbanBoardStorageKey);
    if (
      rawBoard &&
      (contactsBoards.some((board) => board.id === rawBoard) || rawBoard.startsWith('custom:'))
    ) {
      setActiveContactsBoard(rawBoard as ContactsBoardId);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(contactsKanbanBoardStorageKey, activeContactsBoard);
  }, [activeContactsBoard]);

  useEffect(() => {
    if (
      activeContactsBoard.startsWith('custom:') &&
      !customContactsBoards.some((board) => board.id === activeContactsBoard)
    ) {
      setActiveContactsBoard('contacts');
    }
  }, [activeContactsBoard, customContactsBoards]);

  const loadOverview = useCallback(async () => {
    const response = await fetch(`${apiUrl}/dashboard/overview`, {
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error('Nao foi possivel atualizar a dashboard.');
    }

    const data = (await response.json()) as DashboardOverview;
    const nextOverview = sanitizeOverview(data);
    setOverview((current) =>
      areOverviewsEquivalent(current, nextOverview) ? current : nextOverview,
    );
  }, []);

  const loadContactKanbanStages = useCallback(async () => {
    const response = await fetch(`${apiUrl}/whatsapp/contacts/kanban`, {
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error('Nao foi possivel carregar o kanban de contatos.');
    }

    const records = (await response.json()) as ContactKanbanStageRecord[];
    setContactKanbanStageMap(() => {
      const nextMap: Record<string, ContactKanbanStageId> = {};
      for (const record of records) {
        nextMap[`${record.sessionId}:${record.conversationId}`] = record.stage;
      }
      return nextMap;
    });
  }, []);

  const loadContactBoards = useCallback(async () => {
    const response = await fetch(`${apiUrl}/whatsapp/contacts/boards`, {
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error('Nao foi possivel carregar os boards do CRM.');
    }

    const records = (await response.json()) as ContactKanbanBoardRecord[];
    setCustomContactsBoards(records);
  }, []);

  const loadContactCRMProfiles = useCallback(async () => {
    const response = await fetch(`${apiUrl}/whatsapp/contacts/crm`, {
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error('Nao foi possivel carregar os dados do CRM.');
    }

    const records = (await response.json()) as ContactCRMProfileRecord[];
    setContactCrmProfileMap(() => {
      const nextMap: Record<string, ContactCRMProfileRecord> = {};
      for (const record of records) {
        nextMap[`${record.sessionId}:${record.conversationId}`] = record;
      }
      return nextMap;
    });
  }, []);

  useEffect(() => {
    if (!isAuthReady) {
      return;
    }

    setIsLoadingContactKanban(true);
    void loadContactKanbanStages()
      .catch(() => undefined)
      .finally(() => setIsLoadingContactKanban(false));
  }, [isAuthReady, loadContactKanbanStages]);

  useEffect(() => {
    if (!isAuthReady) {
      return;
    }

    setIsLoadingContactBoards(true);
    void loadContactBoards()
      .catch(() => undefined)
      .finally(() => setIsLoadingContactBoards(false));
  }, [isAuthReady, loadContactBoards]);

  useEffect(() => {
    if (!isAuthReady) {
      return;
    }

    setIsLoadingContactCRM(true);
    void loadContactCRMProfiles()
      .catch(() => undefined)
      .finally(() => setIsLoadingContactCRM(false));
  }, [isAuthReady, loadContactCRMProfiles]);

  const fetchConversationMessages = useCallback(async (sessionId: string, conversationId: string) => {
    const response = await fetch(
      `${apiUrl}/whatsapp/sessions/${sessionId}/conversations/${conversationId}/messages`,
      { cache: 'no-store' },
    );

    if (!response.ok) {
      throw new Error('Nao foi possivel carregar as mensagens.');
    }

    return (await response.json()) as MessageRecord[];
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
        const data = await fetchConversationMessages(sessionId, conversationId);
        messageCacheRef.current.set(buildConversationCacheKey(sessionId, conversationId), data);
        setMessages((current) =>
          areMessageListsEquivalent(current, data) ? current : data,
        );
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
        setPendingConversationId((current) =>
          current === conversationId ? null : current,
        );
        if (options?.showLoading ?? true) {
          setIsLoadingMessages(false);
        }
      }
    },
    [fetchConversationMessages],
  );

  const prefetchConversation = useCallback(
    async (sessionId: string, conversationId: string) => {
      const cacheKey = buildConversationCacheKey(sessionId, conversationId);
      if (messageCacheRef.current.has(cacheKey) || messagePrefetchRef.current.has(cacheKey)) {
        return;
      }

      messagePrefetchRef.current.add(cacheKey);
      try {
        const data = await fetchConversationMessages(sessionId, conversationId);
        messageCacheRef.current.set(cacheKey, data);
      } catch {
        return;
      } finally {
        messagePrefetchRef.current.delete(cacheKey);
      }
    },
    [fetchConversationMessages],
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

  const openConversation = useCallback((conversationId: string) => {
    if (!conversationId || conversationId === selectedConversationId) {
      return;
    }

    shouldStickToBottomRef.current = true;

    const targetConversation = visibleSessionConversations.find(
      (conversation) => conversation.id === conversationId,
    );

    setOpenedUnreadMarker({
      conversationId,
      unreadCount: targetConversation?.unread ?? 0,
    });

    const cacheKey = selectedSession
      ? buildConversationCacheKey(selectedSession.id, conversationId)
      : null;
    const cachedMessages = cacheKey ? messageCacheRef.current.get(cacheKey) : undefined;

    setPendingConversationId(conversationId);
    setTypingConversationId(null);
    setIsLoadingMessages(true);
    if (cachedMessages) {
      setMessages((current) =>
        areMessageListsEquivalent(current, cachedMessages) ? current : cachedMessages,
      );
    }
    setSelectedConversationId(conversationId);
  }, [selectedConversationId, selectedSession, visibleSessionConversations]);

  useEffect(() => {
    if (!isConversationsView) {
      return;
    }

    if (!selectedSession) {
      setSelectedConversationId('');
      return;
    }

    const currentConversationExists = visibleSessionConversations.some(
      (conversation) => conversation.id === selectedConversationId,
    );

    if (!currentConversationExists) {
      setSelectedConversationId(visibleSessionConversations[0]?.id ?? '');
    }
  }, [
    isConversationsView,
    selectedConversationId,
    selectedSession,
    visibleSessionConversations,
  ]);

  useEffect(() => {
    if (!isConversationsView || !activeConversationId) {
      return;
    }

    const currentConversation = visibleSessionConversations.find(
      (conversation) => conversation.id === activeConversationId,
    );

    if (!currentConversation) {
      return;
    }

    setOpenedUnreadMarker((current) => {
      if (current?.conversationId === activeConversationId) {
        return current;
      }

      return {
        conversationId: activeConversationId,
        unreadCount: currentConversation.unread,
      };
    });
  }, [activeConversationId, isConversationsView, visibleSessionConversations]);

  useEffect(() => {
    if (!isConversationsView || !selectedSession || visibleSessionConversations.length < 2) {
      return;
    }

    const currentIndex = visibleSessionConversations.findIndex(
      (conversation) => conversation.id === activeConversationId,
    );

    const likelyTargets = [
      visibleSessionConversations[currentIndex + 1]?.id,
      visibleSessionConversations[currentIndex - 1]?.id,
    ].filter((value): value is string => Boolean(value));

    for (const conversationId of likelyTargets) {
      void prefetchConversation(selectedSession.id, conversationId);
    }
  }, [
    activeConversationId,
    isConversationsView,
    prefetchConversation,
    selectedSession,
    visibleSessionConversations,
  ]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        globalSearchInputRef.current?.focus();
        globalSearchInputRef.current?.select();
        return;
      }

      if (isTypingTarget(event.target)) {
        return;
      }

      if (
        event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        ['1', '2', '3', '4', '5'].includes(event.key)
      ) {
        event.preventDefault();
        const nextView = navigationItems[Number(event.key) - 1]?.id;
        if (nextView) {
          navigateToView(nextView);
        }
        return;
      }

      if (
        !isConversationsView ||
        !event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') ||
        visibleSessionConversations.length === 0
      ) {
        return;
      }

      event.preventDefault();
      const currentIndex = visibleSessionConversations.findIndex(
        (conversation) => conversation.id === selectedConversation?.id,
      );
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      const nextIndex =
        currentIndex === -1
          ? 0
          : Math.min(
              Math.max(currentIndex + direction, 0),
              visibleSessionConversations.length - 1,
            );

      if (nextIndex !== currentIndex) {
        openConversation(visibleSessionConversations[nextIndex].id);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    isConversationsView,
    navigateToView,
    openConversation,
    selectedConversation?.id,
    visibleSessionConversations,
  ]);

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
  }, [isAuthReady, isConversationsView, loadOverview, selectedSession]);

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
    if (!isAuthReady) {
      return;
    }

    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let refreshTimer: number | null = null;
    let cancelled = false;

    const scheduleOverviewRefresh = () => {
      if (refreshTimer) {
        window.clearTimeout(refreshTimer);
      }

      refreshTimer = window.setTimeout(() => {
        void loadOverview().catch(() => undefined);
      }, 180);
    };

    const connect = () => {
      if (cancelled) {
        return;
      }

      socket = new WebSocket(getWebSocketUrl(`${apiUrl}/ws`));

      socket.onmessage = (event) => {
        let payload: RealtimeSocketEvent;

        try {
          payload = JSON.parse(event.data) as RealtimeSocketEvent;
        } catch {
          return;
        }

        if (
          payload.kind === 'connection' ||
          payload.kind === 'chat.new' ||
          payload.kind === 'message.new' ||
          payload.kind === 'message.ack'
        ) {
          scheduleOverviewRefresh();
        }

        if (payload.kind === 'kanban.stage.updated') {
          const nextStage = payload.text;
          if (payload.chatJid && payload.sessionId && isValidContactKanbanStageId(nextStage)) {
            setContactKanbanStageMap((current) => ({
              ...current,
              [`${payload.sessionId}:${payload.chatJid}`]: nextStage,
            }));
          } else {
            void loadContactKanbanStages().catch(() => undefined);
          }
        }

        if (payload.kind === 'kanban.board.updated') {
          void loadContactBoards().catch(() => undefined);
        }

        if (payload.kind === 'kanban.contact.updated') {
          if (payload.payload) {
            try {
              const record = JSON.parse(payload.payload) as ContactCRMProfileRecord;
              setContactCrmProfileMap((current) => ({
                ...current,
                [`${record.sessionId}:${record.conversationId}`]: record,
              }));
            } catch {
              void loadContactCRMProfiles().catch(() => undefined);
            }
          } else {
            void loadContactCRMProfiles().catch(() => undefined);
          }
        }

        if (
          isConversationsView &&
          activeSessionId &&
          activeConversationId &&
          payload.kind === 'message.new' &&
          payload.chatJid === activeConversationId
        ) {
          const delay = payload.direction === 'incoming' ? 700 : 0;
          window.setTimeout(() => {
            void loadMessages(activeSessionId, activeConversationId, {
              showLoading: false,
            }).catch(() => undefined);
          }, delay);
        }
      };

      socket.onerror = () => {
        socket?.close();
      };

      socket.onclose = () => {
        if (cancelled) {
          return;
        }

        reconnectTimer = window.setTimeout(connect, 1500);
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (refreshTimer) {
        window.clearTimeout(refreshTimer);
      }
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
      }
      socket?.close();
    };
  }, [
    activeConversationId,
    activeSessionId,
    isAuthReady,
    isConversationsView,
    loadContactBoards,
    loadContactCRMProfiles,
    loadContactKanbanStages,
    loadMessages,
    loadOverview,
  ]);

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

    if (isConversationSwitching) {
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
  }, [
    activeConversationId,
    activeSessionId,
    isConversationSwitching,
    isConversationsView,
    messages,
    typingConversationId,
  ]);

  const handleMessagesScroll = useCallback(() => {
    const container = messagesRef.current;

    if (!container) {
      return;
    }

    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;

    shouldStickToBottomRef.current = distanceFromBottom <= 96;
  }, []);

  const executeAction = useCallback(
    async (handler: () => Promise<void>, options?: { successMessage?: string }) => {
      setErrorMessage(null);

      try {
        await handler();
        if (options?.successMessage) {
          pushToast({
            tone: 'success',
            title: options.successMessage,
          });
        }
        return true;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Falha inesperada.';
        setErrorMessage(message);
        pushToast({
          tone: 'error',
          title: 'Action failed',
          description: message,
        });
        return false;
      }
    },
    [pushToast],
  );

  const runAction = useCallback((handler: () => Promise<void>, options?: { successMessage?: string }) => {
    startTransition(() => {
      void executeAction(handler, options);
    });
  }, [executeAction]);

  const moveContactToStage = useCallback(
    async (contact: ConversationRecord, nextStage: ContactKanbanStageId) => {
      const storageKey = buildContactKanbanKey(contact);
      const previousStage = contactKanbanStageMap[storageKey];

      setContactKanbanStageMap((current) => ({
        ...current,
        [storageKey]: nextStage,
      }));
      setSelectedContactId(contact.id);

      const persisted = await executeAction(async () => {
        const response = await fetch(`${apiUrl}/whatsapp/contacts/kanban`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: contact.sessionId,
            conversationId: contact.id,
            stage: nextStage,
            updatedBy: authUser?.name || authUser?.email || 'Operador',
          }),
        });

        if (!response.ok) {
          throw new Error('Nao foi possivel salvar a etapa do contato.');
        }
      });

      if (!persisted) {
        setContactKanbanStageMap((current) => {
          const nextMap = { ...current };
          if (previousStage) {
            nextMap[storageKey] = previousStage;
          } else {
            delete nextMap[storageKey];
          }
          return nextMap;
        });
      }
    },
    [authUser?.email, authUser?.name, contactKanbanStageMap, executeAction],
  );

  const activateContactsBoard = useCallback(
    (boardId: ContactsBoardId) => {
      setActiveContactsBoard(boardId);

      const customBoard = customContactsBoards.find((board) => board.id === boardId);
      if (customBoard) {
        setContactsFilter(customBoard.contactsFilter);
        setContactsAudienceFilter(customBoard.contactsAudienceFilter);
        setContactsChannelFilter(customBoard.contactsChannelFilter);
      }
    },
    [customContactsBoards],
  );

  const createContactsBoard = useCallback(async () => {
    const label = newBoardForm.label.trim();
    const description = newBoardForm.description.trim() || 'Board personalizado do CRM';
    if (!label) {
      pushToast({
        tone: 'error',
        title: 'Nome do board obrigatorio',
        description: 'Defina um nome curto para criar o board.',
      });
      return;
    }

    const boardId = `custom:${slugifyContact(label)}-${Date.now()}` as const;
    const nextBoard: ContactKanbanBoardRecord = {
      id: boardId,
      label,
      description,
      contactsFilter,
      contactsAudienceFilter,
      contactsChannelFilter,
      createdBy: authUser?.name || authUser?.email || 'Operador',
      updatedBy: authUser?.name || authUser?.email || 'Operador',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const created = await executeAction(async () => {
      const requestPayload = {
        id: nextBoard.id,
        label: nextBoard.label,
        description: nextBoard.description,
        contactsFilter: nextBoard.contactsFilter,
        contactsAudienceFilter: nextBoard.contactsAudienceFilter,
        contactsChannelFilter: nextBoard.contactsChannelFilter,
        createdBy: nextBoard.createdBy,
        updatedBy: nextBoard.updatedBy,
      };

      const response = await fetch(`${apiUrl}/whatsapp/contacts/boards`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestPayload),
      });

      if (!response.ok) {
        throw new Error('Nao foi possivel criar o board do CRM.');
      }

      await loadContactBoards();
    }, { successMessage: 'Board criado' });

    if (created) {
      setCustomContactsBoards((current) => {
        if (current.some((board) => board.id === nextBoard.id)) {
          return current;
        }
        return [nextBoard, ...current];
      });
      setNewBoardForm({ label: '', description: '' });
      setShowCreateBoardModal(false);
      activateContactsBoard(nextBoard.id);
    }
  }, [
    activateContactsBoard,
    authUser?.email,
    authUser?.name,
    contactsAudienceFilter,
    contactsChannelFilter,
    contactsFilter,
    executeAction,
    loadContactBoards,
    newBoardForm.description,
    newBoardForm.label,
    pushToast,
  ]);

  const removeContactsBoard = useCallback(
    async (boardId: ContactsBoardId) => {
      const removedBoards = customContactsBoards.filter((board) => board.id !== boardId);
      if (activeContactsBoard === boardId) {
        setActiveContactsBoard('contacts');
      }

      const removed = await executeAction(async () => {
        const response = await fetch(`${apiUrl}/whatsapp/contacts/boards/${encodeURIComponent(boardId)}`, {
          method: 'DELETE',
        });

        if (!response.ok) {
          throw new Error('Nao foi possivel remover o board do CRM.');
        }

        setCustomContactsBoards(removedBoards);
      }, { successMessage: 'Board removido' });

      if (!removed && activeContactsBoard === boardId) {
        setActiveContactsBoard(boardId);
      }
    },
    [activeContactsBoard, customContactsBoards, executeAction],
  );

  const createManualContact = useCallback(async () => {
    const name = newContactForm.name.trim();
    const phone = newContactForm.phone.trim();
    const sessionId = selectedSession?.id ?? overview.sessions[0]?.id ?? 'default';

    if (!name || !phone) {
      pushToast({
        tone: 'error',
        title: 'Dados incompletos',
        description: 'Preencha nome e telefone para adicionar o contato.',
      });
      return;
    }

    const created = await executeAction(async () => {
      const response = await fetch(`${apiUrl}/whatsapp/contacts/manual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          name,
          phone,
          stage: createContactStage,
          updatedBy: authUser?.name || authUser?.email || 'Operador',
        }),
      });

      if (!response.ok) {
        throw new Error('Nao foi possivel criar o contato no CRM.');
      }

      await loadOverview();
      await loadContactKanbanStages();
    }, { successMessage: 'Contato criado' });

    if (created) {
      setNewContactForm({ name: '', phone: '' });
      setShowCreateContactModal(false);
    }
  }, [
    authUser?.email,
    authUser?.name,
    createContactStage,
    executeAction,
    loadContactKanbanStages,
    loadOverview,
    newContactForm.name,
    newContactForm.phone,
    overview.sessions,
    pushToast,
    selectedSession?.id,
  ]);

  const saveContactCRMProfile = useCallback(
    async (
      contact: ConversationRecord,
      patch: Partial<Pick<ContactCRMProfileRecord, 'assignee' | 'priority' | 'notes' | 'tags'>>,
    ) => {
      const key = buildContactKanbanKey(contact);
      const previousProfile = contactCrmProfileMap[key];
      const nextProfile: ContactCRMProfileRecord = {
        sessionId: contact.sessionId,
        conversationId: contact.id,
        assignee: patch.assignee ?? previousProfile?.assignee ?? '',
        priority: patch.priority ?? previousProfile?.priority ?? '',
        notes: patch.notes ?? previousProfile?.notes ?? '',
        tags: patch.tags ?? previousProfile?.tags ?? [],
        updatedBy: authUser?.name || authUser?.email || 'Operador',
        updatedAt: new Date().toISOString(),
      };

      setContactCrmProfileMap((current) => ({
        ...current,
        [key]: nextProfile,
      }));

      const saved = await executeAction(async () => {
        const requestPayload = {
          sessionId: nextProfile.sessionId,
          conversationId: nextProfile.conversationId,
          assignee: nextProfile.assignee,
          priority: nextProfile.priority,
          notes: nextProfile.notes,
          tags: nextProfile.tags,
          updatedBy: nextProfile.updatedBy,
        };

        const response = await fetch(`${apiUrl}/whatsapp/contacts/crm`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestPayload),
        });

        if (!response.ok) {
          throw new Error('Nao foi possivel salvar os dados do CRM.');
        }
      }, { successMessage: 'CRM atualizado' });

      if (!saved) {
        setContactCrmProfileMap((current) => {
          const nextMap = { ...current };
          if (previousProfile) {
            nextMap[key] = previousProfile;
          } else {
            delete nextMap[key];
          }
          return nextMap;
        });
      }
    },
    [authUser?.email, authUser?.name, contactCrmProfileMap, executeAction],
  );

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
      navigateToView('settings');
    }, { successMessage: 'Session created' });
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
    }, { successMessage: 'Connection started' });
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
    }, { successMessage: 'Session disconnected' });
  };

  const sendMessage = useCallback((text: string) => {
    if (!selectedSession || !selectedConversation || !text.trim()) {
      return Promise.resolve(false);
    }

    const payload = text.trim();
    return executeAction(async () => {
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
  }, [executeAction, loadMessages, loadOverview, selectedConversation, selectedSession]);

  const sendMedia = useCallback(
    (file: File, options?: { sticker?: boolean; caption?: string }) => {
      if (!selectedSession || !selectedConversation) {
        return Promise.resolve(false);
      }

      const formData = new FormData();
      formData.append('file', file);
      formData.append('caption', options?.sticker ? '' : options?.caption ?? '');
      if (options?.sticker) {
        formData.append('sticker', 'true');
        formData.append('kind', 'sticker');
      }

      return executeAction(async () => {
        const response = await fetch(
          `${apiUrl}/whatsapp/sessions/${selectedSession.id}/conversations/${selectedConversation.id}/media`,
          {
            method: 'POST',
            body: formData,
          },
        );

        if (!response.ok) {
          throw new Error('Nao foi possivel enviar a midia.');
        }

        await loadMessages(selectedSession.id, selectedConversation.id);
        await loadOverview();
      });
    },
    [executeAction, loadMessages, loadOverview, selectedConversation, selectedSession],
  );

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
    <section className="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-6">
      <div className="mx-auto max-w-none space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <h1 className="font-headline text-3xl font-extrabold tracking-tight text-white md:text-4xl">
              Command Central
            </h1>
            <p className="mt-2 flex items-center gap-3 text-sm text-[var(--muted)] md:text-base">
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
          <div className="group col-span-12 overflow-hidden rounded-[1.5rem] border border-white/5 bg-[var(--surface-low)] p-6 lg:col-span-5">
            <div className="relative">
              <div className="absolute -right-24 -top-24 h-64 w-64 rounded-full bg-[var(--primary)]/10 blur-[80px]" />
              <div className="relative z-10">
                <div className="mb-12 flex items-start justify-between">
                  <div>
                    <h3 className="text-sm font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
                      Queue Health
                    </h3>
                    <p className="mt-2 font-headline text-5xl font-extrabold text-white md:text-6xl">
                      {overview.metrics.waitingConversations.toLocaleString('pt-BR')}
                    </p>
                    <p className="mt-2 text-xl font-semibold text-[var(--primary)] md:text-2xl">
                      +12% from last hour
                    </p>
                  </div>
                  <LayoutGrid className="h-9 w-9 text-zinc-700" strokeWidth={1.8} />
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

          <div className="col-span-12 overflow-hidden rounded-[1.5rem] border border-white/5 bg-[var(--surface-low)] p-6 lg:col-span-7">
            <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
              <div>
                <h3 className="text-sm font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
                  Average Response Velocity
                </h3>
                <div className="mt-2 flex items-baseline gap-4">
                  <p className="font-headline text-4xl font-extrabold text-white md:text-5xl">1m 42s</p>
                  <p className="text-xl font-bold text-[var(--secondary)] md:text-2xl">↓ 15s improved</p>
                </div>
              </div>
              <div className="flex gap-2">
                <span className="rounded-full bg-[var(--surface-highest)] px-3 py-1.5 text-[11px] font-bold text-zinc-400">
                  Live View
                </span>
                <span className="rounded-full bg-[var(--primary)]/10 px-3 py-1.5 text-[11px] font-bold text-[var(--primary)]">
                  Target: &lt;2m
                </span>
              </div>
            </div>

            <DashboardResponseChart />
          </div>

          <div className="col-span-12 space-y-4 lg:col-span-8">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-headline text-2xl font-bold text-white">Live Stream</h3>
              <button
                className="text-sm font-bold text-[var(--primary)] transition hover:underline"
                onClick={() => navigateToView('conversations')}
                type="button"
              >
                View All Messages
              </button>
            </div>

            <div className="space-y-3">
              {shouldShowInitialSkeleton ? (
                <ListSkeleton rows={3} />
              ) : dashboardConversations.length > 0 ? (
                dashboardConversations.map((conversation, index) => (
                  <DashboardLiveStreamCard
                    key={conversation.id}
                    conversation={conversation}
                    dimmed={index > 0}
                    onOpen={() => {
                      setSelectedSessionId(conversation.sessionId);
                      setSelectedConversationId(conversation.id);
                      navigateToView('conversations');
                    }}
                  />
                ))
              ) : (
                <EmptyStateCard
                  actionLabel="Abrir configuracoes"
                  description="Conecte uma sessao do WhatsApp e troque mensagens reais para alimentar o feed operacional ao vivo."
                  onAction={() => navigateToView('settings')}
                  title="Ainda nao ha atividade recente"
                />
              )}
            </div>
          </div>

          <div className="col-span-12 self-start rounded-[1.5rem] border border-white/5 bg-[var(--surface-low)] p-5 lg:col-span-4">
            <h3 className="mb-6 text-sm font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
              Top Performers
            </h3>
            <div className="space-y-6">
              {shouldShowInitialSkeleton ? (
                <StackSkeleton rows={3} />
              ) : dashboardLeaderboard.length > 0 ? (
                dashboardLeaderboard.map((agent) => (
                  <DashboardPerformerItem key={agent.id} performer={agent} />
                ))
              ) : (
                <EmptyStateCard
                  description="Assim que houver conversas suficientes, os melhores resultados da operacao aparecem aqui automaticamente."
                  title="Leaderboard aguardando dados"
                />
              )}
            </div>
            <button
              className="mt-8 w-full rounded-[1.2rem] border border-white/5 bg-[var(--surface-highest)] py-4 text-xs font-bold uppercase tracking-[0.24em] text-white transition hover:bg-white/5"
              onClick={() => navigateToView('analytics')}
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
    <section className="min-h-0 flex-1 overflow-hidden px-4 py-5 md:px-6">
      <div className="grid h-full min-h-0 gap-5 xl:grid-cols-[14.5rem_minmax(0,1fr)_21rem]">
        <aside className="min-h-0 rounded-[30px] border border-white/6 bg-[linear-gradient(180deg,rgba(18,18,20,0.98),rgba(14,14,16,0.98))] p-4 shadow-[0_18px_40px_-28px_rgba(0,0,0,0.9)]">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-zinc-500">
                Boards
              </p>
              <h2 className="mt-2 font-headline text-2xl font-bold text-white">Contacts</h2>
            </div>
            <button
              className="grid h-10 w-10 place-items-center rounded-full bg-[var(--primary)] text-black shadow-[0_0_20px_rgba(127,175,255,0.24)]"
              onClick={() => setShowCreateBoardModal(true)}
              type="button"
            >
              <Plus className="h-4 w-4" strokeWidth={2.6} />
            </button>
          </div>

          <div className="mt-5 space-y-2">
            {contactsBoardOptions.map((board) => (
              <div
                key={board.id}
                className={`w-full rounded-[20px] border px-3 py-3 transition ${
                  activeContactsBoard === board.id
                    ? 'border-white/10 bg-white/[0.07] shadow-[0_0_0_1px_rgba(255,255,255,0.04)]'
                    : 'border-transparent bg-transparent hover:border-white/6 hover:bg-white/[0.03]'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <button
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    onClick={() => activateContactsBoard(board.id)}
                    type="button"
                  >
                    <div className={`grid h-9 w-9 place-items-center rounded-2xl ${activeContactsBoard === board.id ? 'bg-[var(--primary)]/18 text-[var(--primary)]' : 'bg-white/5 text-zinc-400'}`}>
                      <board.icon className="h-4 w-4" strokeWidth={2.1} />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-white">{board.label}</p>
                      <p className="mt-0.5 truncate text-[11px] text-zinc-500">{board.description}</p>
                    </div>
                  </button>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${activeContactsBoard === board.id ? 'bg-[var(--primary)]/14 text-[var(--primary)]' : 'bg-white/5 text-zinc-400'}`}>
                      {board.count}
                    </span>
                    {board.isCustom ? (
                      <button
                        aria-label={`Remover board ${board.label}`}
                        className="grid h-7 w-7 place-items-center rounded-full bg-white/5 text-zinc-500 transition hover:bg-white/10 hover:text-white"
                        onClick={() => {
                          void removeContactsBoard(board.id);
                        }}
                        type="button"
                      >
                        <X className="h-3.5 w-3.5" strokeWidth={2.1} />
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-5 rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-500">
              Workflow
            </p>
            <p className="mt-3 text-sm leading-6 text-zinc-400">
              Arraste cada contato entre colunas para organizar sua operacao comercial sem sair da tela.
            </p>
          </div>
        </aside>

        <div className="flex min-h-0 flex-col overflow-hidden rounded-[30px] border border-white/6 bg-[linear-gradient(180deg,rgba(18,18,20,0.98),rgba(12,12,14,0.98))] shadow-[0_18px_40px_-28px_rgba(0,0,0,0.9)]">
          <div className="border-b border-white/6 px-4 py-4 md:px-5">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-zinc-500">
                  CRM Kanban
                </p>
                <h3 className="mt-2 font-headline text-3xl font-bold text-white">Pipeline de contatos</h3>
                <p className="mt-2 text-sm text-zinc-400">
                  Base filtrada em tempo real com arraste entre etapas e acesso rapido para conversas.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  className="inline-flex items-center gap-2 rounded-full border border-white/8 bg-white/[0.04] px-4 py-2 text-sm font-medium text-zinc-300 transition hover:bg-white/[0.08] hover:text-white"
                  onClick={() => {
                    setCreateContactStage('new');
                    setShowCreateContactModal(true);
                  }}
                  type="button"
                >
                  <Plus className="h-4 w-4" strokeWidth={2.1} />
                  Novo contato
                </button>
                <button
                  className="inline-flex items-center gap-2 rounded-full border border-white/8 bg-white/[0.04] px-4 py-2 text-sm font-medium text-zinc-300 transition hover:bg-white/[0.08] hover:text-white"
                  onClick={() => setContactsAudienceFilter((current) => (current === 'verified' ? 'all' : 'verified'))}
                  type="button"
                >
                  <BadgeCheck className="h-4 w-4" strokeWidth={2.1} />
                  {contactsAudienceFilter === 'verified' ? 'So verificados' : 'Todos os perfis'}
                </button>
                <button
                  className="inline-flex items-center gap-2 rounded-full bg-[linear-gradient(135deg,#7fafff,#64a1ff)] px-4 py-2 text-sm font-semibold text-black shadow-[0_0_18px_rgba(127,175,255,0.26)] transition hover:scale-[1.01]"
                  onClick={() => runAction(loadOverview)}
                  type="button"
                >
                  <RefreshCw className="h-4 w-4" strokeWidth={2.1} />
                  Deep sync
                </button>
              </div>
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1.45fr)_auto_auto]">
              <div className="rounded-[24px] border border-white/8 bg-white/[0.03] px-4 py-3">
                <div className="flex items-center gap-3 text-sm text-zinc-400">
                  <Search className="h-4 w-4" strokeWidth={2.2} />
                  <input
                    className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-zinc-500"
                    onChange={(event) => setContactsSearch(event.target.value)}
                    placeholder="Buscar por nome, telefone, canal ou responsavel..."
                    value={contactsSearch}
                  />
                </div>
              </div>

              <div className="inline-flex items-center rounded-[24px] border border-white/8 bg-white/[0.03] p-1">
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
                        active ? 'bg-white/10 text-white' : 'hover:bg-white/5'
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

              <button
                className="inline-flex items-center justify-center gap-2 rounded-[24px] border border-white/8 bg-white/[0.03] px-4 py-3 text-sm font-medium text-zinc-300 transition hover:bg-white/[0.06] hover:text-white"
                onClick={() => setShowAdvancedContactsFilters((current) => !current)}
                type="button"
              >
                <SlidersHorizontal className="h-4 w-4" strokeWidth={2.1} />
                Filtros
              </button>
            </div>

            {showAdvancedContactsFilters ? (
              <div className="mt-4 flex flex-wrap gap-2">
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
          </div>

          <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden px-4 pb-4 pt-4 md:px-5">
            {shouldShowContactsSkeleton ? (
              <div className="flex gap-4">
                {Array.from({ length: 4 }, (_, index) => (
                  <div key={index} className="w-[19rem] shrink-0 rounded-[28px] border border-white/6 bg-white/[0.025] p-4">
                    <StackSkeleton rows={4} />
                  </div>
                ))}
              </div>
            ) : filteredContacts.length === 0 ? (
              <EmptyStateCard
                actionLabel="Limpar filtros"
                description="Ajuste busca, canais ou boards para repovoar o pipeline e voltar a arrastar os contatos entre as etapas."
                onAction={resetContactsView}
                title="Nenhum contato disponivel no board"
              />
            ) : (
              <div className="flex h-full min-h-0 items-start gap-4 pb-2">
                {kanbanColumns.map((column) => (
                  <div
                    key={column.id}
                    className={`flex h-full min-h-0 w-[19rem] shrink-0 flex-col rounded-[28px] border border-white/6 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))] p-3 transition ${dragOverStage === column.id ? 'border-[var(--primary)]/35 shadow-[0_0_0_1px_rgba(127,175,255,0.12)]' : ''}`}
                    onDragOver={(event) => {
                      event.preventDefault();
                      setDragOverStage(column.id);
                    }}
                    onDragLeave={() => {
                      if (dragOverStage === column.id) {
                        setDragOverStage(null);
                      }
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      if (!draggedContactKey) {
                        return;
                      }

                      const droppedContact = filteredContacts.find(
                        (contact) => buildContactKanbanKey(contact) === draggedContactKey,
                      );

                      if (droppedContact) {
                        void moveContactToStage(droppedContact, column.id);
                      }

                      setDraggedContactKey(null);
                      setDragOverStage(null);
                    }}
                  >
                    <div className={`rounded-[22px] border border-white/6 bg-gradient-to-br ${column.surface} px-4 py-4`}>
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <span className={`h-2.5 w-2.5 rounded-full ${column.accent}`} />
                          <div>
                            <p className="text-sm font-semibold text-white">{column.label}</p>
                            <p className="mt-1 text-[11px] text-zinc-500">{column.contacts.length} contatos</p>
                          </div>
                        </div>
                        <span className="rounded-full bg-white/8 px-2.5 py-1 text-[10px] font-semibold text-zinc-300">
                          {column.contacts.length}
                        </span>
                      </div>
                    </div>

                    <div className="mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
                      {column.contacts.map((contact) => (
                        <ContactKanbanCard
                          key={buildContactKanbanKey(contact)}
                          contact={contact}
                          crmProfile={contactCrmProfileMap[buildContactKanbanKey(contact)]}
                          onCopyId={() => void navigator.clipboard?.writeText(contact.participantId)}
                          onDragEnd={() => {
                            setDraggedContactKey(null);
                            setDragOverStage(null);
                          }}
                          onDragStart={() => setDraggedContactKey(buildContactKanbanKey(contact))}
                          onOpenConversation={() => {
                            setSelectedContactId(contact.id);
                            setSelectedSessionId(contact.sessionId);
                            setSelectedConversationId(contact.id);
                            navigateToView('conversations');
                          }}
                          onSelect={() => setSelectedContactId(contact.id)}
                          selected={selectedContact?.id === contact.id}
                        />
                      ))}

                      {column.contacts.length === 0 ? (
                        <div className="rounded-[22px] border border-dashed border-white/8 bg-white/[0.02] px-4 py-6 text-center text-sm text-zinc-500">
                          Solte um contato aqui.
                        </div>
                      ) : null}

                      <button
                        className="flex w-full items-center justify-center gap-2 rounded-[20px] border border-dashed border-white/8 bg-white/[0.02] px-4 py-3 text-sm text-zinc-400 transition hover:border-white/12 hover:bg-white/[0.05] hover:text-white"
                        onClick={() => {
                          setCreateContactStage(column.id);
                          setShowCreateContactModal(true);
                        }}
                        type="button"
                      >
                        <Plus className="h-4 w-4" strokeWidth={2.1} />
                        Adicionar contato
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <aside className="min-h-0 overflow-y-auto rounded-[30px] border border-white/6 bg-[linear-gradient(180deg,rgba(18,18,20,0.98),rgba(12,12,14,0.98))] p-4 shadow-[0_18px_40px_-28px_rgba(0,0,0,0.9)]">
          {selectedContact ? (
            <ContactKanbanDetailPanel
              key={`${buildContactKanbanKey(selectedContact)}:${contactCrmProfileMap[buildContactKanbanKey(selectedContact)]?.updatedAt ?? 'base'}`}
              contact={selectedContact}
              crmProfile={contactCrmProfileMap[buildContactKanbanKey(selectedContact)]}
              onCopyId={() => void navigator.clipboard?.writeText(selectedContact.participantId)}
              onMoveStage={moveContactToStage}
              onSaveProfile={saveContactCRMProfile}
              onOpenConversation={() => {
                setSelectedSessionId(selectedContact.sessionId);
                setSelectedConversationId(selectedContact.id);
                navigateToView('conversations');
              }}
              stage={resolveContactKanbanStage(selectedContact, contactKanbanStageMap)}
            />
          ) : (
            <EmptyStateCard
              description="Selecione um card no board para ver contexto, mover de etapa e abrir a conversa rapidamente."
              title="Nenhum contato selecionado"
            />
          )}
        </aside>
      </div>
    </section>
  );

  const renderAnalyticsView = () => (
    <section className="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-6">
      <div className="mx-auto max-w-none space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
              Operational signal
            </p>
            <h2 className="font-headline mt-2 text-3xl font-extrabold tracking-tight text-white md:text-4xl">
              Service Intelligence
            </h2>
            <p className="mt-2 text-sm text-[var(--muted)] md:text-base">
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

        {shouldShowInitialSkeleton ? (
          <AnalyticsLoadingState />
        ) : analyticsModel && overview.conversations.length === 0 ? (
          <EmptyStateCard
            actionLabel="Abrir conversas"
            description="Quando a operacao receber conversas reais, esta area passa a exibir volume, CSAT e horarios de pico automaticamente."
            onAction={() => navigateToView('conversations')}
            title="Analytics aguardando sinal operacional"
          />
        ) : analyticsModel ? (
          <div className="grid grid-cols-12 gap-6">
            <div className="col-span-12 overflow-hidden rounded-[1.25rem] bg-[var(--surface-low)] p-5 lg:col-span-4">
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
                    <span className="font-headline text-4xl font-black text-white md:text-5xl">
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

            <div className="col-span-12 rounded-[1.25rem] bg-[var(--surface-low)] p-5 lg:col-span-8">
              <div className="mb-10 flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h3 className="text-sm font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
                    Conversations per Channel
                  </h3>
                  <p className="mt-1 font-headline text-3xl font-bold text-white md:text-4xl">
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

            <div className="col-span-12 rounded-[1.25rem] bg-[var(--surface-low)] p-5">
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

            <div className="col-span-12 overflow-hidden rounded-[1.25rem] bg-[var(--surface-low)]">
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
    <section className="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-6">
      <div className="mx-auto max-w-none space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
              WhatsApp configuration
            </p>
            <h2 className="font-headline mt-2 text-2xl font-semibold text-white">
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

        <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
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
                {shouldShowInitialSkeleton ? (
                  <StackSkeleton rows={3} />
                ) : overview.sessions.length > 0 ? (
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
                  <EmptyStateCard
                    description="Preencha os dados acima para provisionar o primeiro numero operacional deste workspace."
                    title="Nenhuma sessao criada ainda"
                  />
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
                      <EmptyStateCard
                        actionLabel="Gerar QR / conectar"
                        description="Gere um novo QR para autenticar esta sessao. Se ja houver login persistido, a conexao pode voltar sem novo codigo."
                        onAction={() => connectSession(selectedSession.id)}
                        title="QR aguardando conexao"
                      />
                    )}
                  </div>
                </div>
              </>
            ) : (
              <EmptyStateCard
                description="Escolha uma sessao existente ou crie uma nova para abrir os controles, gerar QR e acompanhar a autenticacao."
                title="Selecione uma sessao para continuar"
              />
            )}
          </div>
        </div>
      </div>
    </section>
  );

  const renderConversationsView = () => (
    <div className="grid min-h-0 flex-1 overflow-hidden grid-cols-1 xl:grid-cols-[19rem_minmax(0,1fr)] 2xl:grid-cols-[19rem_minmax(0,1fr)_17rem]">
      <section className="min-h-0 overflow-hidden border-r border-white/5 bg-[var(--surface-low)]/35 px-3 py-4">
        <div className="mb-4 flex items-center justify-between px-1">
          <div>
            <h2 className="font-headline text-xl font-bold text-white">Conversations</h2>
            <p className="mt-1 text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">
              {queueLabel}
            </p>
          </div>
          <button
            className="rounded-full bg-white/5 px-3 py-1.5 text-[11px] text-[var(--muted)] hover:text-white"
            onClick={() => runAction(loadOverview)}
            type="button"
          >
            Refresh
          </button>
        </div>

        <div className="mb-4 rounded-[24px] border border-white/6 bg-white/[0.03] p-3">
          <div className="flex items-center justify-between gap-3 px-1">
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
              Queue Filters
            </span>
            {conversationSearchTerm ? (
              <span className="rounded-full bg-[var(--primary)]/10 px-2.5 py-1 text-[10px] font-semibold text-[var(--primary)]">
                {visibleSessionConversations.length} result{visibleSessionConversations.length === 1 ? '' : 's'}
              </span>
            ) : null}
          </div>

          <div className="mt-3 flex flex-wrap gap-2 px-1">
            {overview.channels.length > 0 ? (
              overview.channels.map((channel) => <ChannelPill key={channel.id} channel={channel} />)
            ) : (
              <span className="text-xs text-[var(--muted)]">Nenhum canal sincronizado ainda.</span>
            )}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            {conversationFilterOptions.map((option) => {
              const active = conversationFilter === option.id;

              return (
                <button
                  key={option.id}
                  className={`flex items-center justify-between rounded-2xl border px-3 py-2.5 text-left transition-all ${
                    active
                      ? 'border-[var(--primary)]/35 bg-[var(--primary)]/12 shadow-[0_0_0_1px_rgba(127,175,255,0.08)]'
                      : 'border-white/8 bg-white/4 hover:border-white/12 hover:bg-white/6'
                  }`}
                  onClick={() => setConversationFilter(option.id)}
                  type="button"
                >
                  <span className={`text-[12px] font-medium ${active ? 'text-white' : 'text-zinc-300'}`}>
                    {option.label}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      active ? 'bg-[var(--primary)]/14 text-[var(--primary)]' : 'bg-white/6 text-zinc-400'
                    }`}
                  >
                    {option.count}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[11px] text-zinc-500">
            <span>Search `Ctrl/Cmd+K`</span>
            <span>Switch `Alt+Up/Down`</span>
          </div>
        </div>

        <div className="h-[calc(100vh-11.5rem)] space-y-1.5 overflow-y-auto pr-1">
          {shouldShowInitialSkeleton ? <ListSkeleton rows={6} /> : null}
          {!shouldShowInitialSkeleton ? visibleSessionConversations.map((conversation) => {
            const active = (pendingConversationId ?? selectedConversation?.id) === conversation.id;

            return (
              <button
                key={conversation.id}
                className={`w-full rounded-[18px] p-2.5 text-left transition-all ${
                  active
                    ? 'bg-[var(--surface-highest)] shadow-[0_0_0_1px_rgba(255,255,255,0.05)]'
                    : 'hover:bg-white/5'
                }`}
                onFocus={() => {
                  if (selectedSession) {
                    void prefetchConversation(selectedSession.id, conversation.id);
                  }
                }}
                onMouseEnter={() => {
                  if (selectedSession) {
                    void prefetchConversation(selectedSession.id, conversation.id);
                  }
                }}
                onClick={() => openConversation(conversation.id)}
                type="button"
              >
                <div className="flex gap-3">
                  <AvatarBadge label={conversation.contact} src={conversation.avatarUrl} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="truncate text-sm font-semibold text-white">
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
                    <p
                      className={`mt-1 truncate text-[13px] ${
                        conversation.unread > 0
                          ? 'font-semibold text-white'
                          : 'text-[var(--primary)]'
                      }`}
                    >
                      {conversation.preview || 'No preview yet'}
                    </p>
                     <div className="mt-2 flex flex-wrap gap-1.5">
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
          }) : null}

          {selectedSession && !shouldShowInitialSkeleton && visibleSessionConversations.length === 0 ? (
            <EmptyStateCard
              actionLabel={conversationSearchTerm || conversationFilter !== 'all' ? 'Limpar busca e filtros' : 'Atualizar fila'}
              description={conversationSearchTerm
                ? 'Nenhuma conversa combina com a busca atual. Limpe o termo ou ajuste os filtros para continuar navegando.'
                : 'A sessao atual ainda nao trouxe conversas para esta fila. Atualize a sincronizacao ou aguarde novas mensagens.'}
              onAction={conversationSearchTerm || conversationFilter !== 'all'
                ? resetConversationView
                : () => runAction(loadOverview)}
              title="Nenhuma conversa disponivel"
            />
          ) : null}
        </div>
      </section>

      <section className="flex min-h-0 flex-col overflow-hidden bg-[var(--surface)]">
        {selectedSession ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/5 bg-black/10 px-4 py-3 backdrop-blur-md">
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
                  <p className="font-headline text-xl font-semibold text-white md:text-2xl">
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

            </div>

            <div
              ref={messagesRef}
              className="min-h-0 flex-1 overflow-y-auto px-3 py-4 md:px-4"
              onScroll={handleMessagesScroll}
            >
              {isConversationSwitching ? (
                <ConversationLoadingState contact={selectedConversation?.contact} />
              ) : (
                <div className="mx-auto flex max-w-none flex-col gap-4">
                  {isLoadingMessages && messages.length === 0 ? (
                    <ConversationTimelineSkeleton />
                  ) : null}

                  {messages.map((message, index) => (
                    <Fragment key={message.id}>
                      {index === unreadSeparatorIndex ? (
                        <NewMessagesDivider unreadCount={openedUnreadMarker?.unreadCount ?? 0} />
                      ) : null}
                      <MessageBubble
                        avatarUrl={selectedConversation?.avatarUrl}
                        conversation={selectedConversation}
                        isUnread={
                          unreadSeparatorIndex !== -1 &&
                          index >= unreadSeparatorIndex &&
                          message.direction === 'incoming'
                        }
                        message={message}
                      />
                    </Fragment>
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

                  {messages.length === 0 && !isLoadingMessages ? (
                    <EmptyStateCard
                      description="Quando esta conversa tiver historico sincronizado, a timeline completa aparece aqui com mensagens e midias."
                      title="Timeline aguardando mensagens"
                    />
                  ) : null}
                </div>
              )}
            </div>

            <div className="border-t border-white/5 bg-[var(--surface-low)]/45 px-3 py-3 backdrop-blur-xl md:px-4">
              <ConversationComposer
                key={`${selectedSession.id}:${selectedConversation?.id ?? 'none'}`}
                disabled={!selectedConversation || isPending}
                onSendMedia={sendMedia}
                onSend={sendMessage}
                quickReplies={quickReplies}
              />
            </div>
          </>
        ) : (
          <div className="grid flex-1 place-items-center p-6">
            <div className="space-y-4 text-center">
              <EmptyStateCard
                actionLabel="Abrir configuracoes"
                description="Crie ou restaure uma sessao do WhatsApp para liberar a lista de conversas e a timeline operacional."
                onAction={() => navigateToView('settings')}
                title="Nenhuma sessao ativa para conversar"
              />
            </div>
          </div>
        )}
      </section>

      <aside className="hidden min-h-0 overflow-y-auto bg-[var(--surface-low)]/20 px-4 py-4 2xl:block">
        {selectedConversation && selectedSession ? (
          <div className="space-y-5">
            <div className="flex flex-col items-center text-center">
              <div className="relative">
                <AvatarBadge
                  className="h-20 w-20 rounded-[22px] text-2xl"
                  label={selectedConversation.contact}
                  src={selectedConversation.avatarUrl}
                />
                <div className="absolute -bottom-1 -right-1 grid h-9 w-9 place-items-center rounded-full bg-[var(--secondary)] text-black shadow-[0_0_18px_rgba(93,253,138,0.5)]">
                  <MessageCircle className="h-4 w-4" strokeWidth={2.4} />
                </div>
              </div>

              <h3 className="mt-4 font-headline text-2xl font-bold tracking-tight text-white">
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
                    navigateToView('settings');
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

          </div>
        ) : (
          <EmptyStateCard
            description="Abra uma conversa para revelar os dados do contato, tags e atalhos de sessao nesta coluna lateral."
            title="Selecione uma conversa para ver o perfil"
          />
        )}
      </aside>
    </div>
  );

  return (
    <main className="h-screen overflow-hidden bg-[var(--background)] text-[var(--foreground)]">
      <div className="pointer-events-none fixed right-4 top-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2">
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} onDismiss={dismissToast} />
        ))}
      </div>
      {showCreateBoardModal ? (
        <KanbanModal
          description="Salve os filtros atuais como um novo board para acessar esse recorte do CRM com um clique."
          onClose={() => setShowCreateBoardModal(false)}
          title="Criar board"
        >
          <div className="space-y-3">
            <input
              className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-500"
              onChange={(event) => setNewBoardForm((current) => ({ ...current, label: event.target.value }))}
              placeholder="Nome do board"
              value={newBoardForm.label}
            />
            <input
              className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-500"
              onChange={(event) => setNewBoardForm((current) => ({ ...current, description: event.target.value }))}
              placeholder="Descricao curta"
              value={newBoardForm.description}
            />
            <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 text-xs leading-6 text-zinc-400">
              O board sera criado com os filtros atuais: fila <strong className="text-white">{contactsFilter}</strong>, audiencia <strong className="text-white">{contactsAudienceFilter}</strong> e canal <strong className="text-white">{contactsChannelFilter}</strong>.
            </div>
            <div className="flex justify-end gap-2">
              <button
                className="rounded-full bg-white/6 px-4 py-2 text-sm font-medium text-zinc-300 transition hover:bg-white/10 hover:text-white"
                onClick={() => setShowCreateBoardModal(false)}
                type="button"
              >
                Cancelar
              </button>
              <button
                className="rounded-full bg-[linear-gradient(135deg,#7fafff,#64a1ff)] px-4 py-2 text-sm font-semibold text-black"
                onClick={() => {
                  void createContactsBoard();
                }}
                type="button"
              >
                Criar board
              </button>
            </div>
          </div>
        </KanbanModal>
      ) : null}
      {showCreateContactModal ? (
        <KanbanModal
          description="Adicione um contato manualmente ao pipeline para iniciar prospeccao, follow-up ou atendimento." 
          onClose={() => setShowCreateContactModal(false)}
          title="Adicionar contato"
        >
          <div className="space-y-3">
            <input
              className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-500"
              onChange={(event) => setNewContactForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="Nome do contato"
              value={newContactForm.name}
            />
            <input
              className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-500"
              onChange={(event) => setNewContactForm((current) => ({ ...current, phone: event.target.value }))}
              placeholder="Telefone com DDD ou JID"
              value={newContactForm.phone}
            />
            <div className="grid grid-cols-2 gap-2">
              {contactsKanbanStages.map((stage) => (
                <button
                  key={stage.id}
                  className={`rounded-2xl border px-3 py-3 text-left text-sm transition ${createContactStage === stage.id ? 'border-[var(--primary)]/30 bg-[var(--primary)]/10 text-white' : 'border-white/8 bg-white/[0.03] text-zinc-400 hover:bg-white/[0.05]'}`}
                  onClick={() => setCreateContactStage(stage.id)}
                  type="button"
                >
                  {stage.label}
                </button>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button
                className="rounded-full bg-white/6 px-4 py-2 text-sm font-medium text-zinc-300 transition hover:bg-white/10 hover:text-white"
                onClick={() => setShowCreateContactModal(false)}
                type="button"
              >
                Cancelar
              </button>
              <button
                className="rounded-full bg-[linear-gradient(135deg,#7fafff,#64a1ff)] px-4 py-2 text-sm font-semibold text-black"
                onClick={() => void createManualContact()}
                type="button"
              >
                Adicionar contato
              </button>
            </div>
          </div>
        </KanbanModal>
      ) : null}
      <div className="flex h-full overflow-hidden">
        <aside className="hidden h-full w-[4.5rem] flex-col overflow-hidden border-r border-white/5 bg-zinc-950/80 px-2 py-4 backdrop-blur-xl md:flex">
          <div className="mb-6 flex justify-center">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--primary-container)] text-[var(--on-primary-container)]">
                <Sparkles className="h-4 w-4" strokeWidth={2.4} />
              </div>
          </div>

          <nav className="flex-1 space-y-1">
            {navigationItems.map(({ id, label, icon: Icon }, index) => (
              <button
                key={id}
                aria-label={label}
                className={`relative flex w-full items-center justify-center rounded-xl px-3 py-3 text-left transition-all ${
                  currentView === id
                    ? 'bg-blue-600/10 text-blue-400 shadow-[0_0_15px_rgba(59,130,246,0.22)]'
                    : 'text-zinc-500 hover:bg-zinc-800/50 hover:text-zinc-300'
                }`}
                onClick={() => navigateToView(id)}
                title={`${label} (Alt+${index + 1})`}
                type="button"
              >
                {currentView === id ? (
                  <span className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-[var(--primary)]" />
                ) : null}
                <Icon className="h-5 w-5" strokeWidth={currentView === id ? 2.4 : 2.1} />
              </button>
            ))}
          </nav>

          <div className="mt-auto space-y-1 border-t border-white/5 pt-6">
            <button
              aria-label="New Message"
              className="mb-4 flex w-full items-center justify-center rounded-xl bg-[var(--primary-container)] px-3 py-3 text-[var(--on-primary-container)] transition-transform active:scale-95"
              onClick={() => navigateToView(selectedSession ? 'conversations' : 'settings')}
              title="New Message"
              type="button"
            >
              <MessageSquarePlus className="h-4 w-4" strokeWidth={2.2} />
            </button>
            <button
              aria-label="Support"
              className="flex w-full items-center justify-center rounded-xl px-3 py-3 text-zinc-500 transition-all hover:bg-zinc-800/50 hover:text-zinc-300"
              onClick={() => navigateToView('settings')}
              title="Support"
              type="button"
            >
              <CircleHelp className="h-5 w-5" strokeWidth={2.1} />
            </button>
            <button
              aria-label="Sign Out"
              className="flex w-full items-center justify-center rounded-xl px-3 py-3 text-[var(--error-dim)] transition-all hover:bg-white/5"
              onClick={signOut}
              title="Sign Out"
              type="button"
            >
              <LogOut className="h-5 w-5" strokeWidth={2.1} />
            </button>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <header className="sticky top-0 z-20 flex items-center justify-between border-b border-white/8 bg-zinc-950/60 px-4 py-2.5 backdrop-blur-2xl shadow-[0_8px_24px_0_rgba(0,0,0,0.55)] md:px-5">
            <div className="flex items-center gap-5">
              <span className="font-headline text-xl font-bold tracking-tight text-transparent bg-gradient-to-br from-blue-400 to-blue-600 bg-clip-text">
                EtherCommand
              </span>
              <div className="hidden items-center gap-3 rounded-full border border-white/5 bg-white/5 px-4 py-1.5 transition-all duration-300 focus-within:border-[var(--primary)]/50 lg:flex">
                <Search className="h-4 w-4 text-zinc-400" strokeWidth={2.1} />
                <input
                  ref={globalSearchInputRef}
                  className="w-80 border-none bg-transparent text-sm text-white outline-none placeholder:text-zinc-500"
                  onChange={(event) => setGlobalSearch(event.target.value)}
                  placeholder="Search interactions..."
                  value={globalSearch}
                />
                <span className="rounded-full border border-white/8 bg-black/20 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-400">
                  Ctrl/Cmd+K
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              <button className="rounded-full p-2 text-zinc-400 transition-all duration-300 hover:bg-white/5 active:scale-95">
                <Bell className="h-5 w-5" strokeWidth={2.1} />
              </button>
              <button className="rounded-full p-2 text-zinc-400 transition-all duration-300 hover:bg-white/5 active:scale-95">
                <Grid3X3 className="h-5 w-5" strokeWidth={2.1} />
              </button>
              <div className="mx-1 h-7 w-px bg-white/10" />
              <button
                className="flex items-center gap-2 rounded-full bg-[var(--primary-container)] px-3 py-1.5 text-sm font-semibold text-[var(--on-primary-container)] transition-all duration-200 hover:brightness-110 active:scale-95"
                onClick={() => navigateToView(selectedSession ? 'conversations' : 'settings')}
                type="button"
              >
                <Plus className="h-4 w-4" strokeWidth={2.2} />
                <span className="text-sm">Broadcast</span>
              </button>
              <div className="flex items-center gap-3">
                <div className="grid h-8 w-8 place-items-center overflow-hidden rounded-full border border-white/20 bg-[var(--surface-high)] text-[11px] font-bold text-white">
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

          {errorMessage ? (
            <div className="px-4 pt-4 md:px-6">
              <WorkspaceStatusBanner
                description={errorMessage}
                title="Nao foi possivel concluir a ultima acao"
                tone="error"
              />
            </div>
          ) : isPending ? (
            <div className="px-4 pt-4 md:px-6">
              <WorkspaceStatusBanner
                description="Atualizando sessoes, conversas e indicadores sem interromper o fluxo da tela."
                title="Sincronizando workspace"
                tone="info"
              />
            </div>
          ) : null}

          {viewTransition ? (
            <WorkspaceLoadingScreen targetView={viewTransition} />
          ) : activeView === 'dashboard' ? (
            renderDashboardView()
          ) : activeView === 'contacts' ? (
            renderContactsView()
          ) : activeView === 'analytics' ? (
            renderAnalyticsView()
          ) : activeView === 'settings' ? (
            renderSettingsView()
          ) : (
            renderConversationsView()
          )}
        </div>
      </div>
    </main>
  );
}

function ChannelPill({ channel }: { channel: ChannelRecord }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-white/8 bg-white/[0.04] px-3 py-1.5 text-[11px] text-zinc-300">
      <span className="font-medium">{channel.name}</span>
      <span className="rounded-full bg-white/8 px-2 py-0.5 text-[10px] font-semibold text-zinc-400">
        {channel.connectedNumbers}
      </span>
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

function WorkspaceLoadingScreen({ targetView }: { targetView: WorkspaceView }) {
  const config: Record<
    WorkspaceView,
    { label: string; detail: string; icon: typeof Home }
  > = {
    dashboard: {
      label: 'Command Central',
      detail: 'Carregando sinais da operacao e feed em tempo real...',
      icon: Home,
    },
    conversations: {
      label: 'Conversations',
      detail: 'Hidratando filas, timeline e estado do atendimento...',
      icon: MessageCircle,
    },
    contacts: {
      label: 'Contacts',
      detail: 'Montando CRM, filtros e perfis dos contatos...',
      icon: ContactRound,
    },
    analytics: {
      label: 'Service Intelligence',
      detail: 'Calculando estatisticas e organizando a leitura operacional...',
      icon: BarChart3,
    },
    settings: {
      label: 'Settings',
      detail: 'Sincronizando sessoes, QR e configuracoes do workspace...',
      icon: Settings,
    },
  };

  const { label, detail, icon: Icon } = config[targetView];

  return (
    <section className="grid min-h-0 flex-1 place-items-center overflow-hidden px-6 py-8">
      <div className="relative w-full max-w-4xl overflow-hidden rounded-[2rem] border border-white/6 bg-[linear-gradient(180deg,rgba(19,19,19,0.96),rgba(15,15,15,0.98))] p-8 md:p-12">
        <div className="absolute -right-24 -top-20 h-56 w-56 rounded-full bg-[var(--primary)]/10 blur-[80px]" />
        <div className="absolute -bottom-20 -left-12 h-48 w-48 rounded-full bg-[var(--secondary)]/10 blur-[70px]" />

        <div className="relative z-10 flex flex-col gap-10">
          <div className="flex flex-wrap items-center gap-5">
            <div className="grid h-16 w-16 place-items-center rounded-[1.4rem] bg-[linear-gradient(135deg,#7fafff,#64a1ff)] text-black shadow-[0_0_28px_rgba(127,175,255,0.24)]">
              <Icon className="h-7 w-7" strokeWidth={2.2} />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.28em] text-[var(--muted)]">
                Loading workspace
              </p>
              <h2 className="font-headline mt-2 text-4xl font-extrabold text-white md:text-5xl">
                {label}
              </h2>
              <p className="mt-2 max-w-2xl text-base leading-7 text-[var(--muted)]">
                {detail}
              </p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <div
                key={index}
                className="overflow-hidden rounded-[1.5rem] border border-white/5 bg-[var(--surface-low)]/80 p-5"
              >
                <div className="h-3 w-24 animate-pulse rounded-full bg-white/10" />
                <div className="mt-5 h-10 w-20 animate-pulse rounded-2xl bg-white/10" />
                <div className="mt-8 h-2 w-full animate-pulse rounded-full bg-white/5" />
                <div className="mt-3 h-2 w-3/4 animate-pulse rounded-full bg-white/5" />
              </div>
            ))}
          </div>

          <div className="space-y-3">
            <div className="h-3 w-32 animate-pulse rounded-full bg-white/10" />
            <div className="grid gap-3">
              {Array.from({ length: 4 }).map((_, index) => (
                <div
                  key={index}
                  className="flex items-center gap-4 rounded-[1.4rem] border border-white/5 bg-[var(--surface-low)]/70 px-5 py-4"
                >
                  <div className="h-12 w-12 animate-pulse rounded-2xl bg-white/10" />
                  <div className="min-w-0 flex-1 space-y-3">
                    <div className="h-3 w-1/3 animate-pulse rounded-full bg-white/10" />
                    <div className="h-2.5 w-2/3 animate-pulse rounded-full bg-white/5" />
                  </div>
                  <div className="h-8 w-20 animate-pulse rounded-full bg-white/10" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ConversationLoadingState({ contact }: { contact?: string }) {
  return (
    <div className="grid h-full place-items-center bg-[var(--surface)]">
      <div className="flex w-full max-w-4xl flex-col items-center justify-center gap-8 px-6 py-10 text-center">
        <div className="relative flex items-center justify-center">
          <div className="h-10 w-10 animate-spin rounded-full border-[3px] border-white/8 border-t-[#7fafff]" />
          <div className="absolute h-5 w-5 rounded-full bg-[var(--surface)]" />
          <div className="absolute top-1.5 h-1.5 w-1.5 rounded-full bg-[var(--tertiary)]" />
        </div>

        <div>
          <span className="inline-flex rounded-full bg-white/6 px-3 py-1 text-[11px] font-medium text-[var(--muted)]">
            Hoje
          </span>
          <p className="mt-4 text-sm text-[var(--muted)]">
            {contact ? `Abrindo ${contact}...` : 'Abrindo conversa...'}
          </p>
        </div>

        <div className="flex w-full justify-end">
          <div className="w-full max-w-[22rem] animate-pulse rounded-[1rem] rounded-br-md bg-white/[0.06] p-4 text-left">
            <div className="h-3 w-4/5 rounded-full bg-white/10" />
            <div className="mt-3 h-3 w-3/4 rounded-full bg-white/8" />
            <div className="mt-3 h-3 w-2/3 rounded-full bg-white/8" />
            <div className="mt-4 flex justify-end">
              <div className="h-2.5 w-8 rounded-full bg-white/10" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function WorkspaceStatusBanner({
  title,
  description,
  tone,
}: {
  title: string;
  description: string;
  tone: 'info' | 'error';
}) {
  const toneClass =
    tone === 'error'
      ? 'border-rose-500/20 bg-rose-500/10 text-rose-100'
      : 'border-sky-400/20 bg-sky-400/10 text-sky-100';

  return (
    <div className={`rounded-[24px] border px-4 py-3 ${toneClass}`}>
      <p className="text-sm font-semibold text-white">{title}</p>
      <p className="mt-1 text-xs leading-5 text-white/70">{description}</p>
    </div>
  );
}

function EmptyStateCard({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="rounded-[28px] border border-dashed border-white/10 bg-white/[0.03] px-5 py-6 text-center">
      <p className="text-sm font-semibold text-white">{title}</p>
      <p className="mt-2 text-sm leading-7 text-[var(--muted)]">{description}</p>
      {actionLabel && onAction ? (
        <button
          className="mt-4 rounded-full bg-white/6 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-white transition hover:bg-white/10"
          onClick={onAction}
          type="button"
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

function KanbanModal({
  title,
  description,
  onClose,
  children,
}: {
  title: string;
  description: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/70 px-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-[30px] border border-white/8 bg-[linear-gradient(180deg,rgba(18,18,20,0.98),rgba(12,12,14,0.98))] p-6 shadow-[0_32px_80px_-30px_rgba(0,0,0,0.85)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-zinc-500">CRM</p>
            <h3 className="mt-2 text-2xl font-semibold text-white">{title}</h3>
            <p className="mt-2 text-sm leading-6 text-zinc-400">{description}</p>
          </div>
          <button
            className="grid h-10 w-10 place-items-center rounded-full bg-white/5 text-zinc-400 transition hover:bg-white/10 hover:text-white"
            onClick={onClose}
            type="button"
          >
            <X className="h-4 w-4" strokeWidth={2.1} />
          </button>
        </div>

        <div className="mt-5">{children}</div>
      </div>
    </div>
  );
}

function SkeletonBlock({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-2xl bg-white/6 ${className}`} />;
}

function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="rounded-[18px] border border-white/5 bg-white/[0.025] p-3">
          <div className="flex gap-3">
            <SkeletonBlock className="h-12 w-12 rounded-2xl" />
            <div className="flex-1 space-y-2.5 py-1">
              <div className="flex items-center justify-between gap-3">
                <SkeletonBlock className="h-4 w-32" />
                <SkeletonBlock className="h-3 w-12 rounded-full" />
              </div>
              <SkeletonBlock className="h-3 w-3/4" />
              <div className="flex gap-2">
                <SkeletonBlock className="h-6 w-20 rounded-full" />
                <SkeletonBlock className="h-6 w-16 rounded-full" />
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function StackSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="rounded-[24px] border border-white/5 bg-white/[0.025] p-4">
          <SkeletonBlock className="h-4 w-32" />
          <SkeletonBlock className="mt-3 h-3 w-44" />
        </div>
      ))}
    </div>
  );
}

function ConversationTimelineSkeleton() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} className={`flex ${index % 2 === 0 ? 'justify-start' : 'justify-end'}`}>
          <div className="max-w-[80%] space-y-2">
            <SkeletonBlock className="h-16 w-72 rounded-[26px]" />
            <SkeletonBlock className="h-3 w-16" />
          </div>
        </div>
      ))}
    </div>
  );
}

function AnalyticsLoadingState() {
  return (
    <div className="grid grid-cols-12 gap-6">
      <div className="col-span-12 rounded-[1.25rem] bg-[var(--surface-low)] p-5 lg:col-span-4">
        <SkeletonBlock className="h-4 w-36" />
        <SkeletonBlock className="mx-auto mt-8 h-48 w-48 rounded-full" />
        <div className="mt-8 grid grid-cols-2 gap-8">
          <SkeletonBlock className="h-16 w-full" />
          <SkeletonBlock className="h-16 w-full" />
        </div>
      </div>
      <div className="col-span-12 rounded-[1.25rem] bg-[var(--surface-low)] p-5 lg:col-span-8">
        <SkeletonBlock className="h-4 w-44" />
        <SkeletonBlock className="mt-3 h-10 w-36" />
        <div className="mt-10 flex h-48 items-end gap-4">
          {Array.from({ length: 7 }, (_, index) => (
            <SkeletonBlock key={index} className="h-full flex-1 rounded-t-lg" />
          ))}
        </div>
      </div>
      <div className="col-span-12 rounded-[1.25rem] bg-[var(--surface-low)] p-5">
        <SkeletonBlock className="h-4 w-40" />
        <div className="mt-6 grid gap-2">
          {Array.from({ length: 5 }, (_, index) => (
            <SkeletonBlock key={index} className="h-10 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}

function ContactKanbanCard({
  contact,
  crmProfile,
  selected,
  onSelect,
  onOpenConversation,
  onCopyId,
  onDragStart,
  onDragEnd,
}: {
  contact: ConversationRecord;
  crmProfile?: ContactCRMProfileRecord;
  selected: boolean;
  onSelect: () => void;
  onOpenConversation: () => void;
  onCopyId: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const channel = getContactChannelMeta(contact);
  const relativePulse = formatRelativePulse(contact.lastMessageAt);
  const priorityTone = getContactPriorityTone(crmProfile?.priority);

  return (
    <article
      className={`rounded-[22px] border p-3 transition ${
        selected
          ? 'border-[var(--primary)]/25 bg-[var(--primary)]/8 shadow-[0_0_0_1px_rgba(127,175,255,0.08)]'
          : 'border-white/6 bg-white/[0.03] hover:border-white/10 hover:bg-white/[0.045]'
      }`}
      draggable
      onClick={onSelect}
      onDragEnd={onDragEnd}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', contact.id);
        onDragStart();
      }}
    >
      <div className="flex items-start gap-3">
        <AvatarBadge label={contact.contact} src={contact.avatarUrl} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="line-clamp-2 text-sm font-semibold text-white">{contact.contact}</p>
              <p className="mt-1 truncate text-xs text-zinc-500">
                {isVerifiedContact(contact)
                  ? `@${slugifyContact(contact.contact)}`
                  : toContactEmail(contact.contact)}
              </p>
            </div>
            {contact.unread > 0 ? (
              <span className="rounded-full bg-[var(--secondary)]/16 px-2 py-1 text-[10px] font-semibold text-[var(--secondary)]">
                {contact.unread}
              </span>
            ) : null}
          </div>

          <p className="mt-3 line-clamp-2 text-sm leading-6 text-zinc-300">
            {contact.preview || 'Sem preview recente.'}
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${channel.tone}`}>
              <channel.icon className="h-3.5 w-3.5" strokeWidth={2.1} />
              {channel.label}
            </span>
            <span className="rounded-full bg-white/6 px-2.5 py-1 text-[10px] font-semibold text-zinc-400">
              {relativePulse.primary}
            </span>
            {crmProfile?.priority ? (
              <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${priorityTone}`}>
                {crmProfile.priority}
              </span>
            ) : null}
            {crmProfile?.assignee ? (
              <span className="rounded-full bg-white/6 px-2.5 py-1 text-[10px] font-semibold text-zinc-300">
                {crmProfile.assignee}
              </span>
            ) : null}
            {(crmProfile?.tags ?? []).slice(0, 2).map((tag) => (
              <span key={tag} className="rounded-full bg-white/6 px-2.5 py-1 text-[10px] font-semibold text-zinc-400">
                #{tag}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-white/6 pt-3">
        <button
          className="rounded-full bg-white/6 px-3 py-1.5 text-[11px] font-semibold text-zinc-300 transition hover:bg-white/10 hover:text-white"
          onClick={(event) => {
            event.stopPropagation();
            onOpenConversation();
          }}
          type="button"
        >
          Abrir
        </button>
        <button
          className="rounded-full bg-white/6 px-3 py-1.5 text-[11px] font-semibold text-zinc-400 transition hover:bg-white/10 hover:text-white"
          onClick={(event) => {
            event.stopPropagation();
            onCopyId();
          }}
          type="button"
        >
          Copiar ID
        </button>
      </div>
    </article>
  );
}

function ContactKanbanDetailPanel({
  contact,
  crmProfile,
  stage,
  onMoveStage,
  onSaveProfile,
  onOpenConversation,
  onCopyId,
}: {
  contact: ConversationRecord;
  crmProfile?: ContactCRMProfileRecord;
  stage: ContactKanbanStageId;
  onMoveStage: (contact: ConversationRecord, stage: ContactKanbanStageId) => void | Promise<void>;
  onSaveProfile: (
    contact: ConversationRecord,
    patch: Partial<Pick<ContactCRMProfileRecord, 'assignee' | 'priority' | 'notes' | 'tags'>>,
  ) => void | Promise<void>;
  onOpenConversation: () => void;
  onCopyId: () => void;
}) {
  const channel = getContactChannelMeta(contact);
  const interactionMetric = getContactInteractionMetric(contact);
  const relativePulse = formatRelativePulse(contact.lastMessageAt);
  const connectivity = getContactConnectivity(contact);
  const [draftAssignee, setDraftAssignee] = useState(crmProfile?.assignee ?? '');
  const [draftPriority, setDraftPriority] = useState<ContactCRMProfileRecord['priority']>(
    crmProfile?.priority ?? '',
  );
  const [draftNotes, setDraftNotes] = useState(crmProfile?.notes ?? '');
  const [draftTags, setDraftTags] = useState((crmProfile?.tags ?? []).join(', '));

  return (
    <div className="space-y-5">
      <div className="rounded-[26px] border border-white/6 bg-white/[0.03] p-5">
        <div className="flex items-start gap-4">
          <AvatarBadge className="h-16 w-16 text-lg" label={contact.contact} src={contact.avatarUrl} />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-zinc-500">
              Contato ativo
            </p>
            <h3 className="mt-2 text-xl font-semibold text-white">{contact.contact}</h3>
            <p className="mt-1 text-sm text-zinc-400">{contact.owner} · {contact.channelName}</p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${channel.tone}`}>
            <channel.icon className="h-4 w-4" strokeWidth={2.1} />
            {channel.label}
          </span>
          <span className="rounded-full bg-white/6 px-3 py-1.5 text-xs font-semibold text-zinc-300">
            {contactsKanbanStages.find((item) => item.id === stage)?.label}
          </span>
        </div>
      </div>

      <div className="rounded-[26px] border border-white/6 bg-white/[0.03] p-5">
        <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-zinc-500">
          Mover etapa
        </p>
        <div className="mt-4 grid gap-2">
          {contactsKanbanStages.map((item) => (
            <button
              key={item.id}
              className={`flex items-center justify-between rounded-2xl border px-3 py-3 text-left transition ${
                item.id === stage
                  ? 'border-[var(--primary)]/30 bg-[var(--primary)]/10'
                  : 'border-white/6 bg-white/[0.02] hover:bg-white/[0.04]'
              }`}
              onClick={() => {
                void onMoveStage(contact, item.id);
              }}
              type="button"
            >
              <span className="text-sm font-medium text-white">{item.label}</span>
              <span className={`h-2.5 w-2.5 rounded-full ${item.accent}`} />
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-[26px] border border-white/6 bg-white/[0.03] p-5">
        <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-zinc-500">
          Sinais do contato
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-white/[0.03] p-3">
            <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Interacoes</p>
            <p className="mt-2 text-2xl font-semibold text-white">{interactionMetric.value}</p>
            <p className={`mt-1 text-[11px] font-semibold ${interactionMetric.tone}`}>{interactionMetric.label}</p>
          </div>
          <div className="rounded-2xl bg-white/[0.03] p-3">
            <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Pulse</p>
            <p className="mt-2 text-base font-semibold text-white">{relativePulse.primary}</p>
            <p className="mt-1 text-[11px] text-zinc-400">{relativePulse.secondary}</p>
          </div>
        </div>

        <div className="mt-4 rounded-2xl bg-white/[0.03] p-3">
          <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Ultima mensagem</p>
          <p className="mt-2 text-sm leading-6 text-zinc-300">{contact.preview || 'Sem texto recente sincronizado.'}</p>
          <div className="mt-3 flex items-center gap-2 text-xs">
            <span className={`h-2.5 w-2.5 rounded-full ${connectivity.dot}`} />
            <span className={connectivity.tone}>{connectivity.label}</span>
          </div>
        </div>
      </div>

      <div className="rounded-[26px] border border-white/6 bg-white/[0.03] p-5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-zinc-500">
            CRM inline
          </p>
          <button
            className="rounded-full bg-[linear-gradient(135deg,#7fafff,#64a1ff)] px-3 py-1.5 text-xs font-semibold text-black"
            onClick={() => {
              void onSaveProfile(contact, {
                assignee: draftAssignee.trim(),
                priority: draftPriority ?? '',
                notes: draftNotes.trim(),
                tags: parseContactTagsInput(draftTags),
              });
            }}
            type="button"
          >
            Salvar
          </button>
        </div>

        <div className="mt-4 space-y-3">
          <div>
            <label className="mb-2 block text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">
              Responsavel
            </label>
            <input
              className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-500"
              onChange={(event) => setDraftAssignee(event.target.value)}
              placeholder="Nome do responsavel"
              value={draftAssignee}
            />
          </div>

          <div>
            <label className="mb-2 block text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">
              Prioridade
            </label>
            <div className="grid grid-cols-2 gap-2">
              {(['', 'low', 'medium', 'high', 'urgent'] as const).map((priority) => (
                <button
                  key={priority || 'none'}
                  className={`rounded-2xl border px-3 py-2.5 text-left text-sm transition ${draftPriority === priority ? 'border-[var(--primary)]/30 bg-[var(--primary)]/10 text-white' : 'border-white/8 bg-white/[0.03] text-zinc-400 hover:bg-white/[0.05]'}`}
                  onClick={() => setDraftPriority(priority)}
                  type="button"
                >
                  {priority || 'Sem prioridade'}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-2 block text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">
              Tags
            </label>
            <input
              className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-500"
              onChange={(event) => setDraftTags(event.target.value)}
              placeholder="vip, retorno, atacado"
              value={draftTags}
            />
          </div>

          <div>
            <label className="mb-2 block text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">
              Observacoes
            </label>
            <textarea
              className="min-h-28 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-500"
              onChange={(event) => setDraftNotes(event.target.value)}
              placeholder="Resumo do contexto, proxima acao, objeccoes, detalhes do atendimento..."
              value={draftNotes}
            />
          </div>
        </div>
      </div>

      <div className="rounded-[26px] border border-white/6 bg-white/[0.03] p-5">
        <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-zinc-500">
          Acoes rapidas
        </p>
        <div className="mt-4 grid gap-2">
          <button
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[linear-gradient(135deg,#7fafff,#64a1ff)] px-4 py-3 text-sm font-semibold text-black"
            onClick={onOpenConversation}
            type="button"
          >
            <MessageCircle className="h-4 w-4" strokeWidth={2.1} />
            Abrir conversa
          </button>
          <button
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white/[0.04] px-4 py-3 text-sm font-semibold text-zinc-300 transition hover:bg-white/[0.08] hover:text-white"
            onClick={onCopyId}
            type="button"
          >
            <MoreVertical className="h-4 w-4" strokeWidth={2.1} />
            Copiar identificador
          </button>
        </div>
      </div>
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
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const sizeClass = small ? 'h-8 w-8 text-xs' : 'h-12 w-12 text-sm';
  const resolvedSrc = resolveAvatarSrc(src);
  const canRenderImage = Boolean(resolvedSrc) && resolvedSrc !== failedSrc;

  if (canRenderImage && resolvedSrc) {
    return (
      <div
        className={`shrink-0 overflow-hidden rounded-2xl bg-[linear-gradient(135deg,#2f2f2f,#5d5d5d)] ${sizeClass} ${className}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          alt={label}
          className="h-full w-full object-cover"
          onError={() => setFailedSrc(resolvedSrc)}
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
  disabled,
  onSend,
  onSendMedia,
  quickReplies,
}: {
  disabled: boolean;
  onSend: (text: string) => Promise<boolean>;
  onSendMedia: (file: File, options?: { sticker?: boolean; caption?: string }) => Promise<boolean>;
  quickReplies: string[];
}) {
  const [draft, setDraft] = useState('');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showAttachmentMenu, setShowAttachmentMenu] = useState(false);
  const [selectedAttachment, setSelectedAttachment] = useState<ComposerAttachment | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isSendingText, setIsSendingText] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const mediaInputRef = useRef<HTMLInputElement | null>(null);
  const stickerInputRef = useRef<HTMLInputElement | null>(null);

  const composerBusy = disabled || isSendingText || isUploading;

  const clearAttachment = useCallback(() => {
    setSelectedAttachment((current) => {
      if (current?.previewUrl) {
        URL.revokeObjectURL(current.previewUrl);
      }
      return null;
    });
  }, []);

  const queueAttachment = useCallback((file: File, options?: { sticker?: boolean }) => {
    const sticker = options?.sticker ?? false;
    const previewUrl =
      file.type.startsWith('image/') || file.type.startsWith('video/') ? URL.createObjectURL(file) : null;

    setSelectedAttachment((current) => {
      if (current?.previewUrl) {
        URL.revokeObjectURL(current.previewUrl);
      }

      return {
        file,
        previewUrl,
        sticker,
      };
    });

    setShowAttachmentMenu(false);
    setShowEmojiPicker(false);
  }, []);

  useEffect(() => () => {
    if (selectedAttachment?.previewUrl) {
      URL.revokeObjectURL(selectedAttachment.previewUrl);
    }
  }, [selectedAttachment]);

  const submit = useCallback(async () => {
    if (composerBusy) {
      return;
    }

    if (selectedAttachment) {
      setIsUploading(true);
      const sent = await onSendMedia(selectedAttachment.file, {
        sticker: selectedAttachment.sticker,
        caption: selectedAttachment.sticker ? '' : draft.trim(),
      });
      setIsUploading(false);

      if (sent) {
        clearAttachment();
        setDraft('');
      }
      return;
    }

    const payload = draft.trim();
    if (!payload) {
      return;
    }

    setIsSendingText(true);
    const sent = await onSend(payload);
    setIsSendingText(false);
    if (sent) {
      setDraft('');
    }
  }, [clearAttachment, composerBusy, draft, onSend, onSendMedia, selectedAttachment]);

  return (
    <div
      className={`rounded-[34px] transition ${isDragging ? 'bg-[var(--primary)]/8 p-2 ring-1 ring-[var(--primary)]/30' : ''}`}
      onDragEnter={(event) => {
        event.preventDefault();
        if (!disabled) {
          setIsDragging(true);
        }
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setIsDragging(false);
        }
      }}
      onDragOver={(event) => {
        event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        setIsDragging(false);

        if (disabled) {
          return;
        }

        const file = event.dataTransfer.files?.[0];
        if (!file) {
          return;
        }

        queueAttachment(file, { sticker: file.type === 'image/webp' });
      }}
    >
      <input
        ref={mediaInputRef}
        accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,application/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            queueAttachment(file);
          }
          event.currentTarget.value = '';
        }}
        type="file"
      />
      <input
        ref={stickerInputRef}
        accept="image/webp,.webp"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            queueAttachment(file, { sticker: true });
          }
          event.currentTarget.value = '';
        }}
        type="file"
      />
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

      {selectedAttachment ? (
        <div className="mb-3 overflow-hidden rounded-[26px] border border-white/10 bg-[var(--surface-high)] px-3 py-3 shadow-[0_18px_36px_-24px_rgba(0,0,0,0.9)]">
          <div className="flex items-start gap-3">
            {selectedAttachment.previewUrl ? (
              selectedAttachment.file.type.startsWith('video/') ? (
                <video
                  className="h-20 w-20 rounded-2xl object-cover"
                  muted
                  preload="metadata"
                  src={selectedAttachment.previewUrl}
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt={selectedAttachment.file.name}
                  className="h-20 w-20 rounded-2xl object-cover"
                  src={selectedAttachment.previewUrl}
                />
              )
            ) : (
              <div className="grid h-20 w-20 place-items-center rounded-2xl bg-white/5 text-[var(--muted)]">
                {selectedAttachment.sticker ? (
                  <Smile className="h-6 w-6" strokeWidth={2.1} />
                ) : selectedAttachment.file.type.startsWith('audio/') ? (
                  <Mic className="h-6 w-6" strokeWidth={2.1} />
                ) : (
                  <Paperclip className="h-6 w-6" strokeWidth={2.1} />
                )}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="truncate text-sm font-semibold text-white">
                    {selectedAttachment.file.name}
                  </p>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {selectedAttachment.sticker ? 'Figurinha' : getAttachmentLabel(selectedAttachment.file)} · {formatFileSize(selectedAttachment.file.size)}
                  </p>
                </div>
                <button
                  aria-label="Remover anexo"
                  className="grid h-8 w-8 place-items-center rounded-full bg-white/5 text-[var(--muted)] transition hover:bg-white/10 hover:text-white"
                  disabled={composerBusy}
                  onClick={clearAttachment}
                  type="button"
                >
                  <X className="h-4 w-4" strokeWidth={2.1} />
                </button>
              </div>
              <p className="mt-3 text-xs leading-5 text-zinc-400">
                {selectedAttachment.sticker
                  ? 'Pronta para enviar como figurinha.'
                  : draft.trim()
                    ? 'A mensagem digitada sera enviada como legenda do anexo.'
                    : 'Adicione uma legenda opcional ou envie direto.'}
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {showEmojiPicker ? (
        <div className="mb-3 flex flex-wrap gap-2 rounded-[26px] border border-white/10 bg-[var(--surface-high)] px-3 py-3 shadow-[0_18px_36px_-24px_rgba(0,0,0,0.9)]">
          {composerEmojis.map((emoji) => (
            <button
              key={emoji}
              className="grid h-10 w-10 place-items-center rounded-2xl bg-white/5 text-lg transition hover:bg-white/10"
              disabled={composerBusy}
              onClick={() => {
                setDraft((current) => `${current}${emoji}`);
                setShowAttachmentMenu(false);
              }}
              type="button"
            >
              <span aria-hidden>{emoji}</span>
            </button>
          ))}
        </div>
      ) : null}

      {isDragging ? (
        <div className="mb-3 rounded-[26px] border border-dashed border-[var(--primary)]/35 bg-[var(--primary)]/10 px-4 py-4 text-center text-sm text-[var(--primary)]">
          Solte o arquivo aqui para anexar a conversa.
        </div>
      ) : null}

      <div className="flex items-center gap-3 rounded-[30px] bg-[var(--surface-high)] px-3 py-3 shadow-[0_18px_36px_-18px_rgba(0,0,0,0.9)]">
        <div className="relative">
          <button
            aria-label="Abrir anexos"
            className="grid h-11 w-11 place-items-center rounded-full bg-white/5 text-[var(--muted)]"
            disabled={composerBusy}
            onClick={() => {
              setShowAttachmentMenu((current) => !current);
              setShowEmojiPicker(false);
            }}
            type="button"
          >
            <Paperclip className="h-5 w-5" strokeWidth={2.1} />
          </button>
          {showAttachmentMenu ? (
            <div className="absolute bottom-[calc(100%+0.75rem)] left-0 z-10 w-44 rounded-3xl border border-white/10 bg-[var(--surface-highest)] p-2 shadow-[0_22px_40px_-20px_rgba(0,0,0,0.95)]">
              <button
                className="flex w-full items-center justify-between rounded-2xl px-3 py-3 text-left text-sm text-zinc-200 transition hover:bg-white/5"
                onClick={() => {
                  mediaInputRef.current?.click();
                  setShowAttachmentMenu(false);
                }}
                type="button"
              >
                <span>Arquivo</span>
                <Paperclip className="h-4 w-4" strokeWidth={2.1} />
              </button>
              <button
                className="flex w-full items-center justify-between rounded-2xl px-3 py-3 text-left text-sm text-zinc-200 transition hover:bg-white/5"
                onClick={() => {
                  stickerInputRef.current?.click();
                  setShowAttachmentMenu(false);
                }}
                type="button"
              >
                <span>Figurinha</span>
                <Smile className="h-4 w-4" strokeWidth={2.1} />
              </button>
            </div>
          ) : null}
        </div>
        <button
          aria-label="Abrir emojis"
          className={`grid h-11 w-11 place-items-center rounded-full text-[var(--muted)] transition ${showEmojiPicker ? 'bg-[var(--primary)]/12 text-[var(--primary)]' : 'bg-white/5'}`}
          disabled={composerBusy}
          onClick={() => {
            setShowEmojiPicker((current) => !current);
            setShowAttachmentMenu(false);
          }}
          type="button"
        >
          <Smile className="h-5 w-5" strokeWidth={2.1} />
        </button>
        <input
          className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-zinc-500"
          disabled={composerBusy}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.nativeEvent.isComposing) {
              return;
            }

            event.preventDefault();
            void submit();
          }}
          placeholder={disabled ? 'Selecione uma conversa...' : selectedAttachment ? 'Adicione uma legenda opcional...' : 'Type a message...'}
          value={draft}
        />
        <button
          className="grid h-11 w-11 place-items-center rounded-full bg-white/5 text-[var(--muted)]"
          disabled
          type="button"
        >
          <Mic className="h-5 w-5" strokeWidth={2.1} />
        </button>
        <button
          className="grid h-12 w-12 place-items-center rounded-full bg-[linear-gradient(135deg,#7fafff,#64a1ff)] text-black shadow-[0_0_22px_rgba(127,175,255,0.32)] transition hover:scale-105 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={composerBusy || (!draft.trim() && !selectedAttachment)}
          onClick={() => void submit()}
          type="button"
        >
          {isSendingText || isUploading ? (
            <RefreshCw className="h-5 w-5 animate-spin" strokeWidth={2.2} />
          ) : (
            <Send className="h-5 w-5" strokeWidth={2.2} />
          )}
        </button>
      </div>
    </div>
  );
}

const MessageBubble = memo(function MessageBubble({
  message,
  avatarUrl,
  conversation,
  isUnread = false,
}: {
  message: MessageRecord;
  avatarUrl?: string | null;
  conversation?: ConversationRecord;
  isUnread?: boolean;
}) {
  const incoming = message.direction !== 'outgoing';
  const showGroupAuthor = shouldShowGroupMessageAuthor(message, conversation);

  if (incoming) {
    return (
      <div className="flex max-w-[80%] gap-4">
        <AvatarBadge label={message.author} small src={showGroupAuthor ? null : avatarUrl} />
        <div
          className={`glass-panel rounded-[26px] rounded-tl-none px-5 py-4 ${
            isUnread ? 'ring-1 ring-[var(--secondary)]/35 shadow-[0_0_0_1px_rgba(93,253,138,0.08)]' : ''
          }`}
        >
          {showGroupAuthor ? (
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--secondary)]">
              {message.author}
            </p>
          ) : null}
          <MessageContent message={message} />
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
        <MessageContent message={message} />
        <div className="mt-3 flex items-center justify-end gap-2 text-xs text-[var(--primary)]">
          <span>{formatClock(message.timestamp)}</span>
          <span>••</span>
        </div>
      </div>
    </div>
  );
});

function NewMessagesDivider({ unreadCount }: { unreadCount: number }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="h-px flex-1 bg-[var(--secondary)]/18" />
      <span className="rounded-full border border-[var(--secondary)]/20 bg-[var(--secondary)]/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--secondary)]">
        {unreadCount} new {unreadCount === 1 ? 'message' : 'messages'}
      </span>
      <div className="h-px flex-1 bg-[var(--secondary)]/18" />
    </div>
  );
}

function MessageContent({ message }: { message: MessageRecord }) {
  const mediaSrc = resolveApiAsset(message.mediaUrl);

  switch (message.kind) {
    case 'image':
      return (
        <div className="space-y-3">
          {mediaSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img alt={message.fileName || message.body} className="max-h-[22rem] rounded-2xl object-cover" src={mediaSrc} />
          ) : null}
          {message.body && message.body !== '[imagem]' ? (
            <FormattedMessageText className="text-lg leading-8 text-white/95" value={message.body} />
          ) : null}
        </div>
      );
    case 'sticker':
      return mediaSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img alt={message.fileName || 'Sticker'} className="h-36 w-36 rounded-2xl object-contain" src={mediaSrc} />
      ) : (
        <FormattedMessageText className="text-lg leading-9 text-white/95" value={message.body} />
      );
    case 'video':
      return (
        <div className="space-y-3">
          {mediaSrc ? (
            <video className="max-h-[22rem] rounded-2xl" controls playsInline src={mediaSrc} />
          ) : null}
          {message.body && message.body !== '[video]' ? (
            <FormattedMessageText className="text-lg leading-8 text-white/95" value={message.body} />
          ) : null}
        </div>
      );
    case 'audio':
      return (
        <div className="space-y-3">
          {mediaSrc ? <audio className="w-full min-w-[16rem]" controls src={mediaSrc} /> : null}
          <FormattedMessageText className="text-base leading-8 text-white/90" value={message.body || '[audio]'} />
        </div>
      );
    case 'document':
      return (
        <a
          className="flex items-center gap-3 rounded-2xl bg-white/5 px-4 py-4 text-left transition hover:bg-white/10"
          href={mediaSrc || '#'}
          rel="noreferrer"
          target="_blank"
        >
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-white/10 text-white">
            <Paperclip className="h-5 w-5" strokeWidth={2.1} />
          </div>
          <div>
            <p className="text-base font-semibold text-white">{message.fileName || 'Documento'}</p>
            <p className="text-sm text-[var(--muted)]">{message.mimeType || 'Arquivo anexado'}</p>
            {message.body && message.body !== '[documento]' ? (
              <FormattedMessageText className="mt-2 text-sm leading-6 text-white/85" value={message.body} />
            ) : null}
          </div>
        </a>
      );
    default:
      return <FormattedMessageText className="text-lg leading-9 text-white/95" value={message.body} />;
  }
}

function FormattedMessageText({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  return (
    <p className={`whitespace-pre-wrap ${className ?? ''}`}>
      {renderWhatsAppFormattedText(value)}
    </p>
  );
}

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

function ToastCard({
  toast,
  onDismiss,
}: {
  toast: ToastItem;
  onDismiss: (toastId: number) => void;
}) {
  const toneClass =
    toast.tone === 'success'
      ? 'border-emerald-400/20 before:bg-emerald-400'
      : toast.tone === 'error'
        ? 'border-rose-400/20 before:bg-rose-400'
        : 'border-sky-400/20 before:bg-sky-400';

  return (
    <div
      className={`pointer-events-auto relative overflow-hidden rounded-[22px] border bg-[rgba(10,14,18,0.94)] px-4 py-3 shadow-[0_18px_36px_-20px_rgba(0,0,0,0.72)] backdrop-blur-xl before:absolute before:inset-y-3 before:left-3 before:w-1 before:rounded-full ${toneClass}`}
    >
      <div className="flex items-start justify-between gap-3 pl-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white">{toast.title}</p>
          {toast.description ? (
            <p className="mt-1 text-xs leading-5 text-zinc-400">{toast.description}</p>
          ) : null}
        </div>
        <button
          aria-label="Fechar notificacao"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/5 text-zinc-400 transition hover:bg-white/10 hover:text-white"
          onClick={() => onDismiss(toast.id)}
          type="button"
        >
          <X className="h-4 w-4" strokeWidth={2.1} />
        </button>
      </div>
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

function filterContactsBoard(
  contacts: ConversationRecord[],
  boardId: ContactsBoardId,
) {
  switch (boardId) {
    case 'unread':
      return contacts.filter((contact) => contact.unread > 0);
    case 'verified':
      return contacts.filter((contact) => isVerifiedContact(contact));
    case 'groups':
      return contacts.filter((contact) => isGroupConversation(contact));
    default:
      return contacts;
  }
}

function applyContactsWorkspaceFilters(
  contacts: ConversationRecord[],
  options: {
    contactsFilter: ConversationFilter;
    contactsAudienceFilter: 'all' | 'verified';
    contactsChannelFilter: 'all' | 'whatsapp' | 'instagram' | 'facebook';
    searchTerm: string;
  },
) {
  const baseContacts = filterConversations(contacts, options.contactsFilter);
  const term = options.searchTerm.trim().toLowerCase();

  const searchFiltered = baseContacts.filter((contact) => {
    if (!term) {
      return true;
    }

    return [contact.contact, contact.participantId, contact.channelName, contact.owner]
      .join(' ')
      .toLowerCase()
      .includes(term);
  });

  return searchFiltered.filter((contact) => {
    if (options.contactsAudienceFilter === 'verified' && !isVerifiedContact(contact)) {
      return false;
    }

    if (
      options.contactsChannelFilter !== 'all' &&
      getContactChannelKey(contact) !== options.contactsChannelFilter
    ) {
      return false;
    }

    return true;
  });
}

function isValidContactKanbanStageId(
  value?: string,
): value is ContactKanbanStageId {
  return ['new', 'qualified', 'active', 'followup', 'won'].includes(value ?? '');
}

function getContactPriorityTone(priority?: ContactCRMProfileRecord['priority']) {
  switch (priority) {
    case 'urgent':
      return 'border-rose-500/30 bg-rose-500/10 text-rose-200';
    case 'high':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-200';
    case 'medium':
      return 'border-sky-500/30 bg-sky-500/10 text-sky-200';
    case 'low':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200';
    default:
      return 'border-white/8 bg-white/[0.04] text-zinc-400';
  }
}

function parseContactTagsInput(value: string) {
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function buildContactKanbanKey(contact: ConversationRecord) {
  return `${contact.sessionId}:${contact.id}`;
}

function resolveContactKanbanStage(
  contact: ConversationRecord,
  stageMap: Record<string, ContactKanbanStageId>,
) {
  return stageMap[buildContactKanbanKey(contact)] ?? inferContactKanbanStage(contact);
}

function inferContactKanbanStage(contact: ConversationRecord): ContactKanbanStageId {
  const normalizedStatus = contact.status.toLowerCase();
  const waiting = contact.waitingTime.toLowerCase();

  if (normalizedStatus.includes('closed') || normalizedStatus.includes('resolved')) {
    return 'won';
  }

  if (contact.unread >= 3) {
    return 'new';
  }

  if (contact.unread > 0 || waiting.includes('novo')) {
    return 'qualified';
  }

  if (normalizedStatus.includes('follow') || waiting.includes('ontem')) {
    return 'followup';
  }

  return 'active';
}

function resolveAvatarSrc(src?: string | null) {
  if (!src) {
    return undefined;
  }
  return resolveApiAsset(src);
}

function resolveApiAsset(src?: string | null) {
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

function getWebSocketUrl(baseUrl: string) {
  if (baseUrl.startsWith('https://')) {
    return `wss://${baseUrl.slice('https://'.length)}`;
  }
  if (baseUrl.startsWith('http://')) {
    return `ws://${baseUrl.slice('http://'.length)}`;
  }
  return baseUrl;
}

function sanitizeOverview(overview: DashboardOverview): DashboardOverview {
  return {
    ...overview,
    conversations: dedupeConversations(overview.conversations),
  };
}

function areOverviewsEquivalent(left: DashboardOverview, right: DashboardOverview) {
  if (
    left.product !== right.product ||
    left.phase !== right.phase ||
    left.metrics.connectedNumbers !== right.metrics.connectedNumbers ||
    left.metrics.activeSessions !== right.metrics.activeSessions ||
    left.metrics.onlineUsers !== right.metrics.onlineUsers ||
    left.metrics.waitingConversations !== right.metrics.waitingConversations
  ) {
    return false;
  }

  if (left.channels.length !== right.channels.length || left.sessions.length !== right.sessions.length || left.conversations.length !== right.conversations.length) {
    return false;
  }

  for (let index = 0; index < left.channels.length; index += 1) {
    const current = left.channels[index];
    const next = right.channels[index];
    if (
      current.id !== next.id ||
      current.name !== next.name ||
      current.color !== next.color ||
      current.connectedNumbers !== next.connectedNumbers
    ) {
      return false;
    }
  }

  for (let index = 0; index < left.sessions.length; index += 1) {
    const current = left.sessions[index];
    const next = right.sessions[index];
    if (
      current.id !== next.id ||
      current.name !== next.name ||
      current.phoneNumber !== next.phoneNumber ||
      current.channelId !== next.channelId ||
      current.channelName !== next.channelName ||
      current.status !== next.status ||
      current.attendants !== next.attendants ||
      current.waiting !== next.waiting ||
      current.unread !== next.unread ||
      current.lastHeartbeat !== next.lastHeartbeat ||
      current.qrCode !== next.qrCode ||
      current.qrCodeDataUrl !== next.qrCodeDataUrl ||
      current.lastError !== next.lastError
    ) {
      return false;
    }
  }

  for (let index = 0; index < left.conversations.length; index += 1) {
    const current = left.conversations[index];
    const next = right.conversations[index];
    if (
      current.id !== next.id ||
      current.sessionId !== next.sessionId ||
      current.sessionName !== next.sessionName ||
      current.contact !== next.contact ||
      current.avatarUrl !== next.avatarUrl ||
      current.participantId !== next.participantId ||
      current.owner !== next.owner ||
      current.status !== next.status ||
      current.channelName !== next.channelName ||
      current.waitingTime !== next.waitingTime ||
      current.unread !== next.unread ||
      current.preview !== next.preview ||
      current.lastMessageAt !== next.lastMessageAt
    ) {
      return false;
    }
  }

  return true;
}

function areMessageListsEquivalent(left: MessageRecord[], right: MessageRecord[]) {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    const current = left[index];
    const next = right[index];
    if (
      current.id !== next.id ||
      current.conversationId !== next.conversationId ||
      current.direction !== next.direction ||
      current.body !== next.body ||
      current.timestamp !== next.timestamp ||
      current.author !== next.author
    ) {
      return false;
    }
  }

  return true;
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

function buildConversationCacheKey(sessionId: string, conversationId: string) {
  return `${sessionId}:${conversationId}`;
}

function buildToastKey(toast: Pick<ToastItem, 'tone' | 'title' | 'description'>) {
  return [toast.tone, toast.title, toast.description ?? ''].join('::');
}

function renderWhatsAppFormattedText(value: string) {
  const lines = value.split('\n');

  return lines.map((line, lineIndex) => (
    <Fragment key={`${lineIndex}-${line}`}>
      {renderBoldSegments(line, lineIndex)}
      {lineIndex < lines.length - 1 ? <br /> : null}
    </Fragment>
  ));
}

function renderBoldSegments(line: string, lineIndex: number) {
  const segments: React.ReactNode[] = [];
  const pattern = /\*([^*\n]+)\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let matchIndex = 0;

  while ((match = pattern.exec(line)) !== null) {
    const boldText = match[1];
    if (!boldText.trim()) {
      continue;
    }

    if (match.index > lastIndex) {
      segments.push(line.slice(lastIndex, match.index));
    }

    segments.push(
      <strong key={`${lineIndex}-${matchIndex}`} className="font-semibold text-white">
        {boldText}
      </strong>,
    );

    lastIndex = match.index + match[0].length;
    matchIndex += 1;
  }

  if (lastIndex < line.length) {
    segments.push(line.slice(lastIndex));
  }

  return segments.length > 0 ? segments : line;
}

function shouldShowGroupMessageAuthor(
  message: MessageRecord,
  conversation?: ConversationRecord,
) {
  if (!conversation || !isGroupConversation(conversation) || message.direction !== 'incoming') {
    return false;
  }

  const author = message.author.trim();
  if (!author) {
    return false;
  }

  const normalizedAuthor = author.toLowerCase();
  const normalizedConversation = conversation.contact.trim().toLowerCase();

  return normalizedAuthor !== normalizedConversation && normalizedAuthor !== 'operador';
}

function getAttachmentLabel(file: File) {
  if (file.type.startsWith('image/')) {
    return 'Imagem';
  }

  if (file.type.startsWith('video/')) {
    return 'Video';
  }

  if (file.type.startsWith('audio/')) {
    return 'Audio';
  }

  return 'Arquivo';
}

function formatFileSize(size: number) {
  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}
