# Telegram bot (apps/bot): Node 22 + sharp + fonts for server-rendered catalog cards.
#
#   docker build -f infra/bot.Dockerfile -t streaming-bot .
#   docker run --env-file .env streaming-bot
#
# Notes
# - Long polling by default: no public port needed. Run exactly ONE replica in polling mode (Telegram returns 409
#   Conflict to a second poller). Set TELEGRAM_WEBHOOK_URL to switch to webhook mode on $PORT.
# - TELEGRAM_BOT_TOKEN empty → the process logs why and exits 0, so Railway's ON_FAILURE policy does not crash-loop.
# - fonts-dejavu-core: sharp/Pango renders Vietnamese text in the poster grid / detail cards with DejaVu Sans.

FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends tini ca-certificates fontconfig fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/* \
 && fc-list | grep -q "DejaVu Sans"

ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable

WORKDIR /app

# 1) dependency layer (manifests only → cached until a manifest/lockfile changes)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/bot/package.json apps/bot/
# every workspace manifest is copied so --frozen-lockfile sees the same importers as the lockfile
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
RUN pnpm install --frozen-lockfile --filter "@app/bot..."

# 2) sources + workspace build (@app/db → prisma generate + dist)
COPY packages/db packages/db
COPY apps/bot apps/bot
# prisma generate only needs a syntactically valid URL at build time
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" pnpm --filter @app/db build

ENV NODE_ENV=production

USER node
WORKDIR /app/apps/bot

STOPSIGNAL SIGTERM
# tini forwards SIGTERM so grammY stops polling cleanly; tsx runs the TypeScript entrypoint directly (no build step).
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node_modules/.bin/tsx", "src/main.ts"]
