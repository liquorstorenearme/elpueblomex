export const config = { runtime: "edge" };

// PUBLIC endpoint (not in middleware matcher).
// GET ?token=... — verifies HMAC + expiry, sets ep_admin cookie with {email, role},
// redirects to /edit/.

const SESSION_TTL_HOURS_DEFAULT = 24;
const encoder = new TextEncoder();

async function verifyHmac(payloadB64: string, sigB64: string, secret: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const sig = Uint8Array.from(atob(sigB64.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
    return crypto.subtle.verify("HMAC", key, sig, encoder.encode(payloadB64));
  } catch {
    return false;
  }
}

function decodeB64Url(s: string): string {
  return atob(s.replace(/-/g, "+").replace(/_/g, "/"));
}

function b64url(s: string): string {
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

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

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") || "";
  const secret = process.env.SESSION_SECRET;
  if (!secret) return errorPage("Server not configured.");
  if (!token) return errorPage("Missing token.");

  const parts = token.split(".");
  if (parts.length !== 2) return errorPage("Invalid sign-in link.");
  const [payloadB64, sigB64] = parts;

  const ok = await verifyHmac(payloadB64, sigB64, secret);
  if (!ok) return errorPage("This sign-in link is invalid or has been tampered with.");

  let payload: any;
  try {
    payload = JSON.parse(decodeB64Url(payloadB64));
  } catch {
    return errorPage("Invalid sign-in link.");
  }
  if (payload.kind !== "magic") return errorPage("Invalid sign-in link.");
  if (typeof payload.exp !== "number" || payload.exp < Date.now()) {
    return errorPage("This sign-in link has expired. Request a new one.");
  }
  if (typeof payload.email !== "string" || typeof payload.role !== "string") {
    return errorPage("Invalid sign-in link.");
  }

  // Mint the session cookie
  const hours = Number(process.env.ADMIN_SESSION_HOURS || SESSION_TTL_HOURS_DEFAULT);
  const sessionPayload = {
    email: payload.email,
    role: payload.role,
    exp: Date.now() + hours * 60 * 60 * 1000,
  };
  const sessionPayloadB64 = b64url(JSON.stringify(sessionPayload));
  const sessionSig = await hmacSign(sessionPayloadB64, secret);
  const cookie = `${sessionPayloadB64}.${sessionSig}`;

  const isHttps = url.protocol === "https:";
  const cookieParts = [
    `ep_admin=${cookie}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${hours * 60 * 60}`,
  ];
  if (isHttps) cookieParts.push("Secure");

  return new Response(null, {
    status: 302,
    headers: {
      Location: "/edit/",
      "Set-Cookie": cookieParts.join("; "),
      "Cache-Control": "no-store",
    },
  });
}

function errorPage(message: string): Response {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Sign in failed</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#faf0d8;color:#1b1008;margin:0;padding:48px 20px;text-align:center}.card{background:#fff;max-width:440px;margin:48px auto;padding:32px 28px;border-radius:14px;border:1px solid #d84a1e;box-shadow:6px 6px 0 #d84a1e}h1{font-size:22px;margin:0 0 14px}p{font-size:15px;line-height:1.5;color:#4a362a;margin:0 0 22px}a{display:inline-block;background:#d84a1e;color:#fff;padding:11px 22px;border-radius:8px;text-decoration:none;font-weight:600}</style></head><body><div class="card"><h1>Sign in failed</h1><p>${message.replace(/[<>&]/g, "")}</p><a href="/admin-login/">Try again</a></div></body></html>`;
  return new Response(html, {
    status: 400,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}
