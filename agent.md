# Project Agent Guide

## What This Project Is

This repository is a monorepo for a custom WhatsApp operations platform.

Current production-oriented stack:

- `apps/wa-core`: Go backend using `tulir/whatsmeow`
- `apps/web`: Next.js dashboard UI
- PostgreSQL: application data + official whatsmeow SQL store
- Redis: realtime pub/sub for WebSocket and SSE fanout

The project no longer depends on WAHA, Evolution, GOWA, WuzAPI, WPPConnect, or any ready-made WhatsApp gateway.

## Main Goals

- Maintain a direct WhatsApp integration using `whatsmeow`
- Keep the web dashboard working without breaking compatibility
- Persist sessions, contacts, chats, and messages
- Support QR login, realtime updates, chat listing, contact avatars, and message send/receive
- Stay deployable on EasyPanel from GitHub

## Core Architecture

### Active backend

`apps/wa-core`

Important folders:

- `cmd/server`: application bootstrap
- `internal/http`: REST API and compatibility endpoints
- `internal/models`: shared backend DTOs and models
- `internal/store`: PostgreSQL persistence
- `internal/whatsapp`: whatsmeow manager, QR flow, event ingestion, sending, photo logic
- `internal/ws`: WebSocket + Redis pub/sub hub

### Active frontend

`apps/web`

Important areas:

- `src/app`: app router pages and icons
- `src/components/dashboard-client.tsx`: main operational dashboard UI
- `src/lib/pulse-hub.ts`: frontend API types and data fetch helpers

### Legacy code

`apps/server` exists only as historical reference.

It is not part of the active runtime, deployment path, or supported architecture.

## Deployment Context

Primary deployment target:

- EasyPanel on Ubuntu VPS

Expected services:

- PostgreSQL
- Redis
- `pulse-hub-wa-core`
- `pulse-hub-web`

Important env vars used by the backend:

- `PORT`
- `DATABASE_URL`
- `WHATSMEOW_DATABASE_URL`
- `REDIS_URL`
- `AUTH_SEED_EMAIL`
- `AUTH_SEED_PASSWORD`
- `AUTH_SEED_NAME`
- `AUTH_SEED_ROLE`

Important env var used by the frontend:

- `NEXT_PUBLIC_API_URL`

## What An Agent Should Do

- Preserve the Go + whatsmeow architecture
- Keep the current REST and compatibility contracts working
- Prefer changing `apps/wa-core` over reviving `apps/server`
- Preserve EasyPanel deployability
- Preserve PostgreSQL + Redis assumptions
- Keep the project single-session unless the user explicitly asks for multi-session
- Maintain avatar/photo stability, chat deduplication, and LID/PN normalization
- Run relevant builds after changes when possible
- Keep the UI usable on desktop and mobile
- Follow existing compatibility endpoints used by the web dashboard

## What An Agent Must Not Do

- Do not reintroduce WAHA, Evolution, GOWA, WuzAPI, WPPConnect, or similar gateways
- Do not move persistence back to SQLite unless the user explicitly asks
- Do not make `apps/server` the active backend again
- Do not break the web dashboard contract casually
- Do not change production env names without updating the whole stack consistently
- Do not assume multi-session support exists yet
- Do not remove LID/PN normalization logic without understanding the side effects
- Do not force destructive git operations

## Important Existing Behaviors

- The backend exposes both a new API and compatibility endpoints for the dashboard
- Chat identity normalization matters because the same person may appear as `@lid` and `@s.whatsapp.net`
- Avatar handling uses a backend photo endpoint/proxy flow to reduce broken image issues
- The frontend message composer was isolated to reduce typing lag
- Ghost protocol/media echoes were filtered from the timeline

## Validation Commands

From the repo root:

```bash
npm run build:server
npm run lint:server
npm run build:web
```

Local infra helpers:

```bash
npm run dev:infra
npm run dev:infra:down
```

## Priority Rule For Future Work

If there is any conflict between elegance and operational stability, prefer operational stability.

This project is already connected to a live EasyPanel deployment path, so regressions in auth, QR, sending, chat listing, avatars, or compatibility endpoints are high-risk.
