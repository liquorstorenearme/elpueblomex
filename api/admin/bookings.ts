import {
  listBookings,
  updateBooking,
  kvConfigured,
  STATUSES,
  type Status,
} from "../_bookings";

export const config = { runtime: "edge" };

// Access is gated by middleware.ts (HMAC-signed ep_admin cookie). Reads are allowed
// for any signed-in role; writes (status/notes) require manager or owner.

const ROLE_RANK: Record<string, number> = { read_only: 1, manager: 2, owner: 3 };
function getRole(req: Request): string {
  const cookies = req.headers.get("cookie") || "";
  const m = cookies.match(/(?:^|;\s*)ep_admin=([^;]+)/);
  if (!m) return "";
  try {
    const payload = JSON.parse(atob(m[1].split(".")[0].replace(/-/g, "+").replace(/_/g, "/")));
    return payload.role || "read_only";
  } catch { return ""; }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

export default async function handler(req: Request): Promise<Response> {
  if (!kvConfigured()) {
    return json({ error: "KV not configured", bookings: [], statuses: STATUSES }, 200);
  }

  if (req.method === "GET") {
    try {
      const bookings = await listBookings();
      return json({ bookings, statuses: STATUSES });
    } catch (e: any) {
      return json({ error: "Load failed", detail: String(e?.message || e) }, 502);
    }
  }

  if (req.method === "PATCH" || req.method === "POST") {
    if ((ROLE_RANK[getRole(req)] || 0) < ROLE_RANK.manager) {
      return json({ error: "Your account can view bookings but not change them." }, 403);
    }
    let body: any;
    try { body = await req.json(); } catch { return json({ error: "Bad JSON" }, 400); }
    const id = String(body?.id || "").trim();
    if (!id) return json({ error: "Missing id" }, 400);

    const patch: { status?: Status; notes?: string } = {};
    if (body.status != null) {
      if (!STATUSES.includes(body.status)) return json({ error: "Invalid status" }, 400);
      patch.status = body.status;
    }
    if (body.notes != null) patch.notes = String(body.notes).slice(0, 2000);
    if (patch.status === undefined && patch.notes === undefined) {
      return json({ error: "Nothing to update" }, 400);
    }

    try {
      const updated = await updateBooking(id, patch);
      if (!updated) return json({ error: "Not found" }, 404);
      return json({ booking: updated });
    } catch (e: any) {
      return json({ error: "Update failed", detail: String(e?.message || e) }, 502);
    }
  }

  return json({ error: "Method not allowed" }, 405);
}
