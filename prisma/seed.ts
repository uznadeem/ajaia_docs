import nextEnv from "@next/env";
import { createPrismaClient } from "../src/lib/db/client";
import { seedUsers } from "./seed-users";

nextEnv.loadEnvConfig(process.cwd());
const prisma = createPrismaClient();

async function main() {
  await prisma.$transaction((tx) => seedUsers(tx));
  console.log("Demo users seeded successfully.");
}

main()
  .catch(() => {
    // Avoid logging database connection details from driver errors.
    console.error("Database seeding failed. Check database access and migrations.");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
