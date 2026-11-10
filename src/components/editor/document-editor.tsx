"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import Link from "next/link";
import type { JSONContent } from "@tiptap/react";
import type { DocumentResponse } from "@/lib/api/contracts";
import { requestApi, RequestError } from "@/lib/api/client";
import { prepareContent } from "./config";
import { EditorSession } from "./editor-session";

type LoadState = { kind: "loading" } | { kind: "ready"; document: DocumentResponse["document"]; content: JSONContent }
  | { kind: "error"; message: string; retryable: boolean; missing: boolean };

function DocumentLoader({ id }: { id: string }) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  // Next.js Activity preserves this route's state while hidden. Discard the
  // loaded editor before restoration so permissions/content come from the new GET.
  useLayoutEffect(() => () => { setState({ kind: "loading" }); }, []);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const { document } = await requestApi<DocumentResponse>(`/api/documents/${encodeURIComponent(id)}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        const content = prepareContent(document.content);
        setState({ kind: "ready", document, content });
      } catch (error) {
        if (controller.signal.aborted) return;
        setState({ kind: "error", message: error instanceof RequestError ? error.message : "This document could not be loaded. Try again or return to the workspace.",
          retryable: !(error instanceof RequestError) || error.status >= 500,
          missing: error instanceof RequestError && error.status === 404 });
      }
    }
    void load();
    return () => controller.abort();
  }, [id, attempt]);

  if (state.kind === "ready") return <EditorSession document={state.document} initialContent={state.content} />;
  return (
    <main id="main-content" className="workspace" tabIndex={-1}>
      <Link href="/" className="back-link">← Back to dashboard</Link>
      {state.kind === "loading" ? <div className="workspace-state" role="status">Loading document…</div> : (
        <section className="workspace-state" role="alert"><h1>{state.missing ? "Document not found" : "Document unavailable"}</h1><p>{state.message}</p>
          {state.retryable && <button className="button button-secondary" onClick={() => { setState({ kind: "loading" }); setAttempt((value) => value + 1); }}>Try again</button>}
        </section>
      )}
    </main>
  );
}

// The key also protects callers that change IDs without remounting the route.
export function DocumentEditor({ id }: { id: string }) {
  return <DocumentLoader key={id} id={id} />;
}
