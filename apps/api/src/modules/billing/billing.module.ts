import { Module } from "@nestjs/common";
import { BillingController, PaymentWebhookController } from "./billing.controller.js";
import { BillingService } from "./billing.service.js";
import { ManualProvider, PAYMENT_PROVIDERS, type PaymentProvider } from "./payment-provider.js";
import { PayOSProvider } from "./payos.provider.js";

@Module({
  controllers: [BillingController, PaymentWebhookController],
  providers: [
    BillingService,
    ManualProvider,
    PayOSProvider,
    {
      provide: PAYMENT_PROVIDERS,
      useFactory: (manual: ManualProvider, payos: PayOSProvider): PaymentProvider[] => [manual, payos],
      inject: [ManualProvider, PayOSProvider],
    },
  ],
  exports: [BillingService],
})
export class BillingModule {}
