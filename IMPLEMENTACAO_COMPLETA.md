# Implementacao Completa

Este documento descreve a implementacao atual da stack propria de WhatsApp deste repositorio.

## Objetivo

Substituir a stack antiga baseada em backend Node legado por uma implementacao propria com:

- Go moderno
- `tulir/whatsmeow`
- API REST
- WebSocket
- PostgreSQL
- Redis
- compatibilidade com a UI existente

## Estrutura final

```text
apps/
|- wa-core/
|  |- cmd/server/
|  |- internal/http/
|  |- internal/models/
|  |- internal/store/
|  |- internal/whatsapp/
|  |- internal/ws/
|- web/
```

## Backend `apps/wa-core`

### `cmd/server`

Responsavel por:

- carregar envs
- abrir PostgreSQL
- abrir Redis
- criar manager do WhatsApp
- subir API HTTP
- tratar shutdown gracioso

Arquivo principal:

- `apps/wa-core/cmd/server/main.go`

### `internal/store`

Responsavel por:

- migrar schema da aplicacao
- persistir sessao logica
- persistir contatos
- persistir chats
- persistir mensagens

Arquivo principal:

- `apps/wa-core/internal/store/postgres.go`

Tabelas criadas:

- `app_session`
- `contacts`
- `chats`
- `messages`

### `internal/whatsapp`

Responsavel por:

- inicializar `whatsmeow`
- abrir `sqlstore` oficial do `whatsmeow`
- iniciar QR login
- acompanhar status da conexao
- ingerir `HistorySync`
- receber mensagens em tempo real
- enviar mensagens de texto
- atualizar status/ack
- buscar foto de perfil

Arquivo principal:

- `apps/wa-core/internal/whatsapp/manager.go`

Eventos tratados:

- `Connected`
- `Disconnected`
- `LoggedOut`
- `ConnectFailure`
- `PairSuccess`
- `Message`
- `HistorySync`
- `Receipt`
- `Contact`
- `PushName`
- `BusinessName`
- `Picture`

### `internal/http`

Responsavel por:

- expor API nova
- expor endpoints de compatibilidade da UI
- expor stream SSE de compatibilidade

Arquivo principal:

- `apps/wa-core/internal/http/handlers.go`

### `internal/ws`

Responsavel por:

- manter clientes WebSocket locais
- distribuir eventos locais
- publicar eventos no Redis
- receber eventos do Redis e redistribuir

Arquivo principal:

- `apps/wa-core/internal/ws/hub.go`

### `internal/models`

Responsavel por:

- DTOs REST
- DTOs WS
- modelos de sessao, contato, chat e mensagem

Arquivo principal:

- `apps/wa-core/internal/models/models.go`

## Frontend `apps/web`

A UI foi preservada.

Em vez de reescrever a dashboard, o backend Go foi adaptado para manter contratos usados pela tela atual.

Por isso, alem da API nova, ele expoe endpoints de compatibilidade como:

- `POST /auth/sign-in`
- `GET /dashboard/overview`
- `GET /whatsapp/sessions`
- `POST /whatsapp/sessions`
- `POST /whatsapp/sessions/:id/connect`
- `GET /whatsapp/sessions/:id/conversations`
- `GET /whatsapp/sessions/:id/stream`

## Persistencia

### PostgreSQL

Usado para:

- dados da aplicacao
- store do `whatsmeow`
- historico de mensagens
- indice de chats
- contatos

### Redis

Usado para:

- pub/sub de eventos realtime
- fanout entre instancias no futuro
- suporte ao WebSocket/SSE atual

## Endpoints da API nova

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

## Eventos realtime

- `connection`
- `chat.new`
- `message.new`
- `message.ack`

## Variaveis de ambiente

### Backend

```env
PORT=3333
DATABASE_URL=postgres://postgres:postgres@localhost:5432/pulse_hub?sslmode=disable
WHATSMEOW_DATABASE_URL=postgres://postgres:postgres@localhost:5432/pulse_hub?sslmode=disable
REDIS_URL=redis://localhost:6379/0
AUTH_SEED_EMAIL=admin@pulsehub.local
AUTH_SEED_PASSWORD=PulseHub123!
AUTH_SEED_NAME=Pulse Hub Admin
AUTH_SEED_ROLE=admin
```

### Frontend

```env
NEXT_PUBLIC_API_URL=http://localhost:3333
```

## Fluxo de execucao local

### 1. Infra

```bash
npm run dev:infra
```

### 2. Backend

```bash
npm run dev:server
```

### 3. Frontend

```bash
npm run dev:web
```

## Fluxo funcional

1. usuario faz login na UI
2. UI chama backend Go
3. sessao principal e criada
4. backend inicia `whatsmeow`
5. QR e gerado
6. usuario escaneia QR
7. backend recebe eventos de conexao
8. contatos, chats e mensagens sao sincronizados
9. eventos chegam na UI via WebSocket/SSE

## Build e validacao

Comandos validados nesta implementacao:

```bash
npm run build:web
npm run build:server
npm run lint:server
```

## Decisoes importantes

- `single-session` primeiro
- `whatsmeow` direto, sem gateway pronto
- UI antiga mantida por compatibilidade de API
- Postgres para persistencia robusta
- Redis para realtime distribuido
- backend antigo retirado do fluxo operacional

## O que saiu do fluxo operacional

O backend legado em `apps/server` nao participa mais de:

- build do frontend
- scripts principais da raiz
- deploy no EasyPanel
- Dockerfile de producao

Ele permanece apenas como referencia historica no repositorio.

## Proximas evolucoes naturais

- multi-sessao com `sessionId` real nas rotas
- anexos e midias
- reconnect/backoff observavel
- painel de diagnostico do WhatsApp
- workers separados para sync pesado
