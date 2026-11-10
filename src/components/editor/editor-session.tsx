"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useEditor, type JSONContent } from "@tiptap/react";
import type { DocumentResponse } from "@/lib/api/contracts";
import { requestApi, RequestError, requestErrorMessage } from "@/lib/api/client";
import { MAX_BODY_BYTES } from "@/lib/api/limits";
import { contentSchema } from "@/lib/documents/validation";
import { titleSchema } from "@/lib/documents/title";
import { editorExtensions } from "./config";
import { EditorToolbar } from "./editor-toolbar";
import { useUnsavedWarning } from "./use-unsaved-warning";
import { WritingCanvas } from "./writing-canvas";
import { ShareDialog } from "@/components/sharing/share-dialog";

type Props = { document: DocumentResponse["document"]; initialContent: JSONContent };
type Blocked = "permission" | "session" | "missing" | null;

export function EditorSession({ document, initialContent }: Props) {
  const [title, setTitle] = useState(document.title);
  const titleRef = useRef(document.title);
  const saved = useRef({ title: document.title, content: JSON.stringify(initialContent) });
  const [permission, setPermission] = useState(document.permission);
  const [blocked, setBlocked] = useState<Blocked>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [titleError, setTitleError] = useState("");
  const [editVersion, setEditVersion] = useState(0);
  const [sharing, setSharing] = useState(false);
  const locked = useRef(false);
  const request = useRef<AbortController | null>(null);
  const canEdit = permission !== "VIEWER" && !blocked;
  const hidden = blocked === "session" || blocked === "missing";
  useUnsavedWarning(dirty || saving);

  const editor = useEditor({
    extensions: editorExtensions,
    content: initialContent,
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    editable: canEdit,
    editorProps: { attributes: {
      class: "document-content", role: "textbox", "aria-label": "Document content",
      "aria-multiline": "true", "aria-readonly": String(!canEdit), spellcheck: "true",
    } },
    onUpdate: ({ editor }) => {
      if (!canEdit) return;
      setDirty(titleRef.current !== saved.current.title || JSON.stringify(editor.getJSON()) !== saved.current.content);
      setError("");
      setEditVersion((version) => version + 1);
    },
  });

  useEffect(() => {
    editor?.setEditable(canEdit, false);
    editor?.view.dom.setAttribute("aria-readonly", String(!canEdit));
  }, [editor, canEdit]);
  useEffect(() => () => { request.current?.abort(); }, []);

  const stopEditing = useCallback((error: unknown) => {
    if (error instanceof RequestError) {
      if (error.status === 401) setBlocked("session");
      if (error.status === 404) setBlocked("missing");
      if (error.status === 403) { setBlocked("permission"); setPermission("VIEWER"); }
    }
    setError(requestErrorMessage(error));
  }, []);

  const sharingAccessError = useCallback((error: unknown) => {
    setSharing(false);
    stopEditing(error);
  }, [stopEditing]);

  const save = useCallback(async () => {
    if (!editor || !canEdit || locked.current) return;
    const parsedTitle = titleSchema.safeParse(titleRef.current);
    if (!parsedTitle.success) { setTitleError(parsedTitle.error.issues[0].message); return; }
    const parsedContent = contentSchema.safeParse(editor.getJSON());
    if (!parsedContent.success) { setError("This formatting or document size is not supported. Your changes have not been saved."); return; }

    const snapshot = { title: parsedTitle.data, content: JSON.stringify(parsedContent.data) };
    const rawTitle = titleRef.current;
    const payload = {
      ...(snapshot.title !== saved.current.title ? { title: snapshot.title } : {}),
      ...(snapshot.content !== saved.current.content ? { content: parsedContent.data } : {}),
    };
    if (Object.keys(payload).length === 0) {
      titleRef.current = snapshot.title;
      setTitle(snapshot.title);
      setTitleError("");
      setError("");
      setDirty(false);
      return;
    }
    const body = JSON.stringify(payload);
    if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) {
      setError("This document is too large to save. The request must be under 256 KiB. Your changes are still here.");
      return;
    }
    locked.current = true;
    setSaving(true);
    setError("");
    setTitleError("");
    const controller = new AbortController();
    request.current = controller;
    try {
      const result = await requestApi<DocumentResponse>(`/api/documents/${document.id}`, { method: "PATCH", body, signal: controller.signal });
      if (controller.signal.aborted) return;
      // Acknowledge exactly the submitted snapshot. Never replace newer local text.
      saved.current = snapshot;
      if (titleRef.current === rawTitle) { titleRef.current = snapshot.title; setTitle(snapshot.title); }
      setPermission(result.document.permission);
      setDirty(titleRef.current !== snapshot.title || JSON.stringify(editor.getJSON()) !== snapshot.content);
    } catch (error) {
      if (!controller.signal.aborted) stopEditing(error);
    } finally {
      if (!controller.signal.aborted) { locked.current = false; setSaving(false); }
    }
  }, [editor, canEdit, document.id, stopEditing]);

  useEffect(() => {
    if (!editor || !canEdit || !dirty || saving || checking || error || titleError) return;
    const timer = window.setTimeout(() => { void save(); }, 800);
    return () => window.clearTimeout(timer);
  }, [editor, canEdit, dirty, saving, checking, error, titleError, editVersion, save]);

  async function checkAccess() {
    if (locked.current) return;
    locked.current = true;
    setChecking(true);
    const controller = new AbortController();
    request.current = controller;
    try {
      const result = await requestApi<DocumentResponse>(`/api/documents/${document.id}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      // Revalidate access without discarding the unsaved local draft.
      setPermission(result.document.permission);
      setBlocked(null);
      setError(result.document.permission === "VIEWER" && dirty ? "View-only access. Your local changes remain unsaved." : "");
    } catch (error) { if (!controller.signal.aborted) stopEditing(error); }
    finally { if (!controller.signal.aborted) { locked.current = false; setChecking(false); } }
  }

  return (
    <main id="main-content" className="workspace editor-workspace" tabIndex={-1}>
      <h1 className="sr-only">Document editor</h1>
      <Link href="/" className="back-link">← Back to dashboard</Link>
      <div className="editor-heading">
        <div className="editor-document-details">
          <label htmlFor="document-title" className="eyebrow">Document title</label>
          {!hidden && <input id="document-title" className="editor-title" aria-label="Document title" value={title} maxLength={200}
            disabled={!canEdit} aria-invalid={Boolean(titleError)} aria-describedby={titleError ? "title-error" : undefined}
            onChange={(event) => {
              if (!canEdit) return;
              const value = event.target.value;
              titleRef.current = value;
              setTitle(value);
              setTitleError("");
              setError("");
              setDirty(value !== saved.current.title || (editor ? JSON.stringify(editor.getJSON()) !== saved.current.content : false));
              setEditVersion((version) => version + 1);
            }} />}
          {!hidden && <p className="editor-owner">Owned by {document.owner.name}</p>}
        </div>
        <div className="editor-save-controls">
          {permission === "OWNER" && !blocked && <button type="button" className="button button-secondary" disabled={saving || checking} onClick={() => setSharing(true)}>Share</button>}
          <span className={`permission-badge permission-${permission.toLowerCase()}`}>{hidden ? "Access unavailable" : permission === "OWNER" ? "Owner" : permission === "EDITOR" ? "Can edit" : "View only"}</span>
          <button className="button button-primary" disabled={!editor || !canEdit || !dirty || saving || checking} onClick={() => { void save(); }}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
      {titleError && <p id="title-error" className="inline-error" role="alert">{titleError}</p>}
      <div className="editor-status-row">
        <p role="status" aria-live="polite">{saving ? "Saving changes…" : error || titleError ? "Unsaved changes — Error saving" : dirty ? "Unsaved changes" : "All changes saved"}</p>
        {!hidden && permission === "VIEWER" && <span>View-only document</span>}
      </div>
      {error && <div className="editor-error" role="alert"><p>{error}</p>
        {blocked && <><p>Your unsaved changes are kept in this tab. Editing is paused until access is restored.</p>
          <button className="button button-secondary" disabled={checking} onClick={() => { void checkAccess(); }}>{checking ? "Checking access…" : "Check access again"}</button></>}
      </div>}
      {!hidden && <section className="editor-surface" aria-label="Writing area">
        {editor ? <><EditorToolbar editor={editor} disabled={!canEdit} />
          <WritingCanvas editor={editor} editable={canEdit} /></> : <p className="editor-initializing" role="status">Preparing your document…</p>}
      </section>}
      {sharing && permission === "OWNER" && !blocked && <ShareDialog documentId={document.id} ownerName={document.owner.name} onClose={() => setSharing(false)} onAccessError={sharingAccessError} />}
    </main>
  );
}
