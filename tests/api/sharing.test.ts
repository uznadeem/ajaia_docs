import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import nextEnv from "@next/env";
import { NextRequest } from "next/server";

nextEnv.loadEnvConfig(process.cwd());
process.env.DEMO_SESSION_SECRET = randomBytes(32).toString("hex");
process.env.APP_ORIGIN = "http://localhost:3000";
const { prisma } = await import("../../src/lib/db/prisma");
const session = await import("../../src/app/api/demo/session/route");
const shares = await import("../../src/app/api/documents/[id]/shares/route");
const revoke = await import("../../src/app/api/documents/[id]/shares/[userId]/route");
const documents = await import("../../src/app/api/documents/route");
const document = await import("../../src/app/api/documents/[id]/route");
const { SESSION_COOKIE } = await import("../../src/lib/auth/session");
const origin = "http://localhost:3000";
function request(method: string, cookie: string, body?: unknown, extra: Record<string, string> = {}) {
  return new NextRequest(`${origin}/api/documents/test/shares`, { method,
    headers: { origin, "content-type": "application/json", ...(cookie ? { cookie } : {}), ...extra },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function context(id: string) { return { params: Promise.resolve({ id }) }; }
function recipientContext(id: string, userId: string) { return { params: Promise.resolve({ id, userId }) }; }

describe("Owner-managed document sharing", { concurrency: false }, () => {
  let aliceId: string, bobId: string, aliceCookie: string, bobCookie: string, id: string;
  const documentIds = new Set<string>();
  const userIds = new Set<string>();
  async function fixture(ownerId: string) {
    const doc = await prisma.document.create({ data: { title: `Sharing test ${randomUUID()}`, content: { type: "doc", content: [{ type: "paragraph" }] }, ownerId } });
    documentIds.add(doc.id); return doc.id;
  }
  before(async () => {
    aliceId = (await prisma.user.findUniqueOrThrow({ where: { email: "alice@example.com" } })).id;
    bobId = (await prisma.user.findUniqueOrThrow({ where: { email: "bob@example.com" } })).id;
    for (const email of ["alice@example.com", "bob@example.com"]) {
      const response = await session.POST(request("POST", "", { email }));
      assert.equal(response.status, 200);
      const cookie = response.headers.get("set-cookie")!.split(";")[0];
      if (email.startsWith("alice")) aliceCookie = cookie; else bobCookie = cookie;
    }
  });
  beforeEach(async () => { id = await fixture(aliceId); });
  afterEach(async () => {
    await prisma.document.deleteMany({ where: { id: { in: [...documentIds] } } });
    await prisma.user.deleteMany({ where: { id: { in: [...userIds] } } });
    documentIds.clear(); userIds.clear();
  });
  after(async () => { await prisma.$disconnect(); });
  async function grant(permission = "VIEWER") { return shares.POST(request("POST", aliceCookie, { userId: bobId, permission }), context(id)); }

  it("lists only the owner and eligible demo recipient, then shares as viewer", async () => {
    const initial = await shares.GET(request("GET", aliceCookie), context(id));
    assert.equal(initial.status, 200);
    const data = await initial.json();
    assert.equal(data.owner.id, aliceId);
    assert.deepEqual(data.recipients, []);
    assert.deepEqual(data.availableRecipients.map((user: { id: string }) => user.id), [bobId]);
    assert.equal((await grant()).status, 201);
    const listed = await documents.GET(request("GET", bobCookie));
    const shared = (await listed.json()).documents.find((doc: { id: string }) => doc.id === id);
    assert.equal(shared.relationship, "shared"); assert.equal(shared.permission, "VIEWER");
    const read = await document.GET(request("GET", bobCookie), context(id));
    assert.equal(read.status, 200); assert.equal((await read.json()).document.permission, "VIEWER");
    assert.equal((await document.PATCH(request("PATCH", bobCookie, { title: "No" }), context(id))).status, 403);
    assert.equal((await document.DELETE(request("DELETE", bobCookie), context(id))).status, 403);
  });

  it("allows editor saves, permission updates, and subsequent viewer enforcement", async () => {
    assert.equal((await grant("EDITOR")).status, 201);
    assert.equal((await document.PATCH(request("PATCH", bobCookie, { title: "Bob edited" }), context(id))).status, 200);
    assert.equal((await document.DELETE(request("DELETE", bobCookie), context(id))).status, 403);
    const update = await shares.PATCH(request("PATCH", aliceCookie, { userId: bobId, permission: "VIEWER" }), context(id));
    assert.equal(update.status, 200); assert.equal((await update.json()).share.permission, "VIEWER");
    assert.equal((await document.PATCH(request("PATCH", bobCookie, { title: "No longer editable" }), context(id))).status, 403);
    assert.equal((await prisma.document.findUniqueOrThrow({ where: { id } })).title, "Bob edited");
    const list = await shares.GET(request("GET", aliceCookie), context(id));
    assert.equal((await list.json()).recipients[0].permission, "VIEWER");
  });

  it("revokes access, removes shared-list visibility, and hides read/write/delete access", async () => {
    await grant("EDITOR");
    assert.equal((await revoke.DELETE(request("DELETE", aliceCookie), recipientContext(id, bobId))).status, 204);
    assert.equal((await document.GET(request("GET", bobCookie), context(id))).status, 404);
    assert.equal((await document.PATCH(request("PATCH", bobCookie, { title: "No" }), context(id))).status, 404);
    assert.equal((await document.DELETE(request("DELETE", bobCookie), context(id))).status, 404);
    const list = await documents.GET(request("GET", bobCookie));
    assert.equal((await list.json()).documents.some((doc: { id: string }) => doc.id === id), false);
    assert.equal(await prisma.documentShare.count({ where: { documentId: id } }), 0);
  });

  it("rejects duplicate creation without silently changing permission", async () => {
    await grant();
    const duplicate = await grant("EDITOR");
    assert.equal(duplicate.status, 409);
    assert.equal((await duplicate.json()).error.code, "SHARE_EXISTS");
    assert.equal(await prisma.documentShare.count({ where: { documentId: id, userId: bobId } }), 1);
    assert.equal((await prisma.documentShare.findUniqueOrThrow({ where: { documentId_userId: { documentId: id, userId: bobId } } })).permission, "VIEWER");
  });

  it("rejects self-sharing, self-permission updates, and owner revocation", async () => {
    for (const method of ["POST", "PATCH"] as const) {
      assert.equal((await shares[method](request(method, aliceCookie, { userId: aliceId, permission: "EDITOR" }), context(id))).status, 400);
    }
    assert.equal((await revoke.DELETE(request("DELETE", aliceCookie), recipientContext(id, aliceId))).status, 400);
  });

  it("denies all sharing management to viewers and editors", async () => {
    await grant();
    for (const permission of ["VIEWER", "EDITOR"]) {
      if (permission === "EDITOR") await shares.PATCH(request("PATCH", aliceCookie, { userId: bobId, permission }), context(id));
      assert.equal((await shares.GET(request("GET", bobCookie), context(id))).status, 403);
      assert.equal((await shares.POST(request("POST", bobCookie, { userId: aliceId, permission: "EDITOR" }), context(id))).status, 403);
      assert.equal((await shares.PATCH(request("PATCH", bobCookie, { userId: aliceId, permission: "EDITOR" }), context(id))).status, 403);
      assert.equal((await revoke.DELETE(request("DELETE", bobCookie), recipientContext(id, bobId))).status, 403);
    }
  });

  it("hides inaccessible documents for sharing reads and mutations", async () => {
    assert.equal((await shares.GET(request("GET", bobCookie), context(id))).status, 404);
    assert.equal((await shares.POST(request("POST", bobCookie, { userId: aliceId, permission: "VIEWER" }), context(id))).status, 404);
    assert.equal((await shares.PATCH(request("PATCH", bobCookie, { userId: aliceId, permission: "VIEWER" }), context(id))).status, 404);
    assert.equal((await revoke.DELETE(request("DELETE", bobCookie), recipientContext(id, aliceId))).status, 404);
  });

  it("rejects invalid inputs and forged owner fields", async () => {
    for (const input of [{}, { userId: "bad", permission: "VIEWER" }, { userId: bobId, permission: "ADMIN" }, { userId: bobId, permission: "VIEWER", ownerId: aliceId }]) {
      assert.equal((await shares.POST(request("POST", aliceCookie, input), context(id))).status, 400);
    }
    assert.equal((await shares.GET(request("GET", aliceCookie), context("bad"))).status, 400);
    assert.equal((await revoke.DELETE(request("DELETE", aliceCookie), recipientContext(id, "bad"))).status, 400);
  });

  it("rejects unknown or unrelated recipients without enumerating users", async () => {
    const outsider = await prisma.user.create({ data: { email: `${randomUUID()}@sharing-test.invalid`, name: "Unrelated fixture" } });
    userIds.add(outsider.id);
    for (const userId of [id, outsider.id]) {
      const response = await shares.POST(request("POST", aliceCookie, { userId, permission: "VIEWER" }), context(id));
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error.code, "INVALID_RECIPIENT");
    }
    const response = await shares.GET(request("GET", aliceCookie), context(id));
    assert.equal((await response.json()).availableRecipients.some((user: { id: string }) => user.id === outsider.id), false);
  });

  it("requires valid sessions, including expiration checks", async () => {
    assert.equal((await shares.GET(request("GET", ""), context(id))).status, 401);
    assert.equal((await shares.POST(request("POST", "", { userId: bobId, permission: "VIEWER" }), context(id))).status, 401);
    assert.equal((await shares.PATCH(request("PATCH", "", { userId: bobId, permission: "VIEWER" }), context(id))).status, 401);
    assert.equal((await revoke.DELETE(request("DELETE", ""), recipientContext(id, bobId))).status, 401);
    const now = Math.floor(Date.now() / 1000);
    const value = Buffer.from(JSON.stringify({ version: 1, userId: aliceId, email: "alice@example.com", iat: now - 100, exp: now - 1 })).toString("base64url");
    const signature = createHmac("sha256", process.env.DEMO_SESSION_SECRET!).update(value).digest("base64url");
    assert.equal((await shares.GET(request("GET", `${SESSION_COOKIE}=${value}.${signature}`), context(id))).status, 401);
  });

  it("requires same-origin requests for all sharing mutations", async () => {
    const headers = { origin: "https://evil.invalid" };
    assert.equal((await shares.POST(request("POST", aliceCookie, { userId: bobId, permission: "VIEWER" }, headers), context(id))).status, 403);
    assert.equal((await shares.PATCH(request("PATCH", aliceCookie, { userId: bobId, permission: "EDITOR" }, headers), context(id))).status, 403);
    assert.equal((await revoke.DELETE(request("DELETE", aliceCookie, undefined, headers), recipientContext(id, bobId))).status, 403);
  });

  it("reports missing shares without creating them implicitly", async () => {
    assert.equal((await shares.PATCH(request("PATCH", aliceCookie, { userId: bobId, permission: "EDITOR" }), context(id))).status, 404);
    assert.equal((await revoke.DELETE(request("DELETE", aliceCookie), recipientContext(id, bobId))).status, 404);
  });

  it("also allows Bob to share his owned document with Alice", async () => {
    const bobDocument = await fixture(bobId);
    const response = await shares.POST(request("POST", bobCookie, { userId: aliceId, permission: "EDITOR" }), context(bobDocument));
    assert.equal(response.status, 201);
    const read = await document.GET(request("GET", aliceCookie), context(bobDocument));
    assert.equal((await read.json()).document.permission, "EDITOR");
  });
});
