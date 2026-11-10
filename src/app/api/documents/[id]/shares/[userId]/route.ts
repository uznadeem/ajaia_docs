import { NextResponse, type NextRequest } from "next/server";
import { handleApi, requireSameOrigin } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/session";
import { documentIdSchema } from "@/lib/documents/validation";
import { recipientIdSchema } from "@/lib/documents/sharing-validation";
import { revokeShare } from "@/lib/documents/sharing";

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string; userId: string }> }) {
  return handleApi(async () => {
    const user = await requireUser(request);
    requireSameOrigin(request);
    const params = await context.params;
    await revokeShare(documentIdSchema.parse(params.id), user.id, recipientIdSchema.parse(params.userId));
    return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  });
}
