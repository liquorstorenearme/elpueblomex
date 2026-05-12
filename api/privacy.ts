import { looksLikeSpam } from "./_spam";

export const config = { runtime: "edge" };

const attempts = new Map<string, { count: number; reset: number }>();
const RL_WINDOW_MS = 5 * 60 * 1000;
const RL_MAX = 5;
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

const esc = (s: string) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function back(path: string, url: string, params: Record<string, string> = {}): Response {
  const u = new URL(path, url);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return Response.redirect(u.toString(), 302);
}

function row(label: string, value: string): string {
  if (!value) return "";
  return `<tr><td style="padding:8px 12px 8px 0;border-bottom:1px solid #eee;color:#4a362a;vertical-align:top;width:180px;">${esc(label)}</td><td style="padding:8px 0;border-bottom:1px solid #eee;">${esc(value)}</td></tr>`;
}

const REQUEST_TYPE_LABEL: Record<string, string> = {
  access: "Access — send a copy of personal information",
  delete: "Delete — delete personal information",
  correct: "Correct — fix inaccurate information",
  opt_out: "Opt out — do not sell or share",
  appeal: "Appeal a previous decision",
  other: "Other",
};

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const resendKey = process.env.RESEND_API_KEY;
  const toEmail = process.env.EP_PRIVACY_TO || process.env.EP_CONTACT_TO || process.env.EP_TO_EMAIL || "hello@elpueblomex.com";
  const toList = toEmail.split(",").map((s) => s.trim()).filter(Boolean);
  const fromEmail = process.env.EP_FROM_EMAIL || "noreply@elpueblomex.com";

  if (!resendKey) return back("/privacy-request/", req.url, { err: "config" });

  const ip = (req.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim();
  if (ratelimited(ip)) return back("/privacy-request/", req.url, { err: "rate" });

  let form: FormData;
  try { form = await req.formData(); } catch { return back("/privacy-request/", req.url, { err: "parse" }); }
  const g = (k: string) => String(form.get(k) || "").trim();

  if (g("website")) return back("/privacy-request/", req.url, { sent: "1" }); // honeypot

  const name = g("name").slice(0, 100);
  const email = g("email").slice(0, 150);
  const requestType = g("request_type").slice(0, 30);
  const caResident = g("ca_resident").slice(0, 30);
  const authorizedAgent = g("authorized_agent").slice(0, 10);
  const message = g("message").slice(0, 5000);

  if (!name || !email || !requestType) return back("/privacy-request/", req.url, { err: "missing" });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return back("/privacy-request/", req.url, { err: "email" });
  if (looksLikeSpam(message, email, name)) return back("/privacy-request/", req.url, { sent: "1" });

  const requestTypeLabel = REQUEST_TYPE_LABEL[requestType] || requestType;
  const caResidentLabel = caResident === "yes" ? "Yes — California resident" : caResident === "no" ? "No" : "Not specified";
  const agentLabel = authorizedAgent === "yes" ? "Yes — authorized agent" : "No — for self";

  const html = `<!DOCTYPE html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1b1008;max-width:720px;margin:0 auto;padding:24px;background:#faf0d8;">
  <div style="background:#fff;padding:32px 28px;border-radius:12px;border:1px solid #d84a1e;">
    <h2 style="margin:0 0 4px;font-size:22px;">⚖ New privacy request</h2>
    <p style="margin:0 0 24px;color:#4a362a;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;font-weight:600;">El Pueblo Mexican Food · elpueblomex.com</p>
    <p style="background:#faf0d8;padding:12px 16px;border-left:3px solid #d84a1e;font-size:13px;line-height:1.5;margin:0 0 20px;">CCPA/CPRA: substantive response required within <strong>45 days</strong> (extendable by another 45). Acknowledge within 10 business days.</p>
    <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:14px;line-height:1.55;">
      ${row("Name", name)}${row("Email", email)}${row("Request type", requestTypeLabel)}${row("California resident?", caResidentLabel)}${row("Submitted by", agentLabel)}
    </table>
    ${message ? `<h3 style="font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#d84a1e;margin:24px 0 8px;">Details</h3>
    <div style="white-space:pre-wrap;font-size:14px;line-height:1.55;">${esc(message)}</div>` : ""}
    <p style="margin-top:24px;color:#6a5a4a;font-size:11px;border-top:1px solid #eee;padding-top:16px;">IP: ${esc(ip)} · ${new Date().toISOString()}</p>
  </div></body></html>`;

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: `El Pueblo Privacy <${fromEmail}>`,
      to: toList,
      reply_to: email,
      subject: `Privacy Request (${requestTypeLabel.split(" — ")[0]}) — ${name}`,
      html,
    }),
  });

  if (!r.ok) { console.error("Resend error:", r.status, await r.text()); return back("/privacy-request/", req.url, { err: "send" }); }
  return back("/privacy-request/", req.url, { sent: "1" });
}
