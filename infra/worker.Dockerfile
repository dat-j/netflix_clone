# Media worker (apps/worker): Node 22 + system FFmpeg.
#
#   docker build -f infra/worker.Dockerfile -t streaming-worker .
#   docker run --env-file .env -v worker-work:/work streaming-worker
#
# Notes
# - Uses Debian's ffmpeg/ffprobe (bookworm: 5.1, built with libx264, libzimg/zscale, tonemap, libass). FFMPEG_PATH /
#   FFPROBE_PATH point at them, so the bundled static binaries from ffmpeg-static/ffprobe-static are never used here
#   (those dev-only builds segfault on hostname resolution and on MPEG-TS input).
# - TRANSCODE_WORK_DIR needs free disk ≈ source size + ~1.5× the HLS output of the largest concurrent job.
# - Give the container a stop grace period > SHUTDOWN_GRACE_MS (default 30 s), e.g. compose `stop_grace_period: 60s`;
#   on SIGTERM the worker stops taking jobs, waits for running ones, then aborts ffmpeg (the job is retried).
# - Memory: one 1080p source with 4 renditions peaks around 0.7–1 GB RSS for ffmpeg; budget per TRANSCODE_CONCURRENCY.

FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg tini ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && ffmpeg -hide_banner -encoders | grep -q libx264 \
 && ffmpeg -hide_banner -filters | grep -q zscale

ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable

WORKDIR /app

# 1) dependency layer (manifests only → cached until a manifest/lockfile changes)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/worker/package.json apps/worker/
# every workspace manifest is copied so --frozen-lockfile sees the same importers as the lockfile
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
RUN pnpm install --frozen-lockfile --filter "@app/worker..."

# 2) sources + workspace builds (@app/shared → dist, @app/db → prisma generate + dist)
COPY packages/shared packages/shared
COPY packages/db packages/db
COPY apps/worker apps/worker
# prisma generate only needs a syntactically valid URL at build time
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" pnpm --filter @app/shared build \
 && DATABASE_URL="postgresql://build:build@localhost:5432/build" pnpm --filter @app/db build

ENV NODE_ENV=production \
    FFMPEG_PATH=/usr/bin/ffmpeg \
    FFPROBE_PATH=/usr/bin/ffprobe \
    TRANSCODE_WORK_DIR=/work \
    TRANSCODE_CONCURRENCY=1

RUN mkdir -p /work && chown node:node /work
VOLUME ["/work"]
USER node
WORKDIR /app/apps/worker

STOPSIGNAL SIGTERM
# tini reaps ffmpeg children and forwards SIGTERM; tsx runs the TypeScript entrypoint directly (no build step).
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node_modules/.bin/tsx", "src/main.ts"]
