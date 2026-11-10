import type { requireUser } from "../auth/session";
import type { getDocument } from "../documents/queries";
import type { Prisma } from "../../generated/prisma/client";

// Type-only imports keep database/authentication code out of the browser bundle.
export type SessionUser = Awaited<ReturnType<typeof requireUser>>;
export type DocumentSummary = Omit<Awaited<ReturnType<typeof getDocument>>, "content" | "createdAt" | "updatedAt"> & {
  createdAt: string;
  updatedAt: string;
};
export type SessionResponse = { user: SessionUser };
export type DocumentsResponse = { documents: DocumentSummary[] };
export type DocumentResponse = { document: DocumentSummary & { content: Prisma.JsonValue } };
