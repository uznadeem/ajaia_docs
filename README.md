# Ajaia Docs

A lightweight collaborative document editor, currently at Phase 1: application foundation. The workspace is a static placeholder; document creation, persistence, editing, authentication, and sharing are not implemented.

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
```

## Structure

- `src/app`: App Router pages, root layout, metadata, and global styles.
- `src/components`: shared application components; `ui` contains reusable presentation primitives.
- `src/lib`: future shared utilities, added only when needed.
- `src/types`: future shared types, added only when needed.

Components render on the server by default. Strict TypeScript and the `@/*` source alias are enabled. Typography uses locally available fonts without build-time font downloads. No database, editor, validation, or backend dependencies have been introduced; future Prisma, SQLite/PostgreSQL, Tiptap, and Zod integrations can be added as their phases require.
