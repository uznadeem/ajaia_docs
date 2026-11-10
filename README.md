# Ajaia Docs

A lightweight document workspace built for a timed Senior AI Engineer assessment.
Users can create, edit, import, and share documents through seeded demo accounts.

## Core features

- Dashboard with owned documents and Shared with Me.
- Document creation, renaming, and owner-only deletion.
- Tiptap editor with headings, emphasis, underline, and lists.
- Debounced autosave, manual Save, and save-status feedback.
- UTF-8 TXT/Markdown import into editable documents.
- Owner-managed viewer/editor access and revocation.
- Responsive layouts, accessible controls, and error states.

## Tech stack

Next.js 16 App Router, React 19, strict TypeScript, Tailwind CSS,
Prisma 7 with the PostgreSQL adapter, Neon PostgreSQL, Tiptap 3,
Zod, and markdown-it. Tests use Vitest, React Testing Library,
and Node's test runner.

## Prerequisites

- Node.js 24.x recommended; see `package.json` for supported versions.
- npm and access to a PostgreSQL database (the assessment uses Neon).
- Pooled and direct connection strings for the same database.

## Environment variables

- `DATABASE_URL`
- `DATABASE_URL_UNPOOLED`
- `DEMO_SESSION_SECRET`
- `APP_ORIGIN`

## Installation and local setup

```sh
npm ci
cp .env.example .env.local
```

Populate `.env.local` privately using the comments in `.env.example`.
Use the pooled connection for queries and the direct connection for migrations.
Generate a private signing secret with `openssl rand -hex 32`.
Set the allowed origin to the exact browser origin, including any local port.
Never commit `.env.local`, `.neon`, or credentials; never use `NEXT_PUBLIC_` for secrets.
Prisma commands load `.env.local`; process environment variables take precedence.

## Database setup

```sh
npm run db:validate
npm run db:generate
npm run db:deploy
npm run db:seed
npm run db:status
```

Seeding is idempotent and creates Alice/Bob without sample documents.
Installation, type checking, and builds also generate Prisma Client.
Use `npm run db:migrate -- --name change_name` only for development schema changes.
Development migrations require shadow-database permissions or configuration.
Never reset the shared assessment database to resolve migration drift.

## Development and verification

```sh
npm run dev
npm run lint
npm run typecheck
npm run test:frontend
npm run test:api
npm run test:db
npm run test
npm run build
npm run start
```

Open http://localhost:3000 during local development.
Frontend tests mock API requests; API/database suites require the configured database
and seeded users. Integration tests clean up only their own fixtures; interrupted
runs can leave fixtures behind. `npm run test` runs all three suites.

## Production deployment

Use Vercel's Next.js preset and the existing `npm run build` command.
Configure the four environment variables above in the deployment environment;
local environment files do not configure Vercel. Use the exact production HTTPS
origin and a private signing secret. Never deploy this demo with private data.
Apply migrations with `npm run db:deploy` and seed with `npm run db:seed` before use.
Deploy with `npx vercel --prod` after linking and configuring the Vercel project.
Production cookies are Secure and HTTP-only; server routes use Node.js.
Verify sign-in, editing, import, and sharing on the deployed URL after deployment.

## Demo users

Select **Alice Demo** or **Bob Demo** in the dashboard; no password is required.
Create a document, open **Share**, and grant the other demo user view/edit access.
Return to the dashboard and switch users to inspect Shared with Me.
Owners manage sharing/deletion; editors edit; viewers read only.
These selectable identities are assessment sessions, not production authentication.

## Known limitations

No real-time collaboration, conflict resolution, offline drafts, or version history.
Concurrent clients use last-write-wins; leaving with unsaved edits can discard them.
Permission changes become visible on subsequent requests, without live updates.
Imports accept one UTF-8 `.txt` or `.md` file up to 1 MB; converted JSON must also
fit the 256 KiB request limit and supported rich-text structure. Original files
are not stored; links/images are flattened and raw HTML remains inert text.
No PDF/DOCX, attachments, public links, email invitations, or production identity system.
Lists are unpaginated; demo sessions lack login throttling and centralized revocation.
