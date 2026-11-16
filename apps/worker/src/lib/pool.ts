/** Runs `fn` over `items` with at most `concurrency` in flight. Rejects on the first error (after in-flight work settles). */
export async function mapPool<T, R>(items: readonly T[], concurrency: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failed: unknown;
  let hasFailed = false;
  const runners = Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, async () => {
    while (!hasFailed && next < items.length) {
      const i = next++;
      try {
        results[i] = await fn(items[i]!, i);
      } catch (err) {
        if (!hasFailed) {
          hasFailed = true;
          failed = err;
        }
      }
    }
  });
  await Promise.all(runners);
  if (hasFailed) throw failed;
  return results;
}
