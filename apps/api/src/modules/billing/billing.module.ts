import { Module } from "@nestjs/common";
import { BillingController } from "./billing.controller.js";
import { BillingService } from "./billing.service.js";
import { ManualProvider, PAYMENT_PROVIDERS, type PaymentProvider } from "./payment-provider.js";

@Module({
  controllers: [BillingController],
  providers: [
    BillingService,
    ManualProvider,
    // Thêm cổng mới: implement PaymentProvider, thêm vào providers + inject ở đây.
    {
      provide: PAYMENT_PROVIDERS,
      useFactory: (manual: ManualProvider): PaymentProvider[] => [manual],
      inject: [ManualProvider],
    },
  ],
  exports: [BillingService],
})
export class BillingModule {}
