import "./env.js";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import { AppModule } from "./app.module.js";
import { ApiExceptionFilter } from "./common/api-exception.js";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // API chạy sau Next rewrite / reverse proxy: lấy IP thật từ X-Forwarded-For (rate limit, danh sách thiết bị).
  app.set("trust proxy", process.env.TRUST_PROXY ?? "loopback, linklocal, uniquelocal");
  app.setGlobalPrefix("v1");
  app.use(cookieParser());
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();
  // Railway/PaaS cấp PORT; local dùng API_PORT
  await app.listen(Number(process.env.PORT ?? process.env.API_PORT ?? 4000));
}
await bootstrap();
