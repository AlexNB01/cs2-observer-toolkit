const BASE = "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // Only set Content-Type when there's actually a body — Fastify's JSON
  // body parser rejects a request that declares application/json but sends
  // an empty body (FST_ERR_CTP_EMPTY_JSON_BODY), which broke every
  // zero-argument api.post() call (calibrate, install buttons, etc.)
  // before it ever reached the route handler.
  const headers = init?.body ? { "Content-Type": "application/json", ...init?.headers } : init?.headers;
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers,
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => undefined);
  if (!res.ok) {
    const message = (body && (body as { error?: string }).error) || res.statusText;
    throw new Error(message);
  }
  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, data?: unknown) => request<T>(path, { method: "POST", body: data ? JSON.stringify(data) : undefined }),
  put: <T>(path: string, data?: unknown) => request<T>(path, { method: "PUT", body: data ? JSON.stringify(data) : undefined }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

export class NotImplementedError extends Error {}
