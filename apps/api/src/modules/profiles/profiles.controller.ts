import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req, Res, UseGuards } from "@nestjs/common";
import type { AvatarOption, ProfileDto } from "@app/shared";
import type { Response } from "express";
import { type AppRequest, AuthGuard, CurrentUser, PROFILE_COOKIE, type RequestUser } from "../../common/auth.js";
import { clearProfileCookie, setProfileCookie } from "../auth/cookies.js";
import { parseOrThrow } from "../auth/validation.js";
import { AVATARS, ProfilesService, profileInputSchema, profilePatchSchema } from "./profiles.service.js";

@Controller("profiles")
@UseGuards(AuthGuard)
export class ProfilesController {
  constructor(private readonly profiles: ProfilesService) {}

  @Get("avatars")
  avatars(): AvatarOption[] {
    return AVATARS;
  }

  @Get()
  list(@CurrentUser() user: RequestUser): Promise<ProfileDto[]> {
    return this.profiles.list(user.id);
  }

  @Post()
  create(@CurrentUser() user: RequestUser, @Body() body: unknown): Promise<ProfileDto> {
    return this.profiles.create(user.id, parseOrThrow(profileInputSchema, body));
  }

  @Patch(":id")
  update(@CurrentUser() user: RequestUser, @Param("id") id: string, @Body() body: unknown): Promise<ProfileDto> {
    return this.profiles.update(user.id, id, parseOrThrow(profilePatchSchema, body));
  }

  @Delete(":id")
  @HttpCode(204)
  async remove(
    @CurrentUser() user: RequestUser, @Param("id") id: string,
    @Req() req: AppRequest, @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.profiles.remove(user.id, id);
    if (req.cookies?.[PROFILE_COOKIE] === id) clearProfileCookie(res);
  }

  @Post(":id/select")
  @HttpCode(200)
  async select(
    @CurrentUser() user: RequestUser, @Param("id") id: string, @Res({ passthrough: true }) res: Response,
  ): Promise<ProfileDto> {
    const profile = await this.profiles.select(user.id, id);
    setProfileCookie(res, profile.id);
    return profile;
  }
}
