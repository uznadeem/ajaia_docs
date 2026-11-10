"use client";

import { DocumentIcon } from "@/components/ui/document-icon";
import { DemoUserSelector } from "./demo-user-selector";
import { DocumentList } from "./document-list";
import { DocumentActionDialog } from "./document-action-dialog";
import { useWorkspace } from "./use-workspace";

export function Dashboard() {
  const workspace = useWorkspace();
  const busy = Boolean(workspace.pending);
  return (
    <main id="main-content" className="workspace dashboard" tabIndex={-1}>
      <div className="workspace-session-bar">
        <p className="demo-label"><span aria-hidden="true" />Demo workspace</p>
        <DemoUserSelector user={workspace.user} disabled={busy || workspace.sessionState !== "ready"} onSelect={workspace.changeUser} />
      </div>
      <div className="dashboard-heading">
        <div className="workspace-heading">
          <p className="eyebrow">Your workspace</p>
          <h1 id="workspace-title" tabIndex={-1}>Documents</h1>
          <p>Your ideas, drafts, and shared work. All in one place.</p>
        </div>
        {workspace.user && <button id="new-document" className="button button-primary" disabled={busy || workspace.listState === "loading"}
          onClick={() => { void workspace.createDocument(); }}>
          <span aria-hidden="true">＋</span> {workspace.pending === "create" ? "Creating…" : "New Document"}
        </button>}
      </div>
      {workspace.message && workspace.sessionState !== "error" && <p className="workspace-message" role="status">{workspace.message}</p>}

      {workspace.sessionState === "loading" || workspace.pending === "switch" || workspace.pending === "logout" ? (
        <div className="workspace-state" role="status"><span className="loading-dot" />{workspace.pending === "logout" ? "Signing out…" : "Loading your workspace…"}</div>
      ) : workspace.sessionState === "error" ? (
        <section className="workspace-state" role="alert"><h2>Workspace unavailable</h2><p>{workspace.message}</p>
          <button className="button button-secondary" onClick={workspace.retrySession}>Try again</button></section>
      ) : !workspace.user ? (
        <section className="document-panel welcome-state" aria-labelledby="welcome-title">
          <div className="empty-state-icon"><DocumentIcon /></div>
          <h2 id="welcome-title">A workspace for your next idea</h2>
          <p>Choose Alice or Bob from the demo user menu to see their documents.</p>
          <span className="welcome-note">Two demo users. A place to try things out.</span>
        </section>
      ) : workspace.listState === "loading" ? (
        <div className="workspace-state" role="status"><span className="loading-dot" />Loading documents…</div>
      ) : workspace.listState === "error" ? (
        <section className="workspace-state" role="alert"><h2>Couldn’t load your documents</h2><p>{workspace.listError}</p>
          <button className="button button-secondary" disabled={busy} onClick={() => { void workspace.retryDocuments(); }}>Retry documents</button></section>
      ) : (
        <div className="workspace-lists" aria-busy={busy}>
          <DocumentList heading="Owned documents" id="owned-heading" documents={workspace.documents.filter((document) => document.relationship === "owned")}
            disabled={busy} onAction={workspace.setAction} />
          <DocumentList heading="Shared with me" id="shared-heading" shared documents={workspace.documents.filter((document) => document.relationship === "shared")}
            disabled={busy} onAction={workspace.setAction} />
        </div>
      )}
      <p className="workspace-note">Room to think. Space to write.</p>
      {workspace.action && <DocumentActionDialog key={`${workspace.action.kind}-${workspace.action.document.id}`} action={workspace.action}
        pending={busy} onConfirm={workspace.saveAction} onCancel={() => workspace.setAction(null)} />}
    </main>
  );
}
