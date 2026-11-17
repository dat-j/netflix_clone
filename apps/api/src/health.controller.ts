import { Controller, Get, Res } from "@nestjs/common";
import type { Response } from "express";
import { performance } from "node:perf_hooks";
import { PrismaService } from "./infra/prisma.service.js";
import { RedisService } from "./infra/redis.service.js";

@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService, private readonly redis: RedisService) {}

  @Get("live")
  live() {
    return { status: "ok", uptimeSec: Math.floor(process.uptime()) };
  }

  /** Readiness probe: checks each dependency independently and returns 503 when any is unhealthy. */
  @Get()
  async check(@Res({ passthrough: true }) res: Response) {
    const startedAt = performance.now();
    const [database, redis, worker] = await Promise.all([
      this.probe(() => this.prisma.$queryRaw`SELECT 1`),
      this.probe(() => this.redis.ping()),
      this.workerHealth(),
    ]);
    const healthy = database.status === "ok" && redis.status === "ok";
    if (!healthy) res.status(503);
    const memory = process.memoryUsage();
    return {
      status: healthy ? "ok" : "degraded",
      uptimeSec: Math.floor(process.uptime()),
      responseTimeMs: Math.round(performance.now() - startedAt),
      dependencies: { database, redis, worker },
      memory: {
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
        heapTotalBytes: memory.heapTotal,
      },
      timestamp: new Date().toISOString(),
    };
  }

  private async workerHealth() {
    try {
      const [, keys] = await this.redis.scan(0, "MATCH", "health:worker:*", "COUNT", "100");
      const values = keys.length ? await this.redis.mget(...keys) : [];
      const activeWorkers = values.filter((value) => {
        const timestamp = Number(value);
        return Number.isFinite(timestamp) && Date.now() - timestamp < 45_000;
      }).length;
      return { status: activeWorkers > 0 ? "ok" as const : "stale" as const, activeWorkers };
    } catch {
      return { status: "unknown" as const, activeWorkers: 0 };
    }
  }

  private async probe(run: () => Promise<unknown>) {
    const startedAt = performance.now();
    try {
      await run();
      return { status: "ok" as const, latencyMs: Math.round(performance.now() - startedAt) };
    } catch {
      return { status: "error" as const, latencyMs: Math.round(performance.now() - startedAt) };
    }
  }
}
