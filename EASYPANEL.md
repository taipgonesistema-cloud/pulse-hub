# EasyPanel Deployment Guide

Este projeto esta preparado para deploy pelo GitHub no EasyPanel com a seguinte stack:

- `pulse-hub-postgres` - banco principal
- `pulse-hub-redis` - pub/sub em tempo real
- `pulse-hub-wa-core` - backend Go + `whatsmeow`
- `pulse-hub-web` - frontend Next.js

Sem WAHA, Evolution, GOWA, WuzAPI, WPPConnect ou gateways prontos.

## Arquitetura

- `apps/wa-core`
  - API REST
  - WebSocket
  - compatibilidade com a UI atual
  - `whatsmeow` direto
  - persistencia de negocio no PostgreSQL
  - store oficial do `whatsmeow` no PostgreSQL
  - broadcast distribuido via Redis
- `apps/web`
  - dashboard web atual
  - continua consumindo os contratos de compatibilidade do backend Go

## Servicos no EasyPanel

### 1. PostgreSQL

Crie um servico `PostgreSQL`.

- nome sugerido: `pulse-hub-postgres`
- database sugerido: `pulse_hub`

### 2. Redis

Crie um servico `Redis`.

- nome sugerido: `pulse-hub-redis`

### 3. Backend

Crie um servico `App` com fonte GitHub.

- nome: `pulse-hub-wa-core`
- branch: `main`
- Dockerfile path: `apps/wa-core/Dockerfile`
- porta interna: `3333`
- health check: `/health`
- replicas: `1`

### 4. Frontend

Crie outro servico `App` com fonte GitHub.

- nome: `pulse-hub-web`
- branch: `main`
- Dockerfile path: `apps/web/Dockerfile`
- porta interna: `3000`

## Variaveis do backend

Use estas variaveis no servico `pulse-hub-wa-core`:

```env
PORT=3333
DATABASE_URL=postgres://USER:PASSWORD@POSTGRES_HOST:5432/POSTGRES_DB?sslmode=disable
WHATSMEOW_DATABASE_URL=postgres://USER:PASSWORD@POSTGRES_HOST:5432/POSTGRES_DB?sslmode=disable
REDIS_URL=redis://default:REDIS_PASSWORD@REDIS_HOST:6379/0
AUTH_SEED_EMAIL=admin@seudominio.com
AUTH_SEED_PASSWORD=UMA_SENHA_FORTE
AUTH_SEED_NAME=Administrador Pulse Hub
AUTH_SEED_ROLE=admin
```

Notas:

- `DATABASE_URL` guarda `sessions`, `contacts`, `chats` e `messages`
- `WHATSMEOW_DATABASE_URL` guarda o store oficial do `whatsmeow`
- voce pode usar a mesma URL do Postgres nos dois campos
- `REDIS_URL` distribui eventos entre conexoes WebSocket/SSE

## Variaveis do frontend

No servico `pulse-hub-web`, configure:

### Build Arg

```env
NEXT_PUBLIC_API_URL=https://api.seu-dominio.com
```

### Runtime Env

```env
NEXT_PUBLIC_API_URL=https://api.seu-dominio.com
```

## Ordem recomendada de deploy

1. conectar o repositorio GitHub no EasyPanel
2. criar `pulse-hub-postgres`
3. criar `pulse-hub-redis`
4. criar `pulse-hub-wa-core`
5. configurar as envs do backend
6. subir o backend e validar `GET /health`
7. criar `pulse-hub-web`
8. configurar o build arg e a env `NEXT_PUBLIC_API_URL`
9. subir o frontend
10. abrir `/login`, autenticar e iniciar a sessao principal

## URL internas recebidas do EasyPanel

Se o EasyPanel te entregar internal URLs completas, use elas diretamente.

Exemplo de formato:

```env
DATABASE_URL=postgres://postgres:SENHA@nome-interno-postgres:5432/meu_banco?sslmode=disable
WHATSMEOW_DATABASE_URL=postgres://postgres:SENHA@nome-interno-postgres:5432/meu_banco?sslmode=disable
REDIS_URL=redis://default:SENHA@nome-interno-redis:6379/0
```

## Dominio sugerido

- backend: `api.seu-dominio.com`
- frontend: `app.seu-dominio.com`

## Smoke test pos deploy

### 1. Health check

```bash
curl https://api.seu-dominio.com/health
```

Resposta esperada:

```json
{"status":"ok","service":"wa-core"}
```

### 2. Login seed

- abrir `https://app.seu-dominio.com/login`
- entrar com `AUTH_SEED_EMAIL` e `AUTH_SEED_PASSWORD`

### 3. Inicializar sessao

```bash
curl -X POST https://api.seu-dominio.com/session/init \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "WhatsApp principal",
    "phoneNumber": "+5511999999999",
    "channelName": "Comercial"
  }'
```

### 4. Obter QR

```bash
curl https://api.seu-dominio.com/session/qr
```

### 5. Confirmar status

```bash
curl https://api.seu-dominio.com/session/status
```

### 6. Confirmar eventos realtime

- abrir a UI
- conectar uma sessao
- verificar se a tela recebe atualizacao em tempo real
- validar `connection`, `chat.new`, `message.new` e `message.ack`

## Troubleshooting

### Backend nao sobe

- validar `DATABASE_URL`
- validar `WHATSMEOW_DATABASE_URL`
- validar `REDIS_URL`
- confirmar se Postgres e Redis estao saudaveis no EasyPanel

### QR nao aparece

- verificar `POST /session/init`
- verificar `GET /session/qr`
- checar logs do `pulse-hub-wa-core`

### UI nao carrega dados

- confirmar `NEXT_PUBLIC_API_URL`
- confirmar se o backend responde em `/dashboard/overview`
- checar CORS e dominio configurado no EasyPanel

### WebSocket nao atualiza

- confirmar proxy com suporte a WebSocket
- validar `GET /ws`
- validar conectividade do Redis

## Restricoes atuais

- operacao recomendada com `1 replica` do backend
- implementacao atual e `single-session`
- multi-sessao pode ser adicionada depois, mas nao e o alvo desta fase

## Arquivos importantes

- `apps/wa-core/Dockerfile`
- `apps/wa-core/cmd/server/main.go`
- `apps/wa-core/internal/store/postgres.go`
- `apps/wa-core/internal/ws/hub.go`
- `apps/web/Dockerfile`
- `.env.example`
- `.env.easypanel.example`
