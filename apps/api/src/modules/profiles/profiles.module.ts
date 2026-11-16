import { Module } from "@nestjs/common";
import { BillingModule } from "../billing/billing.module.js";
import { ProfilesController } from "./profiles.controller.js";
import { ProfilesService } from "./profiles.service.js";

@Module({
  imports: [BillingModule],
  controllers: [ProfilesController],
  providers: [ProfilesService],
  exports: [ProfilesService],
})
export class ProfilesModule {}
