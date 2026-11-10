import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Editor, JSONContent } from "@tiptap/react";
import { DocumentEditor } from "@/components/editor/document-editor";
import type { DocumentResponse } from "@/lib/api/contracts";
import { updateDocumentSchema } from "@/lib/documents/validation";

const id = "cm01234567890123456789012";
const path = `/api/documents/${id}`;
const empty = { type: "doc", content: [{ type: "paragraph" }] };
const textContent = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Existing content." }] }] };
let document: DocumentResponse["document"];
let override: ((path: string, options: RequestInit) => Response | Promise<Response> | undefined) | undefined;
const fetchMock = vi.fn<typeof fetch>();
function json(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status }); }
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function patches() { return fetchMock.mock.calls.filter(([, options]) => options?.method === "PATCH"); }
function payload(index = 0): unknown { return JSON.parse(String(patches()[index][1]?.body)); }
async function open() {
  const view = render(<DocumentEditor id={id} />);
  const box = await screen.findByRole("textbox", { name: "Document content" });
  const editor = (box as HTMLElement & { editor: Editor }).editor;
  expect(editor).toBeDefined();
  return { ...view, box, editor };
}
function insert(editor: Editor, text: string) { act(() => { editor.commands.insertContent(text); }); }
function selectAll(editor: Editor) { act(() => { editor.commands.selectAll(); }); }

beforeEach(() => {
  window.history.replaceState(null, "", `/documents/${id}`);
  document = { id, title: "Project notes", content: structuredClone(textContent), permission: "OWNER", relationship: "owned",
    ownerId: "alice", owner: { id: "alice", name: "Alice Demo" }, createdAt: "2026-11-01T12:00:00.000Z", updatedAt: "2026-11-10T12:00:00.000Z" };
  override = undefined;
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url, options = {}) => {
    const intercepted = override?.(String(url), options);
    if (intercepted !== undefined) return intercepted;
    if (options.method === "PATCH") {
      const updates = JSON.parse(String(options.body)) as { title?: string; content?: DocumentResponse["document"]["content"] };
      document = { ...document, ...updates };
    }
    return json({ document });
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { window.history.replaceState(null, "", "/"); });

describe("Rich-text document editor with real Tiptap", () => {
  it("loads existing rich-text JSON and title", async () => {
    document.content = { type: "doc", content: [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Saved heading" }] },
      { type: "paragraph", content: [{ type: "text", text: "Saved text", marks: [{ type: "bold" }, { type: "italic" }, { type: "underline" }] }] },
    ] };
    const pending = deferred<Response>();
    override = () => pending.promise;
    render(<DocumentEditor id={id} />);
    expect(screen.getByText("Loading document…")).toBeInTheDocument();
    await act(async () => { pending.resolve(json({ document })); });
    const box = await screen.findByRole("textbox", { name: "Document content" });
    expect(screen.getByLabelText("Document title")).toHaveValue("Project notes");
    expect(within(box).getByRole("heading", { name: "Saved heading", level: 2 })).toBeInTheDocument();
    expect(box.querySelector("strong em u, strong u em, em strong u, em u strong, u strong em, u em strong")).toHaveTextContent("Saved text");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(patches()).toHaveLength(0);
  });

  it("opens an empty document without marking it dirty", async () => {
    document.content = structuredClone(empty);
    const { box, editor } = await open();
    expect(editor.isEmpty).toBe(true);
    expect(box.querySelector("p")).toBeInTheDocument();
    expect(screen.getByText("Start writing…")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("All changes saved");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("canonicalizes numbered-list defaults without false unsaved changes", async () => {
    document.content = { type: "doc", content: [{ type: "orderedList", attrs: { start: 2 }, content: [
      { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Second item" }] }] },
    ] }] };
    const { box } = await open();
    expect(box.querySelector("ol")).toHaveAttribute("start", "2");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("does not render unsupported stored content", async () => {
    document.content = { type: "doc", content: [{ type: "image", attrs: { src: "https://evil.invalid/private.png" } }] };
    render(<DocumentEditor id={id} />);
    await screen.findByRole("heading", { name: "Document unavailable" });
    expect(screen.queryByRole("textbox", { name: "Document content" })).not.toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it.each([[404, "Document not found"], [401, "Document unavailable"]] as const)("handles load status %i", async (status, heading) => {
    override = () => json({}, status);
    render(<DocumentEditor id={id} />);
    expect(await screen.findByRole("heading", { name: heading })).toBeInTheDocument();
    expect(screen.queryByLabelText("Document title")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Back to dashboard/ })).toHaveAttribute("href", "/");
    if (status === 401) expect(screen.getByRole("alert")).toHaveTextContent("session expired");
  });

  it("retries a failed load", async () => {
    override = () => json({}, 500);
    render(<DocumentEditor id={id} />);
    await screen.findByRole("heading", { name: "Document unavailable" });
    override = undefined;
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("textbox", { name: "Document content" })).toHaveTextContent("Existing content.");
  });

  it("clears old content immediately when navigating to a new document", async () => {
    const view = await open();
    const next = deferred<Response>();
    override = () => next.promise;
    view.rerender(<DocumentEditor id="cmsecond" />);
    expect(screen.queryByText("Existing content.")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Document title")).not.toBeInTheDocument();
    expect(screen.getByText("Loading document…")).toBeInTheDocument();
    await act(async () => { next.resolve(json({ document: { ...document, id: "cmsecond", title: "Second document", content: empty } })); });
    expect(await screen.findByLabelText("Document title")).toHaveValue("Second document");
  });

  it("ignores stale fetch responses for a previous document", async () => {
    const old = deferred<Response>();
    override = (url) => url === path ? old.promise : json({ document: { ...document, id: "cmsecond", title: "Second document", content: empty } });
    const view = render(<DocumentEditor id={id} />);
    const oldSignal = fetchMock.mock.calls[0][1]?.signal;
    view.rerender(<DocumentEditor id="cmsecond" />);
    await screen.findByLabelText("Document title");
    await act(async () => { old.resolve(json({ document })); });
    expect(oldSignal?.aborted).toBe(true);
    expect(screen.getByLabelText("Document title")).toHaveValue("Second document");
  });

  it.each([["Bold", "strong"], ["Italic", "em"], ["Underline", "u"]])("applies %s using the toolbar", async (label, selector) => {
    const { editor, box } = await open();
    selectAll(editor);
    await userEvent.click(screen.getByRole("button", { name: label }));
    expect(box.querySelector(selector)).toHaveTextContent("Existing content.");
    expect(screen.getByRole("button", { name: label })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Unsaved changes");
    expect(patches()).toHaveLength(0);
  });

  it.each([1, 2, 3] as const)("applies heading level %i", async (level) => {
    const { editor, box } = await open();
    selectAll(editor);
    await userEvent.click(screen.getByRole("button", { name: `Heading ${level}` }));
    expect(within(box).getByRole("heading", { name: "Existing content.", level })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Heading ${level}` })).toHaveAttribute("aria-pressed", "true");
  });

  it.each([["Bullet list", "ul"], ["Numbered list", "ol"]])("applies and saves a %s as valid API JSON", async (label, selector) => {
    const { editor, box } = await open();
    selectAll(editor);
    await userEvent.click(screen.getByRole("button", { name: label }));
    expect(box.querySelector(`${selector} li p`)).toHaveTextContent("Existing content.");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(updateDocumentSchema.safeParse(payload()).success).toBe(true);
    expect((payload() as { content: JSONContent }).content.content?.[0].type).toBe(selector === "ol" ? "orderedList" : "bulletList");
    if (selector === "ol") expect((payload() as { content: JSONContent }).content.content?.[0].attrs).toEqual({ start: 1, type: null });
  });

  it("returns a heading to a paragraph", async () => {
    const { editor, box } = await open();
    selectAll(editor);
    await userEvent.click(screen.getByRole("button", { name: "Heading 1" }));
    await userEvent.click(screen.getByRole("button", { name: "Paragraph" }));
    expect(box.querySelector("h1")).not.toBeInTheDocument();
    expect(box.querySelector("p")).toHaveTextContent("Existing content.");
  });

  it("supports Tiptap's bold keyboard shortcut", async () => {
    const { editor, box } = await open();
    selectAll(editor);
    fireEvent.keyDown(box, { key: "b", code: "KeyB", ctrlKey: true });
    expect(box.querySelector("strong")).toHaveTextContent("Existing content.");
  });

  it("supports arrow-key navigation in the formatting toolbar", async () => {
    await open();
    const paragraph = screen.getByRole("button", { name: "Paragraph" });
    paragraph.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("button", { name: "Bold" })).toHaveFocus();
    await userEvent.keyboard("{End}");
    expect(screen.getByRole("button", { name: "Numbered list" })).toHaveFocus();
    await userEvent.keyboard("{Home}");
    expect(paragraph).toHaveFocus();
  });

  it("saves title and content explicitly, then disables unchanged saves", async () => {
    const { editor, box } = await open();
    insert(editor, "New words ");
    await userEvent.clear(screen.getByLabelText("Document title"));
    await userEvent.type(screen.getByLabelText("Document title"), "  Revised title  ");
    expect(patches()).toHaveLength(0);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("All changes saved"));
    expect(payload()).toMatchObject({ title: "Revised title", content: editor.getJSON() });
    expect(screen.getByLabelText("Document title")).toHaveValue("Revised title");
    expect(box).toHaveTextContent("New words");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(patches()).toHaveLength(1);
  });

  it.each(["", "   ", "a".repeat(201)])("rejects an invalid title before saving (%#)", async (title) => {
    await open();
    fireEvent.change(screen.getByLabelText("Document title"), { target: { value: title } });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert")).toHaveTextContent(title.length > 200 ? "200 characters" : "Enter a document title");
    expect(screen.getByLabelText("Document title")).toHaveValue(title);
    expect(patches()).toHaveLength(0);
  });

  it("avoids a PATCH for whitespace-only normalization", async () => {
    await open();
    fireEvent.change(screen.getByLabelText("Document title"), { target: { value: "  Project notes  " } });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByLabelText("Document title")).toHaveValue("Project notes");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(patches()).toHaveLength(0);
  });

  it("sends only a changed title for an editor recipient", async () => {
    document.permission = "EDITOR"; document.relationship = "shared";
    const { box } = await open();
    expect(box).toHaveAttribute("contenteditable", "true");
    fireEvent.change(screen.getByLabelText("Document title"), { target: { value: "Editor title" } });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(payload()).toEqual({ title: "Editor title" });
  });

  it("keeps viewers read-only with disabled title, Save, and formatting", async () => {
    document.permission = "VIEWER"; document.relationship = "shared";
    const { box } = await open();
    expect(box).toHaveAttribute("contenteditable", "false");
    expect(box).toHaveAttribute("aria-readonly", "true");
    expect(screen.getByLabelText("Document title")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByText("View-only document")).toBeInTheDocument();
    for (const button of within(screen.getByRole("toolbar")).getAllByRole("button")) expect(button).toBeDisabled();
    expect(patches()).toHaveLength(0);
  });

  it("preserves newer edits made during a save and keeps the same editor instance", async () => {
    const { editor, box } = await open();
    const pending = deferred<Response>();
    override = (_url, options) => options.method === "PATCH" ? pending.promise : undefined;
    insert(editor, "First edit ");
    fireEvent.change(screen.getByLabelText("Document title"), { target: { value: "First title" } });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    const snapshot = payload() as { content: DocumentResponse["document"]["content"]; title: string };
    insert(editor, "Later edit ");
    fireEvent.change(screen.getByLabelText("Document title"), { target: { value: "Later title" } });
    await act(async () => { pending.resolve(json({ document: { ...document, ...snapshot } })); });
    expect(box).toHaveTextContent("Later edit");
    expect(screen.getByLabelText("Document title")).toHaveValue("Later title");
    expect(screen.getByRole("status")).toHaveTextContent("Unsaved changes");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    expect((box as HTMLElement & { editor: Editor }).editor).toBe(editor);
    override = undefined;
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(patches()).toHaveLength(2));
    expect(payload(1)).toMatchObject({ title: "Later title", content: editor.getJSON() });
  });

  it("prevents duplicate submissions while saving", async () => {
    const { editor } = await open();
    const pending = deferred<Response>();
    override = (_url, options) => options.method === "PATCH" ? pending.promise : undefined;
    insert(editor, "New ");
    await userEvent.dblClick(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(patches()).toHaveLength(1);
    // Even if the user undoes locally, the in-flight snapshot may still persist.
    act(() => { editor.commands.undo(); });
    const leaving = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(leaving);
    expect(leaving.defaultPrevented).toBe(true);
    await act(async () => { pending.resolve(json({ document })); });
  });

  it("preserves a failed save and allows retry", async () => {
    const { editor, box } = await open();
    override = (_url, options) => options.method === "PATCH" ? json({}, 500) : undefined;
    insert(editor, "Keep this draft ");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("request could not be completed");
    expect(box).toHaveTextContent("Keep this draft");
    expect(screen.getByRole("status")).toHaveTextContent("Unsaved changes");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    override = undefined;
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("All changes saved"));
    expect(payload(1)).toEqual(payload(0));
  });

  it("preserves local content when the network fails", async () => {
    const { editor, box } = await open();
    override = (_url, options) => { if (options.method === "PATCH") throw new TypeError("offline"); return undefined; };
    insert(editor, "Offline draft ");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not connect");
    expect(box).toHaveTextContent("Offline draft");
  });

  it("warns about dirty reloads and stops warning after saving", async () => {
    const { editor } = await open();
    insert(editor, "Unsaved ");
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("All changes saved"));
    const clean = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
  });

  it("warns before leaving via dashboard/header links", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { editor } = await open();
    insert(editor, "Unsaved ");
    await userEvent.click(screen.getByRole("link", { name: /Back to dashboard/ }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("unsaved changes"));
    expect(screen.getByRole("textbox", { name: "Document content" })).toBeInTheDocument();
  });

  it("becomes clean again after undoing local edits", async () => {
    const { editor } = await open();
    insert(editor, "Change ");
    expect(screen.getByRole("status")).toHaveTextContent("Unsaved changes");
    act(() => { editor.commands.undo(); });
    expect(screen.getByRole("status")).toHaveTextContent("All changes saved");
    expect(patches()).toHaveLength(0);
  });

  it("pauses editing on permission revocation without discarding the draft", async () => {
    document.permission = "EDITOR";
    const { editor, box } = await open();
    override = (_url, options) => options.method === "PATCH" ? json({}, 403) : undefined;
    insert(editor, "Retained draft ");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("permission");
    expect(box).toHaveTextContent("Retained draft");
    expect(box).toHaveAttribute("contenteditable", "false");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    document.permission = "VIEWER";
    await userEvent.click(screen.getByRole("button", { name: "Check access again" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("local changes remain unsaved"));
    expect(box).toHaveTextContent("Retained draft");
  });

  it("hides content on session expiration and restores the local draft after access is revalidated", async () => {
    const { editor } = await open();
    override = (_url, options) => options.method === "PATCH" ? json({}, 401) : undefined;
    insert(editor, "Private local draft ");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("session expired");
    expect(screen.queryByRole("textbox", { name: "Document content" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Document title")).not.toBeInTheDocument();
    override = undefined;
    await userEvent.click(screen.getByRole("button", { name: "Check access again" }));
    expect(await screen.findByRole("textbox", { name: "Document content" })).toHaveTextContent("Private local draft");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("hides content if a save reports the document is no longer accessible", async () => {
    const { editor } = await open();
    override = (_url, options) => options.method === "PATCH" ? json({}, 404) : undefined;
    insert(editor, "Unsaved ");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("no longer available");
    expect(screen.queryByRole("textbox", { name: "Document content" })).not.toBeInTheDocument();
  });

  it("saves a cleared document as a valid empty paragraph", async () => {
    const { editor } = await open();
    act(() => { editor.commands.clearContent(); });
    expect(screen.getByText("Start writing…")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(payload()).toEqual({ content: empty });
  });

  it("rejects oversized requests locally while keeping their content", async () => {
    const { editor, box } = await open();
    act(() => { editor.commands.setContent({ type: "doc", content: Array.from({ length: 4 }, () => ({ type: "paragraph", content: [{ type: "text", text: "x".repeat(80_000) }] })) }); });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert")).toHaveTextContent("too large");
    expect(box.textContent?.length).toBe(320_000);
    expect(patches()).toHaveLength(0);
  });

  it("aborts in-flight saves and destroys Tiptap on unmount", async () => {
    const { editor, unmount } = await open();
    const pending = deferred<Response>();
    override = (_url, options) => options.method === "PATCH" ? pending.promise : undefined;
    insert(editor, "Edit ");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    const signal = patches()[0][1]?.signal;
    unmount();
    expect(signal?.aborted).toBe(true);
    await waitFor(() => expect(editor.isDestroyed).toBe(true));
  });
});
