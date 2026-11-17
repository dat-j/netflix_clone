import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller.js";
import { InfraModule } from "./infra/infra.module.js";
import { AuthModule } from "./modules/auth/auth.module.js";
import { ProfilesModule } from "./modules/profiles/profiles.module.js";
import { BillingModule } from "./modules/billing/billing.module.js";
import { AdminUsersModule } from "./modules/admin-users/admin-users.module.js";
import { StorageModule } from "./modules/storage/storage.module.js";
import { CatalogModule } from "./modules/catalog/catalog.module.js";
import { PlaybackModule } from "./modules/playback/playback.module.js";
import { AdminContentModule } from "./modules/admin-content/admin-content.module.js";
import { TmdbModule } from "./modules/tmdb/tmdb.module.js";
import { TelegramModule } from "./modules/telegram/telegram.module.js";

@Module({
  imports: [
    InfraModule,
    AuthModule,
    ProfilesModule,
    BillingModule,
    AdminUsersModule,
    StorageModule,
    CatalogModule,
    PlaybackModule,
    AdminContentModule,
    TmdbModule,
    TelegramModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
