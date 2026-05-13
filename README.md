# Pulse Hub

Omnichannel support and CRM platform focused on WhatsApp, realtime dashboards, contact management, kanban, quick replies, users, audit logs, and Instagram publishing.

![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=nextdotjs)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=111)
![Go](https://img.shields.io/badge/Go-1.25-00ADD8?logo=go&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-7-DC382D?logo=redis&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)

## Overview

Pulse Hub is a platform for managing customer conversations from a single interface. The frontend consumes a Go API responsible for authentication, WhatsApp sessions, conversations, messages, contacts, metrics, realtime events, and Instagram integration.

Main features:

- Operational dashboard with support metrics.
- Login with sessions, CSRF protection, user roles, and audit trail.
- Multiple WhatsApp sessions with QR Code, status tracking, and message sending.
- Realtime conversations through WebSocket.
- Contact CRM with kanban, labels, and profiles.
- Quick replies with autocomplete.
- Text, media, reactions, and read receipts.
- Feed and story publishing to Instagram when credentials are configured.
- Containerized deployment with Docker Compose.

## Architecture

```txt
.
+-- apps
|   +-- web       # Next.js 16 + React 19 + Tailwind CSS 4 frontend
|   +-- wa-core   # Go API, WhatsApp, WebSocket, Postgres, and Redis
|   +-- server    # NestJS server kept in the repository
+-- scripts       # Development utilities
+-- docker-compose.yml
+-- package.json
```

Main services:

- `web`: web interface at `http://localhost:3000`.
- `wa-core`: HTTP/WebSocket API at `http://localhost:3333`.
- `postgres`: main database and WhatsApp storage.
- `redis`: pub/sub and realtime event support.

## Stack

- Frontend: Next.js 16, React 19, TypeScript, Tailwind CSS 4, Lucide React.
- Main backend: Go 1.25, chi, whatsmeow, PostgreSQL, Redis, WebSocket.
- Alternative/legacy backend: NestJS 11 in `apps/server`.
- Infrastructure: Docker, Docker Compose, PostgreSQL 16, Redis 7.

## Requirements

- Node.js 20 or higher.
- npm 10 or higher.
- Go 1.25 or higher.
- Docker and Docker Compose.

## Running Locally

### 1. Install dependencies

```bash
npm install
```

### 2. Start Postgres and Redis

```bash
npm run dev:infra
```

### 3. Start the Go API

```bash
npm run dev:server
```

The API will be available at `http://localhost:3333`.

### 4. Start the frontend

In another terminal:

```bash
npm run dev:web
```

The dashboard will be available at `http://localhost:3000`.

## Running Everything with Docker

```bash
docker compose up --build
```

Default URLs:

- Frontend: `http://localhost:3000`
- API: `http://localhost:3333`
- Health check: `http://localhost:3333/health`

To stop the containers:

```bash
docker compose down
```

To also remove local volumes:

```bash
docker compose down -v
```

## Initial Access

In development, the API automatically creates an initial user with the values below when the environment variables are not overridden:

```txt
Email: admin@pulsehub.local
Password: PulseHub123!
Role: admin
```

Change `AUTH_SEED_EMAIL`, `AUTH_SEED_PASSWORD`, `AUTH_SEED_NAME`, and `AUTH_SEED_ROLE` in real environments.

## Environment Variables

The `.env.easypanel.example` file can be used as a deployment reference. For local development, the defaults in `docker-compose.yml` work without a `.env` file.

Main variables:

| Variable | Description | Local default |
| --- | --- | --- |
| `PORT` | Go API port | `3333` |
| `DATABASE_URL` | Application PostgreSQL DSN | `postgres://postgres:postgres@localhost:5432/pulse_hub?sslmode=disable` |
| `WHATSMEOW_DATABASE_URL` | WhatsApp/whatsmeow DSN | Same value as `DATABASE_URL` |
| `REDIS_URL` | Redis connection URL | `redis://localhost:6379/0` |
| `NEXT_PUBLIC_API_URL` | Public API URL consumed by the frontend | `http://localhost:3333` |
| `AUTH_SEED_EMAIL` | Initial user email | `admin@pulsehub.local` |
| `AUTH_SEED_PASSWORD` | Initial user password | `PulseHub123!` |
| `AUTH_COOKIE_SECURE` | Secure cookies over HTTPS only | `false` |
| `AUTH_COOKIE_SAME_SITE` | Cookie SameSite policy | `lax` |
| `CORS_ALLOWED_ORIGINS` | Allowed origins, comma-separated | Frontend localhost URLs |

Optional variables for Instagram and image hosting:

| Variable | Description |
| --- | --- |
| `INSTAGRAM_APP_ID` | Meta/Instagram app ID |
| `INSTAGRAM_APP_SECRET` | Meta/Instagram app secret |
| `INSTAGRAM_ACCESS_TOKEN` | Graph API token |
| `INSTAGRAM_USER_ID` | Instagram user/account ID |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary cloud name |
| `CLOUDINARY_API_KEY` | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | Cloudinary API secret |
| `CLOUDINARY_FOLDER` | Cloudinary upload folder |
| `INSTAGRAM_IMAGE_HOST_API_KEY` | Alternative image hosting API key |

## Available Scripts

From the project root:

| Command | Description |
| --- | --- |
| `npm run dev:infra` | Starts Postgres and Redis with Docker Compose |
| `npm run dev:infra:down` | Stops Postgres and Redis |
| `npm run dev:web` | Starts the Next.js frontend |
| `npm run dev:server` | Starts the Go API in development mode |
| `npm run build:web` | Builds the frontend for production |
| `npm run build:server` | Builds the Go API |
| `npm run lint:web` | Runs ESLint for the frontend |
| `npm run lint:server` | Runs `go test ./...` for the Go API |

Inside the web app:

```bash
npm run dev --workspace web
npm run build --workspace web
npm run start --workspace web
npm run lint --workspace web
```

## Main API

Local base URL: `http://localhost:3333`

Public endpoints:

- `GET /health`
- `POST /auth/sign-in`
- `GET /ws`

Authenticated endpoints include:

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

## Deployment

### Docker Compose

The simplest deployment path is using `docker-compose.yml` and adjusting the environment variables for your real domain:

```bash
docker compose up -d --build
```

### Easypanel

Use `.env.easypanel.example` as a base and configure at least:

- `DATABASE_URL`
- `WHATSMEOW_DATABASE_URL`
- `REDIS_URL`
- `AUTH_SEED_EMAIL`
- `AUTH_SEED_PASSWORD`
- `NEXT_PUBLIC_API_URL`
- `CORS_ALLOWED_ORIGINS` or `APP_ORIGIN`
- `AUTH_COOKIE_SECURE=true` when using HTTPS
- `AUTH_COOKIE_SAME_SITE=none` when frontend and API are hosted on different domains

## Development

Recommended checks before opening a pull request:

```bash
npm run lint:web
npm run lint:server
npm run build:web
npm run build:server
```

## License

This project is licensed under the MIT License. See [`LICENSE`](LICENSE) for more details.
