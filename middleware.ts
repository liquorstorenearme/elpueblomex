import { next } from "@vercel/edge";

export const config = {
  matcher: [
    "/edit",
    "/edit/:path*",
    "/api/admin/load",
    "/api/admin/load/",
    "/api/admin/save",
    "/api/admin/save/",
    "/api/admin/upload",
    "/api/admin/upload/",
  ],
};

const encoder = new TextEncoder();

async function verify(token: string, secret: string): Promise<boolean> {
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [payloadB64, sigB64] = parts;
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const sig = Uint8Array.from(atob(sigB64.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
    const ok = await crypto.subtle.verify("HMAC", key, sig, encoder.encode(payloadB64));
    if (!ok) return false;
    const payload = JSON.parse(atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.exp === "number" && payload.exp > Date.now();
  } catch {
    return false;
  }
}

export default async function middleware(req: Request) {
  const url = new URL(req.url);
  const cookies = req.headers.get("cookie") || "";
  const m = cookies.match(/(?:^|;\s*)ep_admin=([^;]+)/);
  const secret = process.env.SESSION_SECRET;

  if (m && secret && (await verify(m[1], secret))) {
    return next();
  }

  if (url.pathname.startsWith("/api/")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  const loginUrl = new URL("/admin-login/", url.origin);
  loginUrl.searchParams.set("from", url.pathname);
  return Response.redirect(loginUrl.toString(), 302);
}
