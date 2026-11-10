import nextEnv from "@next/env";
import { defineConfig } from "prisma/config";

// Match Next.js environment loading, including the ignored .env.local file.
nextEnv.loadEnvConfig(process.cwd());

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Generation works without credentials; migration commands require this URL.
    url: process.env.DATABASE_URL_UNPOOLED,
  },
});
