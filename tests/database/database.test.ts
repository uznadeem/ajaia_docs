import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, afterEach, beforeEach, describe, it } from "node:test";
import nextEnv from "@next/env";
import { Prisma, type User } from "../../src/generated/prisma/client";
import { createPrismaClient } from "../../src/lib/db/client";
import { seedUsers } from "../../prisma/seed-users";

nextEnv.loadEnvConfig(process.cwd());
const db = createPrismaClient();

const richText = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Hello, 世界", marks: [{ type: "bold" }] },
      ],
    },
  ],
} satisfies Prisma.InputJsonObject;

function hasPrismaCode(code: string) {
  return (error: unknown) =>
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}

describe("PostgreSQL database foundation", { concurrency: false }, () => {
  let owner: User;
  let recipient: User;
  let fixtureEmails: string[] = [];

  beforeEach(async () => {
    const runId = randomUUID();
    fixtureEmails = ["owner", "recipient", "seed-alice", "seed-bob"].map(
      (name) => `${name}-${runId}@ajaia-test.invalid`,
    );
    owner = await db.user.create({
      data: { name: "Test owner", email: fixtureEmails[0] },
    });
    recipient = await db.user.create({
      data: { name: "Test recipient", email: fixtureEmails[1] },
    });
  });

  afterEach(async () => {
    // Exact per-test emails only. Related fixtures are removed by FK cascades.
    await db.user.deleteMany({ where: { email: { in: fixtureEmails } } });
  });

  after(async () => {
    await db.$disconnect();
  });

  async function createDocument() {
    return db.document.create({
      data: { title: "Integration test", content: richText, ownerId: owner.id },
    });
  }

  it("rejects duplicate user emails", async () => {
    await assert.rejects(
      db.user.create({ data: { name: "Duplicate", email: owner.email } }),
      hasPrismaCode("P2002"),
    );
    assert.equal(await db.user.count({ where: { email: owner.email } }), 1);
  });

  it("persists ownership and supports owner-scoped queries", async () => {
    const document = await createDocument();
    const saved = await db.document.findUniqueOrThrow({
      where: { id: document.id },
      include: { owner: true },
    });
    assert.equal(saved.owner.id, owner.id);
    const user = await db.user.findUniqueOrThrow({
      where: { id: owner.id },
      include: { ownedDocuments: true },
    });
    assert.deepEqual(user.ownedDocuments.map(({ id }) => id), [document.id]);
    assert.equal(await db.document.count({ where: { ownerId: recipient.id } }), 0);
    assert.ok(saved.createdAt instanceof Date);
    assert.ok(saved.updatedAt instanceof Date);
  });

  it("round-trips nested Tiptap JSON and persists updates", async () => {
    const document = await createDocument();
    const saved = await db.document.findUniqueOrThrow({ where: { id: document.id } });
    assert.deepEqual(saved.content, richText);
    const content = { type: "doc", content: [{ type: "paragraph" }] };
    await db.document.update({ where: { id: document.id }, data: { content } });
    const updated = await db.document.findUniqueOrThrow({ where: { id: document.id } });
    assert.deepEqual(updated.content, content);
    assert.ok(updated.updatedAt >= saved.updatedAt);
  });

  it("enforces one share per document and user and persists permissions", async () => {
    const document = await createDocument();
    const share = await db.documentShare.create({
      data: { documentId: document.id, userId: recipient.id, permission: "VIEWER" },
    });
    await assert.rejects(
      db.documentShare.create({
        data: { documentId: document.id, userId: recipient.id, permission: "EDITOR" },
      }),
      hasPrismaCode("P2002"),
    );
    await db.documentShare.update({ where: { id: share.id }, data: { permission: "EDITOR" } });
    const user = await db.user.findUniqueOrThrow({
      where: { id: recipient.id },
      include: { receivedShares: { include: { document: true } } },
    });
    assert.equal(user.receivedShares.length, 1);
    assert.equal(user.receivedShares[0].permission, "EDITOR");
    assert.equal(user.receivedShares[0].document.id, document.id);
  });

  it("rejects documents with nonexistent owners", async () => {
    await assert.rejects(
      db.document.create({
        data: { title: "Invalid owner", content: richText, ownerId: randomUUID() },
      }),
      hasPrismaCode("P2003"),
    );
  });

  it("rejects shares with nonexistent documents or users", async () => {
    const document = await createDocument();
    await assert.rejects(
      db.documentShare.create({
        data: { documentId: randomUUID(), userId: recipient.id, permission: "VIEWER" },
      }),
      hasPrismaCode("P2003"),
    );
    await assert.rejects(
      db.documentShare.create({
        data: { documentId: document.id, userId: randomUUID(), permission: "VIEWER" },
      }),
      hasPrismaCode("P2003"),
    );
  });

  it("deleting a document cascades shares and preserves its users", async () => {
    const document = await createDocument();
    const share = await db.documentShare.create({
      data: { documentId: document.id, userId: recipient.id, permission: "VIEWER" },
    });
    await db.document.delete({ where: { id: document.id } });
    assert.equal(await db.documentShare.findUnique({ where: { id: share.id } }), null);
    assert.equal(await db.user.count({ where: { id: { in: [owner.id, recipient.id] } } }), 2);
  });

  it("deleting a recipient cascades their shares but preserves the document", async () => {
    const document = await createDocument();
    const share = await db.documentShare.create({
      data: { documentId: document.id, userId: recipient.id, permission: "EDITOR" },
    });
    await db.user.delete({ where: { id: recipient.id } });
    assert.equal(await db.documentShare.findUnique({ where: { id: share.id } }), null);
    assert.ok(await db.document.findUnique({ where: { id: document.id } }));
    assert.ok(await db.user.findUnique({ where: { id: owner.id } }));
  });

  it("deleting an owner cascades owned documents and their shares", async () => {
    const document = await createDocument();
    const share = await db.documentShare.create({
      data: { documentId: document.id, userId: recipient.id, permission: "EDITOR" },
    });
    await db.user.delete({ where: { id: owner.id } });
    assert.equal(await db.document.findUnique({ where: { id: document.id } }), null);
    assert.equal(await db.documentShare.findUnique({ where: { id: share.id } }), null);
    assert.ok(await db.user.findUnique({ where: { id: recipient.id } }));
  });

  it("seeding is idempotent and preserves existing users", async () => {
    const users = [
      { name: "Alice Demo", email: fixtureEmails[2] },
      { name: "Bob Demo", email: fixtureEmails[3] },
    ];
    const first = await seedUsers(db, users);
    const second = await seedUsers(db, users);
    assert.deepEqual(second, first);
    assert.equal(await db.user.count({ where: { email: { in: users.map(({ email }) => email) } } }), 2);
    assert.deepEqual(await db.user.findUniqueOrThrow({ where: { id: owner.id } }), owner);
    await db.user.update({ where: { id: first[0].id }, data: { name: "Edited name" } });
    await seedUsers(db, users);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: first[0].id } })).name, "Edited name");
  });
});
