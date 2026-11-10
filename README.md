# Ajaia Docs

A lightweight collaborative document editor. Phase 3 adds document CRUD APIs and signed demo sessions on the PostgreSQL foundation. The workspace remains a static placeholder; dashboard, editor, uploads, sharing UI, and production authentication are not implemented.

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
npm run test:api
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

Deleting a user cascades to their owned documents and received shares. Deleting a document cascades to its shares. Updating referenced IDs cascades to foreign keys. Document API authorization enforces owner/editor/viewer permissions. Share management and prevention of owner/self-sharing remain outside this phase.

Seeding upserts Alice Demo (`alice@example.com`) and Bob Demo (`bob@example.com`) by email, preserving existing users and edits. It creates no documents or shares and is safe to repeat.

## Database integration tests

`npm run test:db` runs against the configured database after migrations. It covers email and share uniqueness, ownership, JSON persistence, foreign keys, all deletion cascades, and idempotent seed logic. Tests generate UUID-tagged emails under `ajaia-test.invalid`; cleanup targets only those exact per-test emails, with dependent records removed by cascades. The seed test uses those isolated addresses rather than the real demo users. No truncation, broad deletion, or database reset occurs. An interrupted process can leave test fixtures behind.

## Demo sessions and document APIs

**Demo sessions are not production authentication.** Anyone with access to this application can select Alice or Bob; no password or identity verification is performed. Do not expose this demo with private data.

Set a unique `DEMO_SESSION_SECRET` in ignored `.env.local` (generate with `openssl rand -hex 32`). The application rejects secrets shorter than 32 bytes and never supplies a fallback. Set `APP_ORIGIN` to the exact browser origin, including the port, especially behind a reverse proxy. Without it, origin checks use the incoming request URL. Session and document mutation requests require a matching `Origin` header; cross-site Fetch Metadata is also rejected. Requests with JSON bodies must use `Content-Type: application/json`.

| Endpoint | Behavior |
| --- | --- |
| `POST /api/demo/session` | JSON `{ "email": "alice@example.com" }` or Bob's seeded address; returns the existing user and sets a signed session cookie. Other fields/identities are rejected. |
| `DELETE /api/demo/session` | Clears the cookie; returns 204, including when the cookie is missing or invalid. |
| `GET /api/documents` | Lists owned and shared metadata, owner id/name, effective `OWNER`/`EDITOR`/`VIEWER` permission, and `owned`/`shared` relationship. Omits content and other recipients. Ordered by `updatedAt DESC, id DESC`. |
| `POST /api/documents` | JSON `{}` or `{ "title": "My notes" }`; creates an owned document with empty Tiptap content; returns 201 and `{ document }`. Client-supplied ownership or content is rejected. |
| `GET /api/documents/[id]` | Returns `{ document }`, including content and effective permission, if owned/shared; otherwise 404. |
| `PATCH /api/documents/[id]` | Accepts `title` and/or `content`; owner/editor only. Changes only supplied fields; empty or unexpected fields rejected. Returns `{ document }`. |
| `DELETE /api/documents/[id]` | Owner only; deletes the document and cascading shares; returns 204. |

List responses use `{ documents: [...] }`. Errors consistently use `{ error: { code, message } }`: 400 invalid input/JSON, 401 missing/invalid session, 403 visible document with insufficient permission or failed origin checks, 404 absent/inaccessible document, 413 oversized body, and 500 unexpected server/configuration errors. Driver details are never returned. All API responses use `Cache-Control: no-store`.

Sessions contain a version, user ID, allowlisted email, issued-at time, and expiration. They use HMAC-SHA256 and constant-time signature comparison. Every document request validates signature, an eight-hour maximum lifetime, expiration, and the user's continued existence with the same allowlisted email. Cookies are HttpOnly, SameSite=Lax, Path=/, and Secure in production. Identity headers and body-supplied user IDs are never trusted. Switching users replaces the cookie.

Centralized ownership/share filters scope reads and writes. PATCH includes owner-or-editor permission in its atomic database write predicate; DELETE includes ownership in its predicate. Reads select only required fields and filter share relations to the active user, avoiding per-document lookups. Inaccessible records return 404; a visible viewer edit or non-owner delete returns 403. Concurrent revocations fail closed on the returned data; updates use normal PostgreSQL statement-snapshot semantics, not a serialized permission-revocation protocol.

### Input limits and supported content

Document IDs must be CUIDs. Titles are trimmed and must contain 1–200 characters. Bodies are limited to 256 KiB by both the declared content length and actual streamed bytes. Extra request fields, invalid UTF-8/JSON, and unsupported rich-text fields are rejected.

Content supports a strict Tiptap StarterKit subset: `doc`, paragraphs, headings (levels 1–6), text, hard breaks, horizontal rules, blockquotes, bullet/ordered lists, list items, and code blocks. Marks: bold, italic, strike, code, underline. Only the documented node attributes (heading level, ordered-list start, code language) are accepted. Text cannot appear directly in the root; list items must start with paragraphs. Root content requires at least one block. Validation is iterative, limited to 2,000 nodes and depth 20. Images, links, HTML, arbitrary attributes, tables, and custom extensions are intentionally unsupported. Future rendering must use safe Tiptap rendering rather than treating stored text as HTML.

### API tests and security limitations

`npm run test:api` calls the real Next.js route handlers with `NextRequest` objects and real Prisma/Neon queries. It uses Node's `react-server` condition to honor server-only imports. Alice/Bob are read as existing seed users; created document IDs and any temporary third-user IDs are tracked and cleaned up explicitly. No seeded users or unrelated documents are deleted. Tests use a process-local random signing key rather than the configured local secret. Browser cookie enforcement, HTTP transport, and proxy configuration are not exercised by these handler-level tests.

This assessment does not add login throttling, pagination, audit logging, or centralized server-side session revocation. Logout clears the browser cookie; a stolen token remains valid until expiration or secret rotation. The metadata list is currently unpaginated. Separate seed/database integration tests remain available with `npm run test:db`. An interrupted test process can leave its own fixture records behind.
