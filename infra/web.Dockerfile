# Next.js web (apps/web). Build context = gốc repo:
#   docker build -f infra/web.Dockerfile -t streaming-web \
#     --build-arg API_INTERNAL_URL=http://api.railway.internal:4000 \
#     --build-arg MEDIA_IMAGE_ORIGINS="https://<domain-web>/api/v1/dev-cdn/p/**" .
#
# LƯU Ý: rewrite /api/* → API và danh sách host ảnh được "nướng" vào bản build, nên các biến dưới đây
# phải có lúc BUILD (trên Railway: khai báo là biến của service, Railway tự truyền vào build arg cùng tên).
FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends tini ca-certificates \
 && rm -rf /var/lib/apt/lists/*

ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
RUN pnpm install --frozen-lockfile --filter "@app/web..."

COPY packages/shared packages/shared
COPY apps/web apps/web

ARG API_INTERNAL_URL=http://localhost:4000
ARG MEDIA_IMAGE_ORIGINS
ARG NEXT_PUBLIC_IMAGE_UNOPTIMIZED
ENV API_INTERNAL_URL=$API_INTERNAL_URL \
    MEDIA_IMAGE_ORIGINS=$MEDIA_IMAGE_ORIGINS \
    NEXT_PUBLIC_IMAGE_UNOPTIMIZED=$NEXT_PUBLIC_IMAGE_UNOPTIMIZED

RUN pnpm --filter @app/shared build && pnpm --filter @app/web build

ENV NODE_ENV=production
RUN chown -R node:node /app/apps/web/.next
USER node
WORKDIR /app/apps/web
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "-c", "exec node_modules/.bin/next start -H :: -p ${PORT:-3000}"]
