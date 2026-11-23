// app/worker/rateLimit.js
//
// DB-SCALING #9 (queue buffering / rate limiting): an env-driven safety valve.
//
// A large campaign blast enqueues thousands of jobs at once; without a cap the
// worker drains them as fast as it can and can splash MongoDB. This turns a
// per-minute cap into a BullMQ worker `limiter` ({ max, duration }) that caps how
// many jobs the queue STARTS per second, GLOBALLY across every worker process
// (BullMQ coordinates the limit in Redis), regardless of concurrency or how many
// workers run. Rate-limited jobs are not dropped — they wait in the queue.
//
// Sizing (2026-11-20 rs0 stress test): the DB stays healthy up to ~150-160k
// writes/min and only degrades past ~230k, vs. real traffic of ~10k/min. So this
// cap is a BACKSTOP set at the top of the healthy zone — far above normal need,
// below the degradation point — not a tight governor. Tune per queue via env at
// deploy time; set the value to "off" (or 0) to disable it entirely.
//
// The per-minute cap is smoothed over a 1-second window so throughput is steady
// instead of a burst-then-idle sawtooth.

export function getRateLimiter(value, name) {
  const raw = String(value ?? '').trim().toLowerCase();

  // Disabled: unset/empty, "off", or 0 => no limiter (unbounded, prior behavior).
  if (raw === '' || raw === 'off' || raw === '0') return undefined;

  if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
    throw new Error(`Invalid ${name}; expected a positive integer (jobs per minute) or "off"`);
  }

  const perMinute = Number(raw);
  // Smooth over 1-second windows: max jobs per second, at least 1.
  const max = Math.max(1, Math.ceil(perMinute / 60));
  return { max, duration: 1000 };
}
