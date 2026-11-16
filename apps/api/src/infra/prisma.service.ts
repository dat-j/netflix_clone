import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { PrismaClient, PrismaPg } from "@app/db";
import { env } from "../env.js";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    super({ adapter: new PrismaPg({ connectionString: env("DATABASE_URL") }) });
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
