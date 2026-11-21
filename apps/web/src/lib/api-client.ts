import { type AppError, appError, type Result } from "@runelay/shared";

export class ApiError extends Error {
  readonly code: AppError["code"];
  readonly status: number;

  constructor(error: AppError) {
    super(error.message);
    this.code = error.code;
    this.status = error.status;
  }
}

const request = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
  const response = await fetch(`/v1${path}`, {
    method,
    credentials: "include",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => null)) as Result<T> | null;
  if (!payload) throw new ApiError(appError("INTERNAL"));
  if (payload.error) throw new ApiError(payload.error);
  return payload.data;
};

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
  put: <T>(path: string, body: unknown) => request<T>("PUT", path, body),
  delete: <T>(path: string) => request<T>("DELETE", path),
};
