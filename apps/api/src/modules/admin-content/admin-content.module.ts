import { Module } from "@nestjs/common";
import { AdminContentController } from "./admin-content.controller.js";
import { AdminTitlesService } from "./admin-titles.service.js";
import { AdminCatalogService } from "./admin-catalog.service.js";
import { MediaQueuesService } from "./queues.service.js";

@Module({
  controllers: [AdminContentController],
  providers: [AdminTitlesService, AdminCatalogService, MediaQueuesService],
  exports: [AdminTitlesService, AdminCatalogService, MediaQueuesService],
})
export class AdminContentModule {}
