import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Dashboard } from "@/components/dashboard/dashboard";
import { DocumentPlaceholder } from "@/components/dashboard/document-placeholder";
import type { DocumentSummary, SessionUser } from "@/lib/api/contracts";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const alice: SessionUser = { id: "alice", name: "Alice Demo", email: "alice@example.com" };
const bob: SessionUser = { id: "bob", name: "Bob Demo", email: "bob@example.com" };
function summary(id: string, title: string, permission: DocumentSummary["permission"] = "OWNER"): DocumentSummary {
  return { id, title, permission, relationship: permission === "OWNER" ? "owned" : "shared", ownerId: permission === "OWNER" ? alice.id : bob.id,
    owner: permission === "OWNER" ? { id: alice.id, name: alice.name } : { id: bob.id, name: bob.name },
    createdAt: "2026-11-01T12:00:00.000Z", updatedAt: "2026-11-10T12:00:00.000Z" };
}
const owned = summary("cowned", "Project notes");
const editable = summary("ceditor", "Team plan", "EDITOR");
const viewOnly = summary("cviewer", "Reference guide", "VIEWER");
const bobDraft = { ...summary("cbob", "Bob’s draft"), owner: { id: bob.id, name: bob.name }, ownerId: bob.id };
const created = summary("cnew", "Untitled document");
function json(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status }); }
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

let activeUser: SessionUser | null;
let documents: Record<string, DocumentSummary[]>;
let override: ((path: string, options: RequestInit) => Response | Promise<Response> | undefined) | undefined;
const fetchMock = vi.fn<typeof fetch>();
function calls(method: string, path: string) {
  return fetchMock.mock.calls.filter(([url, options]) => String(url) === path && (options?.method ?? "GET") === method);
}
async function ready() {
  render(<Dashboard />);
  await screen.findByRole("link", { name: "Open Project notes" });
}

beforeEach(() => {
  push.mockReset();
  fetchMock.mockReset();
  activeUser = alice;
  documents = { [alice.email]: [{ ...owned }, { ...editable }, { ...viewOnly }], [bob.email]: [{ ...bobDraft }] };
  override = undefined;
  fetchMock.mockImplementation(async (url, options = {}) => {
    const path = String(url);
    const intercepted = override?.(path, options);
    if (intercepted !== undefined) return intercepted;
    const method = options.method ?? "GET";
    if (path === "/api/demo/session") {
      if (method === "GET") return activeUser ? json({ user: activeUser }) : json({}, 401);
      if (method === "DELETE") { activeUser = null; return new Response(null, { status: 204 }); }
      const { email } = JSON.parse(String(options.body)) as { email: string };
      activeUser = email === alice.email ? alice : bob;
      return json({ user: activeUser });
    }
    if (!activeUser) return json({}, 401);
    if (path === "/api/documents") {
      if (method === "GET") return json({ documents: documents[activeUser.email] });
      documents[activeUser.email].unshift({ ...created });
      return json({ document: { ...created, content: { type: "doc", content: [{ type: "paragraph" }] } } }, 201);
    }
    const id = path.split("/").at(-1);
    const document = documents[activeUser.email].find((document) => document.id === id);
    if (!document) return json({}, 404);
    if (method === "DELETE") {
      documents[activeUser.email] = documents[activeUser.email].filter((document) => document.id !== id);
      return new Response(null, { status: 204 });
    }
    if (method === "PATCH") {
      const { title } = JSON.parse(String(options.body)) as { title: string };
      document.title = title;
    }
    return json({ document: { ...document, content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Private body text" }] }] } } });
  });
  vi.stubGlobal("fetch", fetchMock);
});

describe("Document dashboard", () => {
  it("shows an initial loading state, then the no-session screen", async () => {
    const initial = deferred<Response>();
    override = (path) => path === "/api/demo/session" ? initial.promise : undefined;
    render(<Dashboard />);
    expect(screen.getByText("Loading your workspace…")).toBeInTheDocument();
    await act(async () => { initial.resolve(json({}, 401)); });
    expect(await screen.findByRole("heading", { name: "A workspace for your next idea" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /New Document/ })).not.toBeInTheDocument();
    expect(calls("GET", "/api/documents")).toHaveLength(0);
  });

  it.each([alice, bob])("selects $name using the existing session API", async (user) => {
    activeUser = null;
    render(<Dashboard />);
    await screen.findByRole("heading", { name: "A workspace for your next idea" });
    await userEvent.selectOptions(screen.getByLabelText("Demo user"), user.email);
    await screen.findByRole("link", { name: user.id === alice.id ? "Open Project notes" : "Open Bob’s draft" });
    expect(calls("POST", "/api/demo/session")[0][1]?.body).toBe(JSON.stringify({ email: user.email }));
    expect(screen.getByLabelText("Demo user")).toHaveValue(user.email);
  });

  it("groups owned and shared documents with dates and permissions", async () => {
    await ready();
    const mine = screen.getByRole("region", { name: /Owned documents/ });
    const shared = screen.getByRole("region", { name: /Shared with me/ });
    expect(within(mine).getByRole("link", { name: "Open Project notes" })).toHaveAttribute("href", "/documents/cowned");
    expect(within(mine).getByText("Owner")).toBeInTheDocument();
    expect(within(shared).getByText("Can edit")).toBeInTheDocument();
    expect(within(shared).getByText("View only")).toBeInTheDocument();
    expect(within(shared).getAllByText("Owned by Bob Demo")).toHaveLength(2);
    expect(mine.querySelector("time")).toHaveAttribute("datetime", owned.updatedAt);
    expect(screen.queryByText("Private body text")).not.toBeInTheDocument();
    expect(calls("GET", "/api/demo/session")).toHaveLength(1);
    expect(calls("GET", "/api/documents")).toHaveLength(1);
  });

  it("refreshes listings when switching users", async () => {
    await ready();
    await userEvent.selectOptions(screen.getByLabelText("Demo user"), bob.email);
    expect(await screen.findByRole("link", { name: "Open Bob’s draft" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open Project notes" })).not.toBeInTheDocument();
    expect(calls("GET", "/api/documents")).toHaveLength(2);
  });

  it("ignores a stale list response after switching identities", async () => {
    const old = deferred<Response>();
    let first = true;
    override = (path, options) => {
      if (path === "/api/documents" && !options.method && first) { first = false; return old.promise; }
    };
    render(<Dashboard />);
    await screen.findByText("Loading documents…");
    await userEvent.selectOptions(screen.getByLabelText("Demo user"), bob.email);
    await screen.findByRole("link", { name: "Open Bob’s draft" });
    await act(async () => { old.resolve(json({ documents: [owned] })); });
    expect(screen.queryByRole("link", { name: "Open Project notes" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Bob’s draft" })).toBeInTheDocument();
  });

  it("shows separate empty states without hardcoded documents", async () => {
    documents[alice.email] = [];
    render(<Dashboard />);
    expect(await screen.findByText("Your first document starts here")).toBeInTheDocument();
    expect(screen.getByText("Nothing shared with you yet")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Open / })).not.toBeInTheDocument();
  });

  it("handles a listing error and retries", async () => {
    let fail = true;
    override = (path) => path === "/api/documents" && fail ? json({}, 500) : undefined;
    render(<Dashboard />);
    expect(await screen.findByRole("heading", { name: "Couldn’t load your documents" })).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "Retry documents" }));
    await screen.findByRole("link", { name: "Open Project notes" });
    expect(calls("GET", "/api/documents")).toHaveLength(2);
  });

  it("handles an initial session error and retries discovery", async () => {
    let fail = true;
    override = (path) => path === "/api/demo/session" && fail ? json({}, 500) : undefined;
    render(<Dashboard />);
    await screen.findByRole("heading", { name: "Workspace unavailable" });
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByRole("link", { name: "Open Project notes" });
  });

  it("handles session expiry while loading documents", async () => {
    override = (path) => path === "/api/documents" ? json({}, 401) : undefined;
    render(<Dashboard />);
    await screen.findByRole("heading", { name: "A workspace for your next idea" });
    expect(screen.getByText(/session expired/)).toBeInTheDocument();
    expect(screen.getByLabelText("Demo user")).toHaveValue("");
  });

  it("creates with a default title, updates the list, and navigates", async () => {
    await ready();
    await userEvent.click(screen.getByRole("button", { name: /New Document/ }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/documents/cnew"));
    expect(calls("POST", "/api/documents")[0][1]?.body).toBe("{}");
    expect(screen.getByRole("link", { name: "Open Untitled document" })).toBeInTheDocument();
  });

  it("prevents duplicate creation while pending", async () => {
    await ready();
    const pending = deferred<Response>();
    override = (path, options) => path === "/api/documents" && options.method === "POST" ? pending.promise : undefined;
    await userEvent.dblClick(screen.getByRole("button", { name: /New Document/ }));
    expect(screen.getByRole("button", { name: /Creating/ })).toBeDisabled();
    expect(calls("POST", "/api/documents")).toHaveLength(1);
    await act(async () => { pending.resolve(json({ document: { ...created, content: {} } }, 201)); });
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("shows create errors and allows retry", async () => {
    await ready();
    override = (path, options) => path === "/api/documents" && options.method === "POST" ? json({}, 500) : undefined;
    await userEvent.click(screen.getByRole("button", { name: /New Document/ }));
    expect(await screen.findByText(/request could not be completed/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /New Document/ })).toBeEnabled();
    expect(push).not.toHaveBeenCalled();
  });

  it("renames a document with trimmed validation and refreshes the list", async () => {
    await ready();
    await userEvent.click(screen.getByRole("button", { name: "Rename Project notes" }));
    const input = screen.getByLabelText("Document title");
    expect(input).toHaveFocus();
    await userEvent.clear(input);
    await userEvent.type(input, "  Revised notes  ");
    await userEvent.click(screen.getByRole("button", { name: "Save title" }));
    await screen.findByRole("link", { name: "Open Revised notes" });
    expect(calls("PATCH", "/api/documents/cowned")[0][1]?.body).toBe(JSON.stringify({ title: "Revised notes" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect([
      screen.getByRole("heading", { name: "Documents" }),
      screen.getByRole("button", { name: "Rename Revised notes" }),
    ]).toContain(document.activeElement);
  });

  it.each(["   ", "a".repeat(201)])("rejects an invalid rename without calling the API (%#)", async (title) => {
    await ready();
    await userEvent.click(screen.getByRole("button", { name: "Rename Project notes" }));
    const input = screen.getByLabelText("Document title");
    fireEvent.change(input, { target: { value: title } });
    await userEvent.click(screen.getByRole("button", { name: "Save title" }));
    expect(screen.getByRole("alert")).toHaveTextContent(title.length > 200 ? "200 characters" : "Enter a document title");
    expect(calls("PATCH", "/api/documents/cowned")).toHaveLength(0);
    expect(input).toHaveFocus();
  });

  it("offers rename to editors, but never to viewers", async () => {
    await ready();
    expect(screen.getByRole("button", { name: "Rename Team plan" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Rename Reference guide" })).not.toBeInTheDocument();
  });

  it("offers delete only for owned documents", async () => {
    await ready();
    expect(screen.getByRole("button", { name: "Delete Project notes" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete Team plan" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete Reference guide" })).not.toBeInTheDocument();
  });

  it("cancels deletion and returns focus without deleting", async () => {
    await ready();
    const trigger = screen.getByRole("button", { name: "Delete Project notes" });
    await userEvent.click(trigger);
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(trigger).toHaveFocus();
    expect(calls("DELETE", "/api/documents/cowned")).toHaveLength(0);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes a rename dialog with Escape cancellation and restores focus", async () => {
    await ready();
    const trigger = screen.getByRole("button", { name: "Rename Project notes" });
    await userEvent.click(trigger);
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { bubbles: false, cancelable: true }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("keeps Tab and Shift+Tab focus inside the dialog", async () => {
    await ready();
    await userEvent.click(screen.getByRole("button", { name: "Rename Project notes" }));
    const input = screen.getByLabelText("Document title");
    const save = screen.getByRole("button", { name: "Save title" });
    save.focus();
    await userEvent.tab();
    expect(input).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(save).toHaveFocus();
  });

  it("deletes after confirmation and refreshes the list", async () => {
    await ready();
    await userEvent.click(screen.getByRole("button", { name: "Delete Project notes" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("cannot be undone");
    expect(calls("DELETE", "/api/documents/cowned")).toHaveLength(0);
    await userEvent.click(screen.getByRole("button", { name: "Delete document" }));
    await waitFor(() => expect(screen.queryByRole("link", { name: "Open Project notes" })).not.toBeInTheDocument());
    expect(calls("DELETE", "/api/documents/cowned")).toHaveLength(1);
    expect(screen.getByText("Document deleted.")).toBeInTheDocument();
  });

  it("prevents repeated delete submissions", async () => {
    await ready();
    const pending = deferred<Response>();
    override = (path, options) => path === "/api/documents/cowned" && options.method === "DELETE" ? pending.promise : undefined;
    await userEvent.click(screen.getByRole("button", { name: "Delete Project notes" }));
    await userEvent.dblClick(screen.getByRole("button", { name: "Delete document" }));
    expect(screen.getByRole("button", { name: "Deleting…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(calls("DELETE", "/api/documents/cowned")).toHaveLength(1);
    documents[alice.email] = [editable, viewOnly];
    await act(async () => { pending.resolve(new Response(null, { status: 204 })); });
  });

  it("shows permission errors and refreshes changed access", async () => {
    await ready();
    override = (path, options) => {
      if (path === "/api/documents/ceditor" && options.method === "PATCH") {
        documents[alice.email] = [owned, { ...editable, permission: "VIEWER" }, viewOnly];
        return json({}, 403);
      }
    };
    await userEvent.click(screen.getByRole("button", { name: "Rename Team plan" }));
    await userEvent.click(screen.getByRole("button", { name: "Save title" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("no longer have permission");
    expect(screen.queryByRole("button", { name: "Rename Team plan" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Document title")).toHaveValue("Team plan");
  });

  it("handles a document deleted by another user", async () => {
    await ready();
    override = (path, options) => {
      if (path === "/api/documents/cowned" && options.method === "DELETE") {
        documents[alice.email] = [editable, viewOnly];
        return json({}, 404);
      }
    };
    await userEvent.click(screen.getByRole("button", { name: "Delete Project notes" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete document" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("no longer available");
    expect(screen.queryByRole("link", { name: "Open Project notes" })).not.toBeInTheDocument();
  });

  it("clears documents if a mutation finds an expired session", async () => {
    await ready();
    override = (path, options) => path === "/api/documents" && options.method === "POST" ? json({}, 401) : undefined;
    await userEvent.click(screen.getByRole("button", { name: /New Document/ }));
    await screen.findByRole("heading", { name: "A workspace for your next idea" });
    expect(screen.queryByRole("link", { name: "Open Project notes" })).not.toBeInTheDocument();
  });

  it("logs out using the existing endpoint and clears all listings", async () => {
    await ready();
    await userEvent.click(screen.getByRole("button", { name: "Log out" }));
    await screen.findByRole("heading", { name: "A workspace for your next idea" });
    expect(calls("DELETE", "/api/demo/session")).toHaveLength(1);
    expect(screen.queryByRole("link", { name: "Open Project notes" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Demo user")).toHaveValue("");
  });

  it("aborts requests on unmount", async () => {
    const pending = deferred<Response>();
    override = () => pending.promise;
    const view = render(<Dashboard />);
    const signal = fetchMock.mock.calls[0][1]?.signal;
    expect(signal?.aborted).toBe(false);
    view.unmount();
    expect(signal?.aborted).toBe(true);
  });
});

describe("Document navigation placeholder", () => {
  it("loads accessible metadata with a return link and no editor/content rendering", async () => {
    render(<DocumentPlaceholder id={owned.id} />);
    expect(await screen.findByRole("heading", { name: "Project notes" })).toBeInTheDocument();
    expect(screen.getByText(/editor is coming in Phase 5/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Back to workspace/ })).toHaveAttribute("href", "/");
    expect(screen.queryByText("Private body text")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
  it("handles session expiry without exposing a document", async () => {
    activeUser = null;
    render(<DocumentPlaceholder id={owned.id} />);
    expect(await screen.findByRole("heading", { name: "Document unavailable" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("session expired");
    expect(screen.queryByRole("heading", { name: "Project notes" })).not.toBeInTheDocument();
  });
});
