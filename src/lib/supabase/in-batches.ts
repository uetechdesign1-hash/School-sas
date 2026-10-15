/**
 * PostgREST `in.()` filters travel inside the request URL, so a few hundred
 * UUIDs (~37 chars each) push the query string past the URL/header limits of
 * browsers and proxies. The server then rejects the request with a plain-text
 * `400 Bad Request` body, which postgrest-js cannot JSON-parse and surfaces
 * as the opaque `message: "Bad Request"` — seen on the Receipt history screen
 * once a school collected 600+ fee payments.
 *
 * `inBatches` splits the id list into fixed-size batches (default 100 ids ≈
 * 4-5 KB per URL, safely under the common 8 KB request-line limit), runs the
 * batches in parallel and merges the rows, so callers keep the exact
 * single-query semantics: `{ data, error }` with the first failure reported.
 */

import type { PostgrestErrorLike } from "./postgrest-errors";

/** 100 UUIDs ≈ 3.7 KB + filter/column overhead stays well below 8 KB. */
export const IN_BATCH_SIZE = 100;

export type InBatchesResult<TRow> = {
  data: TRow[] | null;
  error: PostgrestErrorLike | null;
};

type InBatchesBatchResult<TRow> = {
  data?: TRow[] | null;
  error?: PostgrestErrorLike | null;
};

export async function inBatches<TRow>(
  ids: Array<string | null | undefined>,
  runBatch: (
    batch: string[],
  ) => PromiseLike<InBatchesBatchResult<TRow>>,
  batchSize: number = IN_BATCH_SIZE,
): Promise<InBatchesResult<TRow>> {
  const uniqueIds = Array.from(
    new Set(ids.filter((id): id is string => Boolean(id))),
  );

  if (uniqueIds.length === 0) return { data: [], error: null };

  const batches: string[][] = [];
  for (let index = 0; index < uniqueIds.length; index += batchSize) {
    batches.push(uniqueIds.slice(index, index + batchSize));
  }

  const results = await Promise.all(batches.map((batch) => runBatch(batch)));

  const rows: TRow[] = [];
  for (const result of results) {
    if (result.error) return { data: null, error: result.error };

    rows.push(...(result.data || []));
  }

  return { data: rows, error: null };
}
