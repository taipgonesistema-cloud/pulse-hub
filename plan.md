# Multi-Session Plan

## Goal

Support two or more real WhatsApp numbers connected at the same time inside the same workspace, with each number having its own QR flow, connection lifecycle, chats, messages, and realtime events.

## Desired Outcome

- multiple active WhatsApp sessions in `apps/wa-core`
- operators can switch between numbers in `apps/web`
- each session keeps its own chats, unread counts, QR state, and send/read actions
- auth, roles, audit log, and security remain intact

## Execution Order

1. backend multi-session support in `apps/wa-core`
2. adapt QR, status, connect, and disconnect flows per session
3. isolate conversations, messages, and realtime events per session
4. polish the dashboard UX for switching between connected numbers

## Phase 1 - Backend Persistence

- replace single-session assumptions in store methods with multi-session-safe methods
- ensure session records are keyed by real session id everywhere
- verify chats/messages remain associated with the correct session id

## Phase 2 - WhatsApp Manager Refactor

- replace the single `whatsmeow.Client` field with a session-aware client registry
- load, create, connect, and disconnect clients per session id
- make QR/status APIs return data per specific session

## Phase 3 - HTTP/API Refactor

- remove `isDefaultSession` restrictions from session-aware routes
- make all session endpoints operate on the requested session id
- keep auth/role checks unchanged
- keep audit logging for connect/disconnect/create actions

## Phase 4 - Realtime Isolation

- include session id consistently in realtime payloads
- ensure websocket and stream updates only affect the right session in the UI

## Phase 5 - Frontend Multi-Session UX

- validate session switching in dashboard without leaking state between numbers
- confirm conversation list, timeline, composer drafts, and quick replies behave per session
- verify QR/connect/disconnect controls work per session

## Phase 6 - Stability Pass

- test two connected numbers simultaneously
- verify message send, media, read receipts, reply, reaction, and CRM updates per session
- verify reconnect behavior after restart/deploy

## First Implementation Slice

1. audit all single-session store methods
2. refactor backend persistence to support multiple session rows safely
3. refactor manager to map session id -> client/store/device
4. remove default-session route guards
5. validate one existing session still works before enabling two

## Success Criteria

- session `A` and session `B` can both stay connected at once
- sending in one session never touches the other
- QR and reconnect are independent per session
- dashboard state remains correctly scoped per session
