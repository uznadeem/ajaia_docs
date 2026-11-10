import type { NextRequest } from "next/server";
import { handleApi, json, requireSameOrigin } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { documentDto, metadataSelect } from "@/lib/documents/queries";
import { convertImport, readImportFile } from "@/lib/documents/import-file";

export async function POST(request: NextRequest) {
  return handleApi(async () => {
    const user = await requireUser(request);
    requireSameOrigin(request);
    const input = await convertImport(await readImportFile(request));
    const document = await prisma.document.create({ data: { ...input, ownerId: user.id }, select: metadataSelect(user.id) });
    return json({ document: documentDto(document, user.id) }, 201);
  });
}
