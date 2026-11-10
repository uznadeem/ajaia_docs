"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { DocumentResponse, DocumentsResponse, DocumentSummary, SessionResponse, SessionUser } from "@/lib/api/contracts";
import { requestApi, RequestError, requestErrorMessage } from "@/lib/api/client";
import { uploadValidationError } from "@/lib/documents/import-options";

type ListState = "loading" | "ready" | "error";
export type DocumentAction = { kind: "rename" | "delete"; document: DocumentSummary };

export function useWorkspace() {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [sessionState, setSessionState] = useState<ListState>("loading");
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [listState, setListState] = useState<ListState>("loading");
  const [message, setMessage] = useState("");
  const [listError, setListError] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [action, setAction] = useState<DocumentAction | null>(null);
  const [attempt, setAttempt] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const locked = useRef(false);

  const expire = useCallback((message: string) => {
    setUser(null);
    setDocuments([]);
    setAction(null);
    setSessionState("ready");
    setMessage(message);
  }, []);

  const loadDocuments = useCallback(async (signal: AbortSignal) => {
    setListState("loading");
    setListError("");
    try {
      const data = await requestApi<DocumentsResponse>("/api/documents", { signal });
      if (signal.aborted) return;
      setDocuments(data.documents);
      setListState("ready");
    } catch (error) {
      if (signal.aborted) return;
      if (error instanceof RequestError && error.status === 401) expire(error.message);
      else { setListState("error"); setListError(requestErrorMessage(error)); }
    }
  }, [expire]);

  useEffect(() => {
    const request = new AbortController();
    controller.current = request;
    async function initialize() {
      try {
        const data = await requestApi<SessionResponse>("/api/demo/session", { signal: request.signal });
        if (request.signal.aborted) return;
        setUser(data.user);
        setSessionState("ready");
        await loadDocuments(request.signal);
      } catch (error) {
        if (request.signal.aborted) return;
        if (error instanceof RequestError && error.status === 401) setSessionState("ready");
        else { setSessionState("error"); setMessage(requestErrorMessage(error)); }
      }
    }
    void initialize();
    return () => { controller.current?.abort(); };
  }, [attempt, loadDocuments]);

  function begin(name: string) {
    if (locked.current) return null;
    locked.current = true;
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setPending(name);
    setMessage("");
    setUploadError("");
    return request;
  }
  function finish(signal: AbortSignal) {
    if (signal.aborted) return;
    locked.current = false;
    setPending(null);
  }

  async function changeUser(email: string | null) {
    const request = begin(email ? "switch" : "logout");
    if (!request) return;
    // Hide the previous identity's data before making any session change.
    setDocuments([]);
    setUser(null);
    setAction(null);
    try {
      if (email) {
        const data = await requestApi<SessionResponse>("/api/demo/session", { method: "POST", body: JSON.stringify({ email }), signal: request.signal });
        if (request.signal.aborted) return;
        setUser(data.user);
        setSessionState("ready");
        await loadDocuments(request.signal);
      } else {
        await requestApi<void>("/api/demo/session", { method: "DELETE", signal: request.signal });
        if (request.signal.aborted) return;
        setSessionState("ready");
        setMessage("You have signed out of the demo workspace.");
      }
    } catch (error) {
      if (request.signal.aborted) return;
      setSessionState("error");
      setMessage(requestErrorMessage(error));
    } finally { finish(request.signal); }
  }

  async function createDocument() {
    const request = begin("create");
    if (!request) return;
    try {
      const { document } = await requestApi<DocumentResponse>("/api/documents", { method: "POST", body: "{}", signal: request.signal });
      if (request.signal.aborted) return;
      // Keep only metadata in dashboard state, even though the create API includes content.
      const { content: _content, ...summary } = document;
      void _content;
      setDocuments((current) => [summary, ...current]);
      router.push(`/documents/${document.id}`);
    } catch (error) {
      if (request.signal.aborted) return;
      if (error instanceof RequestError && error.status === 401) expire(error.message);
      else setMessage(requestErrorMessage(error));
    } finally { finish(request.signal); }
  }

  async function importDocument(file: File) {
    if (locked.current) return;
    const problem = uploadValidationError(file);
    if (problem) { setUploadError(problem); return; }
    const request = begin("import");
    if (!request) return;
    try {
      const form = new FormData();
      form.append("file", file);
      const { document } = await requestApi<{ document: DocumentSummary }>("/api/documents/import", { method: "POST", body: form, signal: request.signal });
      if (request.signal.aborted) return;
      setDocuments((current) => [document, ...current]);
      router.push(`/documents/${document.id}`);
    } catch (error) {
      if (request.signal.aborted) return;
      if (error instanceof RequestError && error.status === 401) expire(error.message);
      else setUploadError(requestErrorMessage(error));
    } finally { finish(request.signal); }
  }

  async function saveAction(title?: string) {
    if (!action) return;
    const request = begin(action.kind);
    if (!request) return;
    try {
      await requestApi<DocumentResponse | void>(`/api/documents/${action.document.id}`, {
        method: action.kind === "rename" ? "PATCH" : "DELETE",
        ...(action.kind === "rename" ? { body: JSON.stringify({ title }) } : {}),
        signal: request.signal,
      });
      if (request.signal.aborted) return;
      setAction(null);
      setMessage(action.kind === "rename" ? "Document renamed." : "Document deleted.");
      await loadDocuments(request.signal);
    } catch (error) {
      if (request.signal.aborted) return;
      if (error instanceof RequestError && error.status === 401) expire(error.message);
      else {
        if (error instanceof RequestError && (error.status === 403 || error.status === 404)) {
          await loadDocuments(request.signal);
        }
        throw error;
      }
    } finally { finish(request.signal); }
  }

  async function retryDocuments() {
    const request = begin("refresh");
    if (!request) return;
    try { await loadDocuments(request.signal); }
    finally { finish(request.signal); }
  }

  return {
    user, sessionState, documents, listState, message, listError, uploadError, pending, action,
    changeUser, createDocument, importDocument, saveAction, retryDocuments, setAction,
    retrySession: () => { setSessionState("loading"); setMessage(""); setAttempt((value) => value + 1); },
  };
}
