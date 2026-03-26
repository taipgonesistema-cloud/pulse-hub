# Pulse Hub

Stack propria de WhatsApp usando `Go + tulir/whatsmeow`, com API REST, WebSocket, PostgreSQL, Redis e compatibilidade com a UI web atual.

## O que mudou

- backend principal agora fica em `apps/wa-core`
- `whatsmeow` e usado direto, sem WAHA, Evolution, GOWA, WuzAPI ou gateway pronto
- a UI em `apps/web` continua funcional porque o backend Go expoe:
  - os endpoints novos pedidos
  - endpoints de compatibilidade usados pela dashboard atual

## Estrutura

```text
apps/
|- wa-core/
|  |- cmd/server
|  |- internal/http
|  |- internal/models
|  |- internal/store
|  |- internal/whatsapp
|  |- internal/ws
|- web/
```

## Backend Go

- `cmd/server` - bootstrap HTTP e config
- `internal/whatsapp` - sessao `whatsmeow`, QR, eventos, envio e recebimento
- `internal/store` - PostgreSQL para sessao, contatos, chats e mensagens
- `internal/http` - rotas REST novas e rotas de compatibilidade da UI
- `internal/ws` - broadcast WebSocket e base para SSE de compatibilidade
- `internal/models` - DTOs e tipos compartilhados

## Requisitos no Ubuntu

Instale Go atual, PostgreSQL e Redis para desenvolvimento local:

```bash
sudo apt update
sudo apt install -y build-essential gcc postgresql-client redis-tools
```

Se ainda nao tiver Go:

```bash
sudo snap install go --classic
```

## Ambiente

Crie `.env` na raiz com base em `.env.example`.

Para deploy, use `.env.easypanel.example` como referencia de variaveis.

Exemplo:

```env
WEB_PORT=3000
SERVER_PORT=3333
NEXT_PUBLIC_API_URL=http://localhost:3333
DATABASE_URL=postgres://postgres:postgres@localhost:5432/pulse_hub?sslmode=disable
WHATSMEOW_DATABASE_URL=postgres://postgres:postgres@localhost:5432/pulse_hub?sslmode=disable
REDIS_URL=redis://localhost:6379/0
AUTH_SEED_EMAIL=admin@pulsehub.local
AUTH_SEED_PASSWORD=PulseHub123!
AUTH_SEED_NAME=Pulse Hub Admin
AUTH_SEED_ROLE=admin
```

## Instalacao

Instale as dependencias do frontend:

```bash
npm install
```

Baixe os modulos Go:

```bash
cd apps/wa-core
go mod tidy
cd ../..
```

## Rodando localmente

Infra local:

```bash
npm run dev:infra
```

Backend Go:

```bash
npm run dev:server
```

Frontend Next:

```bash
npm run dev:web
```

## Fluxo de login e QR

1. Abra `http://localhost:3000/login`
2. Entre com as credenciais de `AUTH_SEED_EMAIL` e `AUTH_SEED_PASSWORD`
3. Na aba `Settings`, crie a sessao principal
4. Clique em `Gerar QR / conectar`
5. Escaneie o QR pelo WhatsApp no celular
6. A sessao deve mudar para `Online`

Tambem e possivel iniciar direto pela API:

```bash
curl -X POST http://localhost:3333/session/init \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "WhatsApp principal",
    "phoneNumber": "+5511999999999",
    "channelName": "Comercial"
  }'
```

Depois consulte o QR:

```bash
curl http://localhost:3333/session/qr
```

## Endpoints principais

### Core

- `GET /health`
- `POST /session/init`
- `GET /session/qr`
- `GET /session/status`
- `GET /contacts`
- `GET /contacts/:jid/photo`
- `GET /chats`
- `GET /chats/:jid/messages`
- `POST /messages/text`
- `GET /ws`

### Compatibilidade da UI atual

- `POST /auth/sign-in`
- `GET /dashboard/overview`
- `GET /whatsapp/sessions`
- `POST /whatsapp/sessions`
- `POST /whatsapp/sessions/:id/connect`
- `POST /whatsapp/sessions/:id/disconnect`
- `GET /whatsapp/sessions/:id/qr`
- `GET /whatsapp/sessions/:id/conversations`
- `GET /whatsapp/sessions/:id/conversations/:jid/messages`
- `POST /whatsapp/sessions/:id/conversations/:jid/messages`
- `POST /whatsapp/sessions/:id/conversations/:jid/read`
- `GET /whatsapp/sessions/:id/stream`

## Testando a API

Status da sessao:

```bash
curl http://localhost:3333/session/status
```

Listar contatos:

```bash
curl http://localhost:3333/contacts
```

Listar chats:

```bash
curl http://localhost:3333/chats
```

Listar mensagens de um chat:

```bash
curl "http://localhost:3333/chats/5511999999999%40s.whatsapp.net/messages"
```

Enviar texto:

```bash
curl -X POST http://localhost:3333/messages/text \
  -H 'Content-Type: application/json' \
  -d '{
    "jid": "5511999999999@s.whatsapp.net",
    "text": "Oi, mensagem enviada pela API Go"
  }'
```

## Testando WebSocket

Conecte em:

```text
ws://localhost:3333/ws
```

Eventos emitidos:

- `connection`
- `chat.new`
- `message.new`
- `message.ack`

## Persistencia

Persistencia principal e realtime ficam em:

- PostgreSQL
  - credenciais/sessao do `whatsmeow`
  - sessao logica da aplicacao
  - contatos
  - chats
  - mensagens
- Redis
  - pub/sub dos eventos em tempo real
  - base para escalar WebSocket/SSE depois

Configuracao padrao local:

```env
DATABASE_URL=postgres://postgres:postgres@localhost:5432/pulse_hub?sslmode=disable
WHATSMEOW_DATABASE_URL=postgres://postgres:postgres@localhost:5432/pulse_hub?sslmode=disable
REDIS_URL=redis://localhost:6379/0
```

## Deploy no EasyPanel

Esse projeto esta preparado para subir pelo GitHub no EasyPanel com:

- backend em `apps/wa-core/Dockerfile`
- frontend em `apps/web/Dockerfile`
- PostgreSQL e Redis como servicos separados

Guias:

- `EASYPANEL.md`
- `IMPLEMENTACAO_COMPLETA.md`

## Comandos uteis

```bash
npm run dev:infra
npm run dev:infra:down
npm run dev:server
npm run dev:web
npm run build:server
npm run build:web
npm run lint:server
npm run lint:web
```

## Observacoes

- o projeto atual esta preparado para `single-session` primeiro
- a estrutura interna ja deixa a evolucao para multi-sessao mais simples
- `HistorySync` e usado para hidratar chats e mensagens antigas
- a listagem de chats e mantida localmente no PostgreSQL
- fotos de perfil sao resolvidas pelo `whatsmeow` e cacheadas localmente
