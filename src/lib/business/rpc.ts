import type { SupabaseClient } from "@supabase/supabase-js";

export class RpcError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "RpcError";
    this.code = code;
  }
}

export function getErrorMessage(error: unknown, fallback = "Something went wrong."): string {
  if (!error) return fallback;
  if (typeof error === "string") return error || fallback;
  if (error instanceof Error) return error.message || fallback;
  if (typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  return fallback;
}

/** Calls a Postgres function through PostgREST and surfaces its message. */
export async function callRpc<T = unknown>(
  client: SupabaseClient,
  name: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await client.rpc(name, args ?? {});
  if (error) throw new RpcError(error.message, error.code);
  return data as T;
}

export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
