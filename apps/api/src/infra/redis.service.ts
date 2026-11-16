import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { Redis } from "ioredis";
import { env } from "../env.js";

@Injectable()
export class RedisService extends Redis implements OnModuleDestroy {
  constructor() {
    super(env("REDIS_URL"), { maxRetriesPerRequest: null });
  }
  onModuleDestroy() {
    this.disconnect();
  }
}
