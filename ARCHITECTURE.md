# Architecture

## Application boundary

Next.js 16 App Router serves the dashboard, document pages, and HTTP API routes.
Layouts and page shells use Server Components; interactive dashboard, editor,
and sharing controls use focused Client Components.
Browser requests use relative API URLs and same-origin cookies.
Server-only modules keep database access and signing secrets out of browser code.

## Persistence

Prisma 7 accesses Neon PostgreSQL through the PostgreSQL driver adapter.
Application queries use the pooled connection; migrations use the direct connection.
A development singleton prevents duplicate clients during hot reloads.
Checked-in migrations define the schema; the idempotent seed supplies demo users.

- A User owns many Documents and receives many DocumentShares.
- Each Document has one required owner and zero or more shares.
- Each DocumentShare connects one document and recipient with VIEWER or EDITOR access.
- Unique email and document/recipient constraints prevent duplicate identities/shares.
- Foreign keys cascade dependent records; indexes support ownership/sharing queries.

## Editing and autosave

Document content is stored as Tiptap JSON in PostgreSQL JSONB, rather than HTML.
Zod and editor-schema validation restrict the supported structure and payload size.
Tiptap provides formatting, keyboard behavior, and read-only rendering.
Title/content edits debounce for approximately 800 ms and reuse the PATCH API.
A shared save path prevents overlapping requests and supports manual Save.
Responses acknowledge the submitted snapshot without replacing newer local edits.
Failures preserve in-memory drafts; retry follows another edit or manual Save.
Route reactivation reloads document data and resets the editor/access state.

## Import

The authenticated import endpoint bounds multipart input and accepts one UTF-8
TXT/Markdown file. markdown-it parses Markdown with raw HTML disabled.
Conversion produces validated Tiptap JSON and creates an owned Document.
The original file is not retained; no object storage or extra tables are needed.

## Identity and authorization

Alice/Bob selection creates an eight-hour HMAC-signed, HTTP-only demo cookie.
Production cookies are Secure; mutation requests require a matching browser origin.
API queries enforce ownership/shares independently of visible UI controls.
Owners manage access/delete; owners/editors save; viewers can only read.
Inaccessible documents return 404; visible but forbidden operations return 403.

## Assessment trade-offs

One application and relational database keep implementation and deployment small.
Existing models support CRUD, import, and sharing without additional infrastructure.
Explicit APIs and shared validation make authorization and persistence testable.
Demo identities intentionally avoid production authentication complexity.
Concurrent clients are last-write-wins; there is no live collaboration or history.
Drafts are memory-only, lists are unpaginated, and permission updates are request-driven.
These limits prioritize a working, verifiable assessment over distributed-system scope.
