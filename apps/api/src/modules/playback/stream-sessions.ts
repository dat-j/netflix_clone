import { Inject, Injectable } from "@nestjs/common";
import { RedisService } from "../../infra/redis.service.js";

export const SESSION_TTL_SEC = 45;
export const HEARTBEAT_INTERVAL_SEC = 10;

export interface StreamSession {
  sid: string;
  userId: string;
  profileId: string;
  titleId: string;
  episodeId: string | null;
  assetId: string;
  maxHeight: number;
  /** Tên playlist con được phép (rendition ≤ maxHeight + media) */
  renditions: string[];
  createdAt: number;
}

const sessKey = (sid: string) => `pb:s:${sid}`;
const userKey = (userId: string) => `pb:u:${userId}`;

// KEYS: userZset, sessKey | ARGV: nowMs, expiresMs, limit, sid, json, ttlSec
const START_LUA = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[3]) then return 0 end
redis.call('ZADD', KEYS[1], ARGV[2], ARGV[4])
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[6]) * 2)
redis.call('SET', KEYS[2], ARGV[5], 'EX', tonumber(ARGV[6]))
return 1`;

// KEYS: userZset, sessKey | ARGV: expiresMs, sid, ttlSec
const TOUCH_LUA = `
if redis.call('EXISTS', KEYS[2]) == 0 then return 0 end
redis.call('EXPIRE', KEYS[2], tonumber(ARGV[3]))
redis.call('ZADD', KEYS[1], ARGV[1], ARGV[2])
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[3]) * 2)
return 1`;

/**
 * Phiên phát trong Redis: key `pb:s:<sid>` (TTL ~45s, gia hạn bởi heartbeat) + ZSET `pb:u:<userId>`
 * (member = sid, score = thời điểm hết hạn) để đếm luồng đồng thời theo USER một cách nguyên tử.
 */
@Injectable()
export class StreamSessionStore {
  constructor(@Inject(RedisService) private readonly redis: RedisService) {}

  /** false nếu đã đạt giới hạn luồng. */
  async start(session: StreamSession, limit: number): Promise<boolean> {
    const now = Date.now();
    const ok = await this.redis.eval(
      START_LUA, 2, userKey(session.userId), sessKey(session.sid),
      String(now), String(now + SESSION_TTL_SEC * 1000), String(limit), session.sid, JSON.stringify(session), String(SESSION_TTL_SEC),
    );
    return ok === 1;
  }

  async get(sid: string): Promise<StreamSession | null> {
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(sid)) return null;
    const raw = await this.redis.get(sessKey(sid));
    return raw ? (JSON.parse(raw) as StreamSession) : null;
  }

  async touch(session: StreamSession): Promise<boolean> {
    const ok = await this.redis.eval(
      TOUCH_LUA, 2, userKey(session.userId), sessKey(session.sid),
      String(Date.now() + SESSION_TTL_SEC * 1000), session.sid, String(SESSION_TTL_SEC),
    );
    return ok === 1;
  }

  async end(session: Pick<StreamSession, "sid" | "userId">): Promise<void> {
    await this.redis.multi().del(sessKey(session.sid)).zrem(userKey(session.userId), session.sid).exec();
  }

  async activeCount(userId: string): Promise<number> {
    await this.redis.zremrangebyscore(userKey(userId), "-inf", Date.now());
    return this.redis.zcard(userKey(userId));
  }
}
