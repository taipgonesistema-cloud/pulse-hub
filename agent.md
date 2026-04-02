# Agent Guide

## Mission

Transform `apps/wa-core` from single-session WhatsApp operation into real multi-session support, starting with two simultaneous connected numbers and expanding cleanly beyond that.

## Active Stack

- `apps/wa-core`: Go backend using `whatsmeow`
- `apps/web`: Next.js operational dashboard
- PostgreSQL: app state and `whatsmeow` persistence
- Redis: realtime fanout for websocket and stream events

## Non-Negotiables

- Keep `apps/wa-core` as the active backend
- Keep `apps/web` as the active frontend
- Keep using `whatsmeow` directly
- Preserve EasyPanel deployability
- Preserve current auth, role gating, audit log, cookie auth, and CSRF protections
- Avoid breaking current single-session production flow while multi-session is being introduced

## Current Reality

- The UI already exposes session-oriented concepts
- The backend still uses one real WhatsApp client and one real persisted session
- Many HTTP handlers still enforce the default session only
- Multi-session work is now the main structural milestone

## Delivery Standard

- Prefer incremental compatibility over big-bang rewrites
- Keep old behavior working while new multi-session paths are introduced
- Add backend support first, then wire the frontend
- Validate with `npm run lint:server`, `npm run lint:web`, and `npm run build:web`

## Guardrails

- Do not reintroduce legacy gateways or external WhatsApp wrappers
- Do not revive `apps/server` as active runtime
- Do not fake multi-session in UI without real backend support
- Do not remove audit/security features during refactors

## Immediate Focus

- Make session persistence truly multi-row
- Make the manager hold multiple live `whatsmeow` clients
- Remove `default session` assumptions from API routes
- Keep conversation, QR, status, send, read, and realtime events isolated per session
