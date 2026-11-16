import {
  Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Query, UploadedFile, UseGuards, UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { AuthGuard, Roles, RolesGuard } from "../../common/auth.js";
import { AdminTitlesService } from "./admin-titles.service.js";
import { AdminCatalogService } from "./admin-catalog.service.js";

@Controller("admin")
@Roles("ADMIN")
@UseGuards(AuthGuard, RolesGuard)
export class AdminContentController {
  constructor(
    @Inject(AdminTitlesService) private readonly titles: AdminTitlesService,
    @Inject(AdminCatalogService) private readonly catalog: AdminCatalogService,
  ) {}

  @Get("stats")
  stats() {
    return this.catalog.stats();
  }

  // ───────── file nguồn ─────────
  @Get("source-files")
  sourceFiles(
    @Query("q") q?: string, @Query("prefix") prefix?: string, @Query("status") status?: string,
    @Query("unlinked") unlinked?: string, @Query("page") page?: string, @Query("pageSize") pageSize?: string,
  ) {
    return this.catalog.sourceFiles({ q, prefix, status, unlinked, page, pageSize });
  }

  @Post("source-files/scan")
  @HttpCode(200)
  scan(@Body() body: unknown) {
    return this.catalog.scan(body);
  }

  // ───────── titles ─────────
  @Get("titles")
  listTitles(
    @Query("q") q?: string, @Query("status") status?: string, @Query("type") type?: string,
    @Query("page") page?: string, @Query("pageSize") pageSize?: string,
  ) {
    return this.titles.list({ q, status, type, page, pageSize });
  }

  @Post("titles")
  createTitle(@Body() body: unknown) {
    return this.titles.create(body);
  }

  @Get("titles/:id")
  getTitle(@Param("id") id: string) {
    return this.titles.get(id);
  }

  @Patch("titles/:id")
  updateTitle(@Param("id") id: string, @Body() body: unknown) {
    return this.titles.update(id, body);
  }

  @Delete("titles/:id")
  @HttpCode(204)
  async deleteTitle(@Param("id") id: string) {
    await this.titles.remove(id);
  }

  @Post("titles/:id/publish")
  @HttpCode(200)
  publish(@Param("id") id: string) {
    return this.titles.publish(id);
  }

  @Post("titles/:id/unpublish")
  @HttpCode(200)
  unpublish(@Param("id") id: string) {
    return this.titles.unpublish(id);
  }

  @Post("titles/:id/assets")
  attachAsset(@Param("id") id: string, @Body() body: unknown) {
    return this.titles.attachAsset(id, body);
  }

  @Post("titles/:id/images")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 20 * 1024 * 1024, files: 1 } }))
  uploadImage(@Param("id") id: string, @UploadedFile() file: { buffer: Buffer; mimetype: string } | undefined, @Body() body: { kind?: string }) {
    return this.titles.uploadImage(id, file, body?.kind);
  }

  // ───────── jobs ─────────
  @Get("jobs")
  jobs(@Query("status") status?: string, @Query("page") page?: string, @Query("pageSize") pageSize?: string) {
    return this.titles.jobs({ status, page, pageSize });
  }

  @Post("jobs/:id/retry")
  @HttpCode(200)
  retryJob(@Param("id") id: string) {
    return this.titles.retryJob(id);
  }

  // ───────── genres ─────────
  @Get("genres")
  genres() {
    return this.catalog.genres();
  }

  // ───────── home rows ─────────
  @Get("home-rows")
  homeRows() {
    return this.catalog.homeRows();
  }

  @Post("home-rows/reorder")
  @HttpCode(200)
  reorder(@Body() body: unknown) {
    return this.catalog.reorderHomeRows(body);
  }

  @Post("home-rows")
  createHomeRow(@Body() body: unknown) {
    return this.catalog.createHomeRow(body);
  }

  @Patch("home-rows/:id")
  updateHomeRow(@Param("id") id: string, @Body() body: unknown) {
    return this.catalog.updateHomeRow(id, body);
  }

  @Delete("home-rows/:id")
  @HttpCode(204)
  async deleteHomeRow(@Param("id") id: string) {
    await this.catalog.deleteHomeRow(id);
  }

  // ───────── collections ─────────
  @Get("collections")
  collections() {
    return this.catalog.collections();
  }

  @Get("collections/:id")
  collection(@Param("id") id: string) {
    return this.catalog.collection(id);
  }

  @Post("collections")
  createCollection(@Body() body: unknown) {
    return this.catalog.createCollection(body);
  }

  @Patch("collections/:id")
  updateCollection(@Param("id") id: string, @Body() body: unknown) {
    return this.catalog.updateCollection(id, body);
  }

  @Delete("collections/:id")
  @HttpCode(204)
  async deleteCollection(@Param("id") id: string) {
    await this.catalog.deleteCollection(id);
  }

  // ───────── billboards ─────────
  @Get("billboards")
  billboards() {
    return this.catalog.billboards();
  }

  @Post("billboards")
  createBillboard(@Body() body: unknown) {
    return this.catalog.createBillboard(body);
  }

  @Delete("billboards/:id")
  @HttpCode(204)
  async deleteBillboard(@Param("id") id: string) {
    await this.catalog.deleteBillboard(id);
  }
}
