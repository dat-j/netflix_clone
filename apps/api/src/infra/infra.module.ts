import { Global, Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service.js";
import { RedisService } from "./redis.service.js";
import { AuthGuard, ProfileGuard, RolesGuard, SubscriptionGuard } from "../common/auth.js";

@Global()
@Module({
  providers: [PrismaService, RedisService, AuthGuard, ProfileGuard, RolesGuard, SubscriptionGuard],
  exports: [PrismaService, RedisService, AuthGuard, ProfileGuard, RolesGuard, SubscriptionGuard],
})
export class InfraModule {}
