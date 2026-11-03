/**
 * Supabase returns at most 1,000 rows per request. This keeps asking for the next page
 * until everything has arrived. `page(from, to)` must build a fresh query with a stable order.
 */
export async function allRows<T = Record<string, unknown>>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
  size = 1000,
): Promise<{ data: T[]; error: { message: string } | null }> {
  const out: T[] = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1);
    if (error) return { data: out, error };
    out.push(...((data ?? []) as T[]));
    if ((data ?? []).length < size) return { data: out, error: null };
  }
}
