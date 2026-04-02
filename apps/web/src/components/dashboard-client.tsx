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
  AuditLogRecord,
  AuthSessionRecord,
  AuthUser,
  ChannelRecord,
  ConversationRecord,
  DashboardOverview,
  MessageRecord,
  QuickReplyRecord,
  SaveQuickReplyPayload,
  SessionRecord,
} from '@/lib/pulse-hub';
import {
  apiUrl,
  authFetch,
  buildAuthenticatedWebSocketUrl,
  clearStoredAuthSession,
  createQuickReply,
  createUser,
  deleteQuickReply,
  autocompleteQuickReplies,
  getCurrentUser,
  getStoredAuthToken,
  getStoredAuthUser,
  listAuditLogs,
  listQuickReplies,
  listUsers,
  listUserSessions,
  revokeUserSession,
  signOutRequest,
  updateQuickReply,
  updateUser,
} from '@/lib/pulse-hub';
import {
  QuickReplyAutocomplete,
  QuickReplyDeleteModal,
  QuickReplyFormModal,
  QuickReplyPreviewModal,
  QuickRepliesSettingsPanel,
} from '@/components/quick-replies';

const statusLabel: Record<SessionRecord['status'], string> = {
  demo: 'Teste',
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

const composerEmojis = ['🙂', '😂', '😍', '🙏', '🎉', '🔥', '✅', '❤️'];

const messageReactionOptions = ['👍', '❤️', '😂', '😮', '🙏'];

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
  { id: 'conversations', label: 'Conversas', icon: MessageCircle },
  { id: 'contacts', label: 'Contatos', icon: ContactRound },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'settings', label: 'Configuracoes', icon: Settings },
];

function canAccessWorkspaceView(role: AuthUser['role'] | undefined, view: WorkspaceView) {
  if (view === 'analytics') {
    return role === 'admin' || role === 'supervisor';
  }

  if (view === 'settings') {
    return role === 'admin' || role === 'supervisor';
  }

  return true;
}

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
    | 'kanban.contact.updated'
    | 'quick_reply.updated';
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
  const [hasLoadedInitialOverview, setHasLoadedInitialOverview] = useState(false);
  const [hasLoadedInitialContactKanban, setHasLoadedInitialContactKanban] = useState(false);
  const [hasLoadedInitialContactBoards, setHasLoadedInitialContactBoards] = useState(false);
  const [hasLoadedInitialContactCRM, setHasLoadedInitialContactCRM] = useState(false);
  const [hasLoadedInitialUsers, setHasLoadedInitialUsers] = useState(false);
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
  const [replyTargetMessage, setReplyTargetMessage] = useState<MessageRecord | null>(null);
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
  const [settingsSection, setSettingsSection] = useState<'sessions' | 'users' | 'quickReplies' | 'audit'>('sessions');
  const [workspaceUsers, setWorkspaceUsers] = useState<AuthUser[]>([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [expandedUserSessionsId, setExpandedUserSessionsId] = useState<string | null>(null);
  const [workspaceUserSessionsMap, setWorkspaceUserSessionsMap] = useState<
    Record<string, AuthSessionRecord[]>
  >({});
  const [loadingUserSessionsMap, setLoadingUserSessionsMap] = useState<Record<string, boolean>>({});
  const [quickReplies, setQuickReplies] = useState<QuickReplyRecord[]>([]);
  const [isLoadingQuickReplies, setIsLoadingQuickReplies] = useState(false);
  const [hasLoadedInitialQuickReplies, setHasLoadedInitialQuickReplies] = useState(false);
  const [quickReplySearchTerm, setQuickReplySearchTerm] = useState('');
  const [selectedQuickReplyIds, setSelectedQuickReplyIds] = useState<string[]>([]);
  const [showQuickReplyFormModal, setShowQuickReplyFormModal] = useState(false);
  const [quickReplyFormMode, setQuickReplyFormMode] = useState<'create' | 'edit'>('create');
  const [editingQuickReplyId, setEditingQuickReplyId] = useState<string | null>(null);
  const [quickReplyFormState, setQuickReplyFormState] = useState<SaveQuickReplyPayload>({
    name: '',
    shortcut: '',
    content: '',
    category: '',
    visibilityScope: 'all',
    visibilityUserId: '',
    status: 'active',
  });
  const [previewQuickReply, setPreviewQuickReply] = useState<QuickReplyRecord | null>(null);
  const [quickReplyToDelete, setQuickReplyToDelete] = useState<QuickReplyRecord | null>(null);
  const [composerQuickReplyResults, setComposerQuickReplyResults] = useState<QuickReplyRecord[]>([]);
  const [isLoadingComposerQuickReplies, setIsLoadingComposerQuickReplies] = useState(false);
  const [auditLogs, setAuditLogs] = useState<AuditLogRecord[]>([]);
  const [isLoadingAuditLogs, setIsLoadingAuditLogs] = useState(false);
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
  const [newUserForm, setNewUserForm] = useState({
    name: '',
    email: '',
    password: '',
    role: 'attendant' as AuthUser['role'],
  });
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editingUserForm, setEditingUserForm] = useState({
    name: '',
    password: '',
    role: 'attendant' as AuthUser['role'],
    isActive: true,
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
  const [isRealtimeConnected, setIsRealtimeConnected] = useState(false);
  const toastTimersRef = useRef(new Map<number, number>());
  const toastIdRef = useRef(0);
  const composerQuickReplyQueryRef = useRef('');
  const composerQuickReplyRequestIdRef = useRef(0);
  const currentView = viewTransition ?? activeView;
  const hasWorkspaceData = overview.sessions.length > 0 || overview.conversations.length > 0;
  const shouldShowInitialSkeleton = isPending && !hasWorkspaceData && !errorMessage;
  const shouldShowContactsSkeleton =
    shouldShowInitialSkeleton || isLoadingContactKanban || isLoadingContactBoards || isLoadingContactCRM;
  const isAdminUser = authUser?.role === 'admin';
  const canManageWorkspaceSessions = authUser?.role === 'admin' || authUser?.role === 'supervisor';
  const canViewAnalytics = authUser?.role === 'admin' || authUser?.role === 'supervisor';
  const canAccessSettings = authUser?.role === 'admin' || authUser?.role === 'supervisor';
  const canManageBoards = canManageWorkspaceSessions;
  const canCreateManualContacts = canManageWorkspaceSessions;
  const canManageQuickReplies = authUser?.role === 'admin' || authUser?.role === 'supervisor';
  const canLoadWorkspaceUsers = authUser?.role === 'admin' || authUser?.role === 'supervisor';
  const canViewAuditLogs = authUser?.role === 'admin' || authUser?.role === 'supervisor';
  const isWorkspaceBootstrapPending =
    isAuthReady &&
    (!hasLoadedInitialOverview ||
      !hasLoadedInitialContactKanban ||
      !hasLoadedInitialContactBoards ||
      !hasLoadedInitialContactCRM ||
      !hasLoadedInitialUsers ||
      !hasLoadedInitialQuickReplies);
  const deferredContactsSearch = useDeferredValue(contactsSearch);
  const deferredQuickReplySearch = useDeferredValue(quickReplySearchTerm);
  const isConversationSwitching = pendingConversationId !== null;
  const isDashboardView = activeView === 'dashboard';
  const isAnalyticsView = activeView === 'analytics';
  const isContactsView = activeView === 'contacts';
  const isConversationsView = activeView === 'conversations';

  const availableNavigationItems = useMemo(
    () => navigationItems.filter((item) => canAccessWorkspaceView(authUser?.role, item.id)),
    [authUser?.role],
  );

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

  const isConversationActivelyViewed = useCallback(
    (sessionId: string, conversationId: string) => {
      if (!isConversationsView) {
        return false;
      }

      if (activeSessionId !== sessionId || activeConversationId !== conversationId) {
        return false;
      }

      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        return false;
      }

      return true;
    },
    [activeConversationId, activeSessionId, isConversationsView],
  );

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

  const messagesById = useMemo(
    () => new Map(messages.map((message) => [message.id, message])),
    [messages],
  );

  const dashboardConversations = useMemo(
    () => (isDashboardView ? overview.conversations.slice(0, 3) : []),
    [isDashboardView, overview.conversations],
  );

  const dashboardLeaderboard = useMemo(
    () => (Array.isArray(overview.dashboard?.leaderboard) ? overview.dashboard.leaderboard.slice(0, 3) : []),
    [overview.dashboard?.leaderboard],
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

  const dashboardSnapshot = useMemo(() => {
    return {
      activeSessions: overview.dashboard?.snapshot?.activeSessions ?? overview.metrics.activeSessions,
      onlineUsers: overview.dashboard?.snapshot?.onlineUsers ?? overview.metrics.onlineUsers,
      recentConversations: overview.dashboard?.snapshot?.recentConversations ?? 0,
      teamCount: overview.dashboard?.snapshot?.teamCount ?? dashboardLeaderboard.length,
    };
  }, [dashboardLeaderboard.length, overview.dashboard?.snapshot, overview.metrics.activeSessions, overview.metrics.onlineUsers]);

  const analyticsModel = useMemo(() => {
    if (!isAnalyticsView) {
      return null;
    }

    const responseVelocity = normalizeResponseVelocityAnalytics(overview.analytics?.responseVelocity);
    const responseSeconds = Math.max(responseVelocity.averageSeconds || 0, 0);
    const responseMinutes = Number((responseSeconds / 60).toFixed(1));
    const resolvedTickets = Array.isArray(overview.analytics?.resolvedTickets) ? overview.analytics.resolvedTickets : [];

    return {
      healthScore: overview.analytics?.healthScore ?? 0,
      responseMinutes,
      resolvedRate: overview.analytics?.resolvedRate ?? 0,
      responseSeconds,
      totalConversations: overview.analytics?.totalConversations ?? overview.conversations.length,
      unreadVolume: overview.analytics?.unreadVolume ?? 0,
      waitingVolume: overview.analytics?.waitingVolume ?? 0,
      channelTotals: overview.analytics?.channelTotals ?? { whatsapp: 0, instagram: 0, facebook: 0 },
      weeklyChannelSeries: Array.isArray(overview.analytics?.weeklyChannelSeries) ? overview.analytics.weeklyChannelSeries : [],
      heatmapRows: Array.isArray(overview.analytics?.heatmapRows) ? overview.analytics.heatmapRows : [],
      resolvedTickets,
      responseVelocity,
    };
  }, [isAnalyticsView, overview.analytics, overview.conversations]);

  const safeResponseVelocity = useMemo(
    () => normalizeResponseVelocityAnalytics(analyticsModel?.responseVelocity),
    [analyticsModel?.responseVelocity],
  );

  const queueLabel = useMemo(() => {
    if (!isConversationsView) {
      return 'Nenhuma sessao selecionada';
    }

    if (!selectedSession) {
      return 'Nenhuma sessao selecionada';
    }

    return `Fila ${selectedSession.channelName}`;
  }, [isConversationsView, selectedSession]);

  const contactInfo = useMemo(() => {
    if (!isConversationsView) {
      return {
        email: 'Nao informado',
        phone: selectedSession?.phoneNumber ?? 'Sem numero vinculado',
      };
    }

    if (!selectedConversation) {
      return {
        email: 'Nao informado',
        phone: selectedSession?.phoneNumber ?? 'Sem numero vinculado',
      };
    }

    return {
      email: 'Nao informado',
      phone: formatParticipantReference(selectedConversation.participantId),
    };
  }, [isConversationsView, selectedConversation, selectedSession?.phoneNumber]);

  const signOut = useCallback(() => {
    void signOutRequest().catch(() => undefined).finally(() => {
      clearStoredAuthSession();
      router.push('/login');
    });
  }, [router]);

  const authenticatedFetch = useCallback(
    async (input: string, init?: RequestInit) => {
      const response = await authFetch(input, init);
      if (response.status === 401) {
        clearStoredAuthSession();
        router.replace('/login');
        throw new Error('Sua sessao expirou. Entre novamente.');
      }
      return response;
    },
    [router],
  );

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
    const token = getStoredAuthToken();
    const cachedUser = getStoredAuthUser();

    if (!token) {
      clearStoredAuthSession();
      router.replace('/login');
      return;
    }

    if (cachedUser) {
      setAuthUser(cachedUser);
    }

    let cancelled = false;

    void getCurrentUser()
      .then((user) => {
        if (cancelled) {
          return;
        }
        setAuthUser(user);
        window.localStorage.setItem('pulse-hub.auth-user', JSON.stringify(user));
        setIsAuthReady(true);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        clearStoredAuthSession();
        router.replace('/login');
      });

    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    if (!isAuthReady || overview.sessions.length === 0) {
      return;
    }

    if (!selectedSessionId) {
      setSelectedSessionId(overview.sessions[0].id);
    }

    if (activeView === 'settings' && !selectedSessionId) {
      setActiveView('dashboard');
    }
  }, [activeView, isAuthReady, overview.sessions, selectedSessionId]);

  useEffect(() => {
    if (!isAuthReady || canAccessWorkspaceView(authUser?.role, activeView)) {
      return;
    }

    navigateToView('dashboard');
  }, [activeView, authUser?.role, isAuthReady, navigateToView]);

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
    if (settingsSection === 'users' && !isAdminUser) {
      setSettingsSection('sessions');
      return;
    }

    if (settingsSection === 'quickReplies' && !canManageQuickReplies) {
      setSettingsSection('sessions');
      return;
    }

    if (settingsSection === 'audit' && !canViewAuditLogs) {
      setSettingsSection('sessions');
    }
  }, [canManageQuickReplies, canViewAuditLogs, isAdminUser, settingsSection]);

  useEffect(() => {
    if (!canManageBoards && showCreateBoardModal) {
      setShowCreateBoardModal(false);
    }
  }, [canManageBoards, showCreateBoardModal]);

  useEffect(() => {
    if (!canCreateManualContacts && showCreateContactModal) {
      setShowCreateContactModal(false);
    }
  }, [canCreateManualContacts, showCreateContactModal]);

  useEffect(() => {
    if (!canManageQuickReplies && showQuickReplyFormModal) {
      setShowQuickReplyFormModal(false);
    }
  }, [canManageQuickReplies, showQuickReplyFormModal]);

  useEffect(() => {
    setSelectedQuickReplyIds((current) => current.filter((id) => quickReplies.some((item) => item.id === id)));
  }, [quickReplies]);

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
    const response = await authenticatedFetch(`${apiUrl}/dashboard/overview`, {
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error('Nao foi possivel atualizar a dashboard.');
    }

    const data = (await response.json()) as DashboardOverview;
    const nextOverview = sanitizeOverview(data);
    const smoothedOverview =
      activeSessionId && activeConversationId && isConversationActivelyViewed(activeSessionId, activeConversationId)
        ? {
            ...nextOverview,
            conversations: nextOverview.conversations.map((conversation) =>
              conversation.sessionId === activeSessionId && conversation.id === activeConversationId
                ? { ...conversation, unread: 0 }
                : conversation,
            ),
          }
        : nextOverview;

    setOverview((current) =>
      areOverviewsEquivalent(current, smoothedOverview) ? current : smoothedOverview,
    );
  }, [activeConversationId, activeSessionId, authenticatedFetch, isConversationActivelyViewed]);

  const loadContactKanbanStages = useCallback(async () => {
    const response = await authenticatedFetch(`${apiUrl}/whatsapp/contacts/kanban`, {
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
  }, [authenticatedFetch]);

  const loadContactBoards = useCallback(async () => {
    const response = await authenticatedFetch(`${apiUrl}/whatsapp/contacts/boards`, {
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error('Nao foi possivel carregar os boards do CRM.');
    }

    const records = (await response.json()) as ContactKanbanBoardRecord[];
    setCustomContactsBoards(records);
  }, [authenticatedFetch]);

  const loadContactCRMProfiles = useCallback(async () => {
    const response = await authenticatedFetch(`${apiUrl}/whatsapp/contacts/crm`, {
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
  }, [authenticatedFetch]);

  const loadWorkspaceUsers = useCallback(async () => {
    const users = await listUsers();
    setWorkspaceUsers(users);
  }, []);

  const loadQuickRepliesList = useCallback(async (query = '') => {
    const items = await listQuickReplies(query);
    setQuickReplies(items);
  }, []);

  const loadAuditLogEntries = useCallback(async () => {
    const items = await listAuditLogs(60);
    setAuditLogs(items);
  }, []);

  const loadComposerQuickReplies = useCallback(async (query = '') => {
    const normalizedQuery = query.trim();
    composerQuickReplyQueryRef.current = normalizedQuery;
    const requestId = composerQuickReplyRequestIdRef.current + 1;
    composerQuickReplyRequestIdRef.current = requestId;
    setIsLoadingComposerQuickReplies(true);

    try {
      const items = await autocompleteQuickReplies(normalizedQuery);
      if (composerQuickReplyRequestIdRef.current !== requestId) {
        return;
      }

      setComposerQuickReplyResults(items);
    } finally {
      if (composerQuickReplyRequestIdRef.current === requestId) {
        setIsLoadingComposerQuickReplies(false);
      }
    }
  }, []);

  const loadUserSessionsForUser = useCallback(async (userId: string) => {
    setLoadingUserSessionsMap((current) => ({ ...current, [userId]: true }));
    try {
      const sessions = await listUserSessions(userId);
      setWorkspaceUserSessionsMap((current) => ({ ...current, [userId]: sessions }));
    } finally {
      setLoadingUserSessionsMap((current) => ({ ...current, [userId]: false }));
    }
  }, []);

  const toggleUserSessions = useCallback(
    (userId: string) => {
      setExpandedUserSessionsId((current) => (current === userId ? null : userId));
      if (workspaceUserSessionsMap[userId]) {
        return;
      }

      void loadUserSessionsForUser(userId).catch(() => undefined);
    },
    [loadUserSessionsForUser, workspaceUserSessionsMap],
  );

  useEffect(() => {
    if (!isAuthReady) {
      return;
    }

    void loadOverview()
      .catch(() => undefined)
      .finally(() => setHasLoadedInitialOverview(true));
  }, [isAuthReady, loadOverview]);

  useEffect(() => {
    if (!isAuthReady) {
      return;
    }

    setIsLoadingContactKanban(true);
    void loadContactKanbanStages()
      .catch(() => undefined)
      .finally(() => {
        setIsLoadingContactKanban(false);
        setHasLoadedInitialContactKanban(true);
      });
  }, [isAuthReady, loadContactKanbanStages]);

  useEffect(() => {
    if (!isAuthReady) {
      return;
    }

    setIsLoadingContactBoards(true);
    void loadContactBoards()
      .catch(() => undefined)
      .finally(() => {
        setIsLoadingContactBoards(false);
        setHasLoadedInitialContactBoards(true);
      });
  }, [isAuthReady, loadContactBoards]);

  useEffect(() => {
    if (!isAuthReady) {
      return;
    }

    setIsLoadingContactCRM(true);
    void loadContactCRMProfiles()
      .catch(() => undefined)
      .finally(() => {
        setIsLoadingContactCRM(false);
        setHasLoadedInitialContactCRM(true);
      });
  }, [isAuthReady, loadContactCRMProfiles]);

  useEffect(() => {
    if (!isAuthReady) {
      setWorkspaceUsers([]);
      setWorkspaceUserSessionsMap({});
      setExpandedUserSessionsId(null);
      return;
    }

    if (!canLoadWorkspaceUsers) {
      setWorkspaceUsers([]);
      setWorkspaceUserSessionsMap({});
      setExpandedUserSessionsId(null);
      setHasLoadedInitialUsers(true);
      return;
    }

    setIsLoadingUsers(true);
    void loadWorkspaceUsers()
      .catch(() => undefined)
      .finally(() => {
        setIsLoadingUsers(false);
        setHasLoadedInitialUsers(true);
      });
  }, [canLoadWorkspaceUsers, isAuthReady, loadWorkspaceUsers]);

  useEffect(() => {
    if (!isAuthReady) {
      composerQuickReplyQueryRef.current = '';
      composerQuickReplyRequestIdRef.current += 1;
      setQuickReplies([]);
      setComposerQuickReplyResults([]);
      setIsLoadingComposerQuickReplies(false);
      return;
    }

    setIsLoadingQuickReplies(true);
    void Promise.all([
      loadQuickRepliesList(),
      loadComposerQuickReplies(),
    ])
      .catch(() => undefined)
      .finally(() => {
        setIsLoadingQuickReplies(false);
        setHasLoadedInitialQuickReplies(true);
      });
  }, [isAuthReady, loadComposerQuickReplies, loadQuickRepliesList]);

  useEffect(() => {
    if (!isAuthReady || !canManageQuickReplies) {
      return;
    }

    setIsLoadingQuickReplies(true);
    void loadQuickRepliesList(deferredQuickReplySearch)
      .catch(() => undefined)
      .finally(() => setIsLoadingQuickReplies(false));
  }, [canManageQuickReplies, deferredQuickReplySearch, isAuthReady, loadQuickRepliesList]);

  useEffect(() => {
    if (!isAuthReady || !canViewAuditLogs) {
      setAuditLogs([]);
      setIsLoadingAuditLogs(false);
      return;
    }

    if (settingsSection !== 'audit') {
      return;
    }

    setIsLoadingAuditLogs(true);
    void loadAuditLogEntries()
      .catch(() => undefined)
      .finally(() => setIsLoadingAuditLogs(false));
  }, [canViewAuditLogs, isAuthReady, loadAuditLogEntries, settingsSection]);

  const fetchConversationMessages = useCallback(async (sessionId: string, conversationId: string) => {
    const response = await authenticatedFetch(
      `${apiUrl}/whatsapp/sessions/${sessionId}/conversations/${conversationId}/messages`,
      { cache: 'no-store' },
    );

    if (!response.ok) {
      throw new Error('Nao foi possivel carregar as mensagens.');
    }

    return (await response.json()) as MessageRecord[];
  }, [authenticatedFetch]);

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
        await authenticatedFetch(
          `${apiUrl}/whatsapp/sessions/${sessionId}/conversations/${conversationId}/read`,
          {
            method: 'POST',
          },
        );
      } catch {
        void loadOverview().catch(() => undefined);
      }
    },
    [authenticatedFetch, loadOverview],
  );

  const realtimeContextRef = useRef({
    isConversationsView: false,
    activeSessionId: null as string | null,
    activeConversationId: null as string | null,
  });
  const loadOverviewRef = useRef(loadOverview);
  const loadMessagesRef = useRef(loadMessages);
  const loadContactBoardsRef = useRef(loadContactBoards);
  const loadContactCRMProfilesRef = useRef(loadContactCRMProfiles);
  const loadContactKanbanStagesRef = useRef(loadContactKanbanStages);
  const loadQuickRepliesListRef = useRef(loadQuickRepliesList);
  const loadComposerQuickRepliesRef = useRef(loadComposerQuickReplies);
  const markConversationAsReadRef = useRef(markConversationAsRead);
  const isConversationActivelyViewedRef = useRef(isConversationActivelyViewed);

  useEffect(() => {
    realtimeContextRef.current = {
      isConversationsView,
      activeSessionId,
      activeConversationId,
    };
  }, [activeConversationId, activeSessionId, isConversationsView]);

  useEffect(() => {
    loadOverviewRef.current = loadOverview;
  }, [loadOverview]);

  useEffect(() => {
    loadMessagesRef.current = loadMessages;
  }, [loadMessages]);

  useEffect(() => {
    loadContactBoardsRef.current = loadContactBoards;
  }, [loadContactBoards]);

  useEffect(() => {
    loadContactCRMProfilesRef.current = loadContactCRMProfiles;
  }, [loadContactCRMProfiles]);

  useEffect(() => {
    loadContactKanbanStagesRef.current = loadContactKanbanStages;
  }, [loadContactKanbanStages]);

  useEffect(() => {
    loadQuickRepliesListRef.current = loadQuickRepliesList;
  }, [loadQuickRepliesList]);

  useEffect(() => {
    loadComposerQuickRepliesRef.current = loadComposerQuickReplies;
  }, [loadComposerQuickReplies]);

  useEffect(() => {
    markConversationAsReadRef.current = markConversationAsRead;
  }, [markConversationAsRead]);

  useEffect(() => {
    isConversationActivelyViewedRef.current = isConversationActivelyViewed;
  }, [isConversationActivelyViewed]);

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
        const nextView = availableNavigationItems[Number(event.key) - 1]?.id;
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
    availableNavigationItems,
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

    const pageVisible = typeof document === 'undefined' || document.visibilityState === 'visible';
    const intervalMs = isRealtimeConnected
      ? pageVisible
        ? 12000
        : 30000
      : selectedSession.status === 'active'
        ? 5000
        : ['initializing', 'qr_ready', 'syncing'].includes(selectedSession.status)
          ? 7000
          : null;

    if (!intervalMs) {
      return;
    }

    const interval = window.setInterval(() => {
      void loadOverview().catch(() => undefined);
    }, intervalMs);

    return () => window.clearInterval(interval);
  }, [isAuthReady, isConversationsView, isRealtimeConnected, loadOverview, selectedSession]);

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
    if (!isConversationsView || !activeSessionId || !activeConversationId) {
      return;
    }

    const handleVisibilityChange = () => {
      if (!isConversationActivelyViewed(activeSessionId, activeConversationId)) {
        return;
      }

      void markConversationAsRead(activeSessionId, activeConversationId).catch(() => undefined);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    handleVisibilityChange();

    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [
    activeConversationId,
    activeSessionId,
    isConversationActivelyViewed,
    isConversationsView,
    markConversationAsRead,
  ]);

  useEffect(() => {
    if (!isConversationsView) {
      return;
    }

    if (!activeSessionId || !activeConversationId || activeSessionStatus !== 'active') {
      return;
    }

    const intervalMs = isRealtimeConnected ? 12000 : 5000;

    const interval = window.setInterval(() => {
      void loadMessages(activeSessionId, activeConversationId, {
        showLoading: false,
      }).catch(() => undefined);
    }, intervalMs);

    return () => window.clearInterval(interval);
  }, [
    activeConversationId,
    activeSessionId,
    activeSessionStatus,
    isRealtimeConnected,
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
        void loadOverviewRef.current().catch(() => undefined);
      }, 180);
    };

    const connect = () => {
      if (cancelled) {
        return;
      }

      socket = new WebSocket(buildAuthenticatedWebSocketUrl(`${apiUrl}/ws`));

      socket.onopen = () => {
        setIsRealtimeConnected(true);
      };

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
            void loadContactKanbanStagesRef.current().catch(() => undefined);
          }
        }

        if (payload.kind === 'kanban.board.updated') {
          void loadContactBoardsRef.current().catch(() => undefined);
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
              void loadContactCRMProfilesRef.current().catch(() => undefined);
            }
          } else {
            void loadContactCRMProfilesRef.current().catch(() => undefined);
          }
        }

        if (payload.kind === 'quick_reply.updated') {
          void loadQuickRepliesListRef.current().catch(() => undefined);
          void loadComposerQuickRepliesRef.current(composerQuickReplyQueryRef.current).catch(() => undefined);
        }

        const { isConversationsView, activeSessionId, activeConversationId } = realtimeContextRef.current;

        if (
          isConversationsView &&
          activeSessionId &&
          activeConversationId &&
          payload.kind === 'message.new' &&
          payload.chatJid === activeConversationId
        ) {
          if (payload.direction === 'incoming' && isConversationActivelyViewedRef.current(activeSessionId, activeConversationId)) {
            void markConversationAsReadRef.current(activeSessionId, activeConversationId).catch(() => undefined);
          }

          const delay = payload.direction === 'incoming' ? 300 : 0;
          window.setTimeout(() => {
            void loadMessagesRef.current(activeSessionId, activeConversationId, {
              showLoading: false,
            }).catch(() => undefined);
          }, delay);
        }
      };

      socket.onerror = () => {
        socket?.close();
      };

      socket.onclose = () => {
        setIsRealtimeConnected(false);
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
      setIsRealtimeConnected(false);
      socket?.close();
    };
  }, [isAuthReady]);

  useEffect(() => {
    if (!isConversationsView) {
      setReplyTargetMessage(null);
      return;
    }

    shouldStickToBottomRef.current = true;
    setReplyTargetMessage(null);
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

  const revokeWorkspaceUserSession = useCallback(
    async (userId: string, sessionId: string) => {
      const completed = await executeAction(async () => {
        await revokeUserSession(userId, sessionId);
        const sessions = await listUserSessions(userId);
        setWorkspaceUserSessionsMap((current) => ({ ...current, [userId]: sessions }));
      }, { successMessage: 'Sessao revogada' });

      if (completed) {
        await loadWorkspaceUsers().catch(() => undefined);
      }
    },
    [executeAction, loadWorkspaceUsers],
  );

  const applyOutgoingMessageUpdate = useCallback(
    (sessionId: string, conversationId: string, message: MessageRecord) => {
      const cacheKey = buildConversationCacheKey(sessionId, conversationId);

      messageCacheRef.current.set(
        cacheKey,
        mergeMessageIntoTimeline(messageCacheRef.current.get(cacheKey) ?? [], message),
      );

      if (activeSessionId === sessionId && activeConversationId === conversationId) {
        setMessages((current) => mergeMessageIntoTimeline(current, message));
      }

      setOverview((current) => ({
        ...current,
        conversations: current.conversations.map((conversation) => {
          if (conversation.sessionId !== sessionId || conversation.id !== conversationId) {
            return conversation;
          }

          return {
            ...conversation,
            preview: summarizeConversationPreview(message),
            lastMessageAt: message.timestamp,
          };
        }),
      }));
    },
    [activeConversationId, activeSessionId],
  );

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
        const response = await authenticatedFetch(`${apiUrl}/whatsapp/contacts/kanban`, {
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
    [authUser?.email, authUser?.name, authenticatedFetch, contactKanbanStageMap, executeAction],
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
    if (!canManageBoards) {
      return;
    }

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

      const response = await authenticatedFetch(`${apiUrl}/whatsapp/contacts/boards`, {
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
    canManageBoards,
    contactsAudienceFilter,
    contactsChannelFilter,
    contactsFilter,
    authenticatedFetch,
    executeAction,
    loadContactBoards,
    newBoardForm.description,
    newBoardForm.label,
    pushToast,
  ]);

  const removeContactsBoard = useCallback(
    async (boardId: ContactsBoardId) => {
      if (!canManageBoards) {
        return;
      }

      const removedBoards = customContactsBoards.filter((board) => board.id !== boardId);
      if (activeContactsBoard === boardId) {
        setActiveContactsBoard('contacts');
      }

      const removed = await executeAction(async () => {
        const response = await authenticatedFetch(`${apiUrl}/whatsapp/contacts/boards/${encodeURIComponent(boardId)}`, {
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
    [activeContactsBoard, authenticatedFetch, canManageBoards, customContactsBoards, executeAction],
  );

  const createManualContact = useCallback(async () => {
    if (!canCreateManualContacts) {
      return;
    }

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
      const response = await authenticatedFetch(`${apiUrl}/whatsapp/contacts/manual`, {
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
    authenticatedFetch,
    canCreateManualContacts,
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

        const response = await authenticatedFetch(`${apiUrl}/whatsapp/contacts/crm`, {
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
    [authUser?.email, authUser?.name, authenticatedFetch, contactCrmProfileMap, executeAction],
  );

  const submitNewUser = useCallback(async () => {
    if (!isAdminUser) {
      return;
    }

    const payload = {
      name: newUserForm.name.trim(),
      email: newUserForm.email.trim(),
      password: newUserForm.password,
      role: newUserForm.role,
      isActive: true,
    };

    if (!payload.name || !payload.email || !payload.password) {
      pushToast({
        tone: 'error',
        title: 'Dados do usuario incompletos',
        description: 'Preencha nome, email e senha para criar o usuario.',
      });
      return;
    }

    const created = await executeAction(async () => {
      const user = await createUser(payload);
      setWorkspaceUsers((current) => [user, ...current.filter((item) => item.id !== user.id)]);
      setNewUserForm({ name: '', email: '', password: '', role: 'attendant' });
    }, { successMessage: 'Usuario criado' });

    if (created) {
      await loadWorkspaceUsers().catch(() => undefined);
    }
  }, [executeAction, isAdminUser, loadWorkspaceUsers, newUserForm.email, newUserForm.name, newUserForm.password, newUserForm.role, pushToast]);

  const startEditingUser = useCallback((user: AuthUser) => {
    setEditingUserId(user.id);
    setEditingUserForm({
      name: user.name,
      password: '',
      role: user.role,
      isActive: user.isActive,
    });
  }, []);

  const submitUserUpdate = useCallback(async () => {
    if (!editingUserId) {
      return;
    }

    const payload = {
      name: editingUserForm.name.trim(),
      password: editingUserForm.password.trim() || undefined,
      role: editingUserForm.role,
      isActive: editingUserForm.isActive,
    };

    if (!payload.name) {
      pushToast({
        tone: 'error',
        title: 'Nome obrigatorio',
        description: 'Defina o nome exibido do usuario antes de salvar.',
      });
      return;
    }

    const saved = await executeAction(async () => {
      const user = await updateUser(editingUserId, payload);
      setWorkspaceUsers((current) => current.map((item) => (item.id === user.id ? user : item)));
      if (authUser?.id === user.id) {
        setAuthUser(user);
        window.localStorage.setItem('pulse-hub.auth-user', JSON.stringify(user));
      }
      setEditingUserId(null);
      setEditingUserForm({
        name: '',
        password: '',
        role: 'attendant',
        isActive: true,
      });
    }, { successMessage: 'Usuario atualizado' });

    if (saved) {
      await loadWorkspaceUsers().catch(() => undefined);
    }
  }, [authUser?.id, editingUserForm.isActive, editingUserForm.name, editingUserForm.password, editingUserForm.role, editingUserId, executeAction, loadWorkspaceUsers, pushToast]);

  const openCreateQuickReplyModal = useCallback(() => {
    setQuickReplyFormMode('create');
    setEditingQuickReplyId(null);
    setQuickReplyFormState({
      name: '',
      shortcut: '',
      content: '',
      category: '',
      visibilityScope: 'all',
      visibilityUserId: '',
      status: 'active',
    });
    setShowQuickReplyFormModal(true);
  }, []);

  const openEditQuickReplyModal = useCallback((item: QuickReplyRecord) => {
    setQuickReplyFormMode('edit');
    setEditingQuickReplyId(item.id);
    setQuickReplyFormState({
      name: item.name,
      shortcut: item.shortcut,
      content: item.content,
      category: item.category ?? '',
      visibilityScope: item.visibilityScope,
      visibilityUserId: item.visibilityUserId ?? '',
      status: item.status,
    });
    setShowQuickReplyFormModal(true);
  }, []);

  const submitQuickReplyForm = useCallback(async () => {
    if (!canManageQuickReplies) {
      return;
    }

    const payload = {
      name: quickReplyFormState.name.trim(),
      shortcut: quickReplyFormState.shortcut.replaceAll('/', '').trim().toLowerCase(),
      content: quickReplyFormState.content.trim(),
      category: quickReplyFormState.category?.trim() ?? '',
      visibilityScope: quickReplyFormState.visibilityScope,
      visibilityUserId: quickReplyFormState.visibilityUserId?.trim() ?? '',
      status: quickReplyFormState.status,
    } satisfies SaveQuickReplyPayload;

    if (!payload.name || !payload.shortcut || !payload.content) {
      pushToast({
        tone: 'error',
        title: 'Campos obrigatorios',
        description: 'Nome, atalho e conteudo devem ser preenchidos.',
      });
      return;
    }

    if (payload.visibilityScope === 'user' && !payload.visibilityUserId) {
      pushToast({
        tone: 'error',
        title: 'Selecione o usuario',
        description: 'Respostas com visibilidade por usuario precisam de um destinatario definido.',
      });
      return;
    }

    const saved = await executeAction(async () => {
      const record = quickReplyFormMode === 'create'
        ? await createQuickReply(payload)
        : await updateQuickReply(editingQuickReplyId ?? '', payload);
      setQuickReplies((current) => [record, ...current.filter((item) => item.id !== record.id)]);
      setShowQuickReplyFormModal(false);
      setEditingQuickReplyId(null);
    }, { successMessage: quickReplyFormMode === 'create' ? 'Resposta rapida criada' : 'Resposta rapida atualizada' });

    if (saved) {
      await loadQuickRepliesList(deferredQuickReplySearch).catch(() => undefined);
      await loadComposerQuickReplies().catch(() => undefined);
    }
  }, [canManageQuickReplies, deferredQuickReplySearch, editingQuickReplyId, executeAction, loadComposerQuickReplies, loadQuickRepliesList, pushToast, quickReplyFormMode, quickReplyFormState]);

  const confirmDeleteQuickReply = useCallback(async () => {
    if (!quickReplyToDelete) {
      return;
    }

    const deleted = await executeAction(async () => {
      await deleteQuickReply(quickReplyToDelete.id);
      setQuickReplyToDelete(null);
    }, { successMessage: 'Resposta rapida excluida' });

    if (deleted) {
      await loadQuickRepliesList(deferredQuickReplySearch).catch(() => undefined);
      await loadComposerQuickReplies().catch(() => undefined);
    }
  }, [deferredQuickReplySearch, executeAction, loadComposerQuickReplies, loadQuickRepliesList, quickReplyToDelete]);

  const toggleQuickReplySelection = useCallback((id: string) => {
    setSelectedQuickReplyIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }, []);

  const toggleAllQuickReplySelections = useCallback(() => {
    setSelectedQuickReplyIds((current) => current.length === quickReplies.length ? [] : quickReplies.map((item) => item.id));
  }, [quickReplies]);

  const createSession = () => {
    if (!canManageWorkspaceSessions) {
      return;
    }

    runAction(async () => {
      const response = await authenticatedFetch(`${apiUrl}/whatsapp/sessions`, {
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
    if (!canManageWorkspaceSessions) {
      return;
    }

    runAction(async () => {
      const response = await authenticatedFetch(
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
    if (!canManageWorkspaceSessions) {
      return;
    }

    runAction(async () => {
      const response = await authenticatedFetch(
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
    const replyToMessageId = replyTargetMessage?.id;
    return executeAction(async () => {
      const response = await authenticatedFetch(
        `${apiUrl}/whatsapp/sessions/${selectedSession.id}/conversations/${selectedConversation.id}/messages`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: payload, author: 'Operador', replyToMessageId }),
        },
      );

      if (!response.ok) {
        throw new Error('Nao foi possivel enviar a mensagem.');
      }

      const createdMessage = (await response.json()) as MessageRecord;
      applyOutgoingMessageUpdate(selectedSession.id, selectedConversation.id, createdMessage);
      setReplyTargetMessage(null);

      void loadMessages(selectedSession.id, selectedConversation.id, {
        showLoading: false,
      }).catch(() => undefined);
      void loadOverview().catch(() => undefined);
    });
  }, [applyOutgoingMessageUpdate, authenticatedFetch, executeAction, loadMessages, loadOverview, replyTargetMessage, selectedConversation, selectedSession]);

  const sendMedia = useCallback(
    (file: File, options?: { sticker?: boolean; caption?: string }) => {
      if (!selectedSession || !selectedConversation) {
        return Promise.resolve(false);
      }

      const formData = new FormData();
      formData.append('file', file);
      formData.append('caption', options?.sticker ? '' : options?.caption ?? '');
      if (replyTargetMessage?.id) {
        formData.append('replyToMessageId', replyTargetMessage.id);
      }
      if (options?.sticker) {
        formData.append('sticker', 'true');
        formData.append('kind', 'sticker');
      }

      return executeAction(async () => {
        const response = await authenticatedFetch(
          `${apiUrl}/whatsapp/sessions/${selectedSession.id}/conversations/${selectedConversation.id}/media`,
          {
            method: 'POST',
            body: formData,
          },
        );

        if (!response.ok) {
          throw new Error('Nao foi possivel enviar a midia.');
        }

        const createdMessage = (await response.json()) as MessageRecord;
        applyOutgoingMessageUpdate(selectedSession.id, selectedConversation.id, createdMessage);
        setReplyTargetMessage(null);

        void loadMessages(selectedSession.id, selectedConversation.id, {
          showLoading: false,
        }).catch(() => undefined);
        void loadOverview().catch(() => undefined);
      });
    },
    [applyOutgoingMessageUpdate, authenticatedFetch, executeAction, loadMessages, loadOverview, replyTargetMessage, selectedConversation, selectedSession],
  );

  const reactToMessage = useCallback(
    (message: MessageRecord, emoji: string) => {
      if (!selectedSession || !selectedConversation || !emoji.trim()) {
        return Promise.resolve(false);
      }

      return executeAction(async () => {
        const response = await authenticatedFetch(
          `${apiUrl}/whatsapp/sessions/${selectedSession.id}/conversations/${selectedConversation.id}/reactions`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              messageId: message.id,
              emoji: emoji.trim(),
              author: 'Operador',
            }),
          },
        );

        if (!response.ok) {
          throw new Error('Nao foi possivel reagir a mensagem.');
        }

        void loadMessages(selectedSession.id, selectedConversation.id, {
          showLoading: false,
        }).catch(() => undefined);
        void loadOverview().catch(() => undefined);
      });
    },
    [authenticatedFetch, executeAction, loadMessages, loadOverview, selectedConversation, selectedSession],
  );

  if (!isAuthReady) {
    return (
      <WorkspaceBootstrapScreen
        items={[
          { label: 'Autenticacao', ready: false },
          { label: 'Workspace', ready: false },
        ]}
        subtitle="Validando credenciais e restaurando sua sessao de acesso."
        title="Entrando no workspace"
      />
    );
  }

  if (isWorkspaceBootstrapPending) {
    return (
      <WorkspaceBootstrapScreen
        items={[
          { label: 'Dashboard', ready: hasLoadedInitialOverview },
          { label: 'Kanban', ready: hasLoadedInitialContactKanban },
          { label: 'Boards', ready: hasLoadedInitialContactBoards },
          { label: 'CRM', ready: hasLoadedInitialContactCRM },
          { label: 'Equipe', ready: hasLoadedInitialUsers },
          { label: 'Quick replies', ready: hasLoadedInitialQuickReplies },
        ]}
        subtitle={`Carregando conversas, contatos e dados operacionais${authUser?.name ? ` para ${authUser.name}` : ''}.`}
        title="Preparando seu workspace"
      />
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
              {dashboardSnapshot.onlineUsers.toLocaleString('pt-BR')} operadores online acompanhando {dashboardSnapshot.recentConversations.toLocaleString('pt-BR')} conversas com atividade nas ultimas 24h.
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
                {dashboardSnapshot.teamCount.toLocaleString('pt-BR')}
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
                      {dashboardSnapshot.activeSessions.toLocaleString('pt-BR')} sessoes online · {dashboardSnapshot.onlineUsers.toLocaleString('pt-BR')} operadores ativos
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
                  <p className="font-headline text-4xl font-extrabold text-white md:text-5xl">
                    {formatDurationLabel(safeResponseVelocity.averageSeconds)}
                  </p>
                  <p
                    className={`text-xl font-bold md:text-2xl ${
                      safeResponseVelocity.deltaSeconds >= 0
                        ? 'text-[var(--secondary)]'
                        : 'text-[var(--error)]'
                    }`}
                  >
                    {formatVelocityDelta(safeResponseVelocity.deltaSeconds)}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <span className="rounded-full bg-[var(--surface-highest)] px-3 py-1.5 text-[11px] font-bold text-zinc-400">
                  Live View
                </span>
                <span className="rounded-full bg-[var(--primary)]/10 px-3 py-1.5 text-[11px] font-bold text-[var(--primary)]">
                  Target: {formatTargetLabel(safeResponseVelocity.targetSeconds)}
                </span>
              </div>
            </div>

            <DashboardResponseChart responseVelocity={safeResponseVelocity} />
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
                  actionLabel={canAccessSettings ? 'Abrir configuracoes' : 'Abrir conversas'}
                  description="Conecte uma sessao do WhatsApp e troque mensagens reais para alimentar o feed operacional ao vivo."
                  onAction={() => navigateToView(canAccessSettings ? 'settings' : 'conversations')}
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
            {canViewAnalytics ? (
              <button
                className="mt-8 w-full rounded-[1.2rem] border border-white/5 bg-[var(--surface-highest)] py-4 text-xs font-bold uppercase tracking-[0.24em] text-white transition hover:bg-white/5"
                onClick={() => navigateToView('analytics')}
                type="button"
              >
                Full Performance Audit
              </button>
            ) : null}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <ConnectivityStripItem label="WhatsApp API" status="2ms" tone="good" />
          <ConnectivityStripItem label="Meta Graph" status="14ms" tone="good" />
          <ConnectivityStripItem label="AI Engine" status="110ms" tone="good" />
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
            {canManageBoards ? (
              <button
                className="grid h-10 w-10 place-items-center rounded-full bg-[var(--primary)] text-black shadow-[0_0_20px_rgba(127,175,255,0.24)]"
                onClick={() => setShowCreateBoardModal(true)}
                type="button"
              >
                <Plus className="h-4 w-4" strokeWidth={2.6} />
              </button>
            ) : null}
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
                    {board.isCustom && canManageBoards ? (
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
                {canCreateManualContacts ? (
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
                ) : null}
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

                      {canCreateManualContacts ? (
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
                      ) : null}
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
                  Workspace Health Score
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
                      strokeDashoffset={552.92 - (analyticsModel.healthScore / 5) * 552.92}
                      strokeLinecap="round"
                      strokeWidth="12"
                      className="text-[var(--primary-fixed)] drop-shadow-[0_0_12px_rgba(100,161,255,0.6)]"
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="font-headline text-4xl font-black text-white md:text-5xl">
                      {analyticsModel.healthScore.toFixed(1)}
                    </span>
                    <span className="mt-1 text-sm font-bold text-[var(--secondary)]">
                      Resposta, fila e pipeline em tempo real
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
                    {analyticsModel.totalConversations.toLocaleString('pt-BR')} Total
                  </p>
                </div>
                <div className="flex gap-3 text-xs text-[var(--muted)]">
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[var(--primary)]" />WhatsApp {analyticsModel.channelTotals.whatsapp}</span>
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[var(--tertiary)]" />Instagram {analyticsModel.channelTotals.instagram}</span>
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[var(--secondary)]" />Facebook {analyticsModel.channelTotals.facebook}</span>
                </div>
              </div>

              <div className="flex h-48 items-end justify-between gap-4 px-4">
                {analyticsModel.weeklyChannelSeries.map((item) => (
                  <div key={item.day} className="flex-1 space-y-2">
                    <div className={`relative h-32 w-full rounded-t-lg ${item.channel === 'whatsapp' ? 'bg-[var(--primary)]/20' : item.channel === 'instagram' ? 'bg-[var(--tertiary)]/20' : 'bg-[var(--secondary)]/20'}`}>
                      <div
                        className={`absolute bottom-0 w-full rounded-t-lg transition-all duration-300 ${item.channel === 'whatsapp' ? 'bg-[var(--primary)]' : item.channel === 'instagram' ? 'bg-[var(--tertiary)]' : 'bg-[var(--secondary)]'}`}
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
                    Distribuicao real das ultimas conversas sincronizadas por dia e horario.
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
                  Recent Resolved Conversations
                </h3>
                <span className="rounded-full bg-[var(--surface-highest)] px-4 py-2 text-xs text-zinc-300">
                  {analyticsModel.resolvedTickets.length.toLocaleString('pt-BR')} itens recentes
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-[var(--surface-high)] font-medium text-[var(--muted)]">
                    <tr>
                      <th className="px-6 py-4">Ticket ID</th>
                      <th className="px-6 py-4">Customer</th>
                      <th className="px-6 py-4">Channel</th>
                      <th className="px-6 py-4">Agent</th>
                      <th className="px-6 py-4">Last Activity</th>
                      <th className="px-6 py-4">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {analyticsModel.resolvedTickets.length === 0 ? (
                      <tr>
                        <td className="px-6 py-6 text-sm text-zinc-500" colSpan={6}>
                          Nenhuma conversa resolvida apareceu ainda no pipeline atual.
                        </td>
                      </tr>
                    ) : analyticsModel.resolvedTickets.map((ticket) => (
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
                            <span className={`h-2 w-2 rounded-full ${ticket.channel === 'whatsapp' ? 'bg-[var(--secondary)]' : ticket.channel === 'instagram' ? 'bg-[var(--tertiary)]' : 'bg-[var(--primary)]'}`} />
                            <span>{ticket.channel === 'whatsapp' ? 'WhatsApp' : ticket.channel === 'instagram' ? 'Instagram' : 'Facebook'}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-white">{ticket.agent}</td>
                        <td className="px-6 py-4 text-white">{formatRelativePulse(ticket.lastActivityAt).primary}</td>
                        <td className="px-6 py-4">
                          <span className="rounded-full border border-[var(--secondary)]/20 bg-[var(--secondary)]/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--secondary)]">
                            {ticket.statusLabel}
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
              Workspace administration
            </p>
            <h2 className="font-headline mt-2 text-2xl font-semibold text-white">
              {settingsSection === 'users'
                ? 'Gerenciar usuarios do workspace'
                : settingsSection === 'quickReplies'
                  ? 'Respostas rapidas'
                  : settingsSection === 'audit'
                    ? 'Audit log'
                  : 'Conectar e gerenciar sessoes'}
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
              {settingsSection === 'users'
                ? 'Controle acessos por role sem derrubar a sessao compartilhada do WhatsApp.'
                : settingsSection === 'quickReplies'
                  ? 'Cadastre atalhos reutilizaveis para acelerar o atendimento e acione autocomplete no chat ao digitar /.'
                  : settingsSection === 'audit'
                    ? 'Acompanhe quem executou mudancas sensiveis no workspace, em que recurso e quando isso aconteceu.'
                  : 'Crie uma sessao operacional, gere QR code, reconecte numeros e acompanhe o estado da autenticacao sem sair do painel.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 rounded-full border border-white/8 bg-white/5 p-1">
              <button
                className={`rounded-full px-4 py-2 text-xs font-semibold transition ${settingsSection === 'sessions' ? 'bg-[var(--primary)] text-black' : 'text-[var(--muted)] hover:text-white'}`}
                onClick={() => setSettingsSection('sessions')}
                type="button"
              >
                Sessions
              </button>
              {isAdminUser ? (
                <button
                  className={`rounded-full px-4 py-2 text-xs font-semibold transition ${settingsSection === 'users' ? 'bg-[var(--secondary)] text-black' : 'text-[var(--muted)] hover:text-white'}`}
                  onClick={() => setSettingsSection('users')}
                  type="button"
                >
                  Users
                </button>
              ) : null}
              {canManageQuickReplies ? (
                <button
                  className={`rounded-full px-4 py-2 text-xs font-semibold transition ${settingsSection === 'quickReplies' ? 'bg-[var(--tertiary)] text-black' : 'text-[var(--muted)] hover:text-white'}`}
                  onClick={() => setSettingsSection('quickReplies')}
                  type="button"
                >
                  Quick replies
                </button>
              ) : null}
              {canViewAuditLogs ? (
                <button
                  className={`rounded-full px-4 py-2 text-xs font-semibold transition ${settingsSection === 'audit' ? 'bg-white text-black' : 'text-[var(--muted)] hover:text-white'}`}
                  onClick={() => setSettingsSection('audit')}
                  type="button"
                >
                  Audit log
                </button>
              ) : null}
            </div>
            <button
              className="rounded-full bg-white/5 px-4 py-2 text-xs text-[var(--muted)] hover:text-white"
              onClick={() => runAction(
                settingsSection === 'users'
                  ? loadWorkspaceUsers
                  : settingsSection === 'quickReplies'
                    ? () => loadQuickRepliesList(quickReplySearchTerm)
                    : settingsSection === 'audit'
                      ? loadAuditLogEntries
                      : loadOverview,
              )}
              type="button"
            >
              Refresh {settingsSection}
            </button>
          </div>
        </div>

        {settingsSection === 'audit' ? (
          canViewAuditLogs ? (
            <div className="grid gap-5 xl:grid-cols-[0.82fr_1.18fr]">
              <div className="glass-panel rounded-[30px] p-6">
                <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
                  Resumo
                </p>
                <div className="mt-5 grid gap-4 md:grid-cols-3 xl:grid-cols-1">
                  <MetricCard label="Eventos" value={auditLogs.length} detail="Ultimos registros carregados" tone="primary" compact />
                  <MetricCard label="Atores" value={new Set(auditLogs.map((item) => item.actorUserId || item.actorName || item.id)).size} detail="Usuarios distintos nesta lista" tone="secondary" compact />
                  <MetricCard label="Recursos" value={new Set(auditLogs.map((item) => item.resourceType)).size} detail="Tipos de recurso rastreados" tone="tertiary" compact />
                </div>
              </div>

              <div className="glass-panel rounded-[30px] p-6">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
                      Eventos recentes
                    </p>
                    <p className="mt-2 text-sm text-[var(--muted)]">
                      Usuario, acao, recurso e contexto operacional das ultimas mudancas sensiveis.
                    </p>
                  </div>
                  <span className="rounded-full bg-white/5 px-3 py-1 text-[11px] text-[var(--muted)]">
                    60 ultimos
                  </span>
                </div>

                <div className="mt-5 space-y-3">
                  {isLoadingAuditLogs ? <StackSkeleton rows={4} /> : null}
                  {!isLoadingAuditLogs && auditLogs.length === 0 ? (
                    <EmptyStateCard
                      description="Assim que uma acao sensivel acontecer, ela passa a aparecer aqui com usuario, recurso e horario."
                      title="Nenhum evento auditado ainda"
                    />
                  ) : null}
                  {!isLoadingAuditLogs ? auditLogs.map((entry) => (
                    <div key={entry.id} className="rounded-[24px] border border-white/8 bg-white/4 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-white">{entry.summary}</p>
                          <p className="mt-1 text-xs text-[var(--muted)]">
                            {entry.actorName || 'Usuario desconhecido'} · {entry.actorRole ? formatRoleLabel(entry.actorRole) : 'Sem role'}
                          </p>
                        </div>
                        <span className="rounded-full bg-white/5 px-3 py-1 text-[11px] text-[var(--muted)]">
                          {formatTimestamp(entry.createdAt)}
                        </span>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-zinc-400">
                        <span className="rounded-full bg-white/5 px-2.5 py-1">acao {entry.action}</span>
                        <span className="rounded-full bg-white/5 px-2.5 py-1">recurso {entry.resourceType}</span>
                        {entry.resourceId ? <span className="rounded-full bg-white/5 px-2.5 py-1">id {entry.resourceId}</span> : null}
                        {entry.remoteAddr ? <span className="rounded-full bg-white/5 px-2.5 py-1">ip {entry.remoteAddr}</span> : null}
                      </div>

                      {entry.details && Object.keys(entry.details).length > 0 ? (
                        <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-zinc-300">
                          {Object.entries(entry.details).slice(0, 6).map(([key, value]) => (
                            <span key={key} className="rounded-full border border-white/8 bg-black/10 px-2.5 py-1">
                              {formatAuditDetailLabel(key)} {formatAuditDetailValue(value)}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  )) : null}
                </div>
              </div>
            </div>
          ) : (
            <EmptyStateCard
              description="Apenas administradores e supervisores podem consultar o historico de auditoria."
              title="Acesso restrito"
            />
          )
        ) : settingsSection === 'quickReplies' ? (
          canManageQuickReplies ? (
            <QuickRepliesSettingsPanel
              isLoading={isLoadingQuickReplies}
              items={quickReplies}
              onDelete={setQuickReplyToDelete}
              onEdit={openEditQuickReplyModal}
              onOpenCreate={openCreateQuickReplyModal}
              onPreview={setPreviewQuickReply}
              onSearchChange={setQuickReplySearchTerm}
              onToggleAll={toggleAllQuickReplySelections}
              onToggleSelection={toggleQuickReplySelection}
              searchTerm={quickReplySearchTerm}
              selectedIds={selectedQuickReplyIds}
              users={workspaceUsers}
            />
          ) : (
            <EmptyStateCard
              description="Apenas administradores e supervisores podem gerenciar respostas rapidas."
              title="Acesso restrito"
            />
          )
        ) : settingsSection === 'users' ? (
          isAdminUser ? (
            <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
              <div className="space-y-6">
                <div className="glass-panel rounded-[30px] p-6">
                  <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
                    Create user
                  </p>
                  <div className="mt-5 space-y-3">
                    <Field
                      onChange={(value) => setNewUserForm((current) => ({ ...current, name: value }))}
                      placeholder="Nome exibido"
                      value={newUserForm.name}
                    />
                    <Field
                      onChange={(value) => setNewUserForm((current) => ({ ...current, email: value }))}
                      placeholder="Email de acesso"
                      value={newUserForm.email}
                    />
                    <Field
                      onChange={(value) => setNewUserForm((current) => ({ ...current, password: value }))}
                      placeholder="Senha inicial"
                      type="password"
                      value={newUserForm.password}
                    />
                    <RoleSelector
                      onChange={(role) => setNewUserForm((current) => ({ ...current, role }))}
                      value={newUserForm.role}
                    />
                    <button
                      className="w-full rounded-2xl bg-[linear-gradient(135deg,#7fafff,#64a1ff)] px-4 py-3 text-sm font-semibold text-black"
                      onClick={() => void submitNewUser()}
                      type="button"
                    >
                      Criar usuario
                    </button>
                  </div>
                </div>
              </div>

              <div className="space-y-6">
                <div className="glass-panel rounded-[30px] p-6">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
                      Workspace users
                    </p>
                    <span className="rounded-full bg-white/5 px-3 py-1 text-[11px] text-[var(--muted)]">
                      {workspaceUsers.length} usuarios
                    </span>
                  </div>

                  <div className="mt-5 space-y-3">
                    {isLoadingUsers ? <StackSkeleton rows={4} /> : null}
                    {!isLoadingUsers && workspaceUsers.length === 0 ? (
                      <EmptyStateCard
                        description="O primeiro administrador ja pode criar supervisores e atendentes aqui."
                        title="Nenhum usuario adicional ainda"
                      />
                    ) : null}

                    {!isLoadingUsers ? workspaceUsers.map((user) => {
                      const editing = editingUserId === user.id;
                      const userSessions = workspaceUserSessionsMap[user.id] ?? [];
                      const sessionsExpanded = expandedUserSessionsId === user.id;
                      const isLoadingSessions = Boolean(loadingUserSessionsMap[user.id]);

                      return (
                        <div key={user.id} className="rounded-[24px] border border-white/8 bg-white/4 p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="text-base font-semibold text-white">{user.name}</p>
                              <p className="mt-1 text-sm text-[var(--muted)]">{user.email}</p>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] ${user.isActive ? 'bg-[var(--secondary)]/14 text-[var(--secondary)]' : 'bg-rose-500/14 text-rose-300'}`}>
                                {user.isActive ? 'ativo' : 'inativo'}
                              </span>
                              <span className="rounded-full bg-[var(--primary)]/12 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--primary)]">
                                {formatRoleLabel(user.role)}
                              </span>
                            </div>
                          </div>

                          <p className="mt-3 text-xs text-[var(--muted)]">
                            Ultimo login: {user.lastLoginAt ? formatTimestamp(user.lastLoginAt) : 'ainda sem login'}
                          </p>

                          <div className="mt-4 rounded-[20px] border border-white/8 bg-black/10 px-3 py-3">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div>
                                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500">
                                  Sessoes ativas
                                </p>
                                <p className="mt-1 text-sm text-zinc-300">
                                  {userSessions.length > 0
                                    ? `${userSessions.length} sessoes carregadas`
                                    : 'Carregue as sessoes deste usuario para revisar acessos ativos.'}
                                </p>
                              </div>
                              <button
                                className="rounded-full bg-white/6 px-4 py-2 text-sm text-zinc-300 transition hover:bg-white/10 hover:text-white"
                                onClick={() => toggleUserSessions(user.id)}
                                type="button"
                              >
                                {sessionsExpanded ? 'Ocultar sessoes' : 'Ver sessoes'}
                              </button>
                            </div>

                            {sessionsExpanded ? (
                              <div className="mt-3 space-y-2">
                                {isLoadingSessions ? <StackSkeleton rows={2} /> : null}
                                {!isLoadingSessions && userSessions.length === 0 ? (
                                  <div className="rounded-[18px] border border-dashed border-white/8 px-3 py-4 text-sm text-zinc-500">
                                    Nenhuma sessao ativa encontrada para este usuario.
                                  </div>
                                ) : null}
                                {!isLoadingSessions ? userSessions.map((session) => (
                                  <div key={session.id} className="rounded-[18px] border border-white/8 bg-white/[0.03] px-3 py-3">
                                    <div className="flex flex-wrap items-start justify-between gap-3">
                                      <div className="min-w-0 flex-1">
                                        <p className="truncate text-sm font-semibold text-white">
                                          {formatSessionUserAgent(session.userAgent)}
                                        </p>
                                        <p className="mt-1 truncate text-xs text-zinc-500">
                                          {session.remoteAddr || 'IP indisponivel'}
                                        </p>
                                      </div>
                                      <button
                                        className="rounded-full bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/15"
                                        onClick={() => {
                                          void revokeWorkspaceUserSession(user.id, session.id);
                                        }}
                                        type="button"
                                      >
                                        Revogar
                                      </button>
                                    </div>
                                    <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-zinc-500">
                                      <span className="rounded-full bg-white/5 px-2.5 py-1">
                                        Ultima atividade {formatTimestamp(session.lastSeenAt)}
                                      </span>
                                      <span className="rounded-full bg-white/5 px-2.5 py-1">
                                        Expira {formatTimestamp(session.expiresAt)}
                                      </span>
                                    </div>
                                  </div>
                                )) : null}
                              </div>
                            ) : null}
                          </div>

                          {editing ? (
                            <div className="mt-4 space-y-3">
                              <Field
                                onChange={(value) => setEditingUserForm((current) => ({ ...current, name: value }))}
                                placeholder="Nome"
                                value={editingUserForm.name}
                              />
                              <Field
                                onChange={(value) => setEditingUserForm((current) => ({ ...current, password: value }))}
                                placeholder="Nova senha (opcional)"
                                type="password"
                                value={editingUserForm.password}
                              />
                              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
                                <RoleSelector
                                  onChange={(role) => setEditingUserForm((current) => ({ ...current, role }))}
                                  value={editingUserForm.role}
                                />
                                <label className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white">
                                  <input
                                    checked={editingUserForm.isActive}
                                    onChange={(event) => setEditingUserForm((current) => ({ ...current, isActive: event.target.checked }))}
                                    type="checkbox"
                                  />
                                  Ativo
                                </label>
                              </div>
                              <div className="flex flex-wrap gap-3">
                                <button
                                  className="rounded-full bg-[linear-gradient(135deg,#7fafff,#64a1ff)] px-4 py-2 text-sm font-semibold text-black"
                                  onClick={() => void submitUserUpdate()}
                                  type="button"
                                >
                                  Salvar usuario
                                </button>
                                <button
                                  className="rounded-full bg-white/5 px-4 py-2 text-sm text-[var(--muted)] hover:text-white"
                                  onClick={() => setEditingUserId(null)}
                                  type="button"
                                >
                                  Cancelar
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="mt-4 flex flex-wrap gap-3">
                              <button
                                className="rounded-full bg-white/5 px-4 py-2 text-sm text-[var(--muted)] hover:text-white"
                                onClick={() => startEditingUser(user)}
                                type="button"
                              >
                                Editar usuario
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    }) : null}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <EmptyStateCard
              description="Apenas administradores podem gerenciar usuarios do workspace."
              title="Acesso restrito"
            />
          )
        ) : (
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
                      <MetricCard label="Unread" value={selectedSession.unread} detail="Mensagens pendentes" tone="primary" compact />
                      <MetricCard label="Waiting" value={selectedSession.waiting} detail="Conversas na fila" tone="tertiary" compact />
                      <MetricCard label="Attendants" value={selectedSession.attendants} detail="Atendentes vinculados" tone="secondary" compact />
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
        )}
      </div>
    </section>
  );

  const renderConversationsView = () => (
    <div className="grid min-h-0 flex-1 overflow-hidden grid-cols-1 xl:grid-cols-[19rem_minmax(0,1fr)] 2xl:grid-cols-[19rem_minmax(0,1fr)_17rem]">
      <section className="min-h-0 overflow-hidden border-r border-white/5 bg-[var(--surface-low)]/35 px-3 py-4">
        <div className="mb-4 flex items-center justify-between px-1">
          <div>
            <h2 className="font-headline text-xl font-bold text-white">Conversas</h2>
            <p className="mt-1 text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">
              {queueLabel}
            </p>
          </div>
          <button
            className="rounded-full bg-white/5 px-3 py-1.5 text-[11px] text-[var(--muted)] hover:text-white"
            onClick={() => runAction(loadOverview)}
            type="button"
          >
            Atualizar
          </button>
        </div>

        <div className="mb-4 rounded-[24px] border border-white/6 bg-white/[0.03] p-3">
          <div className="flex items-center justify-between gap-3 px-1">
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
              Filtros da fila
            </span>
            {conversationSearchTerm ? (
              <span className="rounded-full bg-[var(--primary)]/10 px-2.5 py-1 text-[10px] font-semibold text-[var(--primary)]">
                  {visibleSessionConversations.length} resultado{visibleSessionConversations.length === 1 ? '' : 's'}
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
                        messageLookup={messagesById}
                        onReact={reactToMessage}
                        onReply={setReplyTargetMessage}
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
                key={`${selectedSession.id}:${selectedConversation?.id ?? 'none'}:${authUser?.id ?? 'guest'}`}
                defaultSignatureName={authUser?.name ?? 'Operador'}
                disabled={!selectedConversation || isPending}
                onCancelReply={() => setReplyTargetMessage(null)}
                onQuickReplySearch={(query) => {
                  void loadComposerQuickReplies(query).catch(() => undefined);
                }}
                onSendMedia={sendMedia}
                onSend={sendMessage}
                quickReplies={composerQuickReplyResults}
                quickRepliesLoading={isLoadingComposerQuickReplies}
                replyToMessage={replyTargetMessage}
                signatureStorageKey={`pulse-hub.composer-signature:${authUser?.id ?? 'guest'}`}
              />
            </div>
          </>
        ) : (
          <div className="grid flex-1 place-items-center p-6">
            <div className="space-y-4 text-center">
              <EmptyStateCard
                actionLabel={canAccessSettings ? 'Abrir configuracoes' : 'Voltar ao dashboard'}
                description="Crie ou restaure uma sessao do WhatsApp para liberar a lista de conversas e a timeline operacional."
                onAction={() => navigateToView(canAccessSettings ? 'settings' : 'dashboard')}
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

            <ProfileSection title="Dados do contato">
              <ProfileRow label="Email" value={contactInfo.email} />
              <ProfileRow label="Telefone" value={contactInfo.phone} />
              <ProfileRow label="Sessao" value={selectedSession.name} />
            </ProfileSection>

            <ProfileSection title="Marcadores do contato">
              <div className="flex flex-wrap gap-2">
                <Tag tone="primary">{selectedConversation.channelName}</Tag>
                <Tag tone="tertiary">{selectedConversation.status}</Tag>
                <Tag tone="neutral">{selectedConversation.owner}</Tag>
              </div>
            </ProfileSection>

            <ProfileSection title="Historico da conversa">
              <div className="space-y-4">
                <MiniTimelineItem
                  label="Thread atual no WhatsApp"
                  meta={formatDateLabel(selectedConversation.lastMessageAt)}
                  tone="primary"
                />
                <MiniTimelineItem
                  label="Sessao em tempo real"
                  meta={statusLabel[selectedSession.status]}
                  tone="secondary"
                />
              </div>
            </ProfileSection>

            {canManageWorkspaceSessions ? (
              <ProfileSection title="Controle da sessao">
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
                    Gerar QR / reconectar
                  </button>
                  <button
                    className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[var(--surface-highest)] px-4 py-3 text-sm font-semibold text-white"
                    onClick={() => disconnectSession(selectedSession.id)}
                    type="button"
                  >
                    <Wifi className="h-4 w-4" strokeWidth={2.1} />
                    Desconectar sessao
                  </button>
                </div>
              </ProfileSection>
            ) : null}

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
      {showQuickReplyFormModal ? (
        <QuickReplyFormModal
          isBusy={isPending}
          mode={quickReplyFormMode}
          onChange={setQuickReplyFormState}
          onClose={() => setShowQuickReplyFormModal(false)}
          onSubmit={() => {
            void submitQuickReplyForm();
          }}
          users={workspaceUsers.filter((user) => user.isActive)}
          value={quickReplyFormState}
        />
      ) : null}
      {previewQuickReply ? (
        <QuickReplyPreviewModal
          item={previewQuickReply}
          onClose={() => setPreviewQuickReply(null)}
          users={workspaceUsers}
        />
      ) : null}
      {quickReplyToDelete ? (
        <QuickReplyDeleteModal
          isBusy={isPending}
          item={quickReplyToDelete}
          onClose={() => setQuickReplyToDelete(null)}
          onConfirm={() => {
            void confirmDeleteQuickReply();
          }}
        />
      ) : null}
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
            {availableNavigationItems.map(({ id, label, icon: Icon }, index) => (
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
              aria-label="Acoes rapidas"
              className="mb-4 flex w-full items-center justify-center rounded-xl bg-[var(--primary-container)] px-3 py-3 text-[var(--on-primary-container)] transition-transform active:scale-95"
              onClick={() => navigateToView(selectedSession ? 'conversations' : canAccessSettings ? 'settings' : 'dashboard')}
              title="Acoes rapidas"
              type="button"
            >
              <MessageSquarePlus className="h-4 w-4" strokeWidth={2.2} />
            </button>
            {canAccessSettings ? (
              <button
                aria-label="Ajuda"
                className="flex w-full items-center justify-center rounded-xl px-3 py-3 text-zinc-500 transition-all hover:bg-zinc-800/50 hover:text-zinc-300"
                onClick={() => navigateToView('settings')}
                title="Ajuda"
                type="button"
              >
                <CircleHelp className="h-5 w-5" strokeWidth={2.1} />
              </button>
            ) : null}
            <button
              aria-label="Sair"
              className="flex w-full items-center justify-center rounded-xl px-3 py-3 text-[var(--error-dim)] transition-all hover:bg-white/5"
              onClick={signOut}
              title="Sair"
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
                Pulse Hub
              </span>
              <div className="hidden items-center gap-3 rounded-full border border-white/5 bg-white/5 px-4 py-1.5 transition-all duration-300 focus-within:border-[var(--primary)]/50 lg:flex">
                <Search className="h-4 w-4 text-zinc-400" strokeWidth={2.1} />
                <input
                  ref={globalSearchInputRef}
                  className="w-80 border-none bg-transparent text-sm text-white outline-none placeholder:text-zinc-500"
                  onChange={(event) => setGlobalSearch(event.target.value)}
                  placeholder="Buscar contatos, conversas ou responsaveis..."
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
                <span className="text-sm">Acoes</span>
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

function DashboardResponseChart({
  responseVelocity,
}: {
  responseVelocity?: DashboardOverview['analytics']['responseVelocity'] | null;
}) {
  const safeResponseVelocity = normalizeResponseVelocityAnalytics(responseVelocity);
  const chartPoints = safeResponseVelocity.points.length > 0
    ? safeResponseVelocity.points
    : [
        { label: '08:00 AM', averageSeconds: safeResponseVelocity.averageSeconds },
        { label: '10:00 AM', averageSeconds: safeResponseVelocity.averageSeconds },
        { label: '12:00 PM', averageSeconds: safeResponseVelocity.averageSeconds },
        { label: '02:00 PM', averageSeconds: safeResponseVelocity.averageSeconds },
        { label: '04:00 PM', averageSeconds: safeResponseVelocity.averageSeconds },
        { label: '06:00 PM', averageSeconds: safeResponseVelocity.averageSeconds },
      ];
  const maxSeconds = Math.max(...chartPoints.map((point) => point.averageSeconds), safeResponseVelocity.targetSeconds, 1);
  const minSeconds = Math.min(...chartPoints.map((point) => point.averageSeconds), safeResponseVelocity.targetSeconds, 1);
  const step = chartPoints.length > 1 ? 400 / (chartPoints.length - 1) : 400;
  const linePath = chartPoints
    .map((point, index) => {
      const x = index * step;
      const normalized = maxSeconds === minSeconds
        ? 0.5
        : (point.averageSeconds - minSeconds) / (maxSeconds - minSeconds);
      const y = 84 - normalized * 54;
      return `${index === 0 ? 'M' : 'L'}${x},${y}`;
    })
    .join(' ');
  const areaPath = `${linePath} L400,100 L0,100 Z`;
  const peakIndex = chartPoints.reduce((bestIndex, point, index, items) =>
    point.averageSeconds < items[bestIndex].averageSeconds ? index : bestIndex,
  0);
  const peakX = peakIndex * step;
  const peakNormalized = maxSeconds === minSeconds
    ? 0.5
    : (chartPoints[peakIndex].averageSeconds - minSeconds) / (maxSeconds - minSeconds);
  const peakY = 84 - peakNormalized * 54;

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
            d={linePath}
            fill="none"
            stroke="#7fafff"
            strokeLinecap="round"
            strokeWidth="4"
          />
          <path
            d={areaPath}
            fill="url(#dashboardChartGradient)"
          />
          <circle cx={peakX} cy={peakY} fill="#7fafff" r="5" stroke="#0e0e0e" strokeWidth="2" />
        </svg>
        <div className="absolute left-1/2 top-4 -translate-x-1/2 rounded-lg border border-white/10 bg-[var(--surface-highest)] px-3 py-1 text-[10px] font-bold text-white">
          <span className="mr-2 inline-block h-2 w-2 rounded-full bg-[var(--primary)]" />
          Peak Efficiency: {safeResponseVelocity.peakLabel}
        </div>
      </div>
      <div className="mt-4 flex justify-between text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-600">
        {chartPoints.map((point) => (
          <span key={point.label}>{point.label}</span>
        ))}
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
    volume: number;
    volumeLabel: string;
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
        <p className="text-xs font-bold text-white">{performer.score}% health</p>
        <p className="text-[10px] text-zinc-500">{performer.volume} {performer.volumeLabel}</p>
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
      label: 'Visao geral',
      detail: 'Carregando sinais da operacao e feed em tempo real...',
      icon: Home,
    },
    conversations: {
      label: 'Conversas',
      detail: 'Hidratando filas, timeline e estado do atendimento...',
      icon: MessageCircle,
    },
    contacts: {
      label: 'Contatos',
      detail: 'Montando CRM, filtros e perfis dos contatos...',
      icon: ContactRound,
    },
    analytics: {
      label: 'Analytics',
      detail: 'Calculando estatisticas e organizando a leitura operacional...',
      icon: BarChart3,
    },
    settings: {
      label: 'Configuracoes',
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
                Carregando workspace
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

function WorkspaceBootstrapScreen({
  title,
  subtitle,
  items,
}: {
  title: string;
  subtitle: string;
  items: Array<{ label: string; ready: boolean }>;
}) {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_top,rgba(127,175,255,0.14),transparent_38%),linear-gradient(180deg,#050505_0%,#111111_100%)] px-6 text-white">
      <div className="absolute inset-0 bg-[linear-gradient(120deg,transparent_0%,rgba(255,255,255,0.03)_26%,transparent_52%)] opacity-60" />
      <div className="relative w-full max-w-4xl overflow-hidden rounded-[2.2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(25,28,34,0.92),rgba(15,16,20,0.96))] p-8 shadow-[0_30px_90px_-46px_rgba(0,0,0,0.95)] backdrop-blur-2xl md:p-10">
        <div className="absolute -right-16 top-0 h-44 w-44 rounded-full bg-[var(--primary)]/10 blur-[80px]" />
        <div className="absolute -left-16 bottom-0 h-44 w-44 rounded-full bg-[var(--secondary)]/10 blur-[80px]" />
        <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.04),transparent_34%,transparent_66%,rgba(255,255,255,0.02))] opacity-70" />

        <div className="relative">
          <div className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
            <div className="max-w-2xl">
              <div className="flex items-center gap-3 text-[11px] font-bold uppercase tracking-[0.28em] text-[var(--primary)]">
                <span className="h-2.5 w-2.5 rounded-full bg-[var(--primary)] shadow-[0_0_14px_rgba(127,175,255,0.85)]" />
                Pulse Hub
              </div>
              <h1 className="font-headline mt-5 text-3xl font-semibold text-white md:text-5xl">{title}</h1>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-zinc-400 md:text-base">{subtitle}</p>
            </div>

            <div className="flex justify-center md:justify-end">
              <div className="relative grid h-28 w-28 place-items-center rounded-full border border-white/10 bg-white/[0.03] shadow-[inset_0_0_40px_rgba(255,255,255,0.03)] md:h-32 md:w-32">
                <div className="absolute h-24 w-24 rounded-full border border-[var(--primary)]/12 bg-[radial-gradient(circle,rgba(127,175,255,0.14),transparent_68%)] blur-sm md:h-28 md:w-28" />
                <div className="absolute h-20 w-20 animate-spin rounded-full border-[3px] border-white/8 border-t-[var(--primary)] border-r-[var(--primary)] md:h-24 md:w-24" />
                <div className="absolute h-12 w-12 rounded-full border border-white/10 bg-[rgba(8,10,14,0.94)] shadow-[0_0_26px_rgba(0,0,0,0.45)] md:h-14 md:w-14" />
                <div className="absolute h-2.5 w-2.5 rounded-full bg-[var(--primary)] shadow-[0_0_16px_rgba(127,175,255,0.8)]" />
                <span className="absolute -bottom-3 rounded-full border border-white/10 bg-[rgba(10,12,16,0.92)] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">
                  Syncing
                </span>
              </div>
            </div>
          </div>

          <div className="mt-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((item) => (
              <div
                key={item.label}
                className={`rounded-[1.45rem] border px-4 py-4 transition ${item.ready ? 'border-[var(--secondary)]/20 bg-[linear-gradient(135deg,rgba(93,253,138,0.12),rgba(93,253,138,0.06))] text-[var(--secondary)] shadow-[inset_0_0_0_1px_rgba(93,253,138,0.06)]' : 'border-white/8 bg-[linear-gradient(135deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))] text-zinc-300'}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <span className="text-sm font-medium text-white">{item.label}</span>
                    <p className="mt-1 text-xs text-zinc-500">
                      {item.ready ? 'Camada pronta para uso' : 'Sincronizando dados iniciais'}
                    </p>
                  </div>
                  <span className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] ${item.ready ? 'bg-[var(--secondary)]/14 text-[var(--secondary)]' : 'bg-white/6 text-zinc-400'}`}>
                    {item.ready ? (
                      <>
                        <span className="h-1.5 w-1.5 rounded-full bg-current" />
                        ok
                      </>
                    ) : (
                      <>
                        <span className="h-3 w-3 animate-spin rounded-full border border-white/20 border-t-[var(--primary)]" />
                        loading
                      </>
                    )}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-8 flex flex-wrap items-center justify-between gap-3 rounded-[1.35rem] border border-white/8 bg-black/20 px-4 py-4">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500">Workspace Bootstrap</p>
              <p className="mt-1 text-sm text-zinc-400">Mantendo a entrada do operador fluida enquanto o workspace hidrata conversas e CRM.</p>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full bg-white/6 px-3 py-2 text-[11px] font-medium text-zinc-300">
              <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--primary)]" />
              Inicializando ambiente
            </div>
          </div>
        </div>
      </div>
    </main>
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
                    : formatParticipantReference(contact.participantId)}
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
  defaultSignatureName,
  disabled,
  onQuickReplySearch,
  onSend,
  onSendMedia,
  onCancelReply,
  quickReplies,
  quickRepliesLoading,
  replyToMessage,
  signatureStorageKey,
}: {
  defaultSignatureName: string;
  disabled: boolean;
  onQuickReplySearch: (query: string) => void;
  onSend: (text: string) => Promise<boolean>;
  onSendMedia: (file: File, options?: { sticker?: boolean; caption?: string }) => Promise<boolean>;
  onCancelReply: () => void;
  quickReplies: QuickReplyRecord[];
  quickRepliesLoading: boolean;
  replyToMessage: MessageRecord | null;
  signatureStorageKey: string;
}) {
  const initialSignaturePreference = useMemo(
    () => readComposerSignaturePreference(signatureStorageKey, defaultSignatureName),
    [defaultSignatureName, signatureStorageKey],
  );
  const [draft, setDraft] = useState('');
  const [signatureEnabled, setSignatureEnabled] = useState(initialSignaturePreference.enabled);
  const [signatureName, setSignatureName] = useState(initialSignaturePreference.name);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showAttachmentMenu, setShowAttachmentMenu] = useState(false);
  const [selectedAttachment, setSelectedAttachment] = useState<ComposerAttachment | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isSendingText, setIsSendingText] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isComposerFocused, setIsComposerFocused] = useState(false);
  const [quickReplyActiveIndex, setQuickReplyActiveIndex] = useState(0);
  const mediaInputRef = useRef<HTMLInputElement | null>(null);
  const stickerInputRef = useRef<HTMLInputElement | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);

  const composerBusy = disabled || isSendingText || isUploading;
  const slashContext = useMemo(() => getQuickReplySlashContext(draft), [draft]);
  const slashAutocompleteOpen = Boolean(slashContext) && !composerBusy && isComposerFocused;

  useEffect(() => {
    if (!slashAutocompleteOpen || !slashContext) {
      return;
    }

    onQuickReplySearch(slashContext.query);
  }, [onQuickReplySearch, slashAutocompleteOpen, slashContext]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(
      signatureStorageKey,
      JSON.stringify({
        enabled: signatureEnabled,
        name: signatureName.trim() || defaultSignatureName.trim() || 'Operador',
      }),
    );
  }, [defaultSignatureName, signatureEnabled, signatureName, signatureStorageKey]);

  useLayoutEffect(() => {
    const composer = composerInputRef.current;
    if (!composer) {
      return;
    }

    composer.style.height = '0px';
    composer.style.height = `${Math.min(composer.scrollHeight, 224)}px`;
  }, [draft]);

  const clearAttachment = useCallback(() => {
    setSelectedAttachment((current) => {
      if (current?.previewUrl) {
        URL.revokeObjectURL(current.previewUrl);
      }
      return null;
    });
  }, []);

  const applySignature = useCallback(
    (value: string) => {
      const trimmedValue = value.trim();
      if (!trimmedValue) {
        return '';
      }

      const trimmedSignature = signatureName.trim();
      if (!signatureEnabled || !trimmedSignature) {
        return trimmedValue;
      }

      return `*${trimmedSignature}:*\n${trimmedValue}`;
    },
    [signatureEnabled, signatureName],
  );

  const insertQuickReply = useCallback(
    (reply: QuickReplyRecord) => {
      const content = reply.content.trim();
      if (!content) {
        return;
      }

      setDraft((current) => {
        const context = getQuickReplySlashContext(current);
        if (!context) {
          return appendQuickReplyContent(current, content);
        }

        const before = current.slice(0, context.start);
        const after = current.slice(context.end);
        return `${before}${content}${after}`;
      });
      setQuickReplyActiveIndex(0);

      window.requestAnimationFrame(() => {
        composerInputRef.current?.focus();
      });
    },
    [],
  );

  const handleDraftChange = useCallback((value: string) => {
    setQuickReplyActiveIndex(0);
    setDraft(value);
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
        caption: selectedAttachment.sticker ? '' : applySignature(draft),
      });
      setIsUploading(false);

      if (sent) {
        clearAttachment();
        setDraft('');
      }
      return;
    }

    const payload = applySignature(draft);
    if (!payload) {
      return;
    }

    setIsSendingText(true);
    const sent = await onSend(payload);
    setIsSendingText(false);
    if (sent) {
      setDraft('');
    }
  }, [applySignature, clearAttachment, composerBusy, draft, onSend, onSendMedia, selectedAttachment]);

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

      {replyToMessage ? (
        <div className="mb-3 overflow-hidden rounded-[24px] border border-[var(--primary)]/18 bg-[var(--surface-high)] px-3 py-3 shadow-[0_18px_36px_-24px_rgba(0,0,0,0.9)]">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1 border-l-2 border-[var(--primary)]/55 pl-3">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--primary)]">
                Respondendo {replyToMessage.direction === 'outgoing' ? 'voce' : replyToMessage.author}
              </p>
              <p className="mt-1 line-clamp-2 text-sm text-zinc-300">
                {summarizeMessageForReply(replyToMessage)}
              </p>
            </div>
            <button
              aria-label="Cancelar resposta"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/5 text-[var(--muted)] transition hover:bg-white/10 hover:text-white"
              disabled={composerBusy}
              onClick={onCancelReply}
              type="button"
            >
              <X className="h-4 w-4" strokeWidth={2.1} />
            </button>
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

      <div className="relative">
        <QuickReplyAutocomplete
          activeIndex={quickReplyActiveIndex}
          isLoading={quickRepliesLoading}
          items={quickReplies}
          onHover={setQuickReplyActiveIndex}
          onSelect={insertQuickReply}
          open={slashAutocompleteOpen}
          query={slashContext?.query ?? ''}
        />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-3 rounded-[24px] border border-white/10 bg-[var(--surface-high)] px-3 py-3 shadow-[0_18px_36px_-24px_rgba(0,0,0,0.9)]">
        <button
          aria-pressed={signatureEnabled}
          className={`relative inline-flex h-7 w-12 items-center rounded-full border transition ${signatureEnabled ? 'border-[var(--primary)]/40 bg-[var(--primary)]/20' : 'border-white/10 bg-white/5'}`}
          disabled={composerBusy}
          onClick={() => setSignatureEnabled((current) => !current)}
          type="button"
        >
          <span
            className={`ml-1 block h-5 w-5 rounded-full transition ${signatureEnabled ? 'translate-x-5 bg-[var(--primary)]' : 'translate-x-0 bg-zinc-400'}`}
          />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
            Assinatura do operador
          </p>
          <div className="mt-2">
            <input
              className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white outline-none transition focus:border-[var(--primary)]/40"
              disabled={composerBusy}
              onChange={(event) => setSignatureName(event.target.value)}
              placeholder="Nome da assinatura"
              value={signatureName}
            />
          </div>
        </div>
      </div>

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
        <textarea
          ref={composerInputRef}
          className="max-h-56 min-h-[24px] flex-1 resize-none overflow-y-auto bg-transparent py-1 text-sm leading-6 text-white outline-none placeholder:text-zinc-500"
          disabled={composerBusy}
          onChange={(event) => handleDraftChange(event.target.value)}
          onBlur={() => setIsComposerFocused(false)}
          onFocus={() => setIsComposerFocused(true)}
          onKeyDown={(event) => {
            if (slashAutocompleteOpen && quickReplies.length > 0) {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setQuickReplyActiveIndex((current) => (current + 1) % quickReplies.length);
                return;
              }

              if (event.key === 'ArrowUp') {
                event.preventDefault();
                setQuickReplyActiveIndex((current) => (current - 1 + quickReplies.length) % quickReplies.length);
                return;
              }

              if ((event.key === 'Enter' || event.key === 'Tab') && !event.nativeEvent.isComposing) {
                event.preventDefault();
                const selectedQuickReply = quickReplies[quickReplyActiveIndex] ?? quickReplies[0];
                if (selectedQuickReply) {
                  insertQuickReply(selectedQuickReply);
                }
                return;
              }

              if (event.key === 'Escape') {
                event.preventDefault();
                setDraft((current) => removeQuickReplySlashQuery(current));
                return;
              }
            }

            if (event.key === 'Enter' && event.shiftKey) {
              return;
            }

            if (event.key !== 'Enter' || event.nativeEvent.isComposing) {
              return;
            }

            event.preventDefault();
            void submit();
          }}
          placeholder={disabled ? 'Selecione uma conversa...' : selectedAttachment ? 'Adicione uma legenda opcional...' : 'Digite uma mensagem...'}
          rows={1}
          value={draft}
        />
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
  messageLookup,
  onReact,
  onReply,
}: {
  message: MessageRecord;
  avatarUrl?: string | null;
  conversation?: ConversationRecord;
  isUnread?: boolean;
  messageLookup: Map<string, MessageRecord>;
  onReact: (message: MessageRecord, emoji: string) => Promise<boolean>;
  onReply: (message: MessageRecord) => void;
}) {
  const incoming = message.direction !== 'outgoing';
  const showGroupAuthor = shouldShowGroupMessageAuthor(message, conversation);
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const reactionPickerRef = useRef<HTMLDivElement | null>(null);
  const repliedMessage = message.replyTo ? messageLookup.get(message.replyTo.messageId) : undefined;
  const replyAuthor = repliedMessage
    ? repliedMessage.direction === 'outgoing'
      ? 'Voce'
      : repliedMessage.author
    : normalizeReplyAuthor(message.replyTo?.author);
  const replyPreview = repliedMessage
    ? summarizeMessageForReply(repliedMessage)
    : summarizeReplyRecord(message.replyTo);

  useEffect(() => {
    if (!showReactionPicker) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (reactionPickerRef.current?.contains(event.target as Node)) {
        return;
      }

      setShowReactionPicker(false);
    };

    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [showReactionPicker]);

  const bubbleBody = (
    <div
      className={`group relative ${incoming
        ? `glass-panel rounded-[26px] rounded-tl-none px-5 py-4 ${
            isUnread ? 'ring-1 ring-[var(--secondary)]/35 shadow-[0_0_0_1px_rgba(93,253,138,0.08)]' : ''
          }`
        : 'rounded-[26px] rounded-tr-none border border-[rgba(127,175,255,0.2)] bg-[linear-gradient(180deg,rgba(100,161,255,0.16),rgba(100,161,255,0.08))] px-5 py-4 shadow-[inset_0_0_18px_rgba(127,175,255,0.08)]'}`}
    >
      <div
        ref={reactionPickerRef}
        className={`absolute top-3 z-10 flex items-center gap-2 ${incoming ? 'right-3' : 'left-3'}`}
      >
        {showReactionPicker ? (
          <div className="flex items-center gap-1 rounded-full border border-white/10 bg-[rgba(10,14,18,0.96)] px-2 py-2 shadow-[0_20px_36px_-20px_rgba(0,0,0,0.95)]">
            {messageReactionOptions.map((emoji) => (
              <button
                key={`${message.id}:${emoji}`}
                className="grid h-8 w-8 place-items-center rounded-full bg-white/5 text-base transition hover:bg-white/10"
                onClick={() => {
                  setShowReactionPicker(false);
                  void onReact(message, emoji);
                }}
                type="button"
              >
                <span aria-hidden>{emoji}</span>
              </button>
            ))}
          </div>
        ) : null}

        <button
          aria-label="Reagir a mensagem"
          className="grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-[rgba(12,16,22,0.92)] text-zinc-300 shadow-[0_16px_28px_-18px_rgba(0,0,0,0.9)] transition hover:text-white md:opacity-0 md:group-hover:opacity-100"
          onClick={() => setShowReactionPicker((current) => !current)}
          type="button"
        >
          <Heart className="h-4 w-4" strokeWidth={2.1} />
        </button>
        <button
          aria-label="Responder mensagem"
          className="grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-[rgba(12,16,22,0.92)] text-zinc-300 shadow-[0_16px_28px_-18px_rgba(0,0,0,0.9)] transition hover:text-white md:opacity-0 md:group-hover:opacity-100"
          onClick={() => onReply(message)}
          type="button"
        >
          <Reply className="h-4 w-4" strokeWidth={2.1} />
        </button>
      </div>

      {showGroupAuthor ? (
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--secondary)]">
          {message.author}
        </p>
      ) : null}

      {message.replyTo ? (
        <div className={`mb-3 rounded-[20px] border px-3 py-3 ${incoming ? 'border-white/8 bg-white/4' : 'border-[rgba(127,175,255,0.18)] bg-[rgba(10,18,30,0.26)]'}`}>
          <p className={`text-[11px] font-bold uppercase tracking-[0.16em] ${incoming ? 'text-[var(--secondary)]' : 'text-[var(--primary)]'}`}>
            {replyAuthor || 'Mensagem citada'}
          </p>
          <p className="mt-1 text-sm leading-6 text-zinc-300">{replyPreview}</p>
        </div>
      ) : null}

      <MessageContent message={message} />

      {message.reactions?.length ? (
        <div className={`mt-3 flex flex-wrap gap-2 ${incoming ? '' : 'justify-end'}`}>
          {message.reactions.map((reaction) => (
            <span
              key={`${message.id}:${reaction.emoji}`}
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium ${reaction.fromMe ? 'border-[var(--primary)]/30 bg-[var(--primary)]/14 text-[var(--primary)]' : 'border-white/10 bg-white/6 text-zinc-200'}`}
            >
              <span aria-hidden>{reaction.emoji}</span>
              {reaction.count > 1 ? <span>{reaction.count}</span> : null}
            </span>
          ))}
        </div>
      ) : null}

      {incoming ? (
        <span className="mt-3 block text-xs text-zinc-500">
          {formatClock(message.timestamp)}
        </span>
      ) : (
        <div className="mt-3 flex items-center justify-end gap-2 text-xs text-[var(--primary)]">
          <span>{formatClock(message.timestamp)}</span>
          <span>••</span>
        </div>
      )}
    </div>
  );

  if (incoming) {
    return (
      <div className="flex max-w-[80%] gap-4">
        <AvatarBadge label={message.author} small src={showGroupAuthor ? null : avatarUrl} />
        {bubbleBody}
      </div>
    );
  }

  return (
    <div className="ml-auto flex max-w-[80%] justify-end">
      {bubbleBody}
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

function summarizeMessageForReply(message: MessageRecord) {
  const body = message.body.trim();

  switch (message.kind) {
    case 'image':
      return body && body !== '[imagem]' ? body : 'Foto';
    case 'video':
      return body && body !== '[video]' ? body : 'Video';
    case 'audio':
      return body && body !== '[audio]' && body !== '[voice note]' ? body : 'Audio';
    case 'document':
      return body && body !== '[documento]' ? body : message.fileName || 'Documento';
    case 'sticker':
      return 'Figurinha';
    default:
      return body || 'Mensagem';
  }
}

function summarizeReplyRecord(reply?: MessageRecord['replyTo']) {
  if (!reply) {
    return 'Mensagem';
  }

  const body = reply.body?.trim() ?? '';

  switch (reply.kind) {
    case 'image':
      return body && body !== '[imagem]' ? body : 'Foto';
    case 'video':
      return body && body !== '[video]' ? body : 'Video';
    case 'audio':
      return body && body !== '[audio]' && body !== '[voice note]' ? body : 'Audio';
    case 'document':
      return body && body !== '[documento]' ? body : 'Documento';
    case 'sticker':
      return 'Figurinha';
    default:
      return body || 'Mensagem';
  }
}

function normalizeReplyAuthor(author?: string) {
  const value = author?.trim();
  if (!value) {
    return '';
  }

  return value.includes('@') ? 'Mensagem citada' : value;
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
  type = 'text',
}: {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  type?: 'text' | 'password';
}) {
  return (
    <input
      className="w-full rounded-2xl border-0 border-b-2 border-transparent bg-[var(--surface-high)] px-4 py-3 text-sm text-white outline-none transition focus:border-[var(--primary)]"
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      type={type}
      value={value}
    />
  );
}

function RoleSelector({
  value,
  onChange,
}: {
  value: AuthUser['role'];
  onChange: (role: AuthUser['role']) => void;
}) {
  const roles: AuthUser['role'][] = ['admin', 'supervisor', 'attendant'];

  return (
    <div className="grid grid-cols-3 gap-2 rounded-[1.35rem] border border-white/10 bg-white/5 p-2">
      {roles.map((role) => {
        const active = value === role;

        return (
          <button
            key={role}
            className={`rounded-2xl px-3 py-3 text-sm font-medium transition ${active ? 'bg-[linear-gradient(135deg,#7fafff,#64a1ff)] text-black shadow-[0_0_18px_rgba(127,175,255,0.22)]' : 'bg-white/5 text-zinc-300 hover:bg-white/10 hover:text-white'}`}
            onClick={() => onChange(role)}
            type="button"
          >
            {formatRoleLabel(role)}
          </button>
        );
      })}
    </div>
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

function formatTimestamp(timestamp: string) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return '--';
  }

  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatRoleLabel(role: AuthUser['role']) {
  switch (role) {
    case 'admin':
      return 'Admin';
    case 'supervisor':
      return 'Supervisor';
    default:
      return 'Atendente';
  }
}

function formatAuditDetailLabel(value: string) {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase();
}

function formatAuditDetailValue(value: unknown) {
  if (value == null) {
    return 'vazio';
  }
  if (typeof value === 'boolean') {
    return value ? 'sim' : 'nao';
  }
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.join(', ');
  }

  return JSON.stringify(value);
}

function formatSessionUserAgent(userAgent?: string) {
  const value = userAgent?.trim();
  if (!value) {
    return 'Sessao web';
  }

  if (value.includes('Windows')) {
    return 'Navegador no Windows';
  }
  if (value.includes('Mac OS')) {
    return 'Navegador no macOS';
  }
  if (value.includes('Android')) {
    return 'Navegador no Android';
  }
  if (value.includes('iPhone') || value.includes('iPad')) {
    return 'Navegador no iOS';
  }

  return value.length > 64 ? `${value.slice(0, 64)}...` : value;
}

function getQuickReplySlashContext(value: string) {
  const match = /(^|\s)\/([^\s]*)$/.exec(value);
  if (!match) {
    return null;
  }

  return {
    query: match[2] ?? '',
    start: match.index + match[1].length,
    end: value.length,
  };
}

function removeQuickReplySlashQuery(value: string) {
  const context = getQuickReplySlashContext(value);
  if (!context) {
    return value;
  }

  return `${value.slice(0, context.start)}${value.slice(context.end)}`;
}

function appendQuickReplyContent(current: string, content: string) {
  const trimmedCurrent = current.trimEnd();
  if (!trimmedCurrent) {
    return content;
  }

  return `${trimmedCurrent}\n${content}`;
}

function readComposerSignaturePreference(signatureStorageKey: string, defaultSignatureName: string) {
  const fallbackName = defaultSignatureName.trim() || 'Operador';
  if (typeof window === 'undefined') {
    return {
      enabled: true,
      name: fallbackName,
    };
  }

  const rawValue = window.localStorage.getItem(signatureStorageKey);
  if (!rawValue) {
    return {
      enabled: true,
      name: fallbackName,
    };
  }

  try {
    const parsed = JSON.parse(rawValue) as {
      enabled?: boolean;
      name?: string;
    };
    return {
      enabled: parsed.enabled !== false,
      name: parsed.name?.trim() || fallbackName,
    };
  } catch {
    return {
      enabled: true,
      name: fallbackName,
    };
  }
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
      primary: 'Sem registro',
      secondary: 'Nenhuma atividade detectada',
    };
  }

  const distance = Date.now() - parsed;
  const minutes = Math.max(1, Math.floor(distance / 60000));

  if (minutes < 2) {
    return {
      primary: 'Agora',
      secondary: 'Atividade em tempo real',
    };
  }

  if (minutes < 60) {
    return {
      primary: `Ha ${minutes} min`,
      secondary: 'Sessao ativa',
    };
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return {
      primary: `Ha ${hours}h`,
      secondary: formatClock(timestamp),
    };
  }

  const days = Math.floor(hours / 24);
  return {
    primary: `Ha ${days}d`,
    secondary: formatDateLabel(timestamp),
  };
}

function formatParticipantReference(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return 'Nao informado';
  }

  return trimmed
    .replace(/@s\.whatsapp\.net$/i, '')
    .replace(/@c\.us$/i, '')
    .replace(/@g\.us$/i, ' (grupo)');
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

function estimateWaitingMinutes(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return 0;
  }

  if (normalized.includes('agora') || normalized.includes('now')) {
    return 0;
  }
  if (normalized.includes('ontem')) {
    return 24 * 60;
  }

  const match = normalized.match(/(\d+)/);
  const numericValue = match ? Number.parseInt(match[1] ?? '0', 10) : 0;
  if (normalized.includes('dia')) {
    return numericValue * 24 * 60;
  }
  if (normalized.includes('hora') || normalized.includes('hr') || normalized.includes('h')) {
    return numericValue * 60;
  }
  if (normalized.includes('min')) {
    return numericValue;
  }

  return numericValue;
}

function formatCompactDuration(totalMinutes: number) {
  if (totalMinutes >= 24 * 60) {
    return `${Math.floor(totalMinutes / (24 * 60))}d`;
  }
  if (totalMinutes >= 60) {
    return `${Math.floor(totalMinutes / 60)}h`;
  }
  return `${Math.max(totalMinutes, 0)}m`;
}

function getContactInteractionMetric(contact: ConversationRecord) {
  const interactionCount = Array.isArray(contact.messages) ? contact.messages.length : 0;
  if (interactionCount > 0) {
    return {
      value: interactionCount.toLocaleString('pt-BR'),
      label: contact.unread > 0 ? `${contact.unread} nao lidas` : 'historico sincronizado',
      tone: contact.unread > 0 ? 'text-[var(--secondary)]' : 'text-[var(--muted)]',
    };
  }

  if (contact.unread > 0) {
    return {
      value: contact.unread.toLocaleString('pt-BR'),
      label: `${contact.unread.toLocaleString('pt-BR')} pendentes`,
      tone: 'text-[var(--secondary)]',
    };
  }

  const waitingMinutes = estimateWaitingMinutes(contact.waitingTime);
  if (waitingMinutes > 0) {
    return {
      value: formatCompactDuration(waitingMinutes),
      label: 'em acompanhamento',
      tone: 'text-[var(--muted)]',
    };
  }

  return {
    value: '0',
    label: 'sem interacoes sincronizadas',
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

function formatDurationLabel(totalSeconds: number) {
  const safeSeconds = Math.max(Math.round(totalSeconds), 0);
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
}

function formatVelocityDelta(deltaSeconds: number) {
  if (deltaSeconds > 0) {
    return `↓ ${deltaSeconds}s improved`;
  }

  if (deltaSeconds < 0) {
    return `↑ ${Math.abs(deltaSeconds)}s slower`;
  }

  return 'No change vs previous period';
}

function formatTargetLabel(targetSeconds: number) {
  const targetMinutes = Math.max(Math.round(targetSeconds / 60), 1);
  return `<${targetMinutes}m`;
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
  if (src.startsWith('data:')) {
    return src;
  }

  const token = getStoredAuthToken();
  const appendToken = (value: string) => {
    if (!token) {
      return value;
    }

    try {
      const url = new URL(value);
      url.searchParams.set('token', token);
      return url.toString();
    } catch {
      return value;
    }
  };

  if (src.startsWith('http://') || src.startsWith('https://')) {
    try {
      const assetUrl = new URL(src);
      const backendUrl = new URL(apiUrl);
      if (assetUrl.origin === backendUrl.origin) {
        return appendToken(src);
      }
    } catch {
      return src;
    }

    return src;
  }
  if (src.startsWith('/')) {
    return appendToken(`${apiUrl}${src}`);
  }
  return src;
}

function sanitizeOverview(overview: DashboardOverview): DashboardOverview {
  return {
    ...overview,
    dashboard: {
      snapshot: {
        activeSessions: overview.dashboard?.snapshot?.activeSessions ?? overview.metrics.activeSessions,
        onlineUsers: overview.dashboard?.snapshot?.onlineUsers ?? overview.metrics.onlineUsers,
        recentConversations: overview.dashboard?.snapshot?.recentConversations ?? 0,
        teamCount: overview.dashboard?.snapshot?.teamCount ?? 0,
      },
      leaderboard: Array.isArray(overview.dashboard?.leaderboard) ? overview.dashboard.leaderboard : [],
    },
    analytics: {
      responseVelocity: normalizeResponseVelocityAnalytics(overview.analytics?.responseVelocity),
      healthScore: overview.analytics?.healthScore ?? 0,
      resolvedRate: overview.analytics?.resolvedRate ?? 0,
      totalConversations: overview.analytics?.totalConversations ?? 0,
      unreadVolume: overview.analytics?.unreadVolume ?? 0,
      waitingVolume: overview.analytics?.waitingVolume ?? 0,
      channelTotals: {
        whatsapp: overview.analytics?.channelTotals?.whatsapp ?? 0,
        instagram: overview.analytics?.channelTotals?.instagram ?? 0,
        facebook: overview.analytics?.channelTotals?.facebook ?? 0,
      },
      weeklyChannelSeries: Array.isArray(overview.analytics?.weeklyChannelSeries)
        ? overview.analytics.weeklyChannelSeries
        : [],
      heatmapRows: Array.isArray(overview.analytics?.heatmapRows) ? overview.analytics.heatmapRows : [],
      resolvedTickets: Array.isArray(overview.analytics?.resolvedTickets) ? overview.analytics.resolvedTickets : [],
    },
    conversations: dedupeConversations(overview.conversations),
  };
}

function normalizeResponseVelocityAnalytics(
  responseVelocity?: DashboardOverview['analytics']['responseVelocity'] | null,
) {
  return {
    averageSeconds: responseVelocity?.averageSeconds ?? 102,
    deltaSeconds: responseVelocity?.deltaSeconds ?? 0,
    targetSeconds: responseVelocity?.targetSeconds ?? 120,
    peakLabel: responseVelocity?.peakLabel ?? 'Sem dados',
    points: Array.isArray(responseVelocity?.points) ? responseVelocity.points : [],
  };
}

function areOverviewsEquivalent(left: DashboardOverview, right: DashboardOverview) {
  const leftResponseVelocity = normalizeResponseVelocityAnalytics(left.analytics?.responseVelocity);
  const rightResponseVelocity = normalizeResponseVelocityAnalytics(right.analytics?.responseVelocity);
  const fallbackDashboardSnapshot = {
    activeSessions: 0,
    onlineUsers: 0,
    recentConversations: 0,
    teamCount: 0,
  };
  const fallbackChannelTotals = {
    whatsapp: 0,
    instagram: 0,
    facebook: 0,
  };
  const leftDashboardSnapshot = left.dashboard?.snapshot ?? fallbackDashboardSnapshot;
  const rightDashboardSnapshot = right.dashboard?.snapshot ?? fallbackDashboardSnapshot;
  const leftChannelTotals = left.analytics?.channelTotals ?? fallbackChannelTotals;
  const rightChannelTotals = right.analytics?.channelTotals ?? fallbackChannelTotals;

  if (
    left.product !== right.product ||
    left.phase !== right.phase ||
    left.metrics.connectedNumbers !== right.metrics.connectedNumbers ||
    left.metrics.activeSessions !== right.metrics.activeSessions ||
    left.metrics.onlineUsers !== right.metrics.onlineUsers ||
    left.metrics.waitingConversations !== right.metrics.waitingConversations ||
    leftDashboardSnapshot.activeSessions !== rightDashboardSnapshot.activeSessions ||
    leftDashboardSnapshot.onlineUsers !== rightDashboardSnapshot.onlineUsers ||
    leftDashboardSnapshot.recentConversations !== rightDashboardSnapshot.recentConversations ||
    leftDashboardSnapshot.teamCount !== rightDashboardSnapshot.teamCount ||
    leftResponseVelocity.averageSeconds !== rightResponseVelocity.averageSeconds ||
    leftResponseVelocity.deltaSeconds !== rightResponseVelocity.deltaSeconds ||
    leftResponseVelocity.targetSeconds !== rightResponseVelocity.targetSeconds ||
	    leftResponseVelocity.peakLabel !== rightResponseVelocity.peakLabel ||
    left.analytics.healthScore !== right.analytics.healthScore ||
    left.analytics.resolvedRate !== right.analytics.resolvedRate ||
    left.analytics.totalConversations !== right.analytics.totalConversations ||
    left.analytics.unreadVolume !== right.analytics.unreadVolume ||
    left.analytics.waitingVolume !== right.analytics.waitingVolume ||
    leftChannelTotals.whatsapp !== rightChannelTotals.whatsapp ||
    leftChannelTotals.instagram !== rightChannelTotals.instagram ||
    leftChannelTotals.facebook !== rightChannelTotals.facebook
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

  if (leftResponseVelocity.points.length !== rightResponseVelocity.points.length) {
    return false;
  }

  if (
    left.dashboard.leaderboard.length !== right.dashboard.leaderboard.length ||
    left.analytics.weeklyChannelSeries.length !== right.analytics.weeklyChannelSeries.length ||
    left.analytics.heatmapRows.length !== right.analytics.heatmapRows.length ||
    left.analytics.resolvedTickets.length !== right.analytics.resolvedTickets.length
  ) {
    return false;
  }

  for (let index = 0; index < leftResponseVelocity.points.length; index += 1) {
    const current = leftResponseVelocity.points[index];
    const next = rightResponseVelocity.points[index];
    if (current.label !== next.label || current.averageSeconds !== next.averageSeconds) {
      return false;
    }
  }

  for (let index = 0; index < left.dashboard.leaderboard.length; index += 1) {
    const current = left.dashboard.leaderboard[index];
    const next = right.dashboard.leaderboard[index];
    if (
      current.id !== next.id ||
      current.label !== next.label ||
      current.avatarUrl !== next.avatarUrl ||
      current.score !== next.score ||
      current.volume !== next.volume ||
      current.volumeLabel !== next.volumeLabel ||
      current.rank !== next.rank
    ) {
      return false;
    }
  }

  for (let index = 0; index < left.analytics.weeklyChannelSeries.length; index += 1) {
    const current = left.analytics.weeklyChannelSeries[index];
    const next = right.analytics.weeklyChannelSeries[index];
    if (current.day !== next.day || current.channel !== next.channel || current.value !== next.value) {
      return false;
    }
  }

  for (let index = 0; index < left.analytics.heatmapRows.length; index += 1) {
    const current = left.analytics.heatmapRows[index];
    const next = right.analytics.heatmapRows[index];
    if (current.day !== next.day || current.values.length !== next.values.length) {
      return false;
    }

    for (let valueIndex = 0; valueIndex < current.values.length; valueIndex += 1) {
      if (current.values[valueIndex] !== next.values[valueIndex]) {
        return false;
      }
    }
  }

  for (let index = 0; index < left.analytics.resolvedTickets.length; index += 1) {
    const current = left.analytics.resolvedTickets[index];
    const next = right.analytics.resolvedTickets[index];
    if (
      current.id !== next.id ||
      current.customer !== next.customer ||
      current.customerAvatar !== next.customerAvatar ||
      current.channel !== next.channel ||
      current.agent !== next.agent ||
      current.lastActivityAt !== next.lastActivityAt ||
      current.statusLabel !== next.statusLabel
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
      current.kind !== next.kind ||
      current.body !== next.body ||
      current.mediaUrl !== next.mediaUrl ||
      current.mimeType !== next.mimeType ||
      current.fileName !== next.fileName ||
      current.timestamp !== next.timestamp ||
	      current.author !== next.author ||
	      !areReplyTargetsEquivalent(current.replyTo, next.replyTo) ||
	      !areMessageReactionsEquivalent(current.reactions, next.reactions)
    ) {
      return false;
    }
  }

  return true;
}

function areReplyTargetsEquivalent(left?: MessageRecord['replyTo'], right?: MessageRecord['replyTo']) {
  if (!left && !right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  return (
    left.messageId === right.messageId &&
    left.author === right.author &&
    left.body === right.body &&
    left.kind === right.kind
  );
}

function areMessageReactionsEquivalent(
  left?: MessageRecord['reactions'],
  right?: MessageRecord['reactions'],
) {
  const leftReactions = left ?? [];
  const rightReactions = right ?? [];

  if (leftReactions.length !== rightReactions.length) {
    return false;
  }

  for (let index = 0; index < leftReactions.length; index += 1) {
    const current = leftReactions[index];
    const next = rightReactions[index];

    if (
      current.emoji !== next.emoji ||
      current.count !== next.count ||
      Boolean(current.fromMe) !== Boolean(next.fromMe)
    ) {
      return false;
    }
  }

  return true;
}

function mergeMessageIntoTimeline(messages: MessageRecord[], message: MessageRecord) {
  const existingIndex = messages.findIndex((current) => current.id === message.id);
  if (existingIndex === -1) {
    return [...messages, message];
  }

  const nextMessages = messages.slice();
  nextMessages[existingIndex] = message;
  return nextMessages;
}

function summarizeConversationPreview(message: MessageRecord) {
  switch (message.kind) {
    case 'image':
      return message.body && message.body !== '[imagem]' ? message.body : 'Foto';
    case 'video':
      return message.body && message.body !== '[video]' ? message.body : 'Video';
    case 'audio':
      return message.body && message.body !== '[audio]' && message.body !== '[voice note]'
        ? message.body
        : 'Audio';
    case 'document':
      return message.body && message.body !== '[documento]'
        ? message.body
        : message.fileName || 'Documento';
    case 'sticker':
      return 'Figurinha';
    default:
      return message.body || 'Mensagem';
  }
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
