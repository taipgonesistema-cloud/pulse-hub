'use client';

import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';

export type Locale = 'en-US' | 'pt-BR';

type I18nContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (value: string) => string;
};

const localeStorageKey = 'pulse-hub.locale';

const portugueseDictionary: Record<string, string> = {
  'Test': 'Teste',
  'Ready': 'Pronta',
  'Starting': 'Iniciando',
  'QR ready': 'QR pronto',
  'Online': 'Online',
  'Sync': 'Sincronizando',
  'Offline': 'Offline',
  'Error': 'Erro',
  'New Leads': 'Novos leads',
  'Qualified': 'Qualificados',
  'In Progress': 'Em atendimento',
  'Follow-up': 'Follow-up',
  'Closed': 'Fechados',
  'Dashboard': 'Dashboard',
  'Conversations': 'Conversas',
  'Contacts': 'Contatos',
  'Analytics': 'Analytics',
  'Settings': 'Configuracoes',
  'Help': 'Ajuda',
  'Sign out': 'Sair',
  'Quick actions': 'Acoes rapidas',
  'Search contacts, conversations, or owners...': 'Buscar contatos, conversas ou responsaveis...',
  'Enable notifications': 'Ativar notificacoes',
  'Disable notifications': 'Desativar notificacoes',
  'Browser notifications active': 'Notificacoes do navegador ativas',
  'Enable browser notifications': 'Ativar notificacoes do navegador',
  'Notification permission blocked in the browser': 'Permissao de notificacao bloqueada no navegador',
  'Enable notification sound': 'Ativar som de notificacao',
  'Disable notification sound': 'Desativar som de notificacao',
  'Notification sound active': 'Som de notificacao ativo',
  'Notification sound disabled': 'Som de notificacao desativado',
  'Could not complete the last action': 'Nao foi possivel concluir a ultima acao',
  'Syncing workspace': 'Sincronizando workspace',
  'Updating sessions, conversations, and indicators without interrupting the screen flow.': 'Atualizando sessoes, conversas e indicadores sem interromper o fluxo da tela.',
  'Overview': 'Visao geral',
  'Loading workspace': 'Carregando workspace',
  'Loading operation signals and realtime feed...': 'Carregando sinais da operacao e feed em tempo real...',
  'Hydrating queues, timeline, and support state...': 'Carregando filas, timeline e estado do atendimento...',
  'Preparing CRM, filters, and contact profiles...': 'Preparando CRM, filtros e perfis dos contatos...',
  'Calculating stats and organizing operational insights...': 'Calculando estatisticas e organizando a leitura operacional...',
  'Opening quick guides and answers for common questions...': 'Abrindo guias rapidos e respostas para duvidas comuns...',
  'Syncing sessions, QR, and workspace settings...': 'Sincronizando sessoes, QR e configuracoes do workspace...',
  'Finishing': 'Finalizando',
  'Connect WhatsApp': 'Conectar WhatsApp',
  'Open conversations': 'Abrir conversas',
  'Live Systems Online': 'Sistemas online',
  'Contact pipeline': 'Pipeline de contatos',
  'Adjust search, channels, or boards to repopulate the pipeline and drag contacts between stages again.': 'Ajuste busca, canais ou boards para repovoar o pipeline e voltar a arrastar os contatos entre etapas.',
  'No resolved conversation has appeared in the current pipeline yet.': 'Nenhuma conversa resolvida apareceu no pipeline atual ainda.',
  'Quick guides': 'Guias rapidos',
  'Workspace help and questions': 'Ajuda e duvidas do workspace',
  'A short panel to remember key flows and solve common questions without leaving the dashboard.': 'Um painel curto para lembrar os fluxos principais e resolver duvidas comuns sem sair do dashboard.',
  'Essential guides': 'Guias essenciais',
  'The most used paths in daily operations.': 'Os caminhos mais usados no dia a dia da operacao.',
  'Quick questions': 'Duvidas rapidas',
  'Useful shortcut': 'Atalho util',
  'Alt + number': 'Alt + numero',
  'Open Settings, create or select a session, generate the QR, and track status until it is online.': 'Abra Configuracoes, crie ou selecione uma sessao, gere o QR e acompanhe o status ate ficar online.',
  'Handle conversations': 'Atender conversas',
  'Use Conversations to filter the queue, open a timeline, reply, attach media, and apply contact labels.': 'Use Conversas para filtrar a fila, abrir uma timeline, responder, anexar midias e aplicar etiquetas no contato.',
  'Organize contacts': 'Organizar contatos',
  'In the CRM, drag cards between stages, save owner, priority, notes, and support labels.': 'No CRM, arraste cards entre etapas, salve responsavel, prioridade, observacoes e etiquetas do atendimento.',
  'Publish to Instagram': 'Publicar no Instagram',
  'Go to Settings > Instagram, choose Feed or Story, upload media, review the preview, and publish.': 'Entre em Configuracoes > Instagram, escolha Feed ou Story, envie a midia, revise o preview e publique.',
  'QR code not showing?': 'QR code nao aparece?',
  'Click Generate QR / connect on the session. If it remains empty, refresh the panel and check whether the session is disconnected.': 'Clique em Gerar QR / conectar na sessao. Se continuar vazio, atualize o painel e confira se a sessao esta desconectada.',
  'Message did not reach the timeline?': 'Mensagem nao chegou na timeline?',
  'Use Refresh in the conversation. The timeline also syncs in realtime when the session is online.': 'Use Atualizar na conversa. A timeline tambem sincroniza em tempo real quando a sessao esta online.',
  'How do I enable alerts?': 'Como ativar alertas?',
  'Use the bell at the top for browser notifications and the sound button next to it for audio alerts.': 'Use o sino no topo para notificacoes do navegador e o botao de som ao lado para alerta sonoro.',
  'Where do I change user permissions?': 'Onde mudo permissao de usuario?',
  'Admins can open Settings > Users to change role, status, and active sessions.': 'Administradores acessam Configuracoes > Usuarios para alterar role, status e sessoes ativas.',
  'Manage workspace users': 'Gerenciar usuarios do workspace',
  'Visual contact labels': 'Etiquetas visuais dos contatos',
  'Quick replies': 'Respostas rapidas',
  'Instagram studio': 'Estudio Instagram',
  'Audit log': 'Audit log',
  'Connect and manage sessions': 'Conectar e gerenciar sessoes',
  'Control access by role without dropping the shared WhatsApp session.': 'Controle acessos por role sem derrubar a sessao compartilhada do WhatsApp.',
  'Create labels with name, emoji, and color to visually apply to CRM contacts.': 'Crie etiquetas com nome, emoji e cor para aplicar visualmente aos contatos do CRM.',
  'Create reusable shortcuts to speed up support and trigger autocomplete in chat by typing /.': 'Cadastre atalhos reutilizaveis para acelerar o atendimento e acione autocomplete no chat ao digitar /.',
  'Prepare feed and stories in a clean space without internal details showing to operations.': 'Prepare feed e stories em um espaco limpo, sem detalhes internos aparecendo para a operacao.',
  'Track who performed sensitive workspace changes, on which resource, and when.': 'Acompanhe quem executou mudancas sensiveis no workspace, em que recurso e quando isso aconteceu.',
  'Create an operational session, generate QR code, reconnect numbers, and track authentication status without leaving the panel.': 'Crie uma sessao operacional, gere QR code, reconecte numeros e acompanhe o estado da autenticacao sem sair do painel.',
  'Sessions': 'Sessoes',
  'WhatsApp and channels': 'WhatsApp e canais',
  'Users': 'Usuarios',
  'Access and roles': 'Acesso e roles',
  'Create user': 'Criar usuario',
  'Display name': 'Nome exibido',
  'Access email': 'Email de acesso',
  'Initial password': 'Senha inicial',
  'Workspace users': 'Usuarios do workspace',
  'No additional user yet': 'Nenhum usuario adicional ainda',
  'The first admin can create supervisors and attendants here.': 'O primeiro administrador ja pode criar supervisores e atendentes aqui.',
  'Active sessions': 'Sessoes ativas',
  'Load this user sessions to review active access.': 'Carregue as sessoes deste usuario para revisar acessos ativos.',
  'View sessions': 'Ver sessoes',
  'Hide sessions': 'Ocultar sessoes',
  'No active session found for this user.': 'Nenhuma sessao ativa encontrada para este usuario.',
  'Revoke': 'Revogar',
  'Save user': 'Salvar usuario',
  'Edit user': 'Editar usuario',
  'Restricted access': 'Acesso restrito',
  'Only admins can manage workspace users.': 'Apenas administradores podem gerenciar usuarios do workspace.',
  'Only admins and supervisors can manage quick replies.': 'Apenas administradores e supervisores podem gerenciar respostas rapidas.',
  'Label designer': 'Designer de etiquetas',
  'Set a short name, context emoji, and strong color to identify contacts quickly.': 'Defina um nome curto, um emoji de contexto e uma cor forte para identificar contatos rapidamente.',
  'New label': 'Nova etiqueta',
  'Label name': 'Nome da etiqueta',
  'Save label': 'Salvar etiqueta',
  'Create label': 'Criar etiqueta',
  'Clear form': 'Limpar formulario',
  'Label library': 'Biblioteca de etiquetas',
  'These labels can be applied directly to contacts in the CRM panel.': 'Essas etiquetas podem ser aplicadas diretamente aos contatos no painel de CRM.',
  'No labels created yet': 'Nenhuma etiqueta criada ainda',
  'Create the first label to highlight VIP profiles, campaigns, customer types, or operational CRM statuses.': 'Crie a primeira etiqueta para destacar perfis VIP, campanhas, tipos de cliente ou status operacionais do CRM.',
  'Edit': 'Editar',
  'Delete': 'Excluir',
  'Summary': 'Resumo',
  'Events': 'Eventos',
  'Actors': 'Atores',
  'Resources': 'Recursos',
  'Recent events': 'Eventos recentes',
  'No audited event yet': 'Nenhum evento auditado ainda',
  'Provision new session': 'Criar nova sessao',
  'Operational name': 'Nome operacional',
  'Create session': 'Criar sessao',
  'Creating session...': 'Criando sessao...',
  'Session stack': 'Lista de sessoes',
  'Processing': 'Processando',
  'No session created yet': 'Nenhuma sessao criada ainda',
  'Session control': 'Controle da sessao',
  'Unread': 'Nao lidas',
  'Waiting': 'Aguardando',
  'Attendants': 'Atendentes',
  'Pending messages': 'Mensagens pendentes',
  'Queued conversations': 'Conversas na fila',
  'Linked attendants': 'Atendentes vinculados',
  'Connecting...': 'Conectando...',
  'Generate QR / connect': 'Gerar QR / conectar',
  'Disconnecting...': 'Desconectando...',
  'Disconnect': 'Desconectar',
  'Remove session': 'Remover sessao',
  'QR authentication': 'Autenticacao QR',
  'Generating QR code': 'Gerando QR code',
  'Scan with WhatsApp': 'Escaneie pelo WhatsApp',
  'QR waiting for connection': 'QR aguardando conexao',
  'Select a session to continue': 'Selecione uma sessao para continuar',
  'No conversation available': 'Nenhuma conversa disponivel',
  'Clear search and filters': 'Limpar busca e filtros',
  'Refresh queue': 'Atualizar fila',
  'Back to conversation list': 'Voltar para lista de conversas',
  'Labels': 'Etiquetas',
  'Timeline waiting for messages': 'Timeline aguardando mensagens',
  'Open settings': 'Abrir configuracoes',
  'Back to dashboard': 'Voltar ao dashboard',
  'Connect WhatsApp to start conversations': 'Conecte o WhatsApp para iniciar conversas',
  'Contact labels': 'Etiquetas do contato',
  'Search labels': 'Pesquisar etiquetas',
  'Open label library': 'Abrir biblioteca de etiquetas',
  'No label available': 'Nenhuma etiqueta disponivel',
  'Close': 'Fechar',
  'Manage labels': 'Gerenciar etiquetas',
  'Cancel': 'Cancelar',
  'Removing...': 'Removendo...',
  'Create board': 'Criar board',
  'Board name': 'Nome do board',
  'Short description': 'Descricao curta',
  'Add contact': 'Adicionar contato',
  'Contact name': 'Nome do contato',
  'Phone with area code or JID': 'Telefone com DDD ou JID',
  'Name': 'Nome',
  'Created': 'Criada',
  'Visible to': 'Visivel para',
  'Actions': 'Acoes',
  'No quick reply found.': 'Nenhuma resposta rapida encontrada.',
  'Active': 'Ativo',
  'Inactive': 'Inativo',
  'Preview': 'Visualizar',
  'New quick reply': 'Nova resposta rapida',
  'Edit quick reply': 'Editar resposta rapida',
  'Shortcut': 'Atalho',
  'Content': 'Conteudo',
  'Category': 'Categoria',
  'Visibility': 'Visibilidade',
  'Everyone': 'Todos',
  'Specific user': 'Usuario especifico',
  'Create reply': 'Criar resposta',
  'Save reply': 'Salvar resposta',
  'No quick reply available.': 'Nenhuma resposta rapida disponivel.',
  'Sign in': 'Entrar',
  'Enter the operation': 'Entre na operacao',
  'Lean access for operators, supervisors, and admins. Only the essential flow to sign in fast and land directly in the inbox.': 'Acesso enxuto para operadores, supervisores e administradores. So o fluxo essencial para entrar rapido e cair direto no inbox.',
  'Password': 'Senha',
  'Your password': 'Sua senha',
  'Validating access...': 'Validando acesso...',
  'Sign in now': 'Entrar agora',
  'Fill in email and password to continue.': 'Preencha email e senha para continuar.',
  'Access granted for': 'Acesso liberado para',
  'Redirecting to the dashboard...': 'Redirecionando para a dashboard...',
  'By continuing, you agree with our': 'Ao continuar, voce concorda com a nossa',
  'Privacy Policy': 'Politica de Privacidade',
  'Centralize reusable support shortcuts': 'Centralize atalhos de atendimento reutilizaveis',
  'Create ready-to-use replies with controlled visibility to speed up support and trigger chat autocomplete by typing': 'Crie respostas prontas com visibilidade controlada para acelerar o atendimento e acionar autocomplete no chat ao digitar',
  'Search by name, shortcut, or content': 'Buscar por nome, atalho ou conteudo',
  'replies': 'respostas',
  'shortcut': 'atalho',
  'Reply name': 'Nome da resposta',
  'Type the content to preview the final text.': 'Digite o conteudo para visualizar o texto final.',
  'Uncategorized': 'Sem categoria',
  'Updated': 'Atualizada',
  'by': 'por',
  'system': 'sistema',
  'Delete quick reply': 'Excluir resposta rapida',
  'You are about to delete': 'Voce esta prestes a excluir',
  'This action removes the shortcut from chat autocomplete.': 'Essa acao remove o atalho do autocomplete do chat.',
  'Searching for': 'Buscando por',
  'Type to filter or choose a ready-to-use reply.': 'Digite para filtrar ou escolha uma resposta pronta.',
  'Enter or Tab': 'Enter ou Tab',
  'Dark': 'Escuro',
  'Light': 'Claro',
  'Switch to dark mode': 'Alternar para modo escuro',
  'Switch to light mode': 'Alternar para modo claro',
  'Language': 'Idioma',
};

const portuguesePatterns: Array<[RegExp, (match: RegExpMatchArray) => string]> = [
  [/^(\d+) users$/, (match) => `${match[1]} usuarios`],
  [/^(\d+) labels$/, (match) => `${match[1]} etiquetas`],
  [/^(\d+) contacts$/, (match) => `${match[1]} contatos`],
  [/^(\d+) loaded sessions$/, (match) => `${match[1]} sessoes carregadas`],
  [/^(\d+) new messages?$/, (match) => `${match[1]} nova${match[1] === '1' ? '' : 's'} mensagem${match[1] === '1' ? '' : 'ens'}`],
  [/^Load (\d+) previous messages$/, (match) => `Carregar ${match[1]} mensagens anteriores`],
  [/^\+(\d+) labels$/, (match) => `+${match[1]} etiquetas`],
];

const I18nContext = createContext<I18nContextValue | null>(null);

function resolveStoredLocale(): Locale {
  if (typeof window === 'undefined') return 'en-US';
  const stored = window.localStorage.getItem(localeStorageKey);
  return stored === 'pt-BR' || stored === 'en-US' ? stored : 'en-US';
}

function translateToPortuguese(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return value;
  const direct = portugueseDictionary[trimmed];
  if (direct) return value.replace(trimmed, direct);
  for (const [pattern, resolve] of portuguesePatterns) {
    const match = trimmed.match(pattern);
    if (match) return value.replace(trimmed, resolve(match));
  }
  return value;
}

function translateValue(value: string, locale: Locale) {
  return locale === 'pt-BR' ? translateToPortuguese(value) : value;
}

function shouldSkipElement(element: Element) {
  return ['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION'].includes(element.tagName);
}

function shouldSkipAttributes(element: Element) {
  return ['SCRIPT', 'STYLE'].includes(element.tagName);
}

function translateElement(root: ParentNode, locale: Locale) {
  if (locale !== 'pt-BR') return;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || shouldSkipElement(parent)) return NodeFilter.FILTER_REJECT;
      return node.nodeValue?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });

  const textNodes: Text[] = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text);
  textNodes.forEach((node) => {
    const current = node.nodeValue ?? '';
    const translated = translateValue(current, locale);
    if (translated !== current) node.nodeValue = translated;
  });

  const elements = root instanceof Element ? [root, ...Array.from(root.querySelectorAll('*'))] : Array.from(root.querySelectorAll('*'));
  elements.forEach((element) => {
    if (shouldSkipAttributes(element)) return;
    ['aria-label', 'title', 'placeholder'].forEach((attribute) => {
      const current = element.getAttribute(attribute);
      if (!current) return;
      const translated = translateValue(current, locale);
      if (translated !== current) element.setAttribute(attribute, translated);
    });
  });
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale] = useState<Locale>(resolveStoredLocale);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dataset.locale = locale;
  }, [locale]);

  useEffect(() => {
    if (locale !== 'pt-BR') return undefined;

    translateElement(document.body, locale);
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.TEXT_NODE) {
            const current = node.nodeValue ?? '';
            const translated = translateValue(current, locale);
            if (translated !== current) node.nodeValue = translated;
          } else if (node instanceof Element) {
            translateElement(node, locale);
          }
        });

        if (mutation.type === 'characterData') {
          const current = mutation.target.nodeValue ?? '';
          const translated = translateValue(current, locale);
          if (translated !== current) mutation.target.nodeValue = translated;
        }
      });
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [locale]);

  const value = useMemo<I18nContextValue>(() => ({
    locale,
    setLocale(nextLocale) {
      window.localStorage.setItem(localeStorageKey, nextLocale);
      window.location.reload();
    },
    t(valueToTranslate) {
      return translateValue(valueToTranslate, locale);
    },
  }), [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useI18n must be used inside I18nProvider');
  return context;
}
