import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "../db/prisma";
import { ApiError } from "../api/http";

export const SESSION_COOKIE = "ajaia_demo_session";
export const SESSION_SECONDS = 8 * 60 * 60;
export const demoEmailSchema = z.enum(["alice@example.com", "bob@example.com"]);
export const sessionInputSchema = z.strictObject({ email: demoEmailSchema });
const payloadSchema = z.strictObject({
  version: z.literal(1),
  userId: z.string().min(1).max(100),
  email: demoEmailSchema,
  iat: z.number().int().nonnegative(),
  exp: z.number().int().positive(),
});

function secret() {
  const value = process.env.DEMO_SESSION_SECRET;
  if (!value || Buffer.byteLength(value) < 32) {
    throw new Error("DEMO_SESSION_SECRET must contain at least 32 bytes.");
  }
  return value;
}

export function createSession(user: { id: string; email: z.infer<typeof demoEmailSchema> }) {
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    version: 1, userId: user.id, email: user.email, iat: now, exp: now + SESSION_SECONDS,
  })).toString("base64url");
  const signature = createHmac("sha256", secret()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export async function requireUser(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const unauthorized = () => new ApiError(401, "UNAUTHORIZED", "A valid demo session is required.");
  if (!token || token.length > 2048) throw unauthorized();
  const parts = token.split(".");
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[1])) {
    throw unauthorized();
  }
  const expected = createHmac("sha256", secret()).update(parts[0]).digest();
  const actual = Buffer.from(parts[1], "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw unauthorized();

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
  } catch {
    throw unauthorized();
  }
  const parsed = payloadSchema.safeParse(decoded);
  if (!parsed.success) throw unauthorized();
  const { userId, email, exp, iat } = parsed.data;
  const now = Math.floor(Date.now() / 1000);
  if (exp <= now || iat > now || exp <= iat || exp - iat > SESSION_SECONDS) throw unauthorized();
  const user = await prisma.user.findFirst({
    where: { id: userId, email },
    select: { id: true, name: true, email: true },
  });
  if (!user) throw unauthorized();
  return user;
}

export function setSessionCookie(response: NextResponse, token: string, clear = false) {
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: clear ? 0 : SESSION_SECONDS,
    ...(clear ? { expires: new Date(0) } : {}),
  });
}
