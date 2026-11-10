import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { MAX_BODY_BYTES } from "./limits";

export { MAX_BODY_BYTES } from "./limits";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export async function handleApi(work: () => Promise<Response>): Promise<Response> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ApiError) {
      return json({ error: { code: error.code, message: error.message } }, error.status);
    }
    if (error instanceof z.ZodError) {
      return json({ error: { code: "INVALID_INPUT", message: "Invalid request data." } }, 400);
    }
    // Driver errors can contain connection details. Never serialize or log them.
    console.error("API request failed unexpectedly.");
    return json({ error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." } }, 500);
  }
}

export function requireSameOrigin(request: NextRequest) {
  const expected = new URL(process.env.APP_ORIGIN ?? request.url).origin;
  const origin = request.headers.get("origin");
  if (origin !== expected || request.headers.get("sec-fetch-site") === "cross-site") {
    throw new ApiError(403, "INVALID_ORIGIN", "A same-origin request is required.");
  }
}

export async function readJson(request: NextRequest): Promise<unknown> {
  const length = request.headers.get("content-length");
  if (length !== null) {
    if (!/^\d+$/.test(length)) throw new ApiError(400, "INVALID_BODY", "Invalid content length.");
    if (Number(length) > MAX_BODY_BYTES) throw new ApiError(413, "PAYLOAD_TOO_LARGE", "Request body is too large.");
  }
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new ApiError(400, "INVALID_BODY", "Expected an application/json request body.");
  }
  if (!request.body) throw new ApiError(400, "INVALID_JSON", "A JSON body is required.");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new ApiError(413, "PAYLOAD_TOO_LARGE", "Request body is too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    const bytes = Buffer.concat(chunks);
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new ApiError(400, "INVALID_JSON", "Invalid JSON request body.");
  }
}
