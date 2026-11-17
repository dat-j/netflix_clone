import { createHmac } from "node:crypto";
import { InitDataError, dataCheckString, signInitData, verifyInitData } from "./init-data.js";

const TOKEN = "123456:TEST-fake-bot-token";
const NOW = new Date("2026-11-17T10:00:00Z");
const nowSec = Math.floor(NOW.getTime() / 1000);
const USER = { id: 987654321, first_name: "Lan", last_name: "Nguyễn", username: "lan_ng", language_code: "vi", is_premium: true };

function fields(over: Record<string, string> = {}) {
  return {
    query_id: "AAHdF6IQAAAAAN0XohDhrOrc",
    user: JSON.stringify(USER),
    auth_date: String(nowSec - 60),
    signature: "c2lnbmF0dXJlLWJsb2I",
    ...over,
  };
}

function reason(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof InitDataError ? e.reason : `other:${(e as Error).message}`;
  }
  return undefined;
}

describe("Telegram initData", () => {
  it("accepts data signed per the official algorithm", () => {
    const initData = signInitData(fields(), TOKEN);
    const out = verifyInitData(initData, TOKEN, { now: NOW });
    expect(out.user).toMatchObject({ id: 987654321n, firstName: "Lan", lastName: "Nguyễn", username: "lan_ng", languageCode: "vi", isBot: false });
    expect(out.authDate.getTime()).toBe((nowSec - 60) * 1000);
  });

  it("matches an independent implementation of the spec (sorted, \\n-joined, hash excluded)", () => {
    const f = fields();
    const dcs = Object.keys(f).sort().map((k) => `${k}=${f[k as keyof typeof f]}`).join("\n");
    const secret = createHmac("sha256", "WebAppData").update(TOKEN).digest();
    const hash = createHmac("sha256", secret).update(dcs).digest("hex");
    const initData = new URLSearchParams({ ...f, hash }).toString();
    expect(dataCheckString(new URLSearchParams(initData))).toBe(dcs);
    expect(() => verifyInitData(initData, TOKEN, { now: NOW })).not.toThrow();
  });

  it("rejects a tampered field", () => {
    const params = new URLSearchParams(signInitData(fields(), TOKEN));
    params.set("user", JSON.stringify({ ...USER, id: 1 }));
    expect(reason(() => verifyInitData(params.toString(), TOKEN, { now: NOW }))).toBe("BAD_HASH");
  });

  it("rejects an added field", () => {
    const initData = `${signInitData(fields(), TOKEN)}&start_param=evil`;
    expect(reason(() => verifyInitData(initData, TOKEN, { now: NOW }))).toBe("BAD_HASH");
  });

  it("rejects data signed with another bot token", () => {
    const initData = signInitData(fields(), "999:other-token");
    expect(reason(() => verifyInitData(initData, TOKEN, { now: NOW }))).toBe("BAD_HASH");
  });

  it("rejects an expired auth_date", () => {
    const initData = signInitData(fields({ auth_date: String(nowSec - 25 * 3600) }), TOKEN);
    expect(reason(() => verifyInitData(initData, TOKEN, { now: NOW }))).toBe("EXPIRED");
    expect(reason(() => verifyInitData(initData, TOKEN, { now: NOW, maxAgeSec: 26 * 3600 }))).toBeUndefined();
  });

  it("rejects an auth_date far in the future", () => {
    const initData = signInitData(fields({ auth_date: String(nowSec + 3600) }), TOKEN);
    expect(reason(() => verifyInitData(initData, TOKEN, { now: NOW }))).toBe("EXPIRED");
  });

  it("rejects missing or malformed hash", () => {
    const params = new URLSearchParams(signInitData(fields(), TOKEN));
    params.delete("hash");
    expect(reason(() => verifyInitData(params.toString(), TOKEN, { now: NOW }))).toBe("MISSING_HASH");
    params.set("hash", "zz");
    expect(reason(() => verifyInitData(params.toString(), TOKEN, { now: NOW }))).toBe("BAD_HASH");
  });

  it("rejects duplicate keys, empty input and missing user", () => {
    const signed = signInitData(fields(), TOKEN);
    expect(reason(() => verifyInitData(`${signed}&auth_date=1`, TOKEN, { now: NOW }))).toBe("MALFORMED");
    expect(reason(() => verifyInitData("", TOKEN, { now: NOW }))).toBe("MALFORMED");
    const noUser = signInitData({ auth_date: String(nowSec), query_id: "x" }, TOKEN);
    expect(reason(() => verifyInitData(noUser, TOKEN, { now: NOW }))).toBe("NO_USER");
  });

  it("requires a bot token", () => {
    expect(reason(() => verifyInitData(signInitData(fields(), TOKEN), "", { now: NOW }))).toMatch(/^other:/);
  });
});
