"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { titleSchema } from "@/lib/documents/title";
import { requestErrorMessage } from "@/lib/api/client";
import type { DocumentAction } from "./use-workspace";

type Props = {
  action: DocumentAction;
  pending: boolean;
  onConfirm: (title?: string) => Promise<void>;
  onCancel: () => void;
};

export function DocumentActionDialog({ action, pending, onConfirm, onCancel }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const mounted = useRef(false);
  const submitting = useRef(false);
  const id = useId();
  const [title, setTitle] = useState(action.document.title);
  const [error, setError] = useState("");
  const rename = action.kind === "rename";

  useEffect(() => {
    const opener = document.activeElement;
    const element = dialog.current!;
    mounted.current = true;
    element.showModal();
    if (input.current) { input.current.focus(); input.current.select(); }
    else cancel.current?.focus();
    return () => {
      mounted.current = false;
      element.close();
      if (opener instanceof HTMLElement && opener.isConnected && !opener.matches(":disabled")) opener.focus();
      else document.getElementById("workspace-title")?.focus();
    };
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending || submitting.current) return;
    setError("");
    const parsed = rename ? titleSchema.safeParse(title) : null;
    if (parsed && !parsed.success) { setError(parsed.error.issues[0].message); input.current?.focus(); return; }
    submitting.current = true;
    try { await onConfirm(parsed?.success ? parsed.data : undefined); }
    catch (error) { if (mounted.current) setError(requestErrorMessage(error)); }
    finally { submitting.current = false; }
  }

  return (
    <dialog ref={dialog} className="action-dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = dialog.current?.querySelectorAll<HTMLElement>("input:not(:disabled), button:not(:disabled)");
        if (!controls?.length) { event.preventDefault(); return; }
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }}
      onCancel={(event) => { event.preventDefault(); if (!pending && !submitting.current) onCancel(); }}>
      <form onSubmit={(event) => { void submit(event); }}>
        <p className="eyebrow">{rename ? "Document details" : "Delete document"}</p>
        <h2 id={`${id}-title`}>{rename ? "Give it a new name" : "Delete this document?"}</h2>
        <p id={`${id}-description`} className="dialog-description">
          {rename ? "Choose a clear title so it’s easy to find later." : <>“{action.document.title}” and its shares will be permanently deleted. This cannot be undone.</>}
        </p>
        {rename && (
          <div className="title-field">
            <label htmlFor={`${id}-input`}>Document title</label>
            <input ref={input} id={`${id}-input`} value={title} maxLength={200} disabled={pending}
              aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : `${id}-hint`}
              onChange={(event) => { setTitle(event.target.value); setError(""); }} />
            <p id={`${id}-hint`} className="field-hint">Up to 200 characters.</p>
          </div>
        )}
        {error && <p className="inline-error" role="alert" id={`${id}-error`}>{error}</p>}
        <div className="dialog-actions">
          <button ref={cancel} type="button" className="button button-secondary" disabled={pending} onClick={onCancel}>Cancel</button>
          <button type="submit" className={`button ${rename ? "button-primary" : "button-danger"}`} disabled={pending}>
            {pending ? (rename ? "Saving…" : "Deleting…") : (rename ? "Save title" : "Delete document")}
          </button>
        </div>
      </form>
    </dialog>
  );
}
