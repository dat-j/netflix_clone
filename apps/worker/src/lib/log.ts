/** Tiny structured-ish logger (single line, timestamped). Never pass key material here. */
type Level = "debug" | "info" | "warn" | "error";
const DEBUG = /^(1|true)$/i.test(process.env.WORKER_DEBUG ?? "");

function fmt(fields?: Record<string, unknown>): string {
  if (!fields) return "";
  return (
    " " +
    Object.entries(fields)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}=${typeof v === "string" ? (/\s/.test(v) ? JSON.stringify(v) : v) : JSON.stringify(v)}`)
      .join(" ")
  );
}
function write(level: Level, scope: string, msg: string, fields?: Record<string, unknown>) {
  if (level === "debug" && !DEBUG) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${msg}${fmt(fields)}`;
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
  if (err instanceof Error) return err.message;
  return String(err);
}
