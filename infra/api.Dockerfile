# NestJS API (apps/api). Build context = gốc repo:
#   docker build -f infra/api.Dockerfile -t streaming-api .
# Khi khởi động: chạy `prisma migrate deploy` rồi mới start API (đặt RUN_MIGRATIONS=false để bỏ qua).
FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends tini ca-certificates openssl \
 && rm -rf /var/lib/apt/lists/*

ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
RUN pnpm install --frozen-lockfile --filter "@app/api..."

COPY packages/shared packages/shared
COPY packages/db packages/db
COPY apps/api apps/api
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" pnpm --filter @app/shared build \
 && DATABASE_URL="postgresql://build:build@localhost:5432/build" pnpm --filter @app/db build \
 && pnpm --filter @app/api build

ENV NODE_ENV=production
USER node
WORKDIR /app/apps/api
EXPOSE 4000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "-c", "if [ \"$RUN_MIGRATIONS\" != \"false\" ]; then (cd ../../packages/db && node_modules/.bin/prisma migrate deploy) || exit 1; fi; exec node dist/main.js"]
