import { looksLikeSpam } from "./_spam";
import { resolveRecipients, LOCATION_NAMES } from "./_locations";
import { buildIcs, toBase64 } from "./_ics";
import { saveBooking, kvConfigured, type Booking } from "./_bookings";

export const config = { runtime: "edge" };

const attempts = new Map<string, { count: number; reset: number }>();
const RL_WINDOW_MS = 5 * 60 * 1000;
const RL_MAX = 5;
function ratelimited(ip: string): boolean {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || rec.reset < now) { attempts.set(ip, { count: 1, reset: now + RL_WINDOW_MS }); return false; }
  rec.count += 1;
  return rec.count > RL_MAX;
}

const esc = (s: string) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Only allow redirecting back to known catering pages (no open redirect).
function safeReturn(raw: string): string {
  if (raw === "/catering-preview/" || raw === "/catering/") return raw;
  return "/catering/";
}

function back(path: string, url: string, params: Record<string, string> = {}): Response {
  const u = new URL(path, url);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return Response.redirect(u.toString(), 302);
}

function row(label: string, value: string, multiline = false): string {
  if (!value) return "";
  const val = multiline
    ? `<pre style="margin:0;font:inherit;white-space:pre-wrap;">${esc(value)}</pre>`
    : esc(value);
  return `<tr><td style="padding:8px 12px 8px 0;border-bottom:1px solid #eee;color:#4a362a;vertical-align:top;width:160px;">${esc(label)}</td><td style="padding:8px 0;border-bottom:1px solid #eee;">${val}</td></tr>`;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const resendKey = process.env.RESEND_API_KEY;
  const fallbackTo = process.env.EP_CATERING_TO || process.env.EP_TO_EMAIL || "hello@elpueblomex.com";
  const fromEmail = process.env.EP_FROM_EMAIL || "noreply@elpueblomex.com";

  const ip = (req.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim();

  let form: FormData;
  try { form = await req.formData(); } catch { return back("/catering/", req.url, { err: "parse" }); }
  const g = (k: string) => String(form.get(k) || "").trim();
  const ret = safeReturn(g("return_to"));

  if (ratelimited(ip)) return back(ret, req.url, { err: "rate" });
  if (g("website")) return back(ret, req.url, { sent: "1" });

  const name = g("name").slice(0, 100);
  const email = g("email").slice(0, 150);
  const phone = g("phone").slice(0, 40);
  const organization = g("organization").slice(0, 150);
  const location = g("location").slice(0, 60);
  const pkg = g("package").slice(0, 80);
  const guests = g("guests").slice(0, 20);
  const date = g("date").slice(0, 40);
  const message = g("message").slice(0, 5000);

  if (!name || !email || !location) return back(ret, req.url, { err: "missing" });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return back(ret, req.url, { err: "email" });
  if (looksLikeSpam(message, email, name)) return back(ret, req.url, { sent: "1" });

  const locationName = LOCATION_NAMES[location] || location;

  // 1) Persist the booking (non-fatal — never lose a lead if KV is down/unset).
  const booking: Booking = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    location,
    locationName,
    name,
    email,
    phone,
    organization,
    package: pkg,
    guests,
    date,
    message,
    status: "Inquiry",
    notes: "",
  };
  if (kvConfigured()) {
    try { await saveBooking(booking); }
    catch (e) { console.error("KV saveBooking failed:", e); }
  }

  // 2) Email the servicing location (with a calendar-invite attachment, if a date was given).
  if (!resendKey) return back(ret, req.url, { err: "config", id: booking.id });

  const html = `<!DOCTYPE html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1b1008;max-width:720px;margin:0 auto;padding:24px;background:#faf0d8;">
  <div style="background:#fff;padding:32px 28px;border-radius:12px;border:1px solid #d84a1e;">
    <h2 style="margin:0 0 4px;font-size:22px;">New catering request</h2>
    <p style="margin:0 0 24px;color:#4a362a;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;font-weight:600;">El Pueblo Mexican Food · elpueblomex.com</p>
    <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:14px;line-height:1.55;">
      ${row("Name", name)}${row("Email", email)}${row("Phone", phone)}${row("Organization", organization)}${row("Location", locationName)}${row("Package", pkg)}${row("Guests", guests)}${row("Event date", date)}${row("Details", message, true)}
    </table>
    <p style="margin:24px 0 0;color:#4a362a;font-size:13px;">Next steps: confirm availability &amp; the 2-events/day cap, set the delivery fee &amp; county tax, then send the 50% deposit invoice in Toast. Update the booking status in the <strong>Catering</strong> tab of the admin.</p>
    <p style="margin-top:24px;color:#6a5a4a;font-size:11px;border-top:1px solid #eee;padding-top:16px;">Booking ${esc(booking.id)} · IP: ${esc(ip)} · ${new Date().toISOString()}</p>
  </div></body></html>`;

  const { to: toList, cc: ccList } = resolveRecipients(location, fallbackTo);

  const ics = buildIcs({
    uid: booking.id,
    summary: `Catering — ${name}${pkg ? ` (${pkg})` : ""} — ${locationName}`,
    description: `${guests ? guests + " guests · " : ""}${pkg || "Package TBD"}\nContact: ${name} · ${phone || email}\nServicing location: ${locationName}\n${message}`,
    location: locationName,
    date,
  });

  const attachments = ics
    ? [{ filename: `catering-${date || "event"}.ics`, content: toBase64(ics), content_type: "text/calendar" }]
    : undefined;

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: `El Pueblo Catering <${fromEmail}>`,
      to: toList,
      cc: ccList.length ? ccList : undefined,
      reply_to: email,
      subject: `Catering — ${name} — ${locationName}${guests ? ` (${guests} guests)` : ""}`,
      html,
      attachments,
    }),
  });

  if (!r.ok) { console.error("Resend error:", r.status, await r.text()); return back(ret, req.url, { err: "send", id: booking.id }); }
  return back(ret, req.url, { sent: "1" });
}
