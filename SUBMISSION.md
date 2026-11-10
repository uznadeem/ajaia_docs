# Ajaia Docs — Assessment Submission

## Submission links

- Google Drive folder: [GOOGLE_DRIVE_FOLDER_URL]
- GitHub repository: [GITHUB_REPOSITORY_URL]
- Live Vercel application: [LIVE_VERCEL_URL]
- Walkthrough video: [WALKTHROUGH_VIDEO_URL]

## Completed functionality

Ajaia Docs provides a responsive document dashboard, owned and shared document
lists, document creation/renaming/deletion, and a Tiptap rich-text editor.
The editor supports headings, emphasis, underline, and lists, with debounced
autosave, manual Save, status feedback, and unsaved-change warnings.
Users can import UTF-8 TXT/Markdown files and manage viewer/editor sharing.
Owners control sharing and deletion; authorization is enforced by the API.
Alice and Bob are selectable seeded demo users, with signed session cookies.

## Stack and architecture

Next.js 16 App Router, React 19, strict TypeScript, Tailwind CSS, Prisma 7,
Neon PostgreSQL, Tiptap 3, Zod, and markdown-it form a single application.
Server-only database/session modules protect credentials. PostgreSQL stores
validated Tiptap JSON and relational ownership/shares. Existing APIs support
manual and debounced saving without extra infrastructure or schema changes.

## Verification

Automated coverage includes frontend interactions, permissions, autosave,
import, API authorization, database constraints, and isolated persistence tests.
Regression tests address stale content on first reopen after autosave and owner
sharing controls. Developer manual UI testing informed these fixes.
Final deployment-readiness checks passed lint, TypeScript, production build,
migration status, seeded-user checks, and production-mode HTTPS session checks.
Live Vercel smoke testing has not been verified.

## AI workflow

ChatGPT supported planning, prompts, architecture, and patch feedback.
Codex implemented and tested changes; the developer reviewed patches, made
decisions, tested manually, and managed incremental commits.

## Known limitations

Demo identities are not production authentication. There is no real-time
collaboration, offline persistence, or version history; concurrent edits are
last-write-wins. Imports are limited to supported TXT/Markdown content and size
limits. Permission updates are request-driven, and document lists are unpaginated.
