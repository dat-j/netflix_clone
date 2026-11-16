import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import type { HeartbeatBody, PlaybackSession, PreviewSource, StartPlaybackBody } from "@app/shared";
import {
  AuthGuard, CurrentEntitlement, CurrentProfile, CurrentUser, ProfileGuard, SubscriptionGuard,
  type Entitlement, type RequestProfile, type RequestUser,
} from "../../common/auth.js";
import { PlaybackService } from "./playback.service.js";

const M3U8 = "application/vnd.apple.mpegurl";

function sendPlaylist(res: Response, text: string) {
  res.setHeader("Content-Type", M3U8);
  res.setHeader("Cache-Control", "private, no-store");
  res.send(text);
}

function sendKey(res: Response, key: Buffer) {
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Cache-Control", "private, no-store");
  res.send(key);
}

@Controller("playback")
export class PlaybackController {
  constructor(@Inject(PlaybackService) private readonly playback: PlaybackService) {}

  @Post("sessions")
  @UseGuards(AuthGuard, ProfileGuard, SubscriptionGuard)
  start(
    @CurrentUser() user: RequestUser, @CurrentProfile() profile: RequestProfile, @CurrentEntitlement() ent: Entitlement,
    @Body() body: StartPlaybackBody,
  ): Promise<PlaybackSession> {
    return this.playback.start(user, profile, ent, body);
  }

  @Post("sessions/:sid/heartbeat")
  @HttpCode(204)
  @UseGuards(AuthGuard, ProfileGuard, SubscriptionGuard)
  async heartbeat(@CurrentUser() user: RequestUser, @Param("sid") sid: string, @Body() body: HeartbeatBody) {
    await this.playback.heartbeat(sid, user, body);
  }

  @Delete("sessions/:sid")
  @HttpCode(204)
  @UseGuards(AuthGuard)
  async end(@CurrentUser() user: RequestUser, @Param("sid") sid: string) {
    await this.playback.end(sid, user);
  }

  // Playlist/key: chỉ cần đăng nhập + sở hữu phiên phát đang sống (phiên đã được tạo dưới thuê bao hợp lệ).
  @Get("sessions/:sid/master.m3u8")
  @UseGuards(AuthGuard)
  async master(@CurrentUser() user: RequestUser, @Param("sid") sid: string, @Res() res: Response) {
    sendPlaylist(res, await this.playback.masterPlaylist(sid, user));
  }

  @Get("sessions/:sid/r/:rendition/index.m3u8")
  @UseGuards(AuthGuard)
  async rendition(@CurrentUser() user: RequestUser, @Param("sid") sid: string, @Param("rendition") rendition: string, @Res() res: Response) {
    sendPlaylist(res, await this.playback.renditionPlaylist(sid, user, rendition));
  }

  @Get("sessions/:sid/key")
  @UseGuards(AuthGuard)
  async key(@CurrentUser() user: RequestUser, @Param("sid") sid: string, @Res() res: Response) {
    sendKey(res, await this.playback.key(sid, user));
  }

  @Get("preview/:titleId")
  @UseGuards(AuthGuard)
  preview(@CurrentUser() user: RequestUser, @Param("titleId") titleId: string): Promise<PreviewSource> {
    return this.playback.preview(titleId, user);
  }

  // Proxy preview có token (gắn với user, hết hạn ~1h) — không cần thuê bao, không chiếm slot luồng.
  @Get("previews/:assetId/:exp/:token/master.m3u8")
  @UseGuards(AuthGuard)
  async previewMaster(
    @CurrentUser() user: RequestUser, @Param("assetId") assetId: string, @Param("exp") exp: string, @Param("token") token: string,
    @Res() res: Response,
  ) {
    sendPlaylist(res, await this.playback.previewMaster(assetId, exp, token, user));
  }

  @Get("previews/:assetId/:exp/:token/r/:rendition/index.m3u8")
  @UseGuards(AuthGuard)
  async previewRendition(
    @CurrentUser() user: RequestUser, @Param("assetId") assetId: string, @Param("exp") exp: string, @Param("token") token: string,
    @Param("rendition") rendition: string, @Res() res: Response,
  ) {
    sendPlaylist(res, await this.playback.previewRendition(assetId, exp, token, rendition, user));
  }

  @Get("previews/:assetId/:exp/:token/key")
  @UseGuards(AuthGuard)
  async previewKey(
    @CurrentUser() user: RequestUser, @Param("assetId") assetId: string, @Param("exp") exp: string, @Param("token") token: string,
    @Res() res: Response,
  ) {
    sendKey(res, await this.playback.previewKey(assetId, exp, token, user));
  }
}
