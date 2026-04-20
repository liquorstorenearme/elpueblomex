export const config = { runtime: "edge" };

const attempts = new Map<string, { count: number; reset: number }>();
const RL_WINDOW_MS = 10 * 60 * 1000;
const RL_MAX = 3;
function ratelimited(ip: string): boolean {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || rec.reset < now) { attempts.set(ip, { count: 1, reset: now + RL_WINDOW_MS }); return false; }
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
  const toEmail = process.env.EP_CAREERS_TO || process.env.EP_TO_EMAIL || "info@elpueblomex.com";
  const fromEmail = process.env.EP_FROM_EMAIL || "noreply@elpueblomex.com";

  const fallbackBack = (err: string, slug?: string) =>
    back(slug ? `/jobs/${slug}/` : "/careers/", req.url, { err });

  if (!resendKey) return fallbackBack("config");

  const ip = (req.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim();
  if (ratelimited(ip)) return fallbackBack("rate");

  let form: FormData;
  try { form = await req.formData(); } catch { return fallbackBack("parse"); }
  const g = (k: string) => String(form.get(k) || "").trim();
  const getAll = (k: string) => form.getAll(k).map(v => String(v));

  const jobSlug = g("job_slug").replace(/[^a-z0-9-]/gi, "").slice(0, 60);
  const jobTitle = g("job_title").slice(0, 100);
  const successPath = jobSlug ? `/jobs/${jobSlug}/` : "/careers/";

  if (g("website")) return back(successPath, req.url, { sent: "1" });

  const name = g("name").slice(0, 100);
  const email = g("email").slice(0, 150);
  const phone = g("phone").slice(0, 40);
  const city = g("city").slice(0, 100);
  const preferredLocs = getAll("preferred_locations").slice(0, 10).join(", ");
  const history = g("history").slice(0, 5000);
  const workAuth = g("work_auth").slice(0, 10);
  const backgroundCheck = g("background_check").slice(0, 10);
  const message = g("message").slice(0, 5000);

  if (!name || !email || !phone) return fallbackBack("missing", jobSlug);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fallbackBack("email", jobSlug);

  // Resume (optional)
  const resume = form.get("resume") as File | null;
  let attachment: { filename: string; content: string } | null = null;
  if (resume && resume.size > 0) {
    if (resume.size > 10 * 1024 * 1024) return fallbackBack("size", jobSlug);
    const allowed = [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "text/plain",
    ];
    if (!allowed.includes(resume.type) && !resume.name.match(/\.(pdf|doc|docx|txt)$/i)) {
      return fallbackBack("type", jobSlug);
    }
    const buf = new Uint8Array(await resume.arrayBuffer());
    let s = "";
    for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
    attachment = { filename: resume.name, content: btoa(s) };
  }

  const html = `<!DOCTYPE html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1b1008;max-width:720px;margin:0 auto;padding:24px;background:#faf0d8;">
  <div style="background:#fff;padding:32px 28px;border-radius:12px;border:1px solid #d84a1e;">
    <h2 style="margin:0 0 4px;font-size:22px;">New job application</h2>
    <p style="margin:0 0 24px;color:#4a362a;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;font-weight:600;">El Pueblo Mexican Food · elpueblomex.com</p>
    <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:14px;line-height:1.55;">
      ${row("Position", jobTitle || jobSlug)}${row("Name", name)}${row("Email", email)}${row("Phone", phone)}${row("City, State", city)}${row("Preferred locations", preferredLocs)}${row("Work authorized", workAuth)}${row("Background check", backgroundCheck)}${row("Employment history", history, true)}${row("Why El Pueblo", message, true)}${row("Resume", attachment ? `Attached (${attachment.filename})` : "Not provided")}
    </table>
    <p style="margin-top:24px;color:#6a5a4a;font-size:11px;border-top:1px solid #eee;padding-top:16px;">IP: ${esc(ip)} · ${new Date().toISOString()}</p>
  </div></body></html>`;

  const body: any = {
    from: `El Pueblo Careers <${fromEmail}>`,
    to: [toEmail],
    reply_to: email,
    subject: `Application — ${jobTitle || "Career"} — ${name}`,
    html,
  };
  if (attachment) body.attachments = [attachment];

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!r.ok) { console.error("Resend error:", r.status, await r.text()); return fallbackBack("send", jobSlug); }
  return back(successPath, req.url, { sent: "1" });
}
