/**
 * Helpers that turn PostgREST / Postgres failures into messages an
 * administrator can act on.
 *
 * PostgREST reports schema drift instead of a plain Postgres error:
 *
 *   PGRST204: "Could not find the 'notes' column of 'vendors' in the schema
 *             cache" -> a migration that adds the column was never applied
 *   PGRST202: "Could not find the function public.record_purchase_return(...)
 *             in the schema cache" -> the RPC migration was never applied
 *
 * Both messages hide the fix behind opaque wording, so screens read the code
 * and the reported column / function here instead of printing the raw error.
 */

export type PostgrestErrorLike = {
  message?: string | null;
  code?: string | null;
  details?: string | null;
  hint?: string | null;
};

function errorLike(error: unknown): PostgrestErrorLike | null {
  return error && typeof error === "object"
    ? (error as PostgrestErrorLike)
    : null;
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message || "";

  const like = errorLike(error);

  return typeof like?.message === "string" ? like.message : "";
}

/**
 * Error text with the PostgREST code, details and hint appended. Postgres puts
 * the actionable instruction in `hint` far more often than in `message`.
 */
export function errorText(error: unknown, fallback: string): string {
  const message = messageOf(error).trim() || fallback;
  const like = errorLike(error);

  if (!like) return message;

  const extra = [like.code, like.details, like.hint]
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter((part) => part && !message.includes(part));

  return extra.length ? `${message} (${extra.join("; ")})` : message;
}

/**
 * Column name reported by a missing-column error, or null when the failure is
 * something else. Covers the PostgREST schema-cache error (PGRST204, what the
 * Data API returns for a column it cannot see) and the underlying Postgres
 * undefined_column error (42703).
 */
export function missingColumn(error: unknown): string | null {
  const like = errorLike(error);

  if (!like) return null;

  const message = messageOf(error);

  if (
    like.code === "PGRST204" ||
    /Could not find the '[^']+' column/.test(message)
  ) {
    return /'([^']+)' column/.exec(message)?.[1] || null;
  }

  if (like.code === "42703" || /column .+ does not exist/.test(message)) {
    return /column "([^"]+)"/.exec(message)?.[1] || null;
  }

  return null;
}

/** True when the called RPC is not in the PostgREST schema cache yet. */
export function missingFunction(error: unknown): boolean {
  const like = errorLike(error);

  if (!like) return false;

  if (like.code === "PGRST202" || like.code === "PGRST203") return true;

  return /Could not find the function/i.test(messageOf(error));
}
