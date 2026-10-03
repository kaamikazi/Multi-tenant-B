// Application-level rate limiting for public (anonymous) endpoints.
//
// This is an abuse brake, not the security boundary: the database still caps
// bookings per email and per workspace and makes double booking impossible.
//
// Two backends behind one interface:
//   * memory (default): a fixed-window counter in this server process. Free
//     and zero-config, fine for a demo or a single long-running server. On
//     serverless or multi-instance hosting each instance counts separately,
//     so the effective limit is looser.
//   * Upstash Redis REST (optional): set UPSTASH_REDIS_REST_URL and
//     UPSTASH_REDIS_REST_TOKEN to share counters across instances. Upstash has
//     a free tier; any Redis REST service with INCR/PEXPIRE pipelines works.
//
// Pure module (no Next.js imports) so it is unit-tested in rate-limit.test.ts.

export type LimitRule = { limit: number; windowMs: number };
export type LimitResult = { ok: boolean; remaining: number; retryAfterMs: number };

export interface RateLimiter {
  hit(key: string, rule: LimitRule): Promise<LimitResult>;
}

export function memoryLimiter(now: () => number = Date.now, maxKeys = 10_000): RateLimiter {
  const windows = new Map<string, { count: number; resetAt: number }>();
  return {
    async hit(key, { limit, windowMs }) {
      const t = now();
      let w = windows.get(key);
      if (!w || w.resetAt <= t) {
        // Bound memory: drop expired windows, then the oldest, before adding.
        if (windows.size >= maxKeys) {
          for (const [k, v] of windows) if (v.resetAt <= t) windows.delete(k);
          if (windows.size >= maxKeys) windows.delete(windows.keys().next().value!);
        }
        w = { count: 0, resetAt: t + windowMs };
        windows.set(key, w);
      }
      w.count++;
      return { ok: w.count <= limit, remaining: Math.max(0, limit - w.count), retryAfterMs: Math.max(0, w.resetAt - t) };
    },
  };
}

type Fetch = typeof fetch;

export function upstashLimiter(url: string, token: string, fetchImpl: Fetch = fetch): RateLimiter {
  return {
    async hit(key, { limit, windowMs }) {
      const bucket = Math.floor(Date.now() / windowMs);
      const redisKey = `tf:rl:${key}:${bucket}`;
      const res = await fetchImpl(`${url.replace(/\/$/, "")}/pipeline`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify([["INCR", redisKey], ["PEXPIRE", redisKey, String(windowMs)]]),
        signal: AbortSignal.timeout(2_000),
      });
      if (!res.ok) throw new Error(`rate limit store returned ${res.status}`);
      const [incr] = (await res.json()) as [{ result: number }];
      const count = Number(incr?.result ?? 0);
      const retryAfterMs = (bucket + 1) * windowMs - Date.now();
      return { ok: count <= limit, remaining: Math.max(0, limit - count), retryAfterMs };
    },
  };
}

/**
 * Uses the shared store when configured. If that store is unreachable, falls
 * back to the in-process counter rather than failing open entirely or taking
 * the booking page down.
 */
export function createRateLimiter(env: Record<string, string | undefined> = process.env, fetchImpl: Fetch = fetch): RateLimiter {
  const local = memoryLimiter();
  const { UPSTASH_REDIS_REST_URL: url, UPSTASH_REDIS_REST_TOKEN: token } = env;
  if (!url || !token) return local;
  const shared = upstashLimiter(url, token, fetchImpl);
  return {
    async hit(key, rule) {
      try {
        return await shared.hit(key, rule);
      } catch {
        return local.hit(key, rule);
      }
    },
  };
}

/**
 * The client IP for rate-limit keys: the LAST x-forwarded-for entry, i.e. the
 * address recorded by the nearest hop. Vercel overwrites the header with the
 * real client IP; nginx-style proxies append the peer address (so earlier,
 * client-supplied entries are ignored); with no proxy, Next.js fills it from
 * the socket. Exposed directly to the internet with no proxy, a client can
 * still send its own header, which is why the database limits (per email, per
 * workspace) apply regardless of this key.
 */
export function clientIp(headers: { get(name: string): string | null }): string {
  const hops = (headers.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const ip = hops.at(-1) ?? headers.get("x-real-ip") ?? "unknown";
  return ip.slice(0, 64);
}

/** Limits for the public booking page. */
export const BOOKING_LIMITS = {
  /** Booking attempts from one IP for one workspace. */
  bookPerIp: { limit: 5, windowMs: 10 * 60_000 },
  /** Booking attempts from one IP across all workspaces. */
  bookPerIpGlobal: { limit: 20, windowMs: 60 * 60_000 },
  /** Availability lookups (each one computes two weeks of open slots). */
  viewPerIp: { limit: 60, windowMs: 60_000 },
} satisfies Record<string, LimitRule>;
