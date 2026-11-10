import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { after, afterEach, before, describe, it } from "node:test";
import nextEnv from "@next/env";
import { NextRequest } from "next/server";

nextEnv.loadEnvConfig(process.cwd());
process.env.DEMO_SESSION_SECRET = randomBytes(32).toString("hex");
process.env.APP_ORIGIN = "http://localhost:3000";
const { prisma } = await import("../../src/lib/db/prisma");
const session = await import("../../src/app/api/demo/session/route");
const imports = await import("../../src/app/api/documents/import/route");
const { SESSION_COOKIE } = await import("../../src/lib/auth/session");
const { contentSchema } = await import("../../src/lib/documents/validation");
const { MAX_UPLOAD_BYTES } = await import("../../src/lib/documents/import-options");
const origin = "http://localhost:3000";

function form(name = "Notes.txt", content: BlobPart = "First line\nSecond line\n\nAnother paragraph") {
  const data = new FormData();
  data.append("file", new File([content], name, { type: "application/octet-stream" }));
  return data;
}

describe("Document file import API", { concurrency: false }, () => {
  let cookie: string;
  let aliceId: string;
  const ids = new Set<string>();
  before(async () => {
    aliceId = (await prisma.user.findUniqueOrThrow({ where: { email: "alice@example.com" } })).id;
    const response = await session.POST(new NextRequest(`${origin}/api/demo/session`, {
      method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ email: "alice@example.com" }),
    }));
    assert.equal(response.status, 200);
    cookie = response.headers.get("set-cookie")!.split(";")[0];
  });
  afterEach(async () => { await prisma.document.deleteMany({ where: { id: { in: [...ids] } } }); ids.clear(); });
  after(async () => { await prisma.$disconnect(); });

  async function upload(data: BodyInit = form(), currentCookie = cookie, headers: Record<string, string> = {}) {
    const request = new NextRequest(`${origin}/api/documents/import`, { method: "POST", headers: { origin, ...(currentCookie ? { cookie: currentCookie } : {}), ...headers }, body: data });
    const response = await imports.POST(request);
    if (response.status === 201) {
      const result = await response.clone().json() as { document: { id: string } };
      ids.add(result.document.id);
    }
    return response;
  }
  async function expectStatus(response: Response, status: number) {
    assert.equal(response.status, status);
    assert.equal(response.headers.get("cache-control"), "no-store");
    if (status !== 201) assert.equal(typeof (await response.json()).error.message, "string");
  }

  it("imports TXT with current ownership, paragraph/line breaks, and persisted valid JSON", async () => {
    const response = await upload();
    await expectStatus(response, 201);
    const { document } = await response.json();
    assert.equal(document.title, "Notes");
    assert.equal(document.ownerId, aliceId);
    assert.equal(document.permission, "OWNER");
    assert.equal(document.relationship, "owned");
    assert.equal("content" in document, false);
    const saved = await prisma.document.findUniqueOrThrow({ where: { id: document.id } });
    assert.equal(contentSchema.safeParse(saved.content).success, true);
    assert.deepEqual(saved.content, { type: "doc", content: [
      { type: "paragraph", content: [{ type: "text", text: "First line" }, { type: "hardBreak" }, { type: "text", text: "Second line" }] },
      { type: "paragraph", content: [{ type: "text", text: "Another paragraph" }] },
    ] });
  });

  it("imports Markdown headings, bold/italic text, lists, and code", async () => {
    const response = await upload(form(" Plan.MD", "# Heading\n\nA **bold** and *italic* idea.\n\n- One\n- Two\n\n1. First\n2. Next\n\n```js\nconst x = 1\n```"));
    await expectStatus(response, 201);
    const { document } = await response.json();
    assert.equal(document.title, "Plan");
    const saved = await prisma.document.findUniqueOrThrow({ where: { id: document.id } });
    assert.equal(contentSchema.safeParse(saved.content).success, true);
    const serialized = JSON.stringify(saved.content);
    for (const type of ["heading", "bold", "italic", "bulletList", "orderedList", "codeBlock"]) assert.ok(serialized.includes(`"${type}"`));
  });

  it("rejects missing or expired sessions", async () => {
    await expectStatus(await upload(form(), ""), 401);
    const now = Math.floor(Date.now() / 1000);
    const payload = Buffer.from(JSON.stringify({ version: 1, userId: aliceId, email: "alice@example.com", iat: now - 120, exp: now - 60 })).toString("base64url");
    const signature = createHmac("sha256", process.env.DEMO_SESSION_SECRET!).update(payload).digest("base64url");
    await expectStatus(await upload(form(), `${SESSION_COOKIE}=${payload}.${signature}`), 401);
  });

  it("rejects cross-origin requests", async () => {
    await expectStatus(await upload(form(), cookie, { origin: "https://evil.invalid" }), 403);
  });

  it("rejects unsupported file types regardless of MIME", async () => {
    const data = new FormData();
    data.append("file", new File(["plain text"], "script.exe", { type: "text/plain" }));
    await expectStatus(await upload(data), 400);
  });

  it("rejects missing files, multiple files, text fields, and client ownership", async () => {
    await expectStatus(await upload(new FormData()), 400);
    const multiple = form(); multiple.append("file", new File(["text"], "Second.md"));
    await expectStatus(await upload(multiple), 400);
    const text = new FormData(); text.append("file", "Not a file");
    await expectStatus(await upload(text), 400);
    const forged = form(); forged.append("ownerId", "another-user");
    await expectStatus(await upload(forged), 400);
  });

  it("rejects empty and whitespace-only files", async () => {
    await expectStatus(await upload(form("Empty.txt", "")), 400);
    await expectStatus(await upload(form("Blank.md", " \r\n\t")), 400);
  });

  it("rejects invalid UTF-8 and binary null bytes", async () => {
    await expectStatus(await upload(form("Bad.txt", new Uint8Array([0xc3, 0x28]))), 400);
    await expectStatus(await upload(form("Binary.txt", "text\0text")), 400);
  });

  it("rejects files larger than 1 MB", async () => {
    await expectStatus(await upload(form("Large.txt", new Uint8Array(MAX_UPLOAD_BYTES + 1))), 413);
  });

  it("rejects oversized declared and streamed multipart bodies", async () => {
    await expectStatus(await upload("x", cookie, { "content-type": "multipart/form-data; boundary=x", "content-length": String(MAX_UPLOAD_BYTES + 65537) }), 413);
    await expectStatus(await upload("x".repeat(MAX_UPLOAD_BYTES + 65537), cookie, { "content-type": "multipart/form-data; boundary=x", "content-length": "1" }), 413);
  });

  it("rejects malformed multipart input", async () => {
    await expectStatus(await upload("not multipart", cookie, { "content-type": "multipart/form-data; boundary=missing" }), 400);
    await expectStatus(await upload("{}", cookie, { "content-type": "application/json" }), 400);
  });

  it("rejects excessive generated JSON and node counts", async () => {
    await expectStatus(await upload(form("LongLine.txt", "x".repeat(100_001))), 413);
    await expectStatus(await upload(form("Big.txt", "x".repeat(270_000))), 413);
    await expectStatus(await upload(form("Many.txt", "paragraph\n\n".repeat(2001))), 413);
  });

  it("treats HTML/scripts as literal text without HTML, links, or image nodes", async () => {
    const source = '<script>alert("x")</script>\n\n<img src=x onerror=alert(1)>\n\n[Label](https://example.com) ![alt](https://example.com/image.png)';
    const response = await upload(form("Safe.md", source));
    await expectStatus(response, 201);
    const { document } = await response.json();
    const saved = await prisma.document.findUniqueOrThrow({ where: { id: document.id } });
    assert.equal(contentSchema.safeParse(saved.content).success, true);
    const serialized = JSON.stringify(saved.content);
    assert.ok(serialized.includes("<script>"));
    assert.ok(!serialized.includes('"type":"image"'));
    assert.ok(!serialized.includes('"type":"html"'));
    assert.ok(!serialized.includes('"type":"link"'));
    assert.ok(!serialized.includes("https://example.com"));
  });

  it("sanitizes filename titles and rejects names that cannot produce valid titles", async () => {
    const response = await upload(form("  <Notes>.txt", "text"));
    await expectStatus(response, 201);
    assert.equal((await response.json()).document.title, "Notes");
    await expectStatus(await upload(form(".md", "text")), 400);
    await expectStatus(await upload(form(`${"x".repeat(201)}.txt`, "text")), 400);
  });
});
