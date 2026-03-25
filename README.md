# Pulse Hub

Plataforma omnichannel com foco inicial em WhatsApp Web, inbox compartilhado em tempo real e arquitetura pronta para crescer com PostgreSQL, Redis e deploy em EasyPanel.

## Visao Geral

O projeto foi estruturado como um monorepo com dashboard web e API separadas, permitindo operar varias sessoes, gerar QR code para conexao, centralizar conversas e evoluir depois para Instagram e Facebook sem reescrever o nucleo do inbox.

## Stack

- `Next.js 16` no frontend em `apps/web`
- `NestJS 11` no backend em `apps/server`
- `PostgreSQL` para persistencia de sessoes, conversas, mensagens e canais
- `Redis` para cache do overview e distribuicao de eventos em tempo real
- `whatsapp-web.js` + `puppeteer` para o fluxo de QR e conexao real

## Arquitetura

```text
apps/web      -> dashboard operacional
apps/server   -> API + SSE + integracao WhatsApp
PostgreSQL    -> persistencia principal
Redis         -> cache e pub/sub
EasyPanel     -> deploy via GitHub com servicos separados
```

## O Que Ja Esta Pronto

- criacao de sessoes de WhatsApp por numero e canal
- conexao e reconexao via QR code
- inbox compartilhado por sessao
- leitura e envio de mensagens
- sincronizacao de conversas e mensagens do WhatsApp Web
- cache do overview com Redis
- persistencia do backend em PostgreSQL
- estrutura pronta para deploy no EasyPanel

## Endpoints Principais

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
- `POST /whatsapp/sessions/:id/conversations/:conversationId/read`
- `GET /whatsapp/sessions/:id/stream`

## Estrutura do Repositorio

```text
.
|- apps/
|  |- server/
|  |  |- src/
|  |  |- Dockerfile
|  |- web/
|     |- src/
|     |- Dockerfile
|- docker-compose.yml
|- EASYPANEL.md
|- IMPLEMENTACAO_MVP.md
```

## Rodando Localmente

### 1. Suba a infraestrutura

```bash
docker compose up -d postgres redis
```

### 2. Configure o ambiente

Crie um `.env` na raiz com base em `.env.example`.

Exemplo:

```env
WEB_PORT=3000
SERVER_PORT=3333
NEXT_PUBLIC_API_URL=http://localhost:3333
DATABASE_URL=postgres://postgres:postgres@localhost:5432/pulse_hub
REDIS_URL=redis://localhost:6379
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
PUPPETEER_HEADLESS=true
```

### 3. Rode backend e frontend

```bash
npm run dev:server
npm run dev:web
```

## Build e Validacao

```bash
npm run build:server
npm run lint:server
npm test --workspace server
npm run build:web
npm run lint:web
```

## Persistencia e Tempo Real

### PostgreSQL

O backend persiste:

- canais
- sessoes do WhatsApp
- conversas
- mensagens

### Redis

O Redis e usado para:

- cache do `dashboard/overview`
- pub/sub dos eventos de sessao e mensagens
- preparar o terreno para filas, locks e retentativas

## Persistencia da Sessao do WhatsApp

As credenciais do WhatsApp Web ficam em `apps/server/.wwebjs_auth`.

Em ambiente local ou producao, esse diretorio deve ser persistido. Sem isso, a autenticacao pode ser perdida depois de restart ou redeploy.

## Deploy no EasyPanel

O projeto esta preparado para subir pelo GitHub com frontend e backend separados.

Resumo rapido:

- backend usando `apps/server/Dockerfile`
- frontend usando `apps/web/Dockerfile`
- PostgreSQL e Redis como servicos dedicados
- volume persistente para `apps/server/.wwebjs_auth`
- `NEXT_PUBLIC_API_URL` definido no build e no runtime do frontend

Guia completo em `EASYPANEL.md`.

## Variaveis Importantes

### Backend

```env
PORT=3333
DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/pulse_hub
REDIS_URL=redis://HOST:6379
WHATSAPP_ENGINE=webjs
AUTH_SEED_EMAIL=admin@pulsehub.local
AUTH_SEED_PASSWORD=PulseHub123!
AUTH_SEED_NAME=Pulse Hub Admin
AUTH_SEED_ROLE=admin
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
PUPPETEER_HEADLESS=true
```

Quando a tabela `users` estiver vazia, o backend cria automaticamente o usuario inicial com essas variaveis para liberar o primeiro acesso.

`WHATSAPP_ENGINE=webjs` usa a engine atual com `whatsapp-web.js`. Se quiser preparar a troca para Baileys, use `WHATSAPP_ENGINE=baileys`.

### Frontend

```env
NEXT_PUBLIC_API_URL=https://api.seu-dominio.com
```

## Roadmap Natural

- autenticacao e multiusuario
- atribuicao de conversas
- tags, notas internas e filtros operacionais
- filas Redis para processamento assincorono
- adaptadores para Instagram Direct e Facebook Messenger
- migracoes formais e observabilidade

## Documentacao Complementar

- `EASYPANEL.md` - deploy pelo GitHub no EasyPanel
- `IMPLEMENTACAO_MVP.md` - contexto tecnico e plano de evolucao

## Status

Base pronta para desenvolvimento local, persistencia com Postgres/Redis e deploy inicial em EasyPanel.
