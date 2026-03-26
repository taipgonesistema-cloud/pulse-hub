'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import {
  BarChart3,
  Bell,
  Briefcase,
  CircleHelp,
  ContactRound,
  Home,
  LogOut,
  Mail,
  Mic,
  MessageCircle,
  MessageSquarePlus,
  Phone,
  Plus,
  QrCode,
  Search,
  Send,
  Settings,
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
    initialOverview.sessions.length > 0 ? 'conversations' : 'settings',
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

  const selectedSession = useMemo(
    () =>
      overview.sessions.find((session) => session.id === selectedSessionId) ??
      overview.sessions[0],
    [overview.sessions, selectedSessionId],
  );

  const allSessionConversations = useMemo(
    () =>
      overview.conversations.filter(
        (conversation) => conversation.sessionId === selectedSession?.id,
      ),
    [overview.conversations, selectedSession?.id],
  );

  const sessionConversations = useMemo(
    () => filterConversations(allSessionConversations, conversationFilter),
    [allSessionConversations, conversationFilter],
  );

  const selectedConversation = useMemo(
    () =>
      sessionConversations.find(
        (conversation) => conversation.id === selectedConversationId,
      ) ?? sessionConversations[0],
    [selectedConversationId, sessionConversations],
  );

  const contacts = useMemo(() => overview.conversations, [overview.conversations]);

  const conversationFilterOptions = useMemo(
    () => [
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
    ],
    [allSessionConversations],
  );

  const activeSessionId = selectedSession?.id ?? null;
  const activeSessionStatus = selectedSession?.status ?? null;
  const activeConversationId = selectedConversation?.id ?? null;

  const queueLabel = useMemo(() => {
    if (!selectedSession) {
      return 'No session selected';
    }

    return `${selectedSession.channelName} queue`;
  }, [selectedSession]);

  const contactInfo = useMemo(() => {
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
  }, [selectedConversation, selectedSession?.phoneNumber]);

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
  }, [selectedConversationId, selectedSession, sessionConversations]);

  useEffect(() => {
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
    isAuthReady,
    loadMessages,
    markConversationAsRead,
  ]);

  useEffect(() => {
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
    loadMessages,
  ]);

  useEffect(() => {
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
  }, [activeConversationId, activeSessionId, isAuthReady, loadMessages, loadOverview]);

  useEffect(() => {
    shouldStickToBottomRef.current = true;
  }, [activeConversationId]);

  useLayoutEffect(() => {
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
  }, [activeConversationId, activeSessionId, messages, typingConversationId]);

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

  const activeViewLabel =
    navigationItems.find((item) => item.id === activeView)?.label ?? 'Conversations';

  const renderDashboardView = () => (
    <section className="min-h-0 flex-1 overflow-y-auto px-5 py-6 md:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="Connected numbers"
            value={overview.metrics.connectedNumbers}
            detail="Numeros com operacao disponivel"
            tone="primary"
          />
          <MetricCard
            label="Active sessions"
            value={overview.metrics.activeSessions}
            detail="Sessoes prontas para trafego"
            tone="secondary"
          />
          <MetricCard
            label="Waiting conversations"
            value={overview.metrics.waitingConversations}
            detail="Fila atual em aberto"
            tone="tertiary"
          />
          <MetricCard
            label="Online users"
            value={overview.metrics.onlineUsers}
            detail="Operadores online no painel"
            tone="neutral"
          />
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="glass-panel rounded-[30px] p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
                  Session pulse
                </p>
                <h2 className="font-headline mt-3 text-3xl font-semibold text-white">
                  Operacao em tempo real
                </h2>
              </div>
              <button
                className="rounded-full bg-white/5 px-4 py-2 text-xs text-[var(--muted)] hover:text-white"
                onClick={() => runAction(loadOverview)}
                type="button"
              >
                Refresh
              </button>
            </div>

            <div className="mt-6 space-y-3">
              {overview.sessions.length > 0 ? (
                overview.sessions.map((session) => (
                  <button
                    key={session.id}
                    className="flex w-full items-center justify-between rounded-[24px] border border-white/6 bg-white/4 px-4 py-4 text-left transition hover:bg-white/6"
                    onClick={() => {
                      setSelectedSessionId(session.id);
                      setActiveView('settings');
                    }}
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
                ))
              ) : (
                <GhostPanel>
                  Nenhuma sessao provisionada ainda. Abra `Settings` para conectar seu
                  primeiro WhatsApp.
                </GhostPanel>
              )}
            </div>
          </div>

          <div className="glass-panel rounded-[30px] p-6">
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
              Channels
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              {overview.channels.length > 0 ? (
                overview.channels.map((channel) => (
                  <ChannelPill key={channel.id} channel={channel} />
                ))
              ) : (
                <GhostPanel>No channel tags yet.</GhostPanel>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );

  const renderContactsView = () => (
    <section className="min-h-0 flex-1 overflow-y-auto px-5 py-6 md:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
            Contact index
          </p>
          <h2 className="font-headline mt-3 text-3xl font-semibold text-white">
            Base viva de contatos
          </h2>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {contacts.length > 0 ? (
            contacts.map((contact) => (
              <button
                key={`${contact.sessionId}:${contact.id}`}
                className="glass-panel flex items-center gap-4 rounded-[28px] p-5 text-left transition hover:bg-white/6"
                onClick={() => {
                  setSelectedSessionId(contact.sessionId);
                  setSelectedConversationId(contact.id);
                  setActiveView('conversations');
                }}
                type="button"
              >
                <AvatarBadge label={contact.contact} src={contact.avatarUrl} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-lg font-semibold text-white">
                    {contact.contact}
                  </p>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    {contact.participantId}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Tag tone="primary">{contact.channelName}</Tag>
                    <Tag tone="neutral">{contact.owner}</Tag>
                  </div>
                </div>
              </button>
            ))
          ) : (
            <GhostPanel>
              Seus contatos vao aparecer aqui assim que a primeira sessao do WhatsApp
              sincronizar conversas reais.
            </GhostPanel>
          )}
        </div>
      </div>
    </section>
  );

  const renderAnalyticsView = () => (
    <section className="min-h-0 flex-1 overflow-y-auto px-5 py-6 md:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--muted)]">
            Operational signal
          </p>
          <h2 className="font-headline mt-3 text-3xl font-semibold text-white">
            Indicadores da operacao
          </h2>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <MetricCard
            label="Unread volume"
            value={overview.sessions.reduce((sum, session) => sum + session.unread, 0)}
            detail="Mensagens aguardando leitura"
            tone="primary"
          />
          <MetricCard
            label="Waiting queue"
            value={overview.sessions.reduce((sum, session) => sum + session.waiting, 0)}
            detail="Conversas em espera"
            tone="tertiary"
          />
          <MetricCard
            label="Connected channels"
            value={overview.channels.filter((channel) => channel.connectedNumbers > 0).length}
            detail="Filas com numeros ativos"
            tone="secondary"
          />
        </div>

        <GhostPanel>
          Esta aba ja mostra os sinais principais do workspace. Se quiser, no proximo
          passo eu posso transformar isso em analytics completos com SLA, tempo medio,
          throughput e performance por atendente.
        </GhostPanel>
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
        <aside className="hidden h-full w-72 flex-col overflow-hidden border-r border-white/5 bg-black/35 px-5 py-6 backdrop-blur-2xl md:flex">
          <div className="mb-10 flex items-center gap-4 px-2">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-[linear-gradient(135deg,#7fafff,#64a1ff)] text-black shadow-[0_0_24px_rgba(127,175,255,0.24)]">
              <Sparkles className="h-5 w-5" strokeWidth={2.4} />
            </div>
            <div>
              <p className="font-headline text-3xl font-bold tracking-tight text-white">
                Ether OS
              </p>
              <p className="mt-1 text-[11px] uppercase tracking-[0.28em] text-[var(--muted)]">
                Omni-channel v2.4
              </p>
            </div>
          </div>

          <nav className="space-y-1 text-sm">
            {navigationItems.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                className={`flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition-all ${
                  activeView === id
                    ? 'bg-[linear-gradient(90deg,rgba(127,175,255,0.16),rgba(127,175,255,0.04))] text-[var(--primary)] shadow-[0_0_32px_rgba(127,175,255,0.18)]'
                    : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-200'
                }`}
                onClick={() => setActiveView(id)}
                type="button"
              >
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-white/5">
                  <Icon className="h-4 w-4" strokeWidth={2.1} />
                </span>
                <span>{label}</span>
              </button>
            ))}
          </nav>

          <div className="mt-auto space-y-4">
            <button
              className="flex w-full items-center justify-center gap-3 rounded-full bg-[linear-gradient(135deg,#7fafff,#64a1ff)] px-5 py-4 text-sm font-semibold text-black shadow-[0_0_28px_rgba(127,175,255,0.22)] transition-transform hover:scale-[1.01]"
              onClick={() => setActiveView(selectedSession ? 'conversations' : 'settings')}
              type="button"
            >
              <MessageSquarePlus className="h-4 w-4" strokeWidth={2.2} />
              New Message
            </button>
            <div className="border-t border-white/5 pt-4 text-sm">
              <button
                className="flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
                onClick={() => setActiveView('settings')}
                type="button"
              >
                <CircleHelp className="h-4 w-4" strokeWidth={2.1} />
                Support
              </button>
              <button
                className="flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-rose-400 hover:bg-white/5"
                onClick={signOut}
                type="button"
              >
                <LogOut className="h-4 w-4" strokeWidth={2.1} />
                Sign Out
              </button>
            </div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <header className="sticky top-0 z-20 flex items-center justify-between border-b border-white/5 bg-black/40 px-4 py-4 backdrop-blur-2xl md:px-8">
            <div className="flex items-center gap-4">
              <div>
                <p className="font-headline text-3xl font-bold tracking-tight text-[var(--primary)]">
                  EtherCommand
                </p>
                <p className="mt-1 text-[11px] uppercase tracking-[0.24em] text-[var(--muted)]">
                  {activeViewLabel}
                </p>
              </div>
              <div className="hidden items-center gap-3 rounded-full bg-[var(--surface-low)] px-5 py-3 text-sm text-[var(--muted)] lg:flex lg:min-w-80">
                <Search className="h-4 w-4" strokeWidth={2.2} />
                Global search...
              </div>
            </div>
            <div className="flex items-center gap-5">
              <div className="hidden items-center gap-2 lg:flex">
                <button className="grid h-10 w-10 place-items-center rounded-full bg-white/5 text-zinc-400 transition hover:text-white">
                  <Bell className="h-4 w-4" strokeWidth={2.1} />
                </button>
                <button className="grid h-10 w-10 place-items-center rounded-full bg-white/5 text-zinc-400 transition hover:text-white">
                  <WalletCards className="h-4 w-4" strokeWidth={2.1} />
                </button>
              </div>
              <div className="hidden gap-2 lg:flex">
                {overview.sessions.map((session) => (
                  <button
                    key={session.id}
                    className={`rounded-full px-4 py-2 text-xs font-semibold transition-all ${
                      selectedSession?.id === session.id
                        ? 'bg-[var(--surface-high)] text-white'
                        : 'bg-white/5 text-[var(--muted)] hover:text-white'
                    }`}
                    onClick={() => setSelectedSessionId(session.id)}
                    type="button"
                  >
                    {session.name}
                  </button>
                ))}
              </div>
              <div className="h-10 w-px bg-white/10" />
              <div className="flex items-center gap-3">
                <div className="grid h-11 w-11 place-items-center rounded-full bg-[var(--surface-high)] text-sm font-bold text-white">
                  {authUser?.name
                    ?.split(' ')
                    .map((part) => part[0])
                    .join('')
                    .slice(0, 2)
                    .toUpperCase() ?? 'PH'}
                </div>
                <div className="hidden sm:block">
                  <p className="text-sm font-semibold text-white">
                    {authUser?.name ?? 'Pulse User'}
                  </p>
                  <p className="text-xs text-[var(--primary)]">
                    {authUser?.role ?? 'operator'}
                  </p>
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

  if (src && !hasError) {
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
          src={src}
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
