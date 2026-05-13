export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown, message?: string) {
    super(message ?? `API request failed with status ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

type Json = Record<string, unknown> | unknown[];
type Body =
  | Json
  | string
  | FormData
  | Blob
  | URLSearchParams
  | ArrayBuffer
  | null
  | undefined;

function isRawBody(body: unknown): body is BodyInit {
  return (
    typeof body === "string" ||
    body instanceof FormData ||
    body instanceof Blob ||
    body instanceof URLSearchParams ||
    body instanceof ArrayBuffer
  );
}

function joinUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_BASE_URL}${path.startsWith("/") ? "" : "/"}${path}`;
}

async function parseResponseBody(res: Response): Promise<unknown> {
  if (res.status === 204) return undefined;
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    // Empty body with JSON content-type — guard against parse errors.
    const text = await res.text();
    return text ? JSON.parse(text) : undefined;
  }
  return res.text();
}

async function request<T>(
  method: string,
  path: string,
  body?: Body,
  init?: RequestInit,
): Promise<T> {
  const headers = new Headers(init?.headers);

  let resolvedBody: BodyInit | null | undefined;
  if (body === undefined || body === null) {
    resolvedBody = undefined;
  } else if (isRawBody(body)) {
    resolvedBody = body;
  } else {
    if (!headers.has("Content-Type"))
      headers.set("Content-Type", "application/json");
    resolvedBody = JSON.stringify(body);
  }

  if (!headers.has("Accept")) headers.set("Accept", "application/json");

  const res = await fetch(joinUrl(path), {
    credentials: "include",
    ...init,
    method,
    headers,
    body: resolvedBody,
  });

  const parsed = await parseResponseBody(res);

  if (!res.ok) {
    throw new ApiError(res.status, parsed, res.statusText);
  }

  return parsed as T;
}

export const api = {
  get: <T>(path: string, init?: RequestInit) =>
    request<T>("GET", path, undefined, init),
  post: <T>(path: string, body?: Body, init?: RequestInit) =>
    request<T>("POST", path, body, init),
  put: <T>(path: string, body?: Body, init?: RequestInit) =>
    request<T>("PUT", path, body, init),
  patch: <T>(path: string, body?: Body, init?: RequestInit) =>
    request<T>("PATCH", path, body, init),
  delete: <T>(path: string, init?: RequestInit) =>
    request<T>("DELETE", path, undefined, init),
};
