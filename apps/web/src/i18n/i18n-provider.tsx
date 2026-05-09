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
  'All': 'Todas',
  'Notifications unavailable': 'Notificacoes indisponiveis',
  'Permission blocked': 'Permissao bloqueada',
  'Permission not granted': 'Permissao nao concedida',
  'Notifications enabled': 'Notificacoes ativadas',
  'Notifications disabled': 'Notificacoes desativadas',
  'Sound enabled': 'Som ativado',
  'Sound disabled': 'Som desativado',
  'Contact created': 'Contato criado',
  'CRM updated': 'CRM atualizado',
  'Label updated': 'Etiqueta atualizada',
  'Label created': 'Etiqueta criada',
  'Label removed': 'Etiqueta removida',
  'Verified only': 'So verificados',
  'All profiles': 'Todos os perfis',
  'Search by name, phone, channel, or owner...': 'Buscar por nome, telefone, canal ou responsavel...',
  'Filters': 'Filtros',
  'Clear filters': 'Limpar filtros',
  'Select a card on the board to see context, move stages, and open the conversation quickly.': 'Selecione um card no board para ver contexto, mover de etapa e abrir a conversa rapidamente.',
  'Publication preview': 'Preview da publicacao',
  'Publishing to feed and waiting for Instagram confirmation...': 'Publicando no feed e aguardando confirmacao do Instagram...',
  'Publishing story and waiting for Instagram confirmation...': 'Publicando story e aguardando confirmacao do Instagram...',
  'Publishing feed...': 'Publicando feed...',
  'Publishing story...': 'Publicando story...',
  'Publish to feed': 'Publicar no feed',
  'Publish story': 'Publicar story',
  'Only admins and supervisors can publish to Instagram from the dashboard.': 'Apenas administradores e supervisores podem publicar no Instagram pelo dashboard.',
  'Distinct users in this list': 'Usuarios distintos nesta lista',
  'Latest 60': '60 ultimos',
  'Conversations in queue': 'Conversas na fila',
  'When this conversation has synced history, the complete timeline appears here with messages and media.': 'Quando esta conversa tiver historico sincronizado, a timeline completa aparece aqui com mensagens e midias.',
  'Connect WhatsApp to see real activity': 'Conecte o WhatsApp para ver atividade real',
  'Scan the QR': 'Escaneie o QR',
  'Open Linked devices in WhatsApp and scan the code.': 'Abra Aparelhos conectados no WhatsApp e leia o codigo.',
  'First support flow': 'Primeiro atendimento',
  'Media': 'Midia',
  'No record': 'Sem registro',
  'Now': 'Agora',
  'Realtime activity': 'Atividade em tempo real',
  'Not provided': 'Nao informado',
  'Contact': 'Contato',
  'No owner': 'Sem responsavel',
  'Authentication': 'Autenticacao',
  'Entering the workspace': 'Entrando no workspace',
  'Team': 'Equipe',
  'Preparing your workspace': 'Preparando seu workspace',
  'Today': 'Hoje',
  'Opening conversation...': 'Abrindo conversa...',
  'Feed accepts captions and uses video as a reel when applicable.': 'Feed aceita legenda e usa video como reel quando aplicavel.',
  'Story prioritizes visual creative; text should be inside the image or video.': 'Story prioriza a arte visual; texto deve estar dentro da imagem ou video.',
  'Latest publication': 'Ultima publicacao',
  'Refresh': 'Atualizar',
  'Queue view': 'Visao da fila',
  'No synced channel yet.': 'Nenhum canal sincronizado ainda.',
  'Response, queue, and pipeline in realtime': 'Resposta, fila e pipeline em tempo real',
  'Active contact': 'Contato ativo',
  'No label available yet.': 'Nenhuma etiqueta disponivel ainda.',
  'Notes': 'Observacoes',
  'Context summary, next action, objections, support details...': 'Resumo do contexto, proxima acao, objeccoes, detalhes do atendimento...',
  'Open conversation': 'Abrir conversa',
  'Copy identifier': 'Copiar identificador',
  'Owner': 'Responsavel',
  'Owner name': 'Nome do responsavel',
  'Priority': 'Prioridade',
  'No priority': 'Sem prioridade',
  'Interactions': 'Interacoes',
  'Last message': 'Ultima mensagem',
  'No recent synced text.': 'Sem texto recente sincronizado.',
  'The typed message will be sent as the attachment caption.': 'A mensagem digitada sera enviada como legenda do anexo.',
  'Attendant': 'Atendente',
  'empty': 'vazio',
  'yes': 'sim',
  'no': 'nao',
  'being followed up': 'em acompanhamento',
  'synced history': 'historico sincronizado',
  'no synced interactions': 'sem interacoes sincronizadas',
  'you@company.com': 'voce@empresa.com',
  'Custom CRM board': 'Board personalizado do CRM',
  'Set a short name to create the board.': 'Defina um nome curto para criar o board.',
  'Board created': 'Board criado',
  'Board removed': 'Board removido',
  'Quick reply created': 'Resposta rapida criada',
  'Quick reply updated': 'Resposta rapida atualizada',
  'Quick reply deleted': 'Resposta rapida excluida',
  'Post published on Instagram': 'Post publicado no Instagram',
  'Story published on Instagram': 'Story publicado no Instagram',
  'Instagram status updated': 'Status do Instagram atualizado',
  'to switch between the main sidebar tabs.': 'para alternar entre as abas principais da barra lateral.',
  'Feed and stories': 'Feed e stories',
  'Audit': 'Auditoria',
  'Sensitive events': 'Eventos sensiveis',
  'Control center': 'Central de controle',
  'Feed post caption': 'Legenda do post no feed',
  'Stories use the uploaded creative. Text should be inside the image or video.': 'Stories usam a arte enviada. Texto deve estar na propria imagem ou video.',
  'Signature name': 'Nome da assinatura',
  'Refresh panel': 'Atualizar painel',
  'Open': 'Abrir',
  'Copy ID': 'Copiar ID',
  'Back to login': 'Voltar ao login',
  'Privacy Policy for General Use': 'Politica de Privacidade para Uso Geral',
  'Last updated May 9, 2026': 'Ultima atualizacao em 9 de maio de 2026',
  'Your privacy matters. This policy provides a general overview of how personal information may be handled when you use our services, including digital products, websites, dashboards, integrations, support channels, and related features.': 'A sua privacidade importa. Esta politica apresenta uma visao geral de como informacoes pessoais podem ser tratadas quando voce usa nossos servicos, incluindo produtos digitais, sites, dashboards, integracoes, canais de suporte e recursos relacionados.',
  '1 Scope of this policy': '1 Escopo desta politica',
  'This Privacy Policy explains how we collect, use, store, share, and protect personal information when you access or use our application, website, dashboard, integrations, support channels, or related services.': 'Esta Politica de Privacidade explica como coletamos, usamos, armazenamos, compartilhamos e protegemos informacoes pessoais quando voce acessa ou usa nosso aplicativo, site, dashboard, integracoes, canais de suporte ou servicos relacionados.',
  'This policy applies to general use of the service, whether you are visiting a public page, creating an account, contacting support, using integrations, or interacting with features made available in the platform.': 'Esta politica se aplica ao uso geral do servico, seja ao visitar uma pagina publica, criar uma conta, contatar o suporte, usar integracoes ou interagir com recursos disponibilizados na plataforma.',
  'If a specific product, contract, or legal notice provides additional privacy terms, those additional terms may also apply to that specific use.': 'Se um produto, contrato ou aviso legal especifico trouxer termos adicionais de privacidade, esses termos tambem poderao se aplicar a esse uso especifico.',
  '2 Information we may collect': '2 Informacoes que podemos coletar',
  'The information we collect depends on how you use the service and which features are enabled.': 'As informacoes que coletamos dependem de como voce usa o servico e de quais recursos estao ativados.',
  'Account and profile information, such as name, email address, phone number, role, login credentials, and preferences.': 'Informacoes de conta e perfil, como nome, email, telefone, cargo, credenciais de acesso e preferencias.',
  'Content and communication data, such as messages, files, images, media, comments, forms, support requests, and information you choose to submit.': 'Dados de conteudo e comunicacao, como mensagens, arquivos, imagens, midias, comentarios, formularios, solicitacoes de suporte e informacoes que voce decide enviar.',
  'Usage and device data, such as IP address, browser type, operating system, device identifiers, access dates, pages viewed, interactions, logs, and approximate location inferred from technical data.': 'Dados de uso e dispositivo, como endereco IP, tipo de navegador, sistema operacional, identificadores do dispositivo, datas de acesso, paginas visualizadas, interacoes, logs e localizacao aproximada inferida a partir de dados tecnicos.',
  'Integration data received from connected third-party services when you authorize or configure those integrations.': 'Dados de integracao recebidos de servicos de terceiros conectados quando voce autoriza ou configura essas integracoes.',
  'Payment, billing, or commercial information when paid features, subscriptions, invoices, or transactions are available.': 'Informacoes de pagamento, cobranca ou comerciais quando recursos pagos, assinaturas, faturas ou transacoes estiverem disponiveis.',
  '3 How we use information': '3 Como usamos as informacoes',
  'We use personal information for legitimate operational, security, support, communication, and service improvement purposes.': 'Usamos informacoes pessoais para finalidades legitimas de operacao, seguranca, suporte, comunicacao e melhoria do servico.',
  'Provide, operate, maintain, personalize, and improve the service.': 'Fornecer, operar, manter, personalizar e melhorar o servico.',
  'Create and manage accounts, authentication, permissions, settings, and user sessions.': 'Criar e gerenciar contas, autenticacao, permissoes, configuracoes e sessoes de usuario.',
  'Process requests, provide support, respond to questions, and send service-related communications.': 'Processar solicitacoes, prestar suporte, responder perguntas e enviar comunicacoes relacionadas ao servico.',
  'Enable integrations, automation, notifications, analytics, reporting, and other features requested by users.': 'Habilitar integracoes, automacoes, notificacoes, analytics, relatorios e outros recursos solicitados pelos usuarios.',
  'Monitor service performance, troubleshoot issues, prevent fraud, protect accounts, and enforce our terms and policies.': 'Monitorar o desempenho do servico, solucionar problemas, prevenir fraudes, proteger contas e aplicar nossos termos e politicas.',
  'Comply with legal obligations, regulatory requirements, court orders, or lawful requests from authorities.': 'Cumprir obrigacoes legais, exigencias reguladoras, ordens judiciais ou solicitacoes legais de autoridades.',
  '4 Cookies and similar technologies': '4 Cookies e tecnologias similares',
  'We may use cookies, local storage, pixels, tags, or similar technologies to keep you signed in, remember preferences, improve performance, understand usage, and protect the service.': 'Podemos usar cookies, armazenamento local, pixels, tags ou tecnologias similares para manter voce conectado, lembrar preferencias, melhorar desempenho, entender o uso e proteger o servico.',
  'You can usually control cookies through your browser settings. Some features may not work correctly if cookies or local storage are disabled.': 'Normalmente voce pode controlar cookies pelas configuracoes do navegador. Alguns recursos podem nao funcionar corretamente se cookies ou armazenamento local forem desativados.',
  '5 How we share information': '5 Como compartilhamos informacoes',
  'We do not sell personal information. We may share information only when necessary for the purposes described in this policy.': 'Nao vendemos informacoes pessoais. Podemos compartilhar informacoes somente quando necessario para as finalidades descritas nesta politica.',
  'Service providers that help us host, secure, maintain, analyze, communicate, process payments, or operate the service.': 'Prestadores de servico que nos ajudam a hospedar, proteger, manter, analisar, comunicar, processar pagamentos ou operar o servico.',
  'Third-party integrations that you choose to connect or authorize.': 'Integracoes de terceiros que voce escolhe conectar ou autorizar.',
  'Business partners or account administrators when the service is provided through an organization or shared workspace.': 'Parceiros de negocio ou administradores de conta quando o servico e fornecido por uma organizacao ou workspace compartilhado.',
  'Professional advisers, auditors, insurers, or legal representatives when reasonably necessary.': 'Consultores profissionais, auditores, seguradoras ou representantes legais quando razoavelmente necessario.',
  'Authorities, regulators, courts, or other parties when required by law or to protect rights, safety, and security.': 'Autoridades, reguladores, tribunais ou outras partes quando exigido por lei ou para proteger direitos, seguranca e integridade.',
  'Successors in connection with a merger, acquisition, financing, restructuring, or sale of assets, subject to appropriate protections.': 'Sucessores em caso de fusao, aquisicao, financiamento, reestruturacao ou venda de ativos, sujeitos a protecoes adequadas.',
  '6 Data retention': '6 Retencao de dados',
  'We keep personal information only for as long as reasonably necessary to provide the service, comply with legal obligations, resolve disputes, enforce agreements, maintain security, and support legitimate business needs.': 'Mantemos informacoes pessoais apenas pelo tempo razoavelmente necessario para fornecer o servico, cumprir obrigacoes legais, resolver disputas, aplicar acordos, manter seguranca e apoiar necessidades legitimas do negocio.',
  'Retention periods may vary depending on the type of data, account settings, legal requirements, backup cycles, and the context in which the information was collected.': 'Os prazos de retencao podem variar conforme o tipo de dado, configuracoes da conta, requisitos legais, ciclos de backup e contexto em que a informacao foi coletada.',
  '7 Security': '7 Seguranca',
  'We use reasonable administrative, technical, and organizational measures designed to protect personal information against unauthorized access, loss, misuse, alteration, or disclosure.': 'Usamos medidas administrativas, tecnicas e organizacionais razoaveis para proteger informacoes pessoais contra acesso nao autorizado, perda, uso indevido, alteracao ou divulgacao.',
  'No method of transmission or storage is completely secure. You are responsible for keeping your credentials confidential and for using secure devices and networks when accessing the service.': 'Nenhum metodo de transmissao ou armazenamento e completamente seguro. Voce e responsavel por manter suas credenciais confidenciais e por usar dispositivos e redes seguros ao acessar o servico.',
  '8 International transfers': '8 Transferencias internacionais',
  'Depending on where you are located and how the service is hosted or integrated, personal information may be processed in countries different from your country of residence.': 'Dependendo de onde voce esta localizado e de como o servico e hospedado ou integrado, informacoes pessoais podem ser processadas em paises diferentes do seu pais de residencia.',
  'When information is transferred internationally, we use appropriate safeguards when required by applicable law.': 'Quando informacoes sao transferidas internacionalmente, usamos salvaguardas adequadas quando exigido pela lei aplicavel.',
  '9 Your privacy rights': '9 Seus direitos de privacidade',
  'Depending on your location, you may have rights regarding your personal information. These rights may be subject to legal limitations and identity verification.': 'Dependendo da sua localizacao, voce pode ter direitos relacionados as suas informacoes pessoais. Esses direitos podem estar sujeitos a limitacoes legais e verificacao de identidade.',
  'Access, confirm, or receive a copy of personal information we process about you.': 'Acessar, confirmar ou receber uma copia das informacoes pessoais que tratamos sobre voce.',
  'Correct incomplete, inaccurate, or outdated information.': 'Corrigir informacoes incompletas, imprecisas ou desatualizadas.',
  'Request deletion, anonymization, restriction, or portability of personal information when applicable.': 'Solicitar exclusao, anonimizacao, restricao ou portabilidade de informacoes pessoais quando aplicavel.',
  'Object to certain processing activities or withdraw consent when processing is based on consent.': 'Opor-se a determinadas atividades de tratamento ou retirar consentimento quando o tratamento for baseado em consentimento.',
  'Manage communication preferences and browser-based tracking settings.': 'Gerenciar preferencias de comunicacao e configuracoes de rastreamento do navegador.',
  '10 Third-party services and links': '10 Servicos e links de terceiros',
  'The service may include links, integrations, embeds, APIs, or features provided by third parties. Their privacy practices are governed by their own policies, not by this Privacy Policy.': 'O servico pode incluir links, integracoes, embeds, APIs ou recursos fornecidos por terceiros. As praticas de privacidade deles sao regidas por suas proprias politicas, nao por esta Politica de Privacidade.',
  'You should review the privacy policies and settings of any third-party service before connecting it or sharing information with it.': 'Voce deve revisar as politicas e configuracoes de privacidade de qualquer servico de terceiros antes de conecta-lo ou compartilhar informacoes com ele.',
  '11 Children and minors': '11 Criancas e menores',
  'The service is not intended for children under the minimum age required by applicable law. We do not knowingly collect personal information from children without appropriate consent.': 'O servico nao e destinado a criancas abaixo da idade minima exigida pela lei aplicavel. Nao coletamos conscientemente informacoes pessoais de criancas sem consentimento apropriado.',
  'If you believe a child has provided personal information through the service, contact us so we can review and take appropriate action.': 'Se voce acredita que uma crianca forneceu informacoes pessoais por meio do servico, entre em contato para que possamos avaliar e tomar as medidas adequadas.',
  '12 Changes to this policy': '12 Alteracoes nesta politica',
  'We may update this Privacy Policy from time to time to reflect changes in the service, legal requirements, security practices, or business operations.': 'Podemos atualizar esta Politica de Privacidade periodicamente para refletir alteracoes no servico, requisitos legais, praticas de seguranca ou operacoes do negocio.',
  'When changes are material, we may provide additional notice through the service or other appropriate channels. The updated version will indicate the latest revision date.': 'Quando as alteracoes forem relevantes, poderemos fornecer aviso adicional pelo servico ou por outros canais apropriados. A versao atualizada indicara a data da revisao mais recente.',
  '13 Contact': '13 Contato',
  'If you have questions, requests, or concerns about this Privacy Policy or how personal information is handled, contact the service administrator or the support channel made available in the application.': 'Se voce tiver perguntas, solicitacoes ou preocupacoes sobre esta Politica de Privacidade ou sobre como informacoes pessoais sao tratadas, contate o administrador do servico ou o canal de suporte disponibilizado no aplicativo.',
};

const portuguesePatterns: Array<[RegExp, (match: RegExpMatchArray) => string]> = [
  [/^(\d+) users$/, (match) => `${match[1]} usuarios`],
  [/^(\d+) labels$/, (match) => `${match[1]} etiquetas`],
  [/^(\d+) contacts$/, (match) => `${match[1]} contatos`],
  [/^(\d+) loaded sessions$/, (match) => `${match[1]} sessoes carregadas`],
  [/^(\d+) new messages?$/, (match) => `${match[1]} nova${match[1] === '1' ? '' : 's'} mensagem${match[1] === '1' ? '' : 'ens'}`],
  [/^Load (\d+) previous messages$/, (match) => `Carregar ${match[1]} mensagens anteriores`],
  [/^\+(\d+) labels$/, (match) => `+${match[1]} etiquetas`],
  [/^Consolidated queue · (.+)$/, (match) => `Fila consolidada · ${match[1]}`],
  [/^Queue (.+)$/, (match) => `Fila ${match[1]}`],
  [/^New message received in (.+)\.$/, (match) => `Nova mensagem recebida em ${match[1]}.`],
  [/^(\d+) results?$/, (match) => `${match[1]} resultado${match[1] === '1' ? '' : 's'}`],
  [/^color (.+)$/, (match) => `cor ${match[1]}`],
  [/^usage (\d+)$/, (match) => `uso ${match[1]}`],
  [/^by (.+)$/, (match) => `por ${match[1]}`],
  [/^action (.+)$/, (match) => `acao ${match[1]}`],
  [/^resource (.+)$/, (match) => `recurso ${match[1]}`],
  [/^(\d+) unread$/, (match) => `${match[1]} nao lidas`],
  [/^(\d+) pending$/, (match) => `${match[1]} pendentes`],
  [/^(\d+) min ago$/, (match) => `Ha ${match[1]} min`],
  [/^(\d+)h ago$/, (match) => `Ha ${match[1]}h`],
  [/^(\d+)d ago$/, (match) => `Ha ${match[1]}d`],
  [/^Opening (.+)\.\.\.$/, (match) => `Abrindo ${match[1]}...`],
  [/^Loading conversations, contacts, and operational data for (.+)\.$/, (match) => `Carregando conversas, contatos e dados operacionais para ${match[1]}.`],
  [/^(\d+) recent items$/, (match) => `${match[1]} itens recentes`],
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

    let animationFrameId = 0;
    const scheduleTranslation = () => {
      if (animationFrameId) return;
      animationFrameId = window.requestAnimationFrame(() => {
        animationFrameId = 0;
        translateElement(document.body, locale);
      });
    };

    translateElement(document.body, locale);
    const observer = new MutationObserver(() => {
      scheduleTranslation();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      if (animationFrameId) window.cancelAnimationFrame(animationFrameId);
    };
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
