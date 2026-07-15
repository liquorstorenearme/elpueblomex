// Shared rate limiter for all API endpoints (login, magic-link, public forms).
//
// Why this exists: the previous per-file `new Map()` counters lived in a single
// serverless instance's memory. Vercel runs many short-lived, isolated instances
// across regions, so those counters reset constantly and never shared state —
// making the "limit" trivially bypassable. This helper uses Vercel KV (shared
// across every instance) as the source of truth, with a per-instance in-memory
// fallback so a missing/unreachable KV store degrades gracefully instead of
// removing the limit entirely.

import { kv } from "@vercel/kv";

function kvConfigured(): boolean {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

// Per-instance fallback (used only when KV is absent or errors).
const mem = new Map<string, { count: number; reset: number }>();

/**
 * Best-effort trusted client IP.
 *
 * The leftmost `x-forwarded-for` hop is attacker-controllable (a client can send
 * its own XFF header, which upstream proxies prepend to). Vercel populates
 * `x-real-ip` with the actual TCP peer, so prefer it. If it's missing, fall back
 * to the LAST XFF entry (closest to our infrastructure), never the first.
 */
export function clientIp(req: Request): string {
  const real = req.headers.get("x-real-ip");
  if (real && real.trim()) return real.trim();
  const xff = req.headers.get("x-forwarded-for") || "";
  const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "unknown";
}

export interface RateLimitResult {
  limited: boolean;
  count: number;
  remaining: number;
}

/**
 * Fixed-window counter. `bucket` namespaces the limit (e.g. "login", "form:contact"),
 * `id` is the subject (usually an IP or email), `max` requests per `windowSeconds`.
 * Fails open (never throws) so a rate-limit backend hiccup can't take down a form.
 */
export async function rateLimit(
  bucket: string,
  id: string,
  max: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const key = `rl:${bucket}:${id}`;

  if (kvConfigured()) {
    try {
      const count = await kv.incr(key);
      // Set the TTL only on the first hit of the window.
      if (count === 1) await kv.expire(key, windowSeconds);
      return { limited: count > max, count, remaining: Math.max(0, max - count) };
    } catch {
      // fall through to the in-memory fallback below
    }
  }

  const now = Date.now();
  const rec = mem.get(key);
  if (!rec || rec.reset < now) {
    mem.set(key, { count: 1, reset: now + windowSeconds * 1000 });
    return { limited: false, count: 1, remaining: max - 1 };
  }
  rec.count += 1;
  return { limited: rec.count > max, count: rec.count, remaining: Math.max(0, max - rec.count) };
}
