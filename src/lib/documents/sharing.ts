import "server-only";
import { Prisma } from "../../generated/prisma/client";
import { prisma } from "../db/prisma";
import { demoEmailSchema } from "../auth/session";
import { ApiError } from "../api/http";
import { accessibleTo } from "./queries";
import type { z } from "zod";
import type { shareInputSchema } from "./sharing-validation";

const userSelect = { id: true, name: true, email: true } as const;
const shareSelect = { userId: true, permission: true, user: { select: userSelect } } as const;
type ShareInput = z.infer<typeof shareInputSchema>;

async function requireOwner(db: Prisma.TransactionClient, id: string, userId: string) {
  const document = await db.document.findFirst({
    where: { id, ...accessibleTo(userId) }, select: { ownerId: true, owner: { select: { id: true, name: true } } },
  });
  if (!document) throw new ApiError(404, "NOT_FOUND", "Document not found.");
  if (document.ownerId !== userId) throw new ApiError(403, "FORBIDDEN", "Only the document owner can manage sharing.");
  return document.owner;
}

async function requireRecipient(db: Prisma.TransactionClient, recipientId: string, ownerId: string) {
  if (recipientId === ownerId) throw new ApiError(400, "SELF_SHARING", "You already own this document.");
  const recipient = await db.user.findFirst({ where: { id: recipientId, email: { in: demoEmailSchema.options } }, select: { id: true } });
  if (!recipient) throw new ApiError(400, "INVALID_RECIPIENT", "Choose an available demo recipient.");
}

export async function listShares(id: string, userId: string) {
  return prisma.$transaction(async (db) => {
    const owner = await requireOwner(db, id, userId);
    const recipients = await db.documentShare.findMany({
      where: { documentId: id, user: { email: { in: demoEmailSchema.options } } }, select: shareSelect, orderBy: { userId: "asc" },
    });
    const availableRecipients = await db.user.findMany({
      where: { id: { notIn: [userId, ...recipients.map((share) => share.userId)] }, email: { in: demoEmailSchema.options } },
      select: userSelect, orderBy: { email: "asc" },
    });
    return { owner, recipients, availableRecipients };
  });
}

export async function addShare(id: string, userId: string, input: ShareInput) {
  try {
    return await prisma.$transaction(async (db) => {
      await requireOwner(db, id, userId);
      await requireRecipient(db, input.userId, userId);
      return db.documentShare.create({
        data: { permission: input.permission, document: { connect: { id, ownerId: userId } }, user: { connect: { id: input.userId } } },
        select: shareSelect,
      });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") throw new ApiError(409, "SHARE_EXISTS", "This user already has access. Change their permission instead.");
      if (error.code === "P2025" || error.code === "P2003") throw new ApiError(404, "NOT_FOUND", "Document or recipient is no longer available.");
    }
    throw error;
  }
}

export async function changeShare(id: string, userId: string, input: ShareInput) {
  return prisma.$transaction(async (db) => {
    await requireOwner(db, id, userId);
    await requireRecipient(db, input.userId, userId);
    const result = await db.documentShare.updateMany({
      where: { documentId: id, userId: input.userId, document: { ownerId: userId } }, data: { permission: input.permission },
    });
    if (!result.count) throw new ApiError(404, "NOT_FOUND", "Recipient access not found.");
    return db.documentShare.findUniqueOrThrow({ where: { documentId_userId: { documentId: id, userId: input.userId } }, select: shareSelect });
  });
}

export async function revokeShare(id: string, userId: string, recipientId: string) {
  return prisma.$transaction(async (db) => {
    await requireOwner(db, id, userId);
    await requireRecipient(db, recipientId, userId);
    const result = await db.documentShare.deleteMany({ where: { documentId: id, userId: recipientId, document: { ownerId: userId } } });
    if (!result.count) throw new ApiError(404, "NOT_FOUND", "Recipient access not found.");
  });
}
