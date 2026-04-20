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

const SAFE_SOURCES: Record<string, string> = {
  "la-jolla": "/locations/la-jolla/",
  "home": "/",
  "locations": "/locations/",
};

function back(path: string, url: string, params: Record<string, string> = {}): Response {
  const u = new URL(path, url);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return Response.redirect(u.toString(), 302);
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const resendKey = process.env.RESEND_API_KEY;
  const toEmail = process.env.EP_NEWSLETTER_TO || process.env.EP_TO_EMAIL || "info@elpueblomex.com";
  const fromEmail = process.env.EP_FROM_EMAIL || "noreply@elpueblomex.com";

  let form: FormData;
  try { form = await req.formData(); } catch { return back("/", req.url, { err: "parse" }); }
  const g = (k: string) => String(form.get(k) || "").trim();

  const sourceKey = g("source");
  const returnPath = SAFE_SOURCES[sourceKey] || "/";

  if (!resendKey) return back(returnPath, req.url, { err: "config" });

  const ip = (req.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim();
  if (ratelimited(ip)) return back(returnPath, req.url, { err: "rate" });

  if (g("website")) return back(returnPath, req.url, { sent: "newsletter" });

  const email = g("email").slice(0, 150);
  const name = g("name").slice(0, 100);

  if (!email) return back(returnPath, req.url, { err: "missing" });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return back(returnPath, req.url, { err: "email" });

  const label = sourceKey === "la-jolla" ? "La Jolla opening alerts" : "Newsletter";

  const html = `<!DOCTYPE html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1b1008;max-width:640px;margin:0 auto;padding:24px;background:#faf0d8;">
  <div style="background:#fff;padding:28px 24px;border-radius:12px;border:1px solid #d84a1e;">
    <h2 style="margin:0 0 4px;font-size:20px;">New signup — ${esc(label)}</h2>
    <p style="margin:0 0 20px;color:#4a362a;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;font-weight:600;">El Pueblo Mexican Food · elpueblomex.com</p>
    <p style="margin:0 0 8px;font-size:15px;"><strong>Email:</strong> <a href="mailto:${esc(email)}">${esc(email)}</a></p>
    ${name ? `<p style="margin:0 0 8px;font-size:15px;"><strong>Name:</strong> ${esc(name)}</p>` : ""}
    ${sourceKey ? `<p style="margin:0 0 8px;font-size:15px;"><strong>Source:</strong> ${esc(sourceKey)}</p>` : ""}
    <p style="margin-top:20px;color:#6a5a4a;font-size:11px;border-top:1px solid #eee;padding-top:12px;">IP: ${esc(ip)} · ${new Date().toISOString()}</p>
  </div></body></html>`;

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: `El Pueblo <${fromEmail}>`,
      to: [toEmail],
      reply_to: email,
      subject: `${label} — ${email}`,
      html,
    }),
  });

  if (!r.ok) { console.error("Resend error:", r.status, await r.text()); return back(returnPath, req.url, { err: "send" }); }
  return back(returnPath, req.url, { sent: "newsletter" });
}
