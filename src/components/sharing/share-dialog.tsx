"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { SharingResponse } from "@/lib/api/contracts";
import { requestApi, RequestError, requestErrorMessage } from "@/lib/api/client";

type Permission = SharingResponse["recipients"][number]["permission"];
type Props = { documentId: string; ownerName: string; onClose: () => void; onAccessError: (error: unknown) => void };

export function ShareDialog({ documentId, ownerName, onClose, onAccessError }: Props) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const request = useRef<AbortController | null>(null);
  const locked = useRef(false);
  const [data, setData] = useState<SharingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [permission, setPermission] = useState<Permission>("VIEWER");
  const [selected, setSelected] = useState("");
  const endpoint = `/api/documents/${documentId}/shares`;

  const handleError = useCallback((error: unknown) => {
    if (error instanceof RequestError && [401, 403, 404].includes(error.status)) onAccessError(error);
    else setError(requestErrorMessage(error));
  }, [onAccessError]);

  const load = useCallback(async (signal: AbortSignal) => {
    const result = await requestApi<SharingResponse>(endpoint, { signal });
    if (signal.aborted) return;
    setData(result);
    setSelected(result.availableRecipients[0]?.id ?? "");
  }, [endpoint]);

  useEffect(() => {
    const opener = document.activeElement;
    const element = dialog.current!;
    element.showModal();
    close.current?.focus();
    const controller = new AbortController();
    request.current = controller;
    async function initialize() {
      try { await load(controller.signal); }
      catch (error) { if (!controller.signal.aborted) handleError(error); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void initialize();
    return () => {
      request.current?.abort();
      element.close();
      if (opener instanceof HTMLElement && opener.isConnected && !opener.matches(":disabled")) opener.focus();
      else document.querySelector<HTMLElement>(".back-link")?.focus();
    };
  }, [load, handleError]);

  async function mutate(method: "POST" | "PATCH" | "DELETE", userId: string, value?: Permission) {
    if (locked.current || !userId) return;
    locked.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    const controller = new AbortController();
    request.current = controller;
    try {
      await requestApi(method === "DELETE" ? `${endpoint}/${userId}` : endpoint, {
        method, signal: controller.signal,
        ...(method === "DELETE" ? {} : { body: JSON.stringify({ userId, permission: value }) }),
      });
      await load(controller.signal);
      if (!controller.signal.aborted) setMessage(method === "DELETE" ? "Access revoked." : method === "PATCH" ? "Permission updated." : "Document shared.");
    } catch (error) {
      if (!controller.signal.aborted) {
        if (error instanceof RequestError && error.status === 409) await load(controller.signal).catch(() => {});
        handleError(error);
      }
    } finally { if (!controller.signal.aborted) { locked.current = false; setBusy(false); } }
  }

  async function retry() {
    if (locked.current) return;
    locked.current = true;
    setLoading(true);
    setError("");
    const controller = new AbortController();
    request.current = controller;
    try { await load(controller.signal); }
    catch (error) { if (!controller.signal.aborted) handleError(error); }
    finally { if (!controller.signal.aborted) { locked.current = false; setLoading(false); } }
  }

  return (
    <dialog ref={dialog} className="action-dialog share-dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-owner`}
      onCancel={(event) => { event.preventDefault(); if (!busy && !locked.current) onClose(); }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), select:not(:disabled)");
        const first = controls[0], last = controls[controls.length - 1];
        if (!first) { event.preventDefault(); return; }
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }}>
      <p className="eyebrow">Document access</p>
      <h2 id={`${id}-title`}>Share document</h2>
      <p className="dialog-description" id={`${id}-owner`}>Owner: {data?.owner.name ?? ownerName}</p>
      {loading ? <p className="dialog-description" role="status">Loading sharing…</p> : data && <>
        {data.availableRecipients.length > 0 ? <form className="share-form" onSubmit={(event) => { event.preventDefault(); void mutate("POST", selected, permission); }}>
          <label htmlFor={`${id}-recipient`}>Recipient</label>
          <select id={`${id}-recipient`} value={selected} disabled={busy} onChange={(event) => setSelected(event.target.value)}>
            {data.availableRecipients.map((user) => <option value={user.id} key={user.id}>{user.name} ({user.email})</option>)}
          </select>
          <label htmlFor={`${id}-permission`}>Permission</label>
          <select id={`${id}-permission`} value={permission} disabled={busy} onChange={(event) => setPermission(event.target.value as Permission)}>
            <option value="VIEWER">Can view</option><option value="EDITOR">Can edit</option>
          </select>
          <button type="submit" className="button button-primary" disabled={busy || !selected}>{busy ? "Updating…" : "Share"}</button>
        </form> : <p className="dialog-description">No additional demo users to share with.</p>}
        <section className="share-recipients" aria-labelledby={`${id}-recipients`}>
          <h3 id={`${id}-recipients`}>People with access</h3>
          {data.recipients.length === 0 ? <p className="dialog-description">No recipients yet.</p> : <ul>
            {data.recipients.map((share) => <li key={share.userId} className="share-recipient">
              <div><p>{share.user.name}</p><span>{share.user.email}</span></div>
              <select aria-label={`Permission for ${share.user.name}`} value={share.permission} disabled={busy}
                onChange={(event) => { void mutate("PATCH", share.userId, event.target.value as Permission); }}>
                <option value="VIEWER">Can view</option><option value="EDITOR">Can edit</option>
              </select>
              <button type="button" className="button button-quiet danger-text" aria-label={`Revoke access for ${share.user.name}`} disabled={busy}
                onClick={() => { void mutate("DELETE", share.userId); }}>Revoke</button>
            </li>)}
          </ul>}
        </section>
      </>}
      {message && <p className="dialog-description" role="status">{message}</p>}
      {error && <p className="inline-error" role="alert">{error}</p>}
      {!loading && !data && <button type="button" className="button button-secondary" onClick={() => { void retry(); }}>Retry sharing</button>}
      <div className="dialog-actions"><button ref={close} type="button" className="button button-secondary" disabled={busy} onClick={onClose}>Close</button></div>
    </dialog>
  );
}
