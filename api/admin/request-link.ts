import { rateLimit, clientIp } from "../_ratelimit";
import { kv } from "@vercel/kv";

export const config = { runtime: "edge" };

function kvConfigured(): boolean {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

// PUBLIC endpoint (not in middleware matcher).
// POST { email } -> if email is in ADMIN_USERS allowlist, sends a magic-link
// email via Resend with a 15-minute HMAC-signed token. Returns 200 either way
// (don't leak which emails are allowed).
//
// ADMIN_USERS env var format (JSON):
//   [
//     { "email": "scott@elpueblomex.com", "role": "owner" },
//     { "email": "manager@elpueblomex.com", "role": "manager" },
//     { "email": "viewer@elpueblomex.com", "role": "read_only" }
//   ]

const TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes
const encoder = new TextEncoder();

async function hmacSign(payloadB64: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payloadB64));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64url(s: string): string {
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function makeMagicToken(email: string, role: string, secret: string, jti?: string): Promise<string> {
  const payload: Record<string, unknown> = { email, role, exp: Date.now() + TOKEN_TTL_MS, kind: "magic" };
  if (jti) payload.jti = jti;
  const payloadB64 = b64url(JSON.stringify(payload));
  const sig = await hmacSign(payloadB64, secret);
  return `${payloadB64}.${sig}`;
}

function parseUsers(raw: string | undefined): Array<{ email: string; role: string }> {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((u) => u && typeof u.email === "string" && typeof u.role === "string")
      .map((u) => ({ email: u.email.trim().toLowerCase(), role: u.role }));
  } catch {
    return [];
  }
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const secret = process.env.SESSION_SECRET;
  const resendKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.EP_FROM_EMAIL || "noreply@send.elpueblomex.com";
  const users = parseUsers(process.env.ADMIN_USERS);
  if (!secret) return json({ error: "Server not configured." }, 500);
  if (!resendKey) return json({ error: "Email service not configured." }, 500);

  // Per-IP throttle, checked before the allowlist lookup so it applies uniformly
  // and can't be used to probe which emails are valid.
  const ip = clientIp(req);
  if ((await rateLimit("magiclink:ip", ip, 10, 15 * 60)).limited) {
    return json({ error: "Too many requests. Try again in a few minutes." }, 429);
  }

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Invalid request." }, 400); }
  const email = String(body?.email || "").trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: "Please enter a valid email address." }, 400);
  }

  const user = users.find((u) => u.email === email);
  // Always return 200 to avoid email enumeration. Only send a real link if allowed.
  if (!user) {
    return json({ ok: true });
  }

  // Per-email cap: prevents mail-bombing a real admin inbox / burning Resend quota.
  // On trip we silently return the same 200 as the unknown-email path (no enumeration
  // leak, no email sent).
  if ((await rateLimit("magiclink:email", user.email, 3, 15 * 60)).limited) {
    return json({ ok: true });
  }

  // Single-use nonce: store a jti in KV (TTL = token lifetime). verify-link deletes
  // it on first use, so the link can't be replayed within its 15-min window. If KV is
  // unavailable the token carries no jti and falls back to the (replayable) prior behavior.
  let jti: string | undefined;
  if (kvConfigured()) {
    try {
      jti = crypto.randomUUID();
      await kv.set(`ml:jti:${jti}`, 1, { ex: Math.ceil(TOKEN_TTL_MS / 1000) });
    } catch { jti = undefined; }
  }

  const token = await makeMagicToken(user.email, user.role, secret, jti);
  const url = new URL(req.url);
  const origin = url.origin;
  const link = `${origin}/api/admin/verify-link?token=${encodeURIComponent(token)}`;

  const html = `<!DOCTYPE html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1b1008;max-width:560px;margin:0 auto;padding:24px;background:#faf0d8;">
    <div style="background:#fff;padding:32px 28px;border-radius:12px;border:1px solid #d84a1e;">
      <h2 style="margin:0 0 16px;font-size:22px;">Sign in to El Pueblo admin</h2>
      <p style="margin:0 0 18px;font-size:15px;line-height:1.5;">Click the button below to sign in. This link expires in 15 minutes and works once.</p>
      <p style="margin:0 0 24px;"><a href="${link}" style="display:inline-block;background:#d84a1e;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;">Sign in to admin</a></p>
      <p style="margin:0;font-size:13px;color:#6a5a4a;line-height:1.5;">If the button doesn't work, copy and paste this link:<br><span style="word-break:break-all;color:#4a362a;">${link}</span></p>
      <p style="margin-top:24px;font-size:11px;color:#6a5a4a;border-top:1px solid #eee;padding-top:14px;">If you didn't request this, ignore this email — no one can sign in without clicking the link.</p>
    </div></body></html>`;

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: `El Pueblo Admin <${fromEmail}>`,
      to: [email],
      subject: "Your El Pueblo admin sign-in link",
      html,
    }),
  });
  if (!r.ok) {
    console.error("Magic link send failed:", r.status, await r.text());
    return json({ error: "Could not send the email. Try again." }, 502);
  }

  return json({ ok: true });
}

function json(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
