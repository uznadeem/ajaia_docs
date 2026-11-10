# Ajaia Docs

A lightweight collaborative document editor. Phase 7 adds TXT/Markdown import alongside the autosaving Tiptap editor on top of the dashboard, signed demo sessions, and PostgreSQL document APIs. Attachments, sharing UI, realtime collaboration, and production authentication are not implemented.

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
npm run test:frontend
npm run test
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
| `GET /api/demo/session` | Returns `{ user: { id, name, email } }` for a valid signed session, otherwise 401. Never returns cookie/signature data. |
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

Content supports a strict Tiptap StarterKit subset: `doc`, paragraphs, headings (levels 1–6), text, hard breaks, horizontal rules, blockquotes, bullet/ordered lists, list items, and code blocks. Marks: bold, italic, strike, code, underline. Only the documented node attributes (heading level, ordered-list start and nullable HTML numbering type, code language) are accepted. Tiptap 3 emits an ordered-list `type: null` for decimal lists; the API accepts null or `1`/`a`/`A`/`i`/`I`. Text cannot appear directly in the root; list items must start with paragraphs. Root content requires at least one block. Validation is iterative, limited to 2,000 nodes and depth 20. Images, links, HTML, arbitrary attributes, tables, and custom extensions are intentionally unsupported. The editor renders through Tiptap's schema, not raw stored HTML.

### API tests and security limitations

`npm run test:api` calls the real Next.js route handlers with `NextRequest` objects and real Prisma/Neon queries. It uses Node's `react-server` condition to honor server-only imports. Alice/Bob are read as existing seed users; created document IDs and any temporary third-user IDs are tracked and cleaned up explicitly. No seeded users or unrelated documents are deleted. Tests use a process-local random signing key rather than the configured local secret. Browser cookie enforcement, HTTP transport, and proxy configuration are not exercised by these handler-level tests.

This assessment does not add login throttling, pagination, audit logging, or centralized server-side session revocation. Logout clears the browser cookie; a stolen token remains valid until expiration or secret rotation. The metadata list is currently unpaginated. Separate seed/database integration tests remain available with `npm run test:db`. An interrupted test process can leave its own fixture records behind.

## Document dashboard

The workspace at `/` discovers the current demo user with `GET /api/demo/session`, then loads metadata from `GET /api/documents` once. Selecting Alice/Bob or logging out uses the existing session POST/DELETE endpoints. Signed session data stays in the HTTP-only cookie; the frontend stores no credentials or session tokens. Session expiration clears displayed documents and returns to user selection.

Owned and shared lists preserve API ordering and display titles, owners, permissions, and last-modified times in the browser's locale/time zone. Creating a default document updates local metadata immediately and opens `/documents/[id]`. Owners and editors can rename using the same title schema as the backend; only owners see Delete. Deletion requires confirmation. Successful rename/deletion reloads the list; 403/404 responses also refresh access while keeping a useful dialog error. Authorization remains enforced by the backend.

The root page/layout remain Server Components. `src/components/dashboard` contains the interactive dashboard, local request/state hook, user selector, lists, and action dialog. Shared response types in `src/lib/api/contracts.ts` derive from server helpers with type-only imports; database and signing code is not shipped to the browser. Pending requests use abort signals, stale responses are ignored, and synchronous submission locks prevent repeated mutations. Session switches immediately remove the previous user's data.

Dialogs use native modal semantics and inert backgrounds, explicit keyboard focus wrapping, Escape cancellation, safe initial focus, and return focus to the action trigger or workspace heading when a list refresh removes that trigger. Controls and forms have labels, focus indicators, validation feedback, and disabled pending states. Loading, retry, empty, network error, and expired-session states are included.

`/documents/[id]` opens the access-checked document editor described below. The dashboard intentionally does not poll or subscribe to remote changes; shared lists are empty until shares exist in the database.

### Frontend verification

`npm run test:frontend` uses Vitest, jsdom, and React Testing Library with fetch mocked at the component boundary. It does not connect to Neon. Coverage includes user selection/switching, no session, loading/error/retry, grouping and metadata, stale responses, create/navigation and duplicate protection, title validation, role-specific actions, confirmation cancellation, dialog focus, permission changes, logout/expiry, unmount cancellation, and document editing. jsdom's missing native dialog and layout methods are shimmed in test setup; browser checks cover actual dialog and editor behavior.

The existing `test:api` and `test:db` commands continue to use isolated Neon fixtures. `npm ci` installs the locked test-tool versions; they are development dependencies and are not used by the deployed application.

## Rich-text editing and explicit saving

The document page remains a Server Component with a client editor behind its existing Suspense boundary. It fetches `GET /api/documents/[id]`, validates stored JSON against the shared API schema and ProseMirror schema, and initializes Tiptap once per loaded document. A keyed loader immediately removes the old document on ID changes; abort signals prevent stale fetches from displaying it again.

The three matching Tiptap packages are `@tiptap/react`, `@tiptap/pm`, and `@tiptap/starter-kit`. StarterKit 3 already includes underline. The toolbar provides paragraphs, bold, italic, underline, H1–H3, bullet lists, and numbered lists, with active states, labels, and arrow/Home/End keyboard navigation. Standard Tiptap keyboard shortcuts are retained. Existing API-supported StarterKit content such as code, quotes, strike, and H4–H6 remains readable/editable; no extra extensions are installed. Links and automatic trailing nodes are disabled to stay compatible with API validation and avoid unsolicited document changes.

Owners and editors can edit the title and content; viewers get a read-only title, canvas, and disabled formatting/Save controls. The backend remains authoritative. Save validates the shared title/content schemas and 256 KiB request limit, then PATCHes only changed fields. Clean documents make no PATCH request. A synchronous lock prevents duplicate submissions. Typing can continue while saving; the response acknowledges the submitted snapshot without resetting editor content or newer title edits. Newer local edits remain unsaved and can be saved separately. Autosave uses this same save path, as described below.

Failed saves keep the draft and allow retry. A 403 pauses editing; 401/404 also hide title/content. Drafts remain only in this tab's memory. After restoring the session/access, **Check access again** revalidates with GET and resumes permitted editing without replacing the draft. View-only access stays read-only. No draft or session data is written to localStorage.

Dirty or in-flight saves register a browser `beforeunload` warning and intercept ordinary same-origin document/header links with confirmation. Reload/close warnings depend on browser support and user interaction; SPA back/forward history and programmatic navigation cannot be universally blocked by this guard. Leaving or reloading after confirmation discards the in-memory draft.

Editor tests use real Tiptap/ProseMirror state and toolbar commands, with only fetch mocked. They cover formatting, empty documents, title/content saving, API compatibility, failures, overlapping typing/save responses, duplicate prevention, warnings, access changes, cancellation, and resource destruction. `npm run test` runs frontend, API, and database suites in sequence and therefore requires the configured Neon connection and seeded users. `npm run test:frontend` stays database-free.

## Autosave

Title and content edits debounce for 800ms before using the existing PATCH/save path. Clean documents and viewers never autosave. Saves do not overlap; newer edits made during a request remain dirty and schedule a follow-up 800ms after that request finishes. Manual Save bypasses the debounce and prevents a duplicate timer request.

The status shows Unsaved, Saving, Saved, or Error. Failed saves preserve the in-memory draft and pause automatic retries until the next edit or manual Save; there is no background retry loop. Permission/session failures retain the existing paused/read-only behavior. Timers are cancelled on unmount, and the existing dirty/in-flight navigation and unload guards remain active.

Known limits: browser unload is not guaranteed to finish a save, and confirming navigation can discard pending edits. Drafts are not persisted offline. Separate clients remain last-write-wins; no revision history or conflict-resolution infrastructure is introduced.


## File import

Use **Upload Document** on the dashboard to import one UTF-8 `.txt` or `.md` file, up to 1,048,576 bytes (1 MB). The file becomes a new document owned by the current signed-in demo user and opens in the existing editor. The original file is not stored. Duplicate submissions and other dashboard mutations are disabled during upload; invalid-file/API errors allow reselecting and retrying the same file.

`POST /api/documents/import` accepts multipart/form-data with exactly one `file` field and no extra fields. It uses the existing signed session and same-origin checks. It bounds declared and streamed multipart bytes before native parsing, then validates extension, actual file size, strict UTF-8 decoding, nonempty text, title, generated JSON size, and the existing rich-text schema before writing to PostgreSQL. MIME types are not trusted. Filenames are reduced to a basename, normalized, stripped of control/angle-bracket characters, and validated against the existing 1–200-character title rules. Invalid requests use the existing standardized JSON errors; size failures return 413. A successful 201 response contains `{ document }` metadata (including ID, ownership, and permission), without content.

TXT preserves paragraphs and single line breaks. Markdown uses markdown-it with raw HTML disabled and bounded nesting, converting tokens directly to Tiptap JSON rather than HTML. Headings, emphasis, lists, quotes, code, and rules are supported. Links become plain labels, images become alt text, raw HTML/scripts remain inert text, and tables/custom extensions are not imported as rich structures. No file URLs or image requests are generated.

Existing document limits still apply: converted JSON plus title must fit 256 KiB, with at most 2,000 nodes, nesting depth 20, and 100,000 characters per merged text node. Consequently, some files below the upload-size cap are rejected if their converted document exceeds editor limits. No database migrations or storage services are introduced.

Import API tests exercise the actual route with isolated, tracked document IDs and delete only their own records. Frontend tests mock fetch and cover selection, navigation, busy/duplicate protection, invalid files, API errors, and retry. The existing `npm run test` command includes all import, API, frontend, and database checks.
