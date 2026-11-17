import { Module } from "@nestjs/common";
import { PlaybackController } from "./playback.controller.js";
import { PlaybackService } from "./playback.service.js";
import { StreamSessionStore } from "./stream-sessions.js";
import { CatalogModule } from "../catalog/catalog.module.js";

@Module({
  imports: [CatalogModule],
  controllers: [PlaybackController],
  providers: [PlaybackService, StreamSessionStore],
})
export class PlaybackModule {}
