import { Module } from "@nestjs/common";
import { BillingModule } from "../billing/billing.module.js";
import { AdminPlansController, AdminUsersController } from "./admin-users.controller.js";
import { AdminUsersService } from "./admin-users.service.js";

@Module({
  imports: [BillingModule],
  controllers: [AdminUsersController, AdminPlansController],
  providers: [AdminUsersService],
})
export class AdminUsersModule {}
