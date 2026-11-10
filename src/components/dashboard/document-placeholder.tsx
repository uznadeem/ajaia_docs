"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { DocumentResponse, DocumentSummary } from "@/lib/api/contracts";
import { requestApi, RequestError, requestErrorMessage } from "@/lib/api/client";
import { DocumentIcon } from "@/components/ui/document-icon";

export function DocumentPlaceholder({ id }: { id: string }) {
  const [document, setDocument] = useState<DocumentSummary | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [retryable, setRetryable] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const result = await requestApi<DocumentResponse>(`/api/documents/${encodeURIComponent(id)}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        const { content: _content, ...summary } = result.document;
        void _content;
        setDocument(summary);
      } catch (error) {
        if (controller.signal.aborted) return;
        setError(requestErrorMessage(error));
        setRetryable(!(error instanceof RequestError) || error.status >= 500);
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    return () => controller.abort();
  }, [id, attempt]);

  return (
    <main id="main-content" className="workspace" tabIndex={-1}>
      <Link href="/" className="back-link">← Back to workspace</Link>
      {loading ? <div className="workspace-state" role="status">Loading document…</div> : error ? (
        <section className="workspace-state" role="alert"><h1>Document unavailable</h1><p>{error}</p>
          {retryable && <button className="button button-secondary" onClick={() => { setLoading(true); setError(""); setAttempt((value) => value + 1); }}>Try again</button>}
        </section>
      ) : document && (
        <>
          <div className="workspace-heading document-page-heading"><p className="eyebrow">Document workspace</p><h1>{document.title}</h1>
            <p>Owned by {document.owner.name} · {document.permission === "OWNER" ? "Owner" : document.permission === "EDITOR" ? "Can edit" : "View only"}</p></div>
          <section className="document-panel welcome-state" aria-labelledby="editor-placeholder-title">
            <div className="empty-state-icon"><DocumentIcon /></div>
            <h2 id="editor-placeholder-title">Your document is ready</h2>
            <p>The editor is coming in Phase 5. {document.permission === "VIEWER" ? "You have view-only access to this document." : "You can rename or manage this document from the workspace."}</p>
            <Link href="/" className="button button-secondary">Return to workspace</Link>
          </section>
        </>
      )}
    </main>
  );
}
