# Deploy no EasyPanel

Este projeto esta pronto para subir no EasyPanel a partir do GitHub com 5 servicos separados:

- `pulse-hub-postgres` - banco PostgreSQL gerenciado pelo EasyPanel;
- `pulse-hub-redis` - Redis gerenciado pelo EasyPanel;
- `pulse-hub-wppconnect` - servico dedicado ao WhatsApp;
- `pulse-hub-server` - app NestJS usando `apps/server/Dockerfile`;
- `pulse-hub-web` - app Next.js usando `apps/web/Dockerfile`.

## 1. Preparar o repositorio no GitHub

- suba a raiz do monorepo, incluindo `package.json`, `package-lock.json`, `apps/server`, `apps/web`, `.dockerignore` e os dois `Dockerfile`;
- nao suba `.env`, `node_modules`, `.next`, `dist` nem `apps/server/.baileys_auth`.

## 2. Criar os servicos de infraestrutura

### PostgreSQL

- crie um servico `PostgreSQL` no EasyPanel;
- nome sugerido: `pulse-hub-postgres`;
- banco sugerido: `pulse_hub`.

### Redis

- crie um servico `Redis` no EasyPanel;
- nome sugerido: `pulse-hub-redis`.

### WPPConnect Server

- crie um servico dedicado para `WPPConnect Server` no EasyPanel;
- publique uma URL interna ou publica para ele, por exemplo `https://wpp.seu-dominio.com`;
- esse servico fica responsavel por QR, sessao e reconexao do WhatsApp.

## 3. Criar o backend pelo GitHub

- tipo: `App`;
- fonte: GitHub;
- Dockerfile path: `apps/server/Dockerfile`;
- branch: `main`;
- porta interna: `3333`;
- health check: `/health`.

### Variaveis do backend

Use no minimo:

```env
PORT=3333
DATABASE_URL=postgres://USER:PASSWORD@pulse-hub-postgres:5432/pulse_hub
REDIS_URL=redis://default:SUA_SENHA@pulse-hub-redis:6379
WPPCONNECT_API_URL=https://wpp.seu-dominio.com
WPPCONNECT_SECRET_KEY=THISISMYSECURETOKEN
AUTH_SEED_EMAIL=admin@pulsehub.local
AUTH_SEED_PASSWORD=PulseHub123!
AUTH_SEED_NAME=Pulse Hub Admin
AUTH_SEED_ROLE=admin
```

Se o EasyPanel te entregar uma internal connection URL completa do Redis, use ela diretamente no `REDIS_URL`. Exemplo de formato:

```env
REDIS_URL=redis://default:SUA_SENHA@nome-interno-do-redis:6379
```

### Persistencia do WhatsApp

- a persistencia de sessao sai do backend principal e fica no servico do `WPPConnect Server`.
- siga a documentacao do `WPPConnect Server` para o storage/token store do servico dedicado.

### Primeiro acesso

- se a tabela `users` estiver vazia, o backend cria automaticamente o primeiro usuario usando `AUTH_SEED_*`;
- defina esses valores no EasyPanel antes do primeiro boot para nao depender dos defaults locais.

## 4. Criar o frontend pelo GitHub

- tipo: `App`;
- fonte: GitHub;
- Dockerfile path: `apps/web/Dockerfile`;
- branch: `main`;
- porta interna: `3000`.

### Build args e variaveis do frontend

Defina o endpoint publico do backend no build e no runtime:

```env
NEXT_PUBLIC_API_URL=https://api.seu-dominio.com
```

No EasyPanel, use esse mesmo valor como:

- build arg `NEXT_PUBLIC_API_URL`;
- env var `NEXT_PUBLIC_API_URL`.

## 5. Dominios sugeridos

- frontend: `app.seu-dominio.com`;
- backend: `api.seu-dominio.com`.

## 6. Ordem recomendada de deploy

1. subir `pulse-hub-postgres`;
2. subir `pulse-hub-redis`;
3. subir `pulse-hub-wppconnect`;
4. subir `pulse-hub-server` e validar `/health`;
5. subir `pulse-hub-web` apontando para a URL publica do backend.

## 7. Checklist final

- backend respondendo em `/health`;
- frontend carregando sem erro de fetch;
- `DATABASE_URL` e `REDIS_URL` resolvendo pelos nomes internos do EasyPanel;
- `WPPCONNECT_API_URL` apontando para o servico WPPConnect;
- `NEXT_PUBLIC_API_URL` apontando para o dominio publico do backend.

## 8. Checklist pronto para colar no EasyPanel

### Backend envs

```env
PORT=3333
DATABASE_URL=postgres://postgres:SUA_SENHA@SEU_HOST_POSTGRES:5432/SEU_BANCO?sslmode=disable
REDIS_URL=redis://default:SUA_SENHA@SEU_HOST_REDIS:6379
WPPCONNECT_API_URL=https://wpp.seu-dominio.com
WPPCONNECT_SECRET_KEY=THISISMYSECURETOKEN
AUTH_SEED_EMAIL=admin@seudominio.com
AUTH_SEED_PASSWORD=UMA_SENHA_FORTE
AUTH_SEED_NAME=Administrador Pulse Hub
AUTH_SEED_ROLE=admin
```

### Frontend build arg

```env
NEXT_PUBLIC_API_URL=https://api.seu-dominio.com
```

### Frontend runtime env

```env
NEXT_PUBLIC_API_URL=https://api.seu-dominio.com
```

### Infra adicional

```text
Subir um servico WPPConnect Server separado e usar a URL dele em WPPCONNECT_API_URL
```

## 9. Sequencia de deploy recomendada

1. conectar o repositorio GitHub no EasyPanel;
2. criar ou validar PostgreSQL e Redis;
3. subir e validar o servico WPPConnect Server;
4. cadastrar envs do backend;
5. subir o backend e validar `https://api.seu-dominio.com/health`;
6. cadastrar build arg e env do frontend;
7. subir o frontend;
8. abrir `/login` e entrar com o usuario seed inicial.
