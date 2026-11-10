import "server-only";
import type { Prisma, Permission } from "../../generated/prisma/client";
import { prisma } from "../db/prisma";
import { ApiError } from "../api/http";

export function accessibleTo(userId: string): Prisma.DocumentWhereInput {
  return { OR: [{ ownerId: userId }, { shares: { some: { userId } } }] };
}

function editableBy(userId: string): Prisma.DocumentWhereInput {
  return { OR: [{ ownerId: userId }, { shares: { some: { userId, permission: "EDITOR" } } }] };
}

export function metadataSelect(userId: string) {
  return {
    id: true, title: true, ownerId: true, createdAt: true, updatedAt: true,
    owner: { select: { id: true, name: true } },
    shares: { where: { userId }, select: { permission: true } },
  } satisfies Prisma.DocumentSelect;
}

type DocumentMetadata = Prisma.DocumentGetPayload<{ select: ReturnType<typeof metadataSelect> }>;

export function documentDto<T extends DocumentMetadata>(document: T, userId: string) {
  const { shares, ...data } = document;
  const owned = document.ownerId === userId;
  // A share may have been revoked between relation reads. Fail closed.
  if (!owned && !shares[0]) throw new ApiError(404, "NOT_FOUND", "Document not found.");
  const permission: "OWNER" | Permission = owned ? "OWNER" : shares[0].permission;
  return {
    ...data,
    relationship: owned ? "owned" as const : "shared" as const,
    permission,
  };
}

export async function getDocument(id: string, userId: string) {
  const document = await prisma.document.findFirst({
    where: { id, ...accessibleTo(userId) },
    select: { ...metadataSelect(userId), content: true },
  });
  if (!document) throw new ApiError(404, "NOT_FOUND", "Document not found.");
  return documentDto(document, userId);
}

async function denyWrite(id: string, userId: string): Promise<never> {
  // Only distinguish read-only access after checking visibility.
  const document = await prisma.document.findFirst({
    where: { id, ...accessibleTo(userId) },
    select: { id: true },
  });
  if (!document) throw new ApiError(404, "NOT_FOUND", "Document not found.");
  throw new ApiError(403, "FORBIDDEN", "You do not have permission for this operation.");
}

export async function updateDocument(id: string, userId: string, data: Prisma.DocumentUpdateManyMutationInput) {
  // The write itself checks current permissions, rather than relying on an earlier read.
  const result = await prisma.document.updateMany({ where: { id, ...editableBy(userId) }, data });
  if (result.count === 0) return denyWrite(id, userId);
  return getDocument(id, userId);
}

export async function deleteDocument(id: string, userId: string) {
  const result = await prisma.document.deleteMany({ where: { id, ownerId: userId } });
  if (result.count === 0) await denyWrite(id, userId);
}
