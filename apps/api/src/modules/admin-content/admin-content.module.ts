import { Module } from "@nestjs/common";
import { AdminContentController } from "./admin-content.controller.js";
import { AdminTitlesService } from "./admin-titles.service.js";
import { AdminCatalogService } from "./admin-catalog.service.js";
import { MediaQueuesService } from "./queues.service.js";
import { AdminSeriesController } from "./admin-series.controller.js";
import { AdminSeriesService } from "./admin-series.service.js";
import { TelegramModule } from "../telegram/telegram.module.js";

@Module({
  imports: [TelegramModule],
  controllers: [AdminContentController, AdminSeriesController],
  providers: [AdminTitlesService, AdminSeriesService, AdminCatalogService, MediaQueuesService],
  exports: [AdminTitlesService, AdminSeriesService, AdminCatalogService, MediaQueuesService],
})
export class AdminContentModule {}
