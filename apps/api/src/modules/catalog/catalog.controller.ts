import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Put, Query, UseGuards } from "@nestjs/common";
import type { GenreDto, HomeResponse, Paginated, SeasonDto, TitleCard, TitleDetail } from "@app/shared";
import { AuthGuard, CurrentProfile, ProfileGuard, type RequestProfile } from "../../common/auth.js";
import { BrowseService, parseType } from "./browse.service.js";
import { PersonalService } from "./personal.service.js";
import type { ViewerCtx } from "./title-cards.service.js";

const ctxOf = (p: RequestProfile): ViewerCtx => ({ profileId: p.id, isKids: p.isKids });

@Controller()
@UseGuards(AuthGuard, ProfileGuard)
export class CatalogController {
  constructor(
    @Inject(BrowseService) private readonly browse: BrowseService,
    @Inject(PersonalService) private readonly personal: PersonalService,
  ) {}

  @Get("browse/home")
  home(@CurrentProfile() p: RequestProfile, @Query("type") type?: string): Promise<HomeResponse> {
    return this.browse.home(ctxOf(p), parseType(type));
  }

  @Get("browse/rows/:rowId")
  row(
    @CurrentProfile() p: RequestProfile, @Param("rowId") rowId: string,
    @Query("page") page?: string, @Query("pageSize") pageSize?: string, @Query("type") type?: string,
  ): Promise<Paginated<TitleCard>> {
    return this.browse.row(rowId, ctxOf(p), page, pageSize, parseType(type));
  }

  @Get("browse/genres")
  genres(@CurrentProfile() p: RequestProfile): Promise<GenreDto[]> {
    return this.browse.genres(ctxOf(p));
  }

  @Get("browse/genres/:slug")
  genre(
    @CurrentProfile() p: RequestProfile, @Param("slug") slug: string,
    @Query("page") page?: string, @Query("pageSize") pageSize?: string, @Query("sort") sort?: string, @Query("type") type?: string,
  ) {
    return this.browse.genrePage(slug, ctxOf(p), { page, pageSize, sort, type: parseType(type) });
  }

  @Get("browse/search")
  search(
    @CurrentProfile() p: RequestProfile, @Query("q") q?: string,
    @Query("page") page?: string, @Query("pageSize") pageSize?: string, @Query("type") type?: string,
  ): Promise<Paginated<TitleCard>> {
    return this.browse.search(q, ctxOf(p), page, pageSize, parseType(type));
  }

  @Get("titles/:idOrSlug")
  detail(@CurrentProfile() p: RequestProfile, @Param("idOrSlug") idOrSlug: string): Promise<TitleDetail> {
    return this.browse.detail(idOrSlug, ctxOf(p));
  }

  @Get("titles/:id/episodes")
  episodes(@CurrentProfile() p: RequestProfile, @Param("id") id: string, @Query("season") season?: string): Promise<SeasonDto> {
    return this.browse.episodes(id, season, ctxOf(p));
  }

  @Get("titles/:id/similar")
  similar(@CurrentProfile() p: RequestProfile, @Param("id") id: string): Promise<TitleCard[]> {
    return this.browse.similar(id, ctxOf(p));
  }

  @Get("my-list")
  myList(@CurrentProfile() p: RequestProfile): Promise<TitleCard[]> {
    return this.personal.myList(ctxOf(p));
  }

  @Put("my-list/:titleId")
  @HttpCode(204)
  async addToList(@CurrentProfile() p: RequestProfile, @Param("titleId") titleId: string) {
    await this.personal.addToList(titleId, ctxOf(p));
  }

  @Delete("my-list/:titleId")
  @HttpCode(204)
  async removeFromList(@CurrentProfile() p: RequestProfile, @Param("titleId") titleId: string) {
    await this.personal.removeFromList(titleId, ctxOf(p));
  }

  @Put("ratings/:titleId")
  @HttpCode(204)
  async rate(@CurrentProfile() p: RequestProfile, @Param("titleId") titleId: string, @Body() body: { value?: unknown }) {
    await this.personal.rate(titleId, body?.value, ctxOf(p));
  }

  @Delete("ratings/:titleId")
  @HttpCode(204)
  async unrate(@CurrentProfile() p: RequestProfile, @Param("titleId") titleId: string) {
    await this.personal.unrate(titleId, ctxOf(p));
  }

  @Get("continue-watching")
  continueWatching(@CurrentProfile() p: RequestProfile): Promise<TitleCard[]> {
    return this.personal.continueWatching(ctxOf(p));
  }

  @Delete("continue-watching/:titleId")
  @HttpCode(204)
  async removeContinueWatching(@CurrentProfile() p: RequestProfile, @Param("titleId") titleId: string) {
    await this.personal.removeContinueWatching(titleId, ctxOf(p));
  }
}
