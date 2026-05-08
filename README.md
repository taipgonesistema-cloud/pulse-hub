# Pulse Hub

Central de atendimento e CRM omnichannel com foco em WhatsApp, dashboard em tempo real, gestao de contatos, kanban, respostas rapidas, usuarios, auditoria e publicacao no Instagram.

![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=nextdotjs)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=111)
![Go](https://img.shields.io/badge/Go-1.25-00ADD8?logo=go&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-7-DC382D?logo=redis&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)

## Visao Geral

O Pulse Hub e uma plataforma para operar atendimentos em canais de conversa a partir de uma interface unica. O frontend consome uma API Go responsavel por autenticacao, sessoes do WhatsApp, conversas, mensagens, contatos, metricas, eventos em tempo real e integracao com Instagram.

Principais recursos:

- Dashboard operacional com metricas de atendimento.
- Login com sessoes, CSRF, papeis de usuario e trilha de auditoria.
- Multi-sessoes de WhatsApp com QR Code, status e envio de mensagens.
- Conversas em tempo real via WebSocket.
- CRM de contatos com kanban, etiquetas e perfis.
- Respostas rapidas com autocomplete.
- Envio de texto, midia, reacoes e marcacao de leitura.
- Publicacao de feed e stories no Instagram quando as credenciais estao configuradas.
- Deploy containerizado com Docker Compose.

## Arquitetura

```txt
.
+-- apps
|   +-- web       # Frontend Next.js 16 + React 19 + Tailwind CSS 4
|   +-- wa-core   # API Go, WhatsApp, WebSocket, Postgres e Redis
|   +-- server    # Servidor NestJS mantido no repositorio
+-- scripts       # Utilitarios de desenvolvimento
+-- docker-compose.yml
+-- package.json
```

Servicos principais:

- `web`: interface web em `http://localhost:3000`.
- `wa-core`: API HTTP/WebSocket em `http://localhost:3333`.
- `postgres`: banco principal e armazenamento do WhatsApp.
- `redis`: pub/sub e suporte a eventos em tempo real.

## Stack

- Frontend: Next.js 16, React 19, TypeScript, Tailwind CSS 4, Lucide React.
- Backend principal: Go 1.25, chi, whatsmeow, PostgreSQL, Redis, WebSocket.
- Backend alternativo/legado: NestJS 11 em `apps/server`.
- Infra: Docker, Docker Compose, PostgreSQL 16, Redis 7.

## Requisitos

- Node.js 20 ou superior.
- npm 10 ou superior.
- Go 1.25 ou superior.
- Docker e Docker Compose.

## Como Rodar Localmente

### 1. Instale as dependencias

```bash
npm install
```

### 2. Suba Postgres e Redis

```bash
npm run dev:infra
```

### 3. Inicie a API Go

```bash
npm run dev:server
```

A API ficara disponivel em `http://localhost:3333`.

### 4. Inicie o frontend

Em outro terminal:

```bash
npm run dev:web
```

O painel ficara disponivel em `http://localhost:3000`.

## Rodando Tudo com Docker

```bash
docker compose up --build
```

URLs padrao:

- Frontend: `http://localhost:3000`
- API: `http://localhost:3333`
- Health check: `http://localhost:3333/health`

Para parar os containers:

```bash
docker compose down
```

Para remover tambem os volumes locais:

```bash
docker compose down -v
```

## Acesso Inicial

Em desenvolvimento, a API cria um usuario inicial automaticamente com os valores abaixo, caso as variaveis nao sejam sobrescritas:

```txt
Email: admin@pulsehub.local
Senha: PulseHub123!
Papel: admin
```

Altere `AUTH_SEED_EMAIL`, `AUTH_SEED_PASSWORD`, `AUTH_SEED_NAME` e `AUTH_SEED_ROLE` em ambientes reais.

## Variaveis de Ambiente

O arquivo `.env.easypanel.example` serve como referencia para deploy. Para desenvolvimento local, os defaults do `docker-compose.yml` ja funcionam sem `.env`.

Variaveis principais:

| Variavel | Descricao | Padrao local |
| --- | --- | --- |
| `PORT` | Porta da API Go | `3333` |
| `DATABASE_URL` | DSN do PostgreSQL da aplicacao | `postgres://postgres:postgres@localhost:5432/pulse_hub?sslmode=disable` |
| `WHATSMEOW_DATABASE_URL` | DSN usado pelo WhatsApp/whatsmeow | Mesmo valor de `DATABASE_URL` |
| `REDIS_URL` | URL de conexao com Redis | `redis://localhost:6379/0` |
| `NEXT_PUBLIC_API_URL` | URL publica da API consumida pelo frontend | `http://localhost:3333` |
| `AUTH_SEED_EMAIL` | Email do usuario inicial | `admin@pulsehub.local` |
| `AUTH_SEED_PASSWORD` | Senha do usuario inicial | `PulseHub123!` |
| `AUTH_COOKIE_SECURE` | Cookies apenas via HTTPS | `false` |
| `AUTH_COOKIE_SAME_SITE` | Politica SameSite do cookie | `lax` |
| `CORS_ALLOWED_ORIGINS` | Origens permitidas, separadas por virgula | localhost do frontend |

Variaveis opcionais para Instagram e hospedagem de imagem:

| Variavel | Descricao |
| --- | --- |
| `INSTAGRAM_APP_ID` | ID do app Meta/Instagram |
| `INSTAGRAM_APP_SECRET` | Secret do app Meta/Instagram |
| `INSTAGRAM_ACCESS_TOKEN` | Token Graph API |
| `INSTAGRAM_USER_ID` | ID do usuario/conta Instagram |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary cloud name |
| `CLOUDINARY_API_KEY` | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | Cloudinary API secret |
| `CLOUDINARY_FOLDER` | Pasta de upload no Cloudinary |
| `INSTAGRAM_IMAGE_HOST_API_KEY` | Chave alternativa para hospedagem de imagem |

## Scripts Disponiveis

Na raiz do projeto:

| Comando | Descricao |
| --- | --- |
| `npm run dev:infra` | Sobe Postgres e Redis via Docker Compose |
| `npm run dev:infra:down` | Para Postgres e Redis |
| `npm run dev:web` | Inicia o frontend Next.js |
| `npm run dev:server` | Inicia a API Go em modo desenvolvimento |
| `npm run build:web` | Gera build de producao do frontend |
| `npm run build:server` | Compila a API Go |
| `npm run lint:web` | Executa ESLint no frontend |
| `npm run lint:server` | Executa `go test ./...` na API Go |

No app web:

```bash
npm run dev --workspace web
npm run build --workspace web
npm run start --workspace web
npm run lint --workspace web
```

## API Principal

Base URL local: `http://localhost:3333`

Endpoints publicos:

- `GET /health`
- `POST /auth/sign-in`
- `GET /ws`

Endpoints autenticados incluem:

- `GET /auth/me`
- `POST /auth/sign-out`
- `GET /auth/users`
- `GET /auth/audit-logs`
- `GET /dashboard/overview`
- `POST /session/init`
- `GET /session/qr`
- `GET /session/status`
- `GET /contacts`
- `GET /chats`
- `POST /messages/text`
- `POST /messages/media`
- `GET /whatsapp/sessions`
- `POST /whatsapp/sessions`
- `POST /whatsapp/sessions/{id}/connect`
- `POST /whatsapp/sessions/{id}/disconnect`
- `GET /whatsapp/conversations`
- `GET /whatsapp/quick-replies`
- `POST /instagram/feed`
- `POST /instagram/story`

## Deploy

### Docker Compose

O deploy mais simples e usar `docker-compose.yml`, ajustando as variaveis de ambiente para o dominio real:

```bash
docker compose up -d --build
```

### Easypanel

Use `.env.easypanel.example` como base e configure pelo menos:

- `DATABASE_URL`
- `WHATSMEOW_DATABASE_URL`
- `REDIS_URL`
- `AUTH_SEED_EMAIL`
- `AUTH_SEED_PASSWORD`
- `NEXT_PUBLIC_API_URL`
- `CORS_ALLOWED_ORIGINS` ou `APP_ORIGIN`
- `AUTH_COOKIE_SECURE=true` em HTTPS
- `AUTH_COOKIE_SAME_SITE=none` quando frontend e API estiverem em dominios diferentes

## Desenvolvimento

Fluxo recomendado antes de abrir PR:

```bash
npm run lint:web
npm run lint:server
npm run build:web
npm run build:server
```

## Seguranca

- Nao versione arquivos `.env` reais.
- Troque a senha seed em qualquer ambiente compartilhado ou de producao.
- Configure CORS explicitamente em producao.
- Use cookies seguros (`AUTH_COOKIE_SECURE=true`) em HTTPS.
- Proteja tokens do Instagram, credenciais Cloudinary e DSNs de banco/Redis.

## Licenca

Projeto privado. Defina uma licenca antes de publicar como open source.
