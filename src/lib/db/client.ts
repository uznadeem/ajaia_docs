import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";

// Also used by standalone seed and test processes, outside the Next.js runtime.
export function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required for database queries.");
  }

  const adapter = new PrismaPg({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
  });

  return new PrismaClient({ adapter });
}
