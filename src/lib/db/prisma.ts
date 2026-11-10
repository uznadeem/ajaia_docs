import "server-only";
import { createPrismaClient } from "./client";

const globalForPrisma = globalThis as typeof globalThis & {
  prisma?: ReturnType<typeof createPrismaClient>;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
