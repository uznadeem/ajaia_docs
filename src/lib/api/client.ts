export class RequestError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function requestApi<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    cache: "no-store",
    headers: { ...(options.body && !(options.body instanceof FormData) ? { "Content-Type": "application/json" } : {}), ...options.headers },
  });
  if (!response.ok) {
    if (response.status === 400 || response.status === 409 || response.status === 413) {
      const failure = await response.json().catch(() => null) as { error?: { message?: unknown } } | null;
      if (typeof failure?.error?.message === "string") throw new RequestError(response.status, failure.error.message);
    }
    if (response.status === 401) throw new RequestError(401, "Your demo session expired. Choose a user to continue.");
    if (response.status === 403) throw new RequestError(403, "You no longer have permission for this action. Your access may have changed.");
    if (response.status === 404) throw new RequestError(404, "This document was deleted or is no longer available to you.");
    throw new RequestError(response.status, "The request could not be completed. Please try again.");
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function requestErrorMessage(error: unknown) {
  return error instanceof RequestError ? error.message : "Could not connect. Check your connection and try again.";
}
