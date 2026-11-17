import {
  Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, UploadedFile, UseGuards, UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { AdminEpisode, AdminSeason, ImageDto, MediaAssetDto } from "@app/shared";
import { AuthGuard, Roles, RolesGuard } from "../../common/auth.js";
import { AdminSeriesService } from "./admin-series.service.js";

/** PHIM BỘ (admin): mùa/tập. Đồng bộ TMDB mùa/tập nằm ở TmdbController (`titles/:id/sync-tmdb-seasons`). */
@Controller("admin")
@Roles("ADMIN")
@UseGuards(AuthGuard, RolesGuard)
export class AdminSeriesController {
  constructor(@Inject(AdminSeriesService) private readonly series: AdminSeriesService) {}

  @Get("titles/:id/seasons")
  seasons(@Param("id") id: string): Promise<AdminSeason[]> {
    return this.series.listSeasons(id);
  }

  @Post("titles/:id/seasons")
  createSeason(@Param("id") id: string, @Body() body: unknown): Promise<AdminSeason> {
    return this.series.createSeason(id, body);
  }

  @Patch("seasons/:seasonId")
  updateSeason(@Param("seasonId") id: string, @Body() body: unknown): Promise<AdminSeason> {
    return this.series.updateSeason(id, body);
  }

  @Delete("seasons/:seasonId")
  @HttpCode(204)
  async deleteSeason(@Param("seasonId") id: string) {
    await this.series.deleteSeason(id);
  }

  @Post("seasons/:seasonId/episodes")
  createEpisode(@Param("seasonId") id: string, @Body() body: unknown): Promise<AdminEpisode> {
    return this.series.createEpisode(id, body);
  }

  @Post("seasons/:seasonId/episodes/bulk")
  bulk(@Param("seasonId") id: string, @Body() body: unknown): Promise<AdminEpisode[]> {
    return this.series.bulkCreate(id, body);
  }

  @Post("seasons/:seasonId/publish-ready")
  @HttpCode(200)
  publishReady(@Param("seasonId") id: string): Promise<AdminEpisode[]> {
    return this.series.publishReady(id);
  }

  @Patch("episodes/:episodeId")
  updateEpisode(@Param("episodeId") id: string, @Body() body: unknown): Promise<AdminEpisode> {
    return this.series.updateEpisode(id, body);
  }

  @Delete("episodes/:episodeId")
  @HttpCode(204)
  async deleteEpisode(@Param("episodeId") id: string) {
    await this.series.deleteEpisode(id);
  }

  @Post("episodes/:episodeId/assets")
  attachAsset(@Param("episodeId") id: string, @Body() body: unknown): Promise<MediaAssetDto> {
    return this.series.attachAsset(id, body);
  }

  @Post("episodes/:episodeId/publish")
  @HttpCode(200)
  publish(@Param("episodeId") id: string): Promise<AdminEpisode> {
    return this.series.publishEpisode(id);
  }

  @Post("episodes/:episodeId/unpublish")
  @HttpCode(200)
  unpublish(@Param("episodeId") id: string): Promise<AdminEpisode> {
    return this.series.unpublishEpisode(id);
  }

  @Post("episodes/:episodeId/images")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 20 * 1024 * 1024, files: 1 } }))
  uploadStill(
    @Param("episodeId") id: string, @UploadedFile() file: { buffer: Buffer; mimetype: string } | undefined, @Body() body: { kind?: string },
  ): Promise<ImageDto> {
    return this.series.uploadStill(id, file, body?.kind);
  }
}
