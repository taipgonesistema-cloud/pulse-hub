# Passo a passo do MVP

Este arquivo guarda o plano de implementacao da plataforma para continuarmos depois sem perder o contexto.

## Objetivo do produto

Criar uma dashboard omnichannel no estilo Umbler Talk Premium, com foco inicial em WhatsApp conectado via QR code, sem API oficial, permitindo:

- varios numeros de WhatsApp conectados;
- separacao por canais/equipes;
- varios usuarios acompanhando a mesma operacao;
- leitura e envio de mensagens em um inbox compartilhado;
- base pronta para incluir Instagram e Facebook depois.

## Stack confirmada

- `Next.js` para dashboard web;
- `NestJS` para API e tempo real;
- `PostgreSQL` para persistencia futura;
- `Redis` para fila, presenca e eventos futuros;
- `Baileys` para o MVP via QR.

## Estrutura atual criada

- `apps/web`: frontend inicial da dashboard;
- `apps/server`: backend inicial com endpoints operacionais;
- `README.md`: instrucoes gerais do projeto;
- `.env.example`: variaveis iniciais.

## O que ja foi feito

### 1. Base do projeto

- criacao do monorepo com workspaces npm;
- criacao do app web em `Next.js`;
- criacao do app backend em `NestJS`.

### 2. Dashboard inicial

- hero principal com proposta da plataforma;
- cards de metricas operacionais;
- bloco visual de conexao por QR code;
- area de canais e numeros conectados;
- inbox compartilhado com conversas e atribuicao.

### 3. Backend inicial

- endpoint de health check;
- endpoint de overview da dashboard;
- endpoint de sessoes WhatsApp;
- endpoint de QR por sessao;
- estrutura base pronta para iniciar sem seeds fixas.

### 5. Evolucao aplicada agora

- criacao de sessao por numero e canal;
- acao para conectar e desconectar sessao;
- estrutura pronta para `Baileys` no backend;
- store em memoria para sessoes, conversas e mensagens;
- inbox do frontend consumindo API;
- envio de mensagem pela dashboard;
- QR exibido no painel lateral da operacao.
- limpeza dos dados de teste para subir ambiente novo do zero.

### 4. Validacao tecnica

- build do frontend funcionando;
- lint do backend funcionando;
- build do backend funcionando;
- teste unitario basico funcionando.

## Proximos passos recomendados

### Fase 1 - WhatsApp real

Implementar integracao com `Baileys`:

- iniciar sessao por numero;
- gerar QR real;
- persistir autenticacao por sessao;
- detectar reconexao e desconexao;
- receber mensagens em tempo real;
- enviar mensagens pela dashboard.

Status atual da fase 1:

- biblioteca instalada;
- servico NestJS preparado;
- endpoints operacionais criados;
- fluxo real depende da sessao ser iniciada e persistida no storage da engine.

### Fase 2 - Persistencia

Status atual da fase 2:

- PostgreSQL integrado como fonte principal para sessoes, conversas, mensagens e canais;
- Redis integrado para cache do overview e publicacao/assinatura de eventos em tempo real;
- bootstrap local adicionado em `docker-compose.yml`;
- `.env.example` atualizado com `DATABASE_URL` e `REDIS_URL`.

Proximos incrementos da fase:

- modelar `users`;
- modelar `workspaces`;
- expandir `channels` para multiworkspace;
- expandir `whatsapp_sessions` com auditoria e owner tecnico;
- modelar `contacts`;
- expandir `conversations` com SLA e atribuicao;
- expandir `messages` com anexos e status de entrega;
- modelar `tags` e atribuicoes.

### Fase 3 - Tempo real

Adicionar atualizacao em tempo real com socket:

- status de sessao;
- QR atualizado;
- novas mensagens;
- mudanca de atribuicao;
- presenca de usuarios na conversa.

### Fase 4 - Operacao multiusuario

Implementar regras de uso operacional:

- login e autenticacao;
- perfis `admin`, `supervisor` e `atendente`;
- atribuicao de conversa;
- notas internas;
- tags;
- filtros por canal, numero, usuario e status.

### Fase 5 - Omnichannel

Preparar a expansao:

- criar camada de adaptadores por canal;
- padronizar estrutura de conversa e mensagem;
- plugar Instagram Direct;
- plugar Facebook Messenger.

## Endpoints atuais

- `GET /health`
- `GET /dashboard/overview`
- `GET /whatsapp/sessions`
- `POST /whatsapp/sessions`
- `POST /whatsapp/sessions/:id/connect`
- `POST /whatsapp/sessions/:id/disconnect`
- `GET /whatsapp/sessions/:id/qr`
- `GET /whatsapp/sessions/:id/conversations`
- `GET /whatsapp/sessions/:id/conversations/:conversationId/messages`
- `POST /whatsapp/sessions/:id/conversations/:conversationId/messages`

## Ordem sugerida da proxima execucao

Quando voltarmos, seguir nesta ordem:

1. consolidar `Baileys` no `apps/server`;
2. salvar sessao por numero conectado;
3. expor eventos e status em tempo real;
4. conectar `apps/web` aos endpoints reais;
5. manter ambiente limpo para validacao real em VPS/EasyPanel;
6. implementar login e usuarios;
7. ampliar schema de `PostgreSQL` e filas/locks no `Redis`.

## Observacoes importantes

- conexao via engenharia reversa do WhatsApp pode sofrer instabilidade e mudancas externas;
- varios usuarios na mesma operacao exigem auditoria e atribuicao clara;
- o inbox deve nascer desacoplado do WhatsApp para facilitar Instagram e Facebook.
