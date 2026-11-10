import { NextResponse, type NextRequest } from "next/server";
import { handleApi, json, readJson, requireSameOrigin } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/session";
import { deleteDocument, getDocument, updateDocument } from "@/lib/documents/queries";
import { documentIdSchema, updateDocumentSchema } from "@/lib/documents/validation";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
  return handleApi(async () => {
    const user = await requireUser(request);
    const id = documentIdSchema.parse((await context.params).id);
    return json({ document: await getDocument(id, user.id) });
  });
}

export async function PATCH(request: NextRequest, context: Context) {
  return handleApi(async () => {
    const user = await requireUser(request);
    requireSameOrigin(request);
    const id = documentIdSchema.parse((await context.params).id);
    const input = updateDocumentSchema.parse(await readJson(request));
    return json({ document: await updateDocument(id, user.id, input) });
  });
}

export async function DELETE(request: NextRequest, context: Context) {
  return handleApi(async () => {
    const user = await requireUser(request);
    requireSameOrigin(request);
    const id = documentIdSchema.parse((await context.params).id);
    await deleteDocument(id, user.id);
    return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  });
}
