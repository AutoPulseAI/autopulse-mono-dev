// Drain in-flight tasks before reporting failure; no background writes after
// the batch has been marked failed. Stop assigning new work on the first error.
export async function mapBounded(items, limit, action) {
  let next = 0;
  let failed = false;
  const results = new Array(items.length);
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (!failed && next < items.length) {
      const index = next++;
      try { results[index] = await action(items[index], index); }
      catch (error) { failed = true; throw error; }
    }
  });
  const settled = await Promise.allSettled(runners);
  const failure = settled.find(result => result.status === 'rejected');
  if (failure) throw failure.reason;
  return results;
}
