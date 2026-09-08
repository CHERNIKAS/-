FROM node:24-alpine

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/core/package.json packages/core/
COPY apps/bot/package.json apps/bot/

RUN pnpm install --frozen-lockfile

COPY packages/core packages/core
COPY apps/bot apps/bot
COPY migrations migrations

WORKDIR /app/apps/bot

# Миграции применяются при старте: контейнер всегда поднимается на схеме,
# которую ожидает его же код, и отдельный шаг деплоя не нужен.
CMD ["sh", "-c", "cd /app && pnpm --filter @costnote/bot migrate && pnpm --filter @costnote/bot start"]
