FROM node:20-alpine AS base
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/hono-api/package.json apps/hono-api/
COPY packages/database/package.json packages/database/
RUN pnpm install --frozen-lockfile --filter hono-api...

FROM base AS dev
ENV NODE_ENV=development
ENV PORT=3001
ENV CHOKIDAR_USEPOLLING=true
EXPOSE 3001
WORKDIR /repo/apps/hono-api
CMD ["pnpm", "dev"]

FROM base AS prod
WORKDIR /repo
COPY . .
RUN pnpm --filter hono-api build
ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001
WORKDIR /repo/apps/hono-api
CMD ["pnpm", "start"]
