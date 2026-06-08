import {
  listBookings,
  updateBooking,
  kvConfigured,
  STATUSES,
  type Status,
} from "../_bookings";

export const config = { runtime: "edge" };

// Access is gated by middleware.ts (HMAC-signed ep_admin cookie).

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
