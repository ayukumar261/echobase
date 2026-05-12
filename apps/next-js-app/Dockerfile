FROM node:20-alpine
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

COPY . .
RUN pnpm install --frozen-lockfile --filter next-js-app...
RUN pnpm --filter next-js-app build

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
WORKDIR /repo/apps/next-js-app
CMD ["pnpm", "start"]
