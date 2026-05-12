FROM node:20-alpine
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

COPY . .
RUN pnpm install --frozen-lockfile --filter hono-api...
RUN pnpm --filter hono-api build

ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001
WORKDIR /repo/apps/hono-api
CMD ["pnpm", "start"]
