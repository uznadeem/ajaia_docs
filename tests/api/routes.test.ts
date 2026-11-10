import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { after, afterEach, before, describe, it } from "node:test";
import nextEnv from "@next/env";
import { NextRequest } from "next/server";

nextEnv.loadEnvConfig(process.cwd());
// Each test process has its own signing key; real local secrets are never used.
process.env.DEMO_SESSION_SECRET = randomBytes(32).toString("hex");
process.env.APP_ORIGIN = "http://localhost:3000";
const { prisma } = await import("../../src/lib/db/prisma");
const sessions = await import("../../src/app/api/demo/session/route");
const collection = await import("../../src/app/api/documents/route");
const individual = await import("../../src/app/api/documents/[id]/route");
const { SESSION_COOKIE, SESSION_SECONDS } = await import("../../src/lib/auth/session");
const { MAX_BODY_BYTES } = await import("../../src/lib/api/http");

const origin = "http://localhost:3000";
const empty = { type: "doc", content: [{ type: "paragraph" }] };
const richText = {
  type: "doc",
  content: [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Hello 世界", marks: [{ type: "bold" }] }] }],
};
type ApiDocument = {
  id: string; title: string; ownerId: string; content: unknown;
  permission: "OWNER" | "EDITOR" | "VIEWER"; relationship: "owned" | "shared";
  updatedAt: string; owner: { id: string; name: string };
};
async function documentFrom(response: Response) {
  return (await response.json() as { document: ApiDocument }).document;
}
function request(path: string, method = "GET", cookie?: string, body?: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(`${origin}${path}`, {
    method,
    headers: { origin, "content-type": "application/json", ...(cookie ? { cookie } : {}), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function context(id: string) { return { params: Promise.resolve({ id }) }; }
function signed(payload: unknown) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", process.env.DEMO_SESSION_SECRET!).update(encoded).digest("base64url");
  return `${SESSION_COOKIE}=${encoded}.${signature}`;
}

// Tests call the actual route exports, with real Prisma queries and no DB mocks.
describe("Document API route integration", { concurrency: false }, () => {
  let alice: { id: string; email: string };
  let bob: { id: string; email: string };
  let aliceCookie: string;
  let bobCookie: string;
  const documentIds = new Set<string>();
  const otherUserIds = new Set<string>();

  async function login(email: string) {
    return sessions.POST(request("/api/demo/session", "POST", undefined, { email }));
  }
  function cookieFrom(response: Response) {
    const value = response.headers.get("set-cookie");
    assert.ok(value);
    return value.split(";")[0];
  }
  async function fixture(ownerId = alice.id) {
    const doc = await prisma.document.create({ data: { title: `API test ${randomUUID()}`, content: empty, ownerId } });
    documentIds.add(doc.id);
    return doc;
  }
  async function create(body: unknown, cookie = aliceCookie) {
    const response = await collection.POST(request("/api/documents", "POST", cookie, body));
    if (response.status === 201) {
      const data = await response.clone().json() as { document: ApiDocument };
      documentIds.add(data.document.id);
    }
    return response;
  }
  async function share(permission: "EDITOR" | "VIEWER") {
    const doc = await fixture();
    await prisma.documentShare.create({ data: { documentId: doc.id, userId: bob.id, permission } });
    return doc;
  }
  async function error(response: Response, status: number, code?: string) {
    assert.equal(response.status, status);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const data = await response.json() as { error: { code: string; message: string } };
    assert.equal(typeof data.error.message, "string");
    if (code) assert.equal(data.error.code, code);
  }

  before(async () => {
    alice = await prisma.user.findUniqueOrThrow({ where: { email: "alice@example.com" }, select: { id: true, email: true } });
    bob = await prisma.user.findUniqueOrThrow({ where: { email: "bob@example.com" }, select: { id: true, email: true } });
    const a = await login(alice.email);
    const b = await login(bob.email);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    aliceCookie = cookieFrom(a);
    bobCookie = cookieFrom(b);
  });
  afterEach(async () => {
    // Exact IDs tracked by this process only; never remove Alice or Bob.
    await prisma.document.deleteMany({ where: { id: { in: [...documentIds] } } });
    await prisma.user.deleteMany({ where: { id: { in: [...otherUserIds] } } });
    documentIds.clear();
    otherUserIds.clear();
  });
  after(async () => { await prisma.$disconnect(); });

  it("logs in both permitted demo users with private expiring cookies", async () => {
    for (const user of [alice, bob]) {
      const response = await login(user.email);
      assert.equal(response.status, 200);
      const cookie = response.headers.get("set-cookie")!;
      assert.match(cookie, /HttpOnly/i);
      assert.match(cookie, /SameSite=lax/i);
      assert.match(cookie, /Path=\//i);
      assert.match(cookie, new RegExp(`Max-Age=${SESSION_SECONDS}`));
      const body = await response.json() as { user: { id: string } };
      assert.equal(body.user.id, user.id);
    }
  });
  it("sets Secure in production", async () => {
    const old = process.env.NODE_ENV;
    try {
      Object.assign(process.env, { NODE_ENV: "production" });
      assert.match((await login(alice.email)).headers.get("set-cookie")!, /; Secure/i);
    } finally { Object.assign(process.env, { NODE_ENV: old }); }
  });
  it("rejects non-demo identities", async () => { await error(await login("stranger@example.com"), 400); });
  it("rejects missing and unexpected login fields", async () => {
    for (const body of [{}, { email: alice.email, userId: bob.id }, { userId: alice.id }]) {
      await error(await sessions.POST(request("/api/demo/session", "POST", undefined, body)), 400);
    }
  });
  it("rejects missing sessions for every document operation", async () => {
    const doc = await fixture();
    const calls = [
      collection.GET(request("/api/documents")),
      collection.POST(request("/api/documents", "POST", undefined, {})),
      individual.GET(request(`/api/documents/${doc.id}`), context(doc.id)),
      individual.PATCH(request(`/api/documents/${doc.id}`, "PATCH", undefined, { title: "No" }), context(doc.id)),
      individual.DELETE(request(`/api/documents/${doc.id}`, "DELETE"), context(doc.id)),
    ];
    for (const response of await Promise.all(calls)) await error(response, 401);
  });
  it("rejects tampered sessions", async () => {
    const [name, token] = aliceCookie.split("=");
    const [payload, signature] = token.split(".");
    const tampered = `${name}=${payload}.${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`;
    await error(await collection.GET(request("/api/documents", "GET", tampered)), 401);
  });
  it("rejects expired signed sessions", async () => {
    const now = Math.floor(Date.now() / 1000);
    const cookie = signed({ version: 1, userId: alice.id, email: alice.email, iat: now - SESSION_SECONDS - 1, exp: now - 1 });
    await error(await collection.GET(request("/api/documents", "GET", cookie)), 401);
  });
  it("rejects malformed, future-dated, and overlong sessions", async () => {
    const now = Math.floor(Date.now() / 1000);
    const cookies = [
      `${SESSION_COOKIE}=garbage`, `${SESSION_COOKIE}=${"a".repeat(2050)}`,
      signed({ version: 1, userId: alice.id, email: alice.email, iat: now + 60, exp: now + 120 }),
      signed({ version: 1, userId: alice.id, email: alice.email, iat: now, exp: now + SESSION_SECONDS + 1 }),
    ];
    for (const cookie of cookies) await error(await collection.GET(request("/api/documents", "GET", cookie)), 401);
  });
  it("rejects signed identities that no longer match a demo user", async () => {
    const now = Math.floor(Date.now() / 1000);
    const cookie = signed({ version: 1, userId: bob.id, email: alice.email, iat: now, exp: now + 60 });
    await error(await collection.GET(request("/api/documents", "GET", cookie)), 401);
  });
  it("does not trust arbitrary identity headers", async () => {
    await error(await collection.GET(request("/api/documents", "GET", undefined, undefined, { "x-user-id": alice.id, "x-demo-user": alice.email })), 401);
  });
  it("logs out and clears the cookie even if the session is invalid", async () => {
    const response = await sessions.DELETE(request("/api/demo/session", "DELETE", `${SESSION_COOKIE}=invalid`));
    assert.equal(response.status, 204);
    assert.match(response.headers.get("set-cookie")!, /Max-Age=0/i);
    assert.match(response.headers.get("set-cookie")!, /HttpOnly/i);
    await error(await collection.GET(request("/api/documents", "GET", cookieFrom(response))), 401);
  });
  it("rejects cross-origin session creation and logout", async () => {
    const headers = { origin: "https://evil.invalid" };
    await error(await sessions.POST(request("/api/demo/session", "POST", undefined, { email: alice.email }, headers)), 403);
    await error(await sessions.DELETE(request("/api/demo/session", "DELETE", aliceCookie, undefined, headers)), 403);
  });
  it("rejects absent Origin and cross-site fetch metadata", async () => {
    const req = request("/api/demo/session", "POST", undefined, { email: alice.email });
    req.headers.delete("origin");
    await error(await sessions.POST(req), 403);
    await error(await sessions.POST(request("/api/demo/session", "POST", undefined, { email: alice.email }, { "sec-fetch-site": "cross-site" })), 403);
  });
  it("fails safely with an invalid signing-secret configuration", async () => {
    const old = process.env.DEMO_SESSION_SECRET;
    try {
      process.env.DEMO_SESSION_SECRET = "short";
      const response = await login(alice.email);
      await error(response, 500, "INTERNAL_ERROR");
      assert.equal(response.headers.get("set-cookie"), null);
    } finally { process.env.DEMO_SESSION_SECRET = old; }
  });

  it("creates a document with default title and empty Tiptap content", async () => {
    const response = await create({});
    assert.equal(response.status, 201);
    const doc = await documentFrom(response);
    assert.equal(doc.title, "Untitled document");
    assert.equal(doc.ownerId, alice.id);
    assert.equal(doc.permission, "OWNER");
    assert.deepEqual(doc.content, empty);
  });
  it("creates a trimmed custom title under the active identity", async () => {
    const response = await create({ title: "  Bob's notes  " }, bobCookie);
    assert.equal(response.status, 201);
    const doc = await documentFrom(response);
    assert.equal(doc.title, "Bob's notes");
    assert.equal(doc.ownerId, bob.id);
  });
  it("rejects forged ownership and create-time content", async () => {
    for (const body of [{ ownerId: bob.id }, { userId: bob.id }, { content: richText }, { title: "Valid", extra: true }]) {
      await error(await create(body), 400);
    }
  });
  it("lists owned and shared metadata while excluding unrelated documents", async () => {
    const owned = await fixture(bob.id);
    const shared = await share("EDITOR");
    const unrelated = await fixture(alice.id);
    const response = await collection.GET(request("/api/documents", "GET", bobCookie));
    assert.equal(response.status, 200);
    const { documents } = await response.json() as { documents: ApiDocument[] };
    assert.equal(documents.find(({ id }) => id === owned.id)?.relationship, "owned");
    const sharedDoc = documents.find(({ id }) => id === shared.id)!;
    assert.equal(sharedDoc.relationship, "shared");
    assert.equal(sharedDoc.permission, "EDITOR");
    assert.equal(sharedDoc.owner.id, alice.id);
    assert.equal(documents.some(({ id }) => id === unrelated.id), false);
    for (const doc of documents) {
      assert.equal("content" in doc, false);
      assert.equal("shares" in doc, false);
      assert.equal("email" in doc.owner, false);
    }
  });
  it("orders lists stably by updatedAt and id descending", async () => {
    const a = await fixture(); const b = await fixture();
    const time = new Date("2026-01-01T00:00:00Z");
    await prisma.document.updateMany({ where: { id: { in: [a.id, b.id] } }, data: { updatedAt: time } });
    const response = await collection.GET(request("/api/documents", "GET", aliceCookie));
    const { documents } = await response.json() as { documents: ApiDocument[] };
    const filtered = documents.filter(({ id }) => [a.id, b.id].includes(id));
    assert.deepEqual(filtered.map(({ id }) => id), [a.id, b.id].sort().reverse());
    for (let i = 1; i < documents.length; i++) assert.ok(documents[i - 1].updatedAt >= documents[i].updatedAt);
  });
  it("reads an owned document with effective permission", async () => {
    const doc = await fixture();
    const response = await individual.GET(request(`/api/documents/${doc.id}`, "GET", aliceCookie), context(doc.id));
    assert.equal(response.status, 200);
    const body = await documentFrom(response);
    assert.equal(body.id, doc.id); assert.equal(body.permission, "OWNER"); assert.deepEqual(body.content, empty);
  });
  it("renames a document without changing content", async () => {
    const doc = await fixture();
    const response = await individual.PATCH(request(`/api/documents/${doc.id}`, "PATCH", aliceCookie, { title: "  Renamed  " }), context(doc.id));
    assert.equal(response.status, 200);
    const body = await documentFrom(response);
    assert.equal(body.title, "Renamed"); assert.deepEqual(body.content, empty);
  });
  it("persists rich-text JSON without changing title", async () => {
    const doc = await fixture();
    const response = await individual.PATCH(request(`/api/documents/${doc.id}`, "PATCH", aliceCookie, { content: richText }), context(doc.id));
    assert.equal(response.status, 200);
    const body = await documentFrom(response);
    assert.equal(body.title, doc.title); assert.deepEqual(body.content, richText);
    assert.deepEqual((await prisma.document.findUniqueOrThrow({ where: { id: doc.id } })).content, richText);
  });
  it("updates title and content together", async () => {
    const doc = await fixture();
    const response = await individual.PATCH(request(`/api/documents/${doc.id}`, "PATCH", aliceCookie, { title: "Both", content: richText }), context(doc.id));
    assert.equal(response.status, 200);
    const body = await documentFrom(response); assert.equal(body.title, "Both"); assert.deepEqual(body.content, richText);
  });
  it("rejects invalid titles on both creation and update", async () => {
    const doc = await fixture();
    for (const title of ["", "   ", "a".repeat(201), 123, null]) {
      await error(await create({ title }), 400);
      await error(await individual.PATCH(request(`/api/documents/${doc.id}`, "PATCH", aliceCookie, { title }), context(doc.id)), 400);
    }
  });
  it("rejects empty updates and unexpected update fields", async () => {
    const doc = await fixture();
    for (const body of [{}, { ownerId: bob.id }, { title: "No", shares: [] }, [], null]) {
      await error(await individual.PATCH(request(`/api/documents/${doc.id}`, "PATCH", aliceCookie, body), context(doc.id)), 400);
    }
  });
  it("rejects malformed rich-text types, nesting, attributes, and marks", async () => {
    const doc = await fixture();
    const invalid = [null, "text", {}, { type: "doc", content: [] }, { type: "doc", content: [{ type: "text", text: "inline at root" }] },
      { type: "doc", content: [{ type: "paragraph", content: [{ type: "image", attrs: { src: "x" } }] }] },
      { type: "doc", content: [{ type: "heading", attrs: { level: 9 } }] },
      { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "script" }] }] }] },
      { type: "doc", content: [{ type: "paragraph", attrs: { onclick: "alert(1)" } }] },
      { type: "doc", content: [{ type: "bulletList", content: [{ type: "paragraph" }] }] },
      { type: "doc", content: [{ type: "listItem", content: [{ type: "paragraph" }] }] },
    ];
    for (const content of invalid) await error(await individual.PATCH(request(`/api/documents/${doc.id}`, "PATCH", aliceCookie, { content }), context(doc.id)), 400);
  });
  it("accepts lists, quotes, code blocks, and inline breaks", async () => {
    const doc = await fixture();
    const content = { type: "doc", content: [
      { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Item" }, { type: "hardBreak" }] }] }] },
      { type: "orderedList", attrs: { start: 2 }, content: [{ type: "listItem", content: [{ type: "paragraph" }] }] },
      { type: "blockquote", content: [{ type: "paragraph" }] },
      { type: "codeBlock", attrs: { language: null }, content: [{ type: "text", text: "const x = 1" }] }, { type: "horizontalRule" },
    ] };
    const response = await individual.PATCH(request(`/api/documents/${doc.id}`, "PATCH", aliceCookie, { content }), context(doc.id));
    assert.equal(response.status, 200); assert.deepEqual((await documentFrom(response)).content, content);
  });
  it("rejects excessive content depth and node counts", async () => {
    const doc = await fixture();
    let node: unknown = { type: "paragraph" };
    for (let i = 0; i < 25; i++) node = { type: "blockquote", content: [node] };
    for (const content of [{ type: "doc", content: [node] }, { type: "doc", content: Array.from({ length: 2001 }, () => ({ type: "paragraph" })) }]) {
      await error(await individual.PATCH(request(`/api/documents/${doc.id}`, "PATCH", aliceCookie, { content }), context(doc.id)), 400);
    }
  });
  it("rejects invalid JSON and unsupported content types", async () => {
    const bad = new NextRequest(`${origin}/api/documents`, { method: "POST", headers: { origin, cookie: aliceCookie, "content-type": "application/json" }, body: "{broken" });
    await error(await collection.POST(bad), 400, "INVALID_JSON");
    await error(await create(null), 400);
    await error(await collection.POST(request("/api/documents", "POST", aliceCookie, {}, { "content-type": "text/plain" })), 400);
  });
  it("rejects oversized bodies with or without honest content length", async () => {
    const body = { title: "a".repeat(MAX_BODY_BYTES + 1) };
    await error(await collection.POST(request("/api/documents", "POST", aliceCookie, body)), 413);
    await error(await collection.POST(request("/api/documents", "POST", aliceCookie, {}, { "content-length": String(MAX_BODY_BYTES + 1) })), 413);
    await error(await collection.POST(request("/api/documents", "POST", aliceCookie, body, { "content-length": "1" })), 413);
  });
  it("requires same-origin requests for all document mutations", async () => {
    const doc = await fixture(); const headers = { origin: "https://evil.invalid" };
    await error(await collection.POST(request("/api/documents", "POST", aliceCookie, {}, headers)), 403);
    await error(await individual.PATCH(request(`/api/documents/${doc.id}`, "PATCH", aliceCookie, { title: "No" }, headers), context(doc.id)), 403);
    await error(await individual.DELETE(request(`/api/documents/${doc.id}`, "DELETE", aliceCookie, undefined, headers), context(doc.id)), 403);
  });
  it("deletes owned documents and cascades their shares", async () => {
    const doc = await share("EDITOR");
    const response = await individual.DELETE(request(`/api/documents/${doc.id}`, "DELETE", aliceCookie), context(doc.id));
    assert.equal(response.status, 204); assert.equal(await response.text(), "");
    assert.equal(await prisma.document.findUnique({ where: { id: doc.id } }), null);
    assert.equal(await prisma.documentShare.count({ where: { documentId: doc.id } }), 0);
  });
  it("returns 404 for nonexistent document reads, edits, and deletes", async () => {
    const doc = await fixture(); await prisma.document.delete({ where: { id: doc.id } });
    await error(await individual.GET(request(`/api/documents/${doc.id}`, "GET", aliceCookie), context(doc.id)), 404);
    await error(await individual.PATCH(request(`/api/documents/${doc.id}`, "PATCH", aliceCookie, { title: "No" }), context(doc.id)), 404);
    await error(await individual.DELETE(request(`/api/documents/${doc.id}`, "DELETE", aliceCookie), context(doc.id)), 404);
  });
  it("rejects invalid or missing document identifiers", async () => {
    for (const id of ["", "not-an-id", "../secret", "a".repeat(500)]) {
      await error(await individual.GET(request("/api/documents/x", "GET", aliceCookie), context(id)), 400);
      await error(await individual.PATCH(request("/api/documents/x", "PATCH", aliceCookie, { title: "No" }), context(id)), 400);
      await error(await individual.DELETE(request("/api/documents/x", "DELETE", aliceCookie), context(id)), 400);
    }
  });
  it("allows editors to read and edit title and content", async () => {
    const doc = await share("EDITOR");
    const read = await individual.GET(request(`/api/documents/${doc.id}`, "GET", bobCookie), context(doc.id));
    assert.equal(read.status, 200); assert.equal((await documentFrom(read)).permission, "EDITOR");
    const patch = await individual.PATCH(request(`/api/documents/${doc.id}`, "PATCH", bobCookie, { title: "Editor change", content: richText }), context(doc.id));
    assert.equal(patch.status, 200); assert.equal((await documentFrom(patch)).title, "Editor change");
  });
  it("allows viewers to read but forbids edits", async () => {
    const doc = await share("VIEWER");
    const response = await individual.GET(request(`/api/documents/${doc.id}`, "GET", bobCookie), context(doc.id));
    assert.equal(response.status, 200); assert.equal((await documentFrom(response)).permission, "VIEWER");
    await error(await individual.PATCH(request(`/api/documents/${doc.id}`, "PATCH", bobCookie, { title: "No", content: richText }), context(doc.id)), 403);
    assert.equal((await prisma.document.findUniqueOrThrow({ where: { id: doc.id } })).title, doc.title);
  });
  it("forbids editors and viewers from deleting documents", async () => {
    for (const permission of ["EDITOR", "VIEWER"] as const) {
      const doc = await share(permission);
      await error(await individual.DELETE(request(`/api/documents/${doc.id}`, "DELETE", bobCookie), context(doc.id)), 403);
      assert.ok(await prisma.document.findUnique({ where: { id: doc.id } }));
    }
  });
  it("hides unrelated documents for reads, updates, and deletes", async () => {
    const doc = await fixture();
    await error(await individual.GET(request(`/api/documents/${doc.id}`, "GET", bobCookie), context(doc.id)), 404);
    await error(await individual.PATCH(request(`/api/documents/${doc.id}`, "PATCH", bobCookie, { title: "No" }), context(doc.id)), 404);
    await error(await individual.DELETE(request(`/api/documents/${doc.id}`, "DELETE", bobCookie), context(doc.id)), 404);
    assert.equal((await prisma.document.findUniqueOrThrow({ where: { id: doc.id } })).title, doc.title);
  });
  it("hides third-user documents and rejects their signed identity", async () => {
    const user = await prisma.user.create({ data: { name: "API outsider", email: `${randomUUID()}@ajaia-api-test.invalid` } });
    otherUserIds.add(user.id);
    const doc = await fixture(user.id);
    await error(await individual.GET(request(`/api/documents/${doc.id}`, "GET", aliceCookie), context(doc.id)), 404);
    const now = Math.floor(Date.now() / 1000);
    const cookie = signed({ version: 1, userId: user.id, email: user.email, iat: now, exp: now + 60 });
    await error(await collection.GET(request("/api/documents", "GET", cookie)), 401);
  });
  it("rechecks revoked and downgraded editor access on writes", async () => {
    const doc = await share("EDITOR");
    await prisma.documentShare.update({ where: { documentId_userId: { documentId: doc.id, userId: bob.id } }, data: { permission: "VIEWER" } });
    await error(await individual.PATCH(request(`/api/documents/${doc.id}`, "PATCH", bobCookie, { title: "No" }), context(doc.id)), 403);
    await prisma.documentShare.delete({ where: { documentId_userId: { documentId: doc.id, userId: bob.id } } });
    await error(await individual.PATCH(request(`/api/documents/${doc.id}`, "PATCH", bobCookie, { title: "No" }), context(doc.id)), 404);
  });
});
