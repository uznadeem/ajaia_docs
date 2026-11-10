import type { NextRequest } from "next/server";
import { handleApi, json, readJson, requireSameOrigin } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/session";
import { documentIdSchema } from "@/lib/documents/validation";
import { shareInputSchema } from "@/lib/documents/sharing-validation";
import { addShare, changeShare, listShares } from "@/lib/documents/sharing";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
  return handleApi(async () => {
    const user = await requireUser(request);
    const id = documentIdSchema.parse((await context.params).id);
    return json(await listShares(id, user.id));
  });
}

export async function POST(request: NextRequest, context: Context) {
  return handleApi(async () => {
    const user = await requireUser(request);
    requireSameOrigin(request);
    const id = documentIdSchema.parse((await context.params).id);
    const input = shareInputSchema.parse(await readJson(request));
    return json({ share: await addShare(id, user.id, input) }, 201);
  });
}

export async function PATCH(request: NextRequest, context: Context) {
  return handleApi(async () => {
    const user = await requireUser(request);
    requireSameOrigin(request);
    const id = documentIdSchema.parse((await context.params).id);
    const input = shareInputSchema.parse(await readJson(request));
    return json({ share: await changeShare(id, user.id, input) });
  });
}
