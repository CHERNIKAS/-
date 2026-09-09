FROM node:24-alpine

RUN corepack enable
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/

RUN pnpm install --frozen-lockfile

COPY packages/core packages/core
COPY apps/api apps/api

CMD ["pnpm", "--filter", "@costnote/api", "start"]
