# AI Development Workflow

## Responsibilities

ChatGPT supported planning, architecture discussions, implementation prompts,
and patch-review feedback throughout the phased assessment workflow.
Codex implemented repository changes, added tests, investigated failures,
and made focused fixes against the developer's requirements.
The developer supplied requirements, made scope decisions, manually tested the UI,
reviewed changes, approved work, and managed incremental commits.
Codex was instructed not to stage, commit, or push changes.

## Incremental process

Work proceeded in phases: foundation, persistence, APIs, dashboard, editor,
autosave, file import, sharing, regression fixes, and deployment readiness.
Each phase supplied explicit requirements, exclusions, and verification commands.
Follow-up review feedback constrained patches to the issue being addressed.
The developer supplied successive commit references as completed work progressed.
Repository code and existing contracts were inspected before implementation.
Installed Next.js documentation guided version-specific decisions.

## Review and verification

AI-generated changes were checked through patch review, automated verification,
and developer-led manual browser testing rather than accepted on generation alone.
Frontend tests exercise real Tiptap behavior where practical with backend requests mocked.
API/database tests exercise real persistence using isolated, explicitly cleaned fixtures.
Lint, TypeScript checking, production builds, and diff checks supplemented tests.
Local browser regression checks supplemented handler/component tests.
Checks were reported with their actual results; blocked runs were distinguished
from successful retries. Production deployment smoke testing has not been verified.

## Examples of feedback-driven fixes

Manual testing found sharing controls unavailable to a document owner and old
content appearing on the first reopen after an acknowledged autosave.
Investigation traced preserved editor/access state to cached route lifecycle behavior.
The focused fix reloads/reset editor state when the route becomes active again,
while retaining backend ownership checks and the existing save behavior.
Regression tests cover first reopen after autosave and owner/editor/viewer behavior,
including owner recipient management. Local browser checks exercised these paths.

## Boundaries

AI assisted implementation and review; the developer retained responsibility
for requirements, acceptance, commits, deployment configuration, and submission.
Credentials stayed in ignored local files and were excluded from documentation.
This note records the workflow without claiming independent production certification.
