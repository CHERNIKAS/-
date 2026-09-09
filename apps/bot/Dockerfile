FROM node:24-alpine

# Шрифты нужны resvg: на голом alpine их нет вовсе, и текст на картинке
# молча не рисуется — ни сумма в центре кольца, ни подписи легенды.
RUN apk add --no-cache font-noto ttf-dejavu && corepack enable

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
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
