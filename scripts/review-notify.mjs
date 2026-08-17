#!/usr/bin/env node
// Send queued review notifications via Resend.
//
//   node scripts/review-notify.mjs             # send "immediate" items only
//   node scripts/review-notify.mjs --digest    # also flush 2-3★ digest items
//   node scripts/review-notify.mjs --test-to a@b.com   # one sample email, queue untouched
//
// Routing (Scott, 2026-08-17): every notification → that location's manager
// address + everyone in notify.lowStarGlobal. Sent items are removed from the
// queue; failures stay queued for the next run.

import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const cfg = JSON.parse(fs.readFileSync(path.join(root, "content/review-config.json"), "utf8"));
const qPath = path.join(root, "content/review-notifications.json");
const queue = fs.existsSync(qPath) ? JSON.parse(fs.readFileSync(qPath, "utf8")) : [];

const argv = process.argv.slice(2);
const DIGEST = argv.includes("--digest");
const testTo = argv.includes("--test-to") ? argv[argv.indexOf("--test-to") + 1] : null;

const KEY = process.env.RESEND_API_KEY;
if (!KEY) { console.error("Set RESEND_API_KEY."); process.exit(1); }

const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const starRow = n => "★".repeat(n) + "☆".repeat(5 - n);

function reviewCard(n) {
  return `<div style="border:1px solid #ddd;border-radius:8px;padding:14px 16px;margin:0 0 14px">
    <div style="font-size:15px"><strong>${starRow(n.stars)}</strong> &nbsp;${esc(n.reviewer)} · ${esc(n.location)} · ${esc(String(n.createTime).slice(0,10))}</div>
    <p style="margin:10px 0;white-space:pre-wrap">${esc(n.text) || "<em>(rating only — no text)</em>"}</p>
    ${n.staff?.length ? `<div><strong>Staff mentioned:</strong> ${esc(n.staff.join(", "))}</div>` : ""}
    ${n.theme && n.theme !== "-" ? `<div><strong>Theme:</strong> ${esc(n.theme)}</div>` : ""}
    <div style="margin-top:10px;padding:10px;background:#f6f6f6;border-radius:6px">
      <strong>${n.replySource === "existing (other system)" ? "Existing reply on the profile" : "Our posted reply"}:</strong><br>${esc(n.reply)}
    </div>
    <div style="margin-top:8px"><a href="${esc(n.link)}">Open reviews in Google Business Profile</a></div>
  </div>`;
}

async function send(to, subject, html) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: `El Pueblo Reviews <${cfg.notify.from}>`, to, subject, html }),
  });
  if (!r.ok) throw new Error(`resend ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return (await r.json()).id;
}

const recipientsFor = n => [n.managerEmail, ...(cfg.notify.lowStarGlobal || [])].filter(Boolean);

if (testTo) {
  const sample = queue[0] || { stars: 1, reviewer: "Test Reviewer", location: "Carlsbad", createTime: new Date().toISOString(),
    text: "This is a sample low-star review body so you can see the format.", staff: ["Sample Name"], theme: "service",
    reply: "This is where the posted reply appears.", link: "https://business.google.com", managerEmail: "carlsbad@elpueblomex.com" };
  const id = await send([testTo], `[TEST] 1★ review — ${sample.location}`, reviewCard(sample));
  console.log(`test email sent to ${testTo} (resend id ${id}) — queue untouched`);
  process.exit(0);
}

const due = queue.filter(n => n.urgency === "immediate" || (DIGEST && n.urgency === "digest"));
console.log(`queue: ${queue.length} · sending now: ${due.length} (${DIGEST ? "immediate + digest" : "immediate only"})`);
const sentIds = new Set();

// immediates: one email each
for (const n of due.filter(n => n.urgency === "immediate")) {
  try {
    await send(recipientsFor(n), `🚨 New ${n.stars}★ review — ${n.location}`, reviewCard(n));
    sentIds.add(n.id); console.log(`  ✓ immediate → ${recipientsFor(n).join(", ")}`);
  } catch (e) { console.log(`  ⚠ ${n.id}: ${e.message}`); }
}

// digest: one email per location covering all its items
if (DIGEST) {
  const byLoc = {};
  for (const n of due.filter(n => n.urgency === "digest")) (byLoc[n.location] ??= []).push(n);
  for (const [locName, items] of Object.entries(byLoc)) {
    try {
      await send(recipientsFor(items[0]),
        `Review digest — ${locName}: ${items.length} low-star review${items.length > 1 ? "s" : ""}`,
        `<p>${items.length} low-star review${items.length > 1 ? "s" : ""} at ${esc(locName)} since the last digest.</p>` +
        items.map(reviewCard).join(""));
      items.forEach(n => sentIds.add(n.id));
      console.log(`  ✓ digest ${locName} (${items.length}) → ${recipientsFor(items[0]).join(", ")}`);
    } catch (e) { console.log(`  ⚠ digest ${locName}: ${e.message}`); }
  }
}

const remaining = queue.filter(n => !sentIds.has(n.id));
fs.writeFileSync(qPath, JSON.stringify(remaining, null, 2) + "\n");
console.log(`sent ${sentIds.size}; ${remaining.length} left queued`);
