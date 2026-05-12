FROM node:20-alpine AS base
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/next-js-app/package.json apps/next-js-app/
COPY packages/database/package.json packages/database/
RUN pnpm install --frozen-lockfile --filter next-js-app...

FROM base AS dev
ENV NODE_ENV=development
ENV PORT=3000
ENV WATCHPACK_POLLING=true
EXPOSE 3000
WORKDIR /repo/apps/next-js-app
CMD ["pnpm", "dev"]

FROM base AS prod
WORKDIR /repo
COPY . .
RUN pnpm --filter next-js-app build
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
WORKDIR /repo/apps/next-js-app
CMD ["pnpm", "start"]
