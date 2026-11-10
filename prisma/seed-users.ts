import type { PrismaClient } from "../src/generated/prisma/client";

const demoUsers = [
  { name: "Alice Demo", email: "alice@example.com" },
  { name: "Bob Demo", email: "bob@example.com" },
] as const;

// Optional inputs let integration tests exercise this logic with isolated users.
export async function seedUsers(
  db: Pick<PrismaClient, "user">,
  users: readonly { name: string; email: string }[] = demoUsers,
) {
  return Promise.all(
    users.map((user) =>
      db.user.upsert({
        where: { email: user.email },
        update: {},
        create: user,
      }),
    ),
  );
}
