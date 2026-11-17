/** Single-line structured logger. Secrets registered via `registerSecret` are masked in every line. */
type Level = "debug" | "info" | "warn" | "error";
const secrets = new Set<string>();
let debugEnabled = /^(1|true)$/i.test(process.env.BOT_DEBUG ?? "");

export function registerSecret(s: string | undefined) {
  if (s && s.length >= 6) secrets.add(s);
}
export function setDebug(on: boolean) {
  debugEnabled = on;
}
export function redact(s: string): string {
  let out = s;
  for (const sec of secrets) out = out.split(sec).join("***");
  // Telegram tokens look like 123456:AA…; mask any that slipped through (e.g. inside a URL in an error message).
  return out.replace(/\b\d{6,12}:[A-Za-z0-9_-]{30,}\b/g, "***");
}
function fmt(fields?: Record<string, unknown>): string {
  if (!fields) return "";
  return Object.entries(fields)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => ` ${k}=${typeof v === "string" ? (/[\s"=]/.test(v) ? JSON.stringify(v) : v) : JSON.stringify(v)}`)
    .join("");
}
function write(level: Level, scope: string, msg: string, fields?: Record<string, unknown>) {
  if (level === "debug" && !debugEnabled) return;
  const line = redact(`${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${msg}${fmt(fields)}`);
  (level === "error" || level === "warn" ? console.error : console.log)(line);
}
export function logger(scope: string) {
  return {
    debug: (m: string, f?: Record<string, unknown>) => write("debug", scope, m, f),
    info: (m: string, f?: Record<string, unknown>) => write("info", scope, m, f),
    warn: (m: string, f?: Record<string, unknown>) => write("warn", scope, m, f),
    error: (m: string, f?: Record<string, unknown>) => write("error", scope, m, f),
  };
}
export type Logger = ReturnType<typeof logger>;
export function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
