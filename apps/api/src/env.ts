import path from "node:path";
import { config } from "dotenv";

// .env nằm ở gốc monorepo; phải import file này đầu tiên trong main.ts
config({ path: path.resolve(import.meta.dirname, "../../../.env"), quiet: true });
config({ path: path.resolve(process.cwd(), "../../.env"), quiet: true });

export function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) throw new Error(`Thiếu biến môi trường ${name}`);
  return value;
}
