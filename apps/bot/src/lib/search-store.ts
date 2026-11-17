/** Maps a search text to a short id so it fits in callback_data (`L:q.<qid>:<page>`). */
import { createHash } from "node:crypto";
import type { KV } from "./kv.js";
import { normalizeQuery, queryKey } from "./text.js";

const TTL = 30 * 86_400;

export class SearchStore {
  constructor(private readonly kv: KV) {}

  static idFor(q: string): string {
    return createHash("sha256").update(queryKey(q)).digest("base64url").slice(0, 10);
  }

  async put(raw: string): Promise<{ qid: string; query: string }> {
    const query = normalizeQuery(raw);
    const qid = SearchStore.idFor(query);
    await this.kv.set(`bot:q:${qid}`, query, TTL);
    return { qid, query };
  }

  async get(qid: string): Promise<string | null> {
    return this.kv.get(`bot:q:${qid}`);
  }
}
