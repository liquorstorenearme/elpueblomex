export const config = { runtime: "edge" };

const encoder = new TextEncoder();

function b64url(bytes: Uint8Array | string): string {
  const b = typeof bytes === "string" ? btoa(bytes) : btoa(String.fromCharCode(...bytes));
  return b.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sign(payload: object, secret: string): Promise<string> {
  const payloadB64 = b64url(JSON.stringify(payload));
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payloadB64));
  return `${payloadB64}.${b64url(new Uint8Array(sig))}`;
}

const attempts = new Map<string, { count: number; reset: number }>();
const RL_WINDOW_MS = 15 * 60 * 1000;
const RL_MAX = 8;
function ratelimited(ip: string): boolean {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || rec.reset < now) {
    attempts.set(ip, { count: 1, reset: now + RL_WINDOW_MS });
    return false;
  }
  rec.count += 1;
  return rec.count > RL_MAX;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const password = process.env.ADMIN_PASSWORD;
  const secret = process.env.SESSION_SECRET;
  const hours = Number(process.env.ADMIN_SESSION_HOURS || "24");

  if (!password || !secret) return new Response("Server not configured", { status: 500 });

  const ip = (req.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim();
  if (ratelimited(ip)) return Response.redirect(new URL("/admin-login/?err=locked", req.url).toString(), 302);

  const form = await req.formData();
  const submitted = String(form.get("password") || "");
  const from = String(form.get("from") || "/edit");

  const a = encoder.encode(submitted);
  const b = encoder.encode(password);
  let match = a.length === b.length ? 1 : 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) match &= a[i] === b[i] ? 1 : 0;

  if (!match) return Response.redirect(new URL("/admin-login/?err=1", req.url).toString(), 302);

  const exp = Date.now() + hours * 60 * 60 * 1000;
  const token = await sign({ exp }, secret);
  const maxAge = hours * 60 * 60;

  const dest = from.startsWith("/") && !from.startsWith("//") ? from : "/edit";
  const headers = new Headers();
  headers.set("Location", new URL(dest, req.url).toString());
  headers.append("Set-Cookie", `ep_admin=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`);
  return new Response(null, { status: 302, headers });
}
