import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ShareDialog } from "@/components/sharing/share-dialog";
import { DocumentEditor } from "@/components/editor/document-editor";
import type { DocumentResponse, SharingResponse } from "@/lib/api/contracts";

const alice = { id: "cm01234567890123456789012", name: "Alice Demo", email: "alice@example.com" };
const bob = { id: "cm01234567890123456789013", name: "Bob Demo", email: "bob@example.com" };
const id = "cm01234567890123456789014";
const endpoint = `/api/documents/${id}/shares`;
type Permission = SharingResponse["recipients"][number]["permission"];
let data: SharingResponse;
let document: DocumentResponse["document"];
let override: ((path: string, options: RequestInit) => Response | Promise<Response> | undefined) | undefined;
const fetchMock = vi.fn<typeof fetch>();
const onClose = vi.fn();
const onAccessError = vi.fn();
function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status }); }
function calls(method: string, path = endpoint) { return fetchMock.mock.calls.filter(([url, options]) => String(url) === path && (options?.method ?? "GET") === method); }
function grant(permission: Permission = "VIEWER") { data.recipients = [{ userId: bob.id, permission, user: bob }]; data.availableRecipients = []; }
async function open() {
  render(<ShareDialog documentId={id} ownerName={alice.name} onClose={onClose} onAccessError={onAccessError} />);
  await screen.findByLabelText("Recipient");
}

beforeEach(() => {
  onClose.mockReset(); onAccessError.mockReset(); fetchMock.mockReset(); override = undefined;
  data = { owner: { id: alice.id, name: alice.name }, recipients: [], availableRecipients: [bob] };
  document = { id, title: "Shared notes", content: { type: "doc", content: [{ type: "paragraph" }] }, permission: "OWNER", relationship: "owned",
    ownerId: alice.id, owner: { id: alice.id, name: alice.name }, createdAt: "2026-11-01T12:00:00Z", updatedAt: "2026-11-10T12:00:00Z" };
  fetchMock.mockImplementation(async (url, options = {}) => {
    const path = String(url);
    const intercepted = override?.(path, options);
    if (intercepted !== undefined) return intercepted;
    if (path === `/api/documents/${id}`) return json({ document });
    if (options.method === "POST") {
      grant((JSON.parse(String(options.body)) as { permission: Permission }).permission);
      return json({ share: data.recipients[0] }, 201);
    }
    if (options.method === "PATCH") {
      data.recipients[0].permission = (JSON.parse(String(options.body)) as { permission: Permission }).permission;
      return json({ share: data.recipients[0] });
    }
    if (options.method === "DELETE") { data.recipients = []; data.availableRecipients = [bob]; return new Response(null, { status: 204 }); }
    return json(data);
  });
  vi.stubGlobal("fetch", fetchMock);
});

describe("Document Share dialog", () => {
  it("shows the owner, eligible demo recipient, and permission choices", async () => {
    await open();
    const dialog = screen.getByRole("dialog", { name: "Share document" });
    expect(dialog).toHaveTextContent("Owner: Alice Demo");
    expect(screen.getByLabelText("Recipient")).toHaveValue(bob.id);
    expect(screen.getByLabelText("Permission")).toHaveValue("VIEWER");
    expect(screen.queryByRole("option", { name: /alice@example.com/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
    expect(calls("GET")).toHaveLength(1);
  });

  it("shares with the selected permission and refreshes recipients", async () => {
    await open();
    await userEvent.selectOptions(screen.getByLabelText("Permission"), "EDITOR");
    await userEvent.click(screen.getByRole("button", { name: "Share" }));
    expect(await screen.findByText("Document shared.")).toBeInTheDocument();
    expect(calls("POST")[0][1]?.body).toBe(JSON.stringify({ userId: bob.id, permission: "EDITOR" }));
    expect(screen.getByLabelText("Permission for Bob Demo")).toHaveValue("EDITOR");
    expect(calls("GET")).toHaveLength(2);
  });

  it("updates an existing permission and refreshes", async () => {
    grant();
    render(<ShareDialog documentId={id} ownerName={alice.name} onClose={onClose} onAccessError={onAccessError} />);
    await screen.findByLabelText("Permission for Bob Demo");
    await userEvent.selectOptions(screen.getByLabelText("Permission for Bob Demo"), "EDITOR");
    await screen.findByText("Permission updated.");
    expect(calls("PATCH")[0][1]?.body).toBe(JSON.stringify({ userId: bob.id, permission: "EDITOR" }));
    expect(screen.getByLabelText("Permission for Bob Demo")).toHaveValue("EDITOR");
    expect(calls("GET")).toHaveLength(2);
  });

  it("revokes access and makes the demo user available again", async () => {
    grant("EDITOR");
    render(<ShareDialog documentId={id} ownerName={alice.name} onClose={onClose} onAccessError={onAccessError} />);
    await userEvent.click(await screen.findByRole("button", { name: "Revoke access for Bob Demo" }));
    await screen.findByText("Access revoked.");
    expect(calls("DELETE", `${endpoint}/${bob.id}`)).toHaveLength(1);
    expect(screen.getByLabelText("Recipient")).toHaveValue(bob.id);
    expect(screen.queryByLabelText("Permission for Bob Demo")).not.toBeInTheDocument();
  });

  it("prevents duplicate submissions while a sharing mutation is pending", async () => {
    await open();
    let resolve!: (response: Response) => void;
    const pending = new Promise<Response>((done) => { resolve = done; });
    override = (_path, options) => options.method === "POST" ? pending : undefined;
    await userEvent.dblClick(screen.getByRole("button", { name: "Share" }));
    expect(calls("POST")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Updating…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Close" })).toBeDisabled();
    grant();
    await act(async () => { resolve(json({ share: data.recipients[0] }, 201)); });
  });

  it("reports duplicate conflicts and refreshes current access", async () => {
    await open();
    override = (_path, options) => {
      if (options.method === "POST") { grant(); return json({ error: { message: "This user already has access." } }, 409); }
    };
    await userEvent.click(screen.getByRole("button", { name: "Share" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already has access");
    expect(screen.getByLabelText("Permission for Bob Demo")).toBeInTheDocument();
    expect(screen.queryByLabelText("Recipient")).not.toBeInTheDocument();
  });

  it("shows loading/error states and retries failed sharing reads", async () => {
    let resolve!: (response: Response) => void;
    override = () => new Promise<Response>((done) => { resolve = done; });
    render(<ShareDialog documentId={id} ownerName={alice.name} onClose={onClose} onAccessError={onAccessError} />);
    expect(screen.getByText("Loading sharing…")).toBeInTheDocument();
    await act(async () => { resolve(json({}, 500)); });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    override = undefined;
    await userEvent.click(screen.getByRole("button", { name: "Retry sharing" }));
    expect(await screen.findByLabelText("Recipient")).toBeInTheDocument();
  });

  it.each([401, 403, 404])("reports expired or revoked sharing access (%i)", async (status) => {
    override = () => json({}, status);
    render(<ShareDialog documentId={id} ownerName={alice.name} onClose={onClose} onAccessError={onAccessError} />);
    await waitFor(() => expect(onAccessError).toHaveBeenCalledWith(expect.objectContaining({ status })));
    expect(screen.queryByLabelText("Recipient")).not.toBeInTheDocument();
  });
});

describe("Editor sharing permissions", () => {
  it.each(["OWNER", "EDITOR", "VIEWER"] as const)("shows sharing only for an owner (%s)", async (permission) => {
    document.permission = permission;
    render(<DocumentEditor id={id} />);
    await screen.findByRole("textbox", { name: "Document content" });
    if (permission === "OWNER") {
      const trigger = screen.getByRole("button", { name: "Share" });
      await userEvent.click(trigger);
      const dialog = screen.getByRole("dialog", { name: "Share document" });
      const close = within(dialog).getByRole("button", { name: "Close" });
      expect(close).toHaveFocus();
      await userEvent.tab({ shift: true });
      expect(within(dialog).getByRole("button", { name: "Share" })).toHaveFocus();
      fireEvent(dialog, new Event("cancel", { cancelable: true }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    } else expect(screen.queryByRole("button", { name: "Share" })).not.toBeInTheDocument();
  });

  it("handles loss of owner rights by closing sharing and pausing editor mutations", async () => {
    override = (path) => path === endpoint ? json({}, 403) : undefined;
    render(<DocumentEditor id={id} />);
    const content = await screen.findByRole("textbox", { name: "Document content" });
    await userEvent.click(screen.getByRole("button", { name: "Share" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("permission");
    expect(content).toHaveAttribute("contenteditable", "false");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Share" })).not.toBeInTheDocument();
  });
});
