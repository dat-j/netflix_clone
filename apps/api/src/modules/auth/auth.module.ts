import { Module } from "@nestjs/common";
import { ThrottlerModule } from "@nestjs/throttler";
import { BillingModule } from "../billing/billing.module.js";
import { ProfilesModule } from "../profiles/profiles.module.js";
import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import { MailService } from "./mail.service.js";

@Module({
  imports: [
    // Chỉ AuthController dùng ThrottlerGuard (theo IP; main.ts bật trust proxy cho Next rewrite).
    ThrottlerModule.forRoot({ throttlers: [{ name: "default", ttl: 60_000, limit: 120 }] }),
    BillingModule,
    ProfilesModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, MailService],
  exports: [AuthService, MailService],
})
export class AuthModule {}
