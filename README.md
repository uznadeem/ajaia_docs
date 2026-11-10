# Ajaia Docs

A lightweight collaborative document editor. Phase 2 adds the PostgreSQL database foundation; the workspace remains a static placeholder. Document APIs, authentication, editing, uploads, and sharing UI are not implemented.

## Development

```sh
npm ci
npm run dev
```

Open http://localhost:3000.

## Verification

```sh
npm run lint
npm run typecheck
npm run build
npm run db:validate
npm run test:db
```

## Structure

- `src/app`: App Router pages, root layout, metadata, and global styles.
- `src/components`: shared application components; `ui` contains reusable presentation primitives.
- `src/lib/db`: Prisma construction and the server-only application singleton.
- `prisma`: schema, migrations, and demo seed.
- `tests/database`: integration tests using isolated records in the configured database.
- `src/generated/prisma`: generated client, ignored by Git.

Components render on the server by default. Strict TypeScript and the `@/*` source alias are enabled. Typography uses locally available fonts without build-time font downloads.

## Database setup

Use a Node.js version supported by `package.json` (Prisma 7 requires Node 20.19+, 22.12+, or 24+). Prisma CLI, Client, and the PostgreSQL adapter are pinned to the same stable version.

Copy `.env.example` to `.env.local` and populate the existing Neon project's URLs locally. Keep `.env.local` and `.neon` ignored. Prisma config, seeding, and tests load `.env.local` using Next.js environment loading; existing process environment variables take precedence.

- `DATABASE_URL`: pooled connection used by the application, seeding, and tests.
- `DATABASE_URL_UNPOOLED`: direct connection used by Prisma migrations. Prisma 7 config points to this variable directly; `DIRECT_URL` is unnecessary.

```sh
npm run db:validate
npm run db:generate
npm run db:deploy
npm run db:seed
npm run db:status
```

`db:deploy` applies checked-in migrations without resetting the database. For future schema changes on a development database, use `npm run db:migrate -- --name change_name`; Prisma's development migration workflow needs permission to create a shadow database or a separately configured shadow database. Never reset the shared Neon database to resolve migration drift.

Install, type checking, and builds regenerate the ignored Prisma Client automatically. Generation does not need database credentials or a live connection; migrations, seeding, and integration tests do.

Application server code should import `prisma` from `@/lib/db/prisma`. Its `server-only` guard prevents client-component imports, and its development singleton survives hot reloads. Standalone seed and test processes construct their own client and disconnect when finished. Each client uses a bounded pool of up to five connections.

## Data rules

Users have unique emails. Documents have required owners and JSONB content for Tiptap JSON; JSON structure is not validated at this database layer. A user can receive at most one share per document, with `VIEWER` or `EDITOR` permission. Indexes support owner/update-time and recipient/creation-time queries; the unique share index also supports document share lookups.

Deleting a user cascades to their owned documents and received shares. Deleting a document cascades to its shares. Updating referenced IDs cascades to foreign keys. Authorization and prevention of owner/self-sharing are future application responsibilities.

Seeding upserts Alice Demo (`alice@example.com`) and Bob Demo (`bob@example.com`) by email, preserving existing users and edits. It creates no documents or shares and is safe to repeat.

## Database integration tests

`npm run test:db` runs against the configured database after migrations. It covers email and share uniqueness, ownership, JSON persistence, foreign keys, all deletion cascades, and idempotent seed logic. Tests generate UUID-tagged emails under `ajaia-test.invalid`; cleanup targets only those exact per-test emails, with dependent records removed by cascades. The seed test uses those isolated addresses rather than the real demo users. No truncation, broad deletion, or database reset occurs. An interrupted process can leave test fixtures behind.
