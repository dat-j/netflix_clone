import { Controller, Get } from "@nestjs/common";
import { PrismaService } from "./infra/prisma.service.js";
import { RedisService } from "./infra/redis.service.js";

@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService, private readonly redis: RedisService) {}

  @Get()
  async check() {
    await this.prisma.$queryRaw`SELECT 1`;
    await this.redis.ping();
    return { status: "ok" };
  }
}
