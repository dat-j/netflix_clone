import "../src/env.js";
import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import type { Response } from "supertest";
import { AppModule } from "../src/app.module.js";
import { ApiExceptionFilter } from "../src/common/api-exception.js";

/** Dựng app in-process giống main.ts (prefix v1, cookie-parser, filter lỗi). */
export async function createTestApp(): Promise<NestExpressApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: ["error", "warn"] });
  app.set("trust proxy", "loopback");
  app.setGlobalPrefix("v1");
  app.use(cookieParser());
  app.useGlobalFilters(new ApiExceptionFilter());
  await app.init();
  return app;
}

export interface SetCookie { name: string; value: string; attrs: string }

export function setCookies(res: Response): Record<string, SetCookie> {
  const raw = res.headers["set-cookie"] as unknown as string[] | string | undefined;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const out: Record<string, SetCookie> = {};
  for (const line of list) {
    const [pair, ...rest] = line.split(";");
    const idx = pair!.indexOf("=");
    const name = pair!.slice(0, idx).trim();
    out[name] = { name, value: decodeURIComponent(pair!.slice(idx + 1)), attrs: rest.join(";").trim() };
  }
  return out;
}

/** Hũ cookie tối giản: cập nhật theo Set-Cookie (bỏ qua path để gọi thẳng /v1/...). */
export class CookieJar {
  private jar = new Map<string, string>();
  update(res: Response): this {
    for (const c of Object.values(setCookies(res))) {
      if (!c.value || /Expires=Thu, 01 Jan 1970/i.test(c.attrs)) this.jar.delete(c.name);
      else this.jar.set(c.name, c.value);
    }
    return this;
  }
  get(name: string) { return this.jar.get(name); }
  set(name: string, value: string) { this.jar.set(name, value); return this; }
  header(): string {
    return [...this.jar].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("; ");
  }
}
