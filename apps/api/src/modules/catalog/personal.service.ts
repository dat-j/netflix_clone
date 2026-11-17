import { Inject, Injectable } from "@nestjs/common";
import type { RatingValue, TitleCard } from "@app/shared";
import { PrismaService } from "../../infra/prisma.service.js";
import { ApiException } from "../../common/api-exception.js";
import { TitleCardsService, visibleWhere, type ViewerCtx } from "./title-cards.service.js";

const UUID_RE = /^[0-9a-f-]{36}$/i;
const RATINGS: RatingValue[] = ["DISLIKE", "LIKE", "LOVE"];

/** Danh sách của tôi, đánh giá, xem tiếp — theo profile. */
@Injectable()
export class PersonalService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TitleCardsService) private readonly cards: TitleCardsService,
  ) {}

  private async assertVisible(titleId: string, ctx: ViewerCtx) {
    if (!UUID_RE.test(titleId)) throw new ApiException(404, "NOT_FOUND", "Không tìm thấy phim");
    const t = await this.prisma.title.findFirst({ where: { AND: [{ id: titleId }, visibleWhere(ctx)] }, select: { id: true } });
    if (!t) throw new ApiException(404, "NOT_FOUND", "Không tìm thấy phim");
  }

  async myList(ctx: ViewerCtx): Promise<TitleCard[]> {
    const rows = await this.prisma.myListItem.findMany({
      where: { profileId: ctx.profileId, title: visibleWhere(ctx) }, orderBy: { createdAt: "desc" }, take: 500, select: { titleId: true },
    });
    return this.cards.cardsByIds(rows.map((r) => r.titleId), ctx);
  }

  async addToList(titleId: string, ctx: ViewerCtx) {
    await this.assertVisible(titleId, ctx);
    await this.prisma.myListItem.upsert({
      where: { profileId_titleId: { profileId: ctx.profileId, titleId } }, create: { profileId: ctx.profileId, titleId }, update: {},
    });
  }

  async removeFromList(titleId: string, ctx: ViewerCtx) {
    if (!UUID_RE.test(titleId)) return;
    await this.prisma.myListItem.deleteMany({ where: { profileId: ctx.profileId, titleId } });
  }

  async rate(titleId: string, value: unknown, ctx: ViewerCtx) {
    if (typeof value !== "string" || !RATINGS.includes(value as RatingValue)) {
      throw new ApiException(400, "VALIDATION", "value phải là DISLIKE, LIKE hoặc LOVE");
    }
    await this.assertVisible(titleId, ctx);
    await this.prisma.rating.upsert({
      where: { profileId_titleId: { profileId: ctx.profileId, titleId } },
      create: { profileId: ctx.profileId, titleId, value: value as RatingValue },
      update: { value: value as RatingValue },
    });
  }

  async unrate(titleId: string, ctx: ViewerCtx) {
    if (!UUID_RE.test(titleId)) return;
    await this.prisma.rating.deleteMany({ where: { profileId: ctx.profileId, titleId } });
  }

  async continueWatching(ctx: ViewerCtx): Promise<TitleCard[]> {
    return this.cards.cardsByIds(await this.cards.continueWatchingIds(ctx, visibleWhere(ctx)), ctx);
  }

  async removeContinueWatching(titleId: string, ctx: ViewerCtx) {
    if (!UUID_RE.test(titleId)) return;
    await this.prisma.watchProgress.deleteMany({ where: { profileId: ctx.profileId, titleId } });
  }
}
