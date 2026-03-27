# Project Walktrough

## Current State Snapshot

This repository currently runs a custom WhatsApp dashboard stack composed of:

- Go backend in `apps/wa-core`
- Next.js frontend in `apps/web`
- PostgreSQL for application and WhatsApp session persistence
- Redis for realtime event propagation

The active architecture is no longer based on the old Node backend.

## Repository Path Walkthrough

### Root

Important root files:

- `package.json`: root scripts for web, Go backend, and local infra helpers
- `package-lock.json`: npm lockfile
- `docker-compose.yml`: local composition for Postgres, Redis, backend, and frontend
- `.env.example`: local env reference
- `.env.easypanel.example`: deployment env reference for EasyPanel
- `scripts/go-runner.js`: helper to run Go commands reliably from npm scripts

### `apps/wa-core`

This is the active backend.

#### `apps/wa-core/cmd/server/main.go`

Bootstraps:

- config loading
- PostgreSQL connection
- Redis hub connection
- WhatsApp manager
- HTTP server startup and shutdown

#### `apps/wa-core/internal/http`

Contains the public HTTP API.

Main responsibilities:

- health endpoint
- session init, QR, and status
- contacts, chats, and messages endpoints
- send text endpoint
- WebSocket endpoint
- compatibility endpoints for the dashboard

Compatibility routes include:

- `/auth/sign-in`
- `/dashboard/overview`
- `/whatsapp/sessions/...`

#### `apps/wa-core/internal/models`

Defines backend response/request models used by the API and realtime events.

Includes:

- session models
- contact models
- chat models
- message models
- dashboard compatibility DTOs
- photo response model

#### `apps/wa-core/internal/store`

Implements PostgreSQL persistence.

Current tables managed by the app layer:

- `app_session`
- `contacts`
- `chats`
- `messages`

What is persisted:

- session metadata
- contacts and display names
- chat index and unread counts
- message timeline data
- cached avatar metadata such as `photo_id` and `photo_url`

#### `apps/wa-core/internal/whatsapp`

This is the core integration logic.

Responsibilities:

- initialize whatsmeow client
- pair via QR code
- reconnect existing device store
- process message and receipt events
- sync contacts and chats
- normalize conversations between `@lid` and `@s.whatsapp.net`
- fetch and refresh profile photos
- send text messages
- filter protocol/noise events from the timeline

Important behaviors already implemented:

- QR flow uses a persistent context
- LID/PN chat normalization exists
- message send path supports compatibility payloads from the dashboard
- protocol echo noise is filtered out of visible messages
- avatar fetching can return both raw URL data and a proxy-style backend path

#### `apps/wa-core/internal/ws`

Realtime layer.

Responsibilities:

- local WebSocket clients
- local subscribers for SSE compatibility
- Redis publish/subscribe fanout

Events broadcast include:

- connection updates
- new chat sync
- new messages
- message ack/status changes

### `apps/web`

This is the active UI.

#### `apps/web/src/app`

- route entrypoints
- app layout
- login page
- icon assets

#### `apps/web/src/components/dashboard-client.tsx`

This is the main operational screen and currently contains most of the dashboard behavior.

Current implemented behaviors include:

- session selection and control
- QR display
- conversation list
- group/direct/unread filters
- conversation deduplication on the client side
- timeline rendering
- optimized composer with reduced typing lag
- avatar rendering with backend-relative avatar URLs

#### `apps/web/src/lib/pulse-hub.ts`

Frontend API type definitions and dashboard bootstrap helpers.

## Runtime Flow

### 1. Backend startup

When `wa-core` starts, it:

- reads env vars
- opens PostgreSQL
- opens Redis
- creates the whatsmeow manager
- restores the first stored device if one exists
- exposes HTTP endpoints

### 2. Login and dashboard load

The frontend authenticates via compatibility auth and loads:

- `/dashboard/overview`

That payload drives the dashboard state.

### 3. Session init and QR

When the user initializes or reconnects a session:

- backend prepares the whatsmeow client
- QR channel is opened
- QR image is generated
- frontend shows the QR in the settings area

### 4. Pairing and sync

After the phone scans the QR:

- backend receives pairing/connect events
- session status becomes active
- contacts are synced
- history sync is ingested
- chats and messages are stored

### 5. Conversation rendering

The backend builds dashboard conversations from stored chats and contact metadata.

Important detail:

- duplicate entries caused by `@lid` vs `@s.whatsapp.net` are normalized and merged

### 6. Sending messages

The frontend sends through compatibility routes.

Backend flow:

- accepts compatibility JSON payload
- resolves target JID
- normalizes send target when possible
- sends through whatsmeow
- stores outgoing message
- refreshes overview/messages

### 7. Avatar flow

The backend stores photo metadata and exposes:

- `/contacts/:jid/photo`

The frontend uses backend-relative avatar URLs so photo rendering remains stable even if the raw WhatsApp URL changes.

## Current Known Strengths

- direct whatsmeow integration is working
- QR pairing works
- session connection works
- sending messages works
- chats and contacts list works
- avatars are significantly more stable than before
- chat duplication has been reduced by canonical JID merging
- typing lag in the composer has been reduced

## Current Known Constraints

- active model is still single-session
- `apps/server` is legacy and should not be treated as active runtime
- `dashboard-client.tsx` is still a large file and could be split further later
- the frontend build may show local Next lockfile patch warnings, but the build currently completes successfully
- EasyPanel deploys should keep backend replicas at `1`

## Current Deployment Shape

Expected EasyPanel services:

- PostgreSQL service
- Redis service
- `pulse-hub-wa-core` app
- `pulse-hub-web` app

Backend critical env vars:

- `DATABASE_URL`
- `WHATSMEOW_DATABASE_URL`
- `REDIS_URL`

Frontend critical env var:

- `NEXT_PUBLIC_API_URL`

## Recommended Next Technical Refactors

- split `dashboard-client.tsx` into smaller UI components
- create a dedicated avatar/photo service abstraction in the frontend
- add structured message-type support instead of `[midia]` fallback
- add stronger observability around WhatsApp events and reconnect cycles
- consider multi-session support only with explicit product decision

## Safe Working Rules For Future Changes

- prefer editing `apps/wa-core` instead of touching legacy `apps/server`
- preserve compatibility endpoints unless the frontend is migrated in the same change
- avoid breaking the EasyPanel deployment model
- validate both backend and frontend after meaningful changes
