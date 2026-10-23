/**
 * Paginated PostgREST read that bypasses the 1,000-row max-rows cap.
 *
 * PostgREST caps every response at `max-rows` (default 1,000).  Supabase-js
 * `.range(from, to)` sends `offset`/`limit` query params, which PostgREST
 * honours without applying the cap, so we can page through an entire table
 * or view one chunk at a time and merge the results.
 *
 * `queryPage(from, to)` must return `{ data, error }` from a supabase-js
 * query that already has `.order(...)` applied (range requires ordering to
 * be deterministic) and any `.eq(...)` filters.  Returns `{ data, error }`
 * where `data` is always an array (never null).
 */
export async function pagedRead<TRow>(
  queryPage: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: TRow[] | null; error: any }>,
  pageSize: number = 1000,
): Promise<{ data: TRow[]; error: any }> {
  const rows: TRow[] = [];

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await queryPage(from, from + pageSize - 1);
    if (error) return { data: rows, error };

    const page = (data || []) as TRow[];
    rows.push(...page);
    if (page.length < pageSize) return { data: rows, error: null };
  }
}
