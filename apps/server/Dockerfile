FROM node:20-bookworm-slim AS base

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
COPY apps/server/package*.json ./apps/server/
COPY apps/web/package*.json ./apps/web/

RUN npm ci

COPY . .

RUN npm run build --workspace server

WORKDIR /app/apps/server

ENV NODE_ENV=production

EXPOSE 3333

CMD ["node", "dist/main"]
