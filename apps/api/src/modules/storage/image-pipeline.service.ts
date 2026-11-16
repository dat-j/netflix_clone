import { randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import sharp from "sharp";
import { mediaLayout } from "@app/shared/media";
import type { ImageDto, ImageKind, ImageRef } from "@app/shared";
import type { Image } from "@app/db";
import { PrismaService } from "../../infra/prisma.service.js";
import { StorageService } from "./storage.service.js";
import { CdnSigner } from "./cdn-signer.js";

const MAX_SIZE: Record<ImageKind, { width: number; height: number }> = {
  POSTER: { width: 600, height: 900 },
  BACKDROP: { width: 1920, height: 1080 },
  LOGO: { width: 800, height: 400 },
  STILL: { width: 1280, height: 720 },
};

export interface ProcessedImage { buffer: Buffer; width: number; height: number; blur: string }

/** Xử lý ảnh chung cho upload admin, import TMDB và seed: sharp → WebP + blur placeholder → bucket media. */
@Injectable()
export class ImagePipelineService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(StorageService) private readonly storage: StorageService,
    @Inject(CdnSigner) private readonly cdn: CdnSigner,
  ) {}

  async process(input: Buffer, kind: ImageKind): Promise<ProcessedImage> {
    const max = MAX_SIZE[kind];
    const pipeline = sharp(input, { failOn: "error" }).rotate().resize({ width: max.width, height: max.height, fit: "inside", withoutEnlargement: true });
    const { data, info } = await pipeline.webp({ quality: kind === "LOGO" ? 90 : 80, alphaQuality: 100 }).toBuffer({ resolveWithObject: true });
    const tiny = await sharp(data).resize({ width: 16, height: 16, fit: "inside" }).webp({ quality: 40 }).toBuffer();
    return { buffer: data, width: info.width, height: info.height, blur: `data:image/webp;base64,${tiny.toString("base64")}` };
  }

  /** Lưu ảnh của title, đặt làm ảnh chính của loại đó. */
  async saveTitleImage(titleId: string, kind: ImageKind, input: Buffer, opts: { language?: string | null } = {}): Promise<Image> {
    const img = await this.process(input, kind);
    const key = mediaLayout.titleImage(titleId, `${kind.toLowerCase()}-${randomBytes(4).toString("hex")}.webp`);
    await this.storage.putMedia(key, img.buffer, "image/webp");
    const old = await this.prisma.image.findMany({ where: { titleId, kind }, select: { id: true, key: true } });
    const created = await this.prisma.$transaction(async (tx) => {
      await tx.image.updateMany({ where: { titleId, kind }, data: { isPrimary: false } });
      return tx.image.create({
        data: { titleId, kind, key, width: img.width, height: img.height, blurData: img.blur, language: opts.language ?? null, isPrimary: true },
      });
    });
    // MVP: mỗi loại chỉ giữ một ảnh → dọn ảnh cũ
    if (old.length) {
      await this.prisma.image.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
      await Promise.allSettled(old.map((o) => this.storage.deleteMedia(o.key)));
    }
    return created;
  }

  /** Ảnh người (diễn viên) → images/people/<personId>.webp */
  async savePersonImage(personId: string, input: Buffer): Promise<string> {
    const { data } = await sharp(input).resize({ width: 185, height: 278, fit: "cover" }).webp({ quality: 75 }).toBuffer({ resolveWithObject: true });
    const key = `images/people/${personId}.webp`;
    await this.storage.putMedia(key, data, "image/webp");
    return key;
  }

  imageRef(img: Pick<Image, "key" | "width" | "height" | "blurData"> | null | undefined): ImageRef | null {
    if (!img) return null;
    return { url: this.cdn.publicUrl(img.key), width: img.width, height: img.height, blur: img.blurData };
  }

  imageDto(img: Image): ImageDto {
    return { ...this.imageRef(img)!, id: img.id, kind: img.kind, isPrimary: img.isPrimary };
  }
}

/** Chọn ảnh chính theo loại (ưu tiên isPrimary, sau đó mới nhất). */
export function pickImage<T extends { kind: string; isPrimary: boolean }>(images: T[], kind: ImageKind): T | null {
  let best: T | null = null;
  for (const img of images) {
    if (img.kind !== kind) continue;
    if (!best || (img.isPrimary && !best.isPrimary)) best = img;
  }
  return best;
}
