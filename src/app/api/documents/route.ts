import type { NextRequest } from "next/server";
import { handleApi, json, readJson, requireSameOrigin } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { accessibleTo, documentDto, metadataSelect } from "@/lib/documents/queries";
import { createDocumentSchema, emptyDocument } from "@/lib/documents/validation";


export async function GET(request: NextRequest) {
  return handleApi(async () => {
    const user = await requireUser(request);
    const documents = await prisma.document.findMany({
      where: accessibleTo(user.id),
      select: metadataSelect(user.id),
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    });
    return json({ documents: documents.map((document) => documentDto(document, user.id)) });
  });
}

export async function POST(request: NextRequest) {
  return handleApi(async () => {
    const user = await requireUser(request);
    requireSameOrigin(request);
    const input = createDocumentSchema.parse(await readJson(request));
    const document = await prisma.document.create({
      data: { title: input.title ?? "Untitled document", content: emptyDocument, ownerId: user.id },
      select: { ...metadataSelect(user.id), content: true },
    });
    return json({ document: documentDto(document, user.id) }, 201);
  });
}
