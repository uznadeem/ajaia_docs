import { NextResponse, type NextRequest } from "next/server";
import { handleApi, json, readJson, requireSameOrigin, ApiError } from "@/lib/api/http";
import { createSession, requireUser, sessionInputSchema, setSessionCookie } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";

export async function GET(request: NextRequest) {
  return handleApi(async () => json({ user: await requireUser(request) }));
}

export async function POST(request: NextRequest) {
  return handleApi(async () => {
    requireSameOrigin(request);
    const { email } = sessionInputSchema.parse(await readJson(request));
    const user = await prisma.user.findUnique({
      where: { email }, select: { id: true, name: true, email: true },
    });
    if (!user) throw new ApiError(401, "UNAUTHORIZED", "Demo user is unavailable.");
    const response = json({ user });
    setSessionCookie(response, createSession({ id: user.id, email }));
    return response;
  });
}

export async function DELETE(request: NextRequest) {
  return handleApi(async () => {
    requireSameOrigin(request);
    // Clearing an expired or malformed cookie is also allowed.
    const response = new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
    setSessionCookie(response, "", true);
    return response;
  });
}
