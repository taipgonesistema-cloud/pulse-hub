# Product Implementation Plan

## Current Direction

Build Pulse Hub as a shared multi-user WhatsApp operations workspace.

The WhatsApp connection in `apps/wa-core` stays shared and persistent.
User login to the dashboard must be independent from the WhatsApp session, so multiple people can access the same workspace at the same time without disconnecting each other.

## Confirmed Product Rules

- keep the backend on `apps/wa-core`
- keep the frontend on `apps/web`
- keep using `whatsmeow` directly
- keep PostgreSQL + Redis
- allow multiple dashboard users on the same active WhatsApp session
- v1 access control uses roles only
- do not add per-user limits yet

## Already Delivered

### Core Messaging

- shared WhatsApp session management
- QR login and reconnect flow
- conversation timeline
- media and sticker sending
- reply to message
- react to message
- smoother unread handling for active conversations
- lighter refresh and websocket behavior

### CRM / Contacts

- Kanban contacts workspace
- shared Kanban stage persistence
- shared custom boards
- inline CRM editing
- websocket sync for CRM and Kanban updates

### Analytics

- real response-time analytics
- business-hours filtering
- hardened frontend fallbacks for analytics payloads

## Main Goal Now

Introduce real multi-user dashboard authentication and user management without breaking the shared WhatsApp workspace.

## Phase 1 - Real Auth Foundation

### Backend

- add `app_user` table
- add `app_user_session` table
- hash passwords instead of using env-only credentials
- keep env seed only for bootstrapping the first admin user
- create real sign-in, sign-out, and `me` endpoints
- allow multiple active login sessions per user

### Frontend

- stop relying on fake local-only auth state
- centralize authenticated API calls
- attach auth token to API and websocket requests
- make dashboard bootstrap work with authenticated user state

## Phase 2 - Role-Based Access

### Roles for v1

- `admin`
- `supervisor`
- `attendant`

### Role Behavior

- `admin` manages users, sessions, workspace settings, CRM, analytics, and messaging actions
- `supervisor` manages operations and sessions but not user administration
- `attendant` handles inbox, replies, reactions, and CRM work but not user management or sensitive settings

### Enforcement

- enforce roles in backend endpoints, not only in UI
- hide or disable UI sections the current user cannot access
- protect websocket-connected actions the same way as HTTP actions

## Phase 3 - User Management UI

### Settings Expansion

- add a `Users` management area inside `Settings`
- list users with:
  - name
  - email
  - role
  - active status
  - last login
  - current session activity

### User Actions

- create user
- edit user profile
- change role
- activate or deactivate user
- reset or replace password
- revoke active login sessions if needed

### Current Execution Focus

- list active login sessions per user inside `Settings > Users`
- show last activity and basic device/session context
- allow admins to revoke specific active sessions
- keep WhatsApp session shared and untouched while dashboard sessions are revoked

## Phase 4 - Shared Workspace Hardening

- ensure multiple logged-in operators can stay in the same workspace safely
- keep the WhatsApp session connected even if one dashboard user logs out
- preserve realtime sync across users for conversations, CRM, Kanban, replies, and reactions
- avoid coupling dashboard auth lifecycle to WhatsApp connection lifecycle

## Phase 5 - Post-Auth UX Polish

- refine settings IA after adding user management
- improve session status visibility for supervisors/admins
- add clearer activity/audit feedback for user changes
- polish active-session management UX after revoke flow lands
- continue reducing heavy rerenders in large conversation/contact datasets
- add virtualization where needed for long lists

## Explicitly Deferred

Do not implement these yet:

- per-user limits
- per-user quotas
- session assignment caps
- rate limits by operator
- channel restrictions by operator
- schedule-based permissions
- custom permission matrices beyond role-based v1

These can be added later after roles are stable.

## Recommended Implementation Order

1. add database schema for users and login sessions
2. replace env-only fake auth with real auth endpoints
3. add auth middleware and role checks in backend
4. migrate frontend to authenticated dashboard bootstrap
5. add `Users` management inside `Settings`
6. gate UI and actions by role
7. polish multi-user UX and audit visibility

## Success Criteria

- multiple people can log into the same dashboard workspace simultaneously
- no user login disconnects the shared WhatsApp session
- roles reliably restrict access in both backend and frontend
- admins can manage users without leaving the dashboard
- supervisors and attendants only see actions they are allowed to use
- existing messaging, CRM, Kanban, and analytics flows remain stable during the auth migration
