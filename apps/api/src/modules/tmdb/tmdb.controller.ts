import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, UseGuards } from "@nestjs/common";
import type { AdminSeason, AdminTitle, TmdbSearchResult } from "@app/shared";
import { AuthGuard, Roles, RolesGuard } from "../../common/auth.js";
import { TmdbService } from "./tmdb.service.js";
import { TmdbSeasonsService } from "./tmdb-seasons.service.js";

@Controller("admin")
@Roles("ADMIN")
@UseGuards(AuthGuard, RolesGuard)
export class TmdbController {
  constructor(
    @Inject(TmdbService) private readonly tmdb: TmdbService,
    @Inject(TmdbSeasonsService) private readonly seasons: TmdbSeasonsService,
  ) {}

  @Get("tmdb/search")
  search(@Query("q") q?: string, @Query("type") type?: string): Promise<TmdbSearchResult[]> {
    return this.tmdb.search(q, type);
  }

  @Post("titles/import-tmdb")
  importTitle(@Body() body: { tmdbId?: unknown; type?: unknown }): Promise<AdminTitle> {
    return this.tmdb.import(body);
  }

  @Post("titles/:id/sync-tmdb")
  @HttpCode(200)
  sync(@Param("id") id: string): Promise<AdminTitle> {
    return this.tmdb.sync(id);
  }

  @Post("titles/:id/sync-tmdb-seasons")
  @HttpCode(200)
  syncSeasons(@Param("id") id: string, @Body() body: unknown): Promise<AdminSeason[]> {
    return this.seasons.syncEndpoint(id, body);
  }
}
