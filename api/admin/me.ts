export const config = { runtime: "edge" };

// Returns the signed-in user's email + role. Reads from the ep_admin cookie.
// Middleware has already verified the cookie's HMAC by the time we get here,
// so we can safely parse the payload.

export default async function handler(req: Request): Promise<Response> {
  const cookies = req.headers.get("cookie") || "";
  const m = cookies.match(/(?:^|;\s*)ep_admin=([^;]+)/);
  if (!m) return json({ error: "Not authenticated" }, 401);
  const parts = m[1].split(".");
  if (parts.length !== 2) return json({ error: "Bad cookie" }, 401);
  try {
    const payload = JSON.parse(
      atob(parts[0].replace(/-/g, "+").replace(/_/g, "/")),
    );
    if (typeof payload.exp !== "number" || payload.exp < Date.now()) {
      return json({ error: "Expired" }, 401);
    }
    return json({
      email: payload.email || "owner",
      role: payload.role || "owner",
    });
  } catch {
    return json({ error: "Bad cookie" }, 401);
  }
}

function json(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
