import { Module } from "@nestjs/common";
import { AdminContentModule } from "../admin-content/admin-content.module.js";
import { TmdbController } from "./tmdb.controller.js";
import { TmdbClient } from "./tmdb.client.js";
import { TmdbService } from "./tmdb.service.js";
import { TmdbSeasonsService } from "./tmdb-seasons.service.js";

@Module({
  imports: [AdminContentModule],
  controllers: [TmdbController],
  providers: [TmdbClient, TmdbService, TmdbSeasonsService],
})
export class TmdbModule {}
