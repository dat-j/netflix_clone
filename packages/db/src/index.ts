import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

export * from "../generated/prisma/client.js";

export function createPrismaClient(databaseUrl = process.env.DATABASE_URL): PrismaClient {
  if (!databaseUrl) throw new Error("DATABASE_URL chưa được cấu hình");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
}
export { PrismaPg } from "@prisma/adapter-pg";
