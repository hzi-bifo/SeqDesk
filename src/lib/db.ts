import { PrismaClient } from "@prisma/client";
import { bootstrapRuntimeEnv } from "@/lib/config/runtime-env";
import { requirePostgresDatabaseUrl } from "@/lib/database-url";

bootstrapRuntimeEnv();
if (process.env.NODE_ENV === "test") {
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ||
    "postgresql://seqdesk:seqdesk@127.0.0.1:5432/seqdesk_test?schema=public";
  process.env.DIRECT_URL = process.env.DIRECT_URL || process.env.DATABASE_URL;
}
requirePostgresDatabaseUrl(process.env.DATABASE_URL);

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["error", "warn"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
