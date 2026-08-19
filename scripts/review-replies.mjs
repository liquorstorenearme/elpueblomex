#!/usr/bin/env node
// Draft (and optionally publish) Google review replies across El Pueblo locations.
//
//   node scripts/review-replies.mjs            # DRY RUN — prints drafts, writes nothing
//   node scripts/review-replies.mjs --apply    # posts replies + queues notifications
//   node scripts/review-replies.mjs --location carlsbad --limit 5
//
// Dry run is the default on purpose: replies are public and instant, and there
// is no undo a customer won't have already seen.

import fs from "node:fs";
import path from "node:path";
import { accessToken, listReviews, putReply, stars, isReplied, reviewIdOf } from "./gbp-lib.mjs";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const cfg = JSON.parse(fs.readFileSync(path.join(root, "content/review-config.json"), "utf8"));
const statePath = path.join(root, "content/review-state.json");
const state = fs.existsSync(statePath)
  ? JSON.parse(fs.readFileSync(statePath, "utf8"))
  : { replied: {}, notified: {}, lastRun: null };

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const only = argv.includes("--location") ? argv[argv.indexOf("--location") + 1] : null;
const limitArg = argv.includes("--limit") ? Number(argv[argv.indexOf("--limit") + 1]) : NaN;
// A bare/typo'd --limit must fall back to the throttle, never disable it (NaN comparisons are always false).
const limit = Number.isFinite(limitArg) && limitArg > 0 ? limitArg : cfg.throttle.maxRepliesPerRun;

function anthropicKey() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  const f = path.join(process.env.HOME, ".lsnm_env");
  if (fs.existsSync(f)) {
    const m = fs.readFileSync(f, "utf8").match(/^ANTHROPIC_API_KEY=(.+)$/m);
    if (m) return m[1].trim();
  }
  throw new Error("No ANTHROPIC_API_KEY (env or ~/.lsnm_env).");
}

// ── the reply framework, as a prompt ────────────────────────────────────────
// Keyword budget scales INVERSELY with star rating; 1-2 star replies must
// assert nothing at all, which is what makes auto-publishing them safe.
function buildPrompt(loc, review, recent = []) {
  const s = stars(review);
  const facts = [...cfg.sharedFacts];
  if (loc.fullBar) facts.push("Full bar — call it 'the full bar' only; do NOT name any specific drink or cocktail (none are verified)");
  const constraints = loc.constraints || [];

  return `You write Google review replies for El Pueblo Mexican Food, a 5-location San Diego County Mexican restaurant. You are replying as the restaurant.

LOCATION: ${loc.name} (${loc.city})
TRUE FACTS you may reference: ${facts.join("; ")}
${constraints.length ? `HARD CONSTRAINTS for this location:\n${constraints.map(c => `- ${c}`).join("\n")}\n` : ""}
REVIEW (${s} stars) by ${review.reviewer?.displayName || "a guest"}:
"""${review.comment || "(no text — rating only)"}"""

RULES:
- Reply in the language the review is written in (Spanish review → Spanish reply). Rating-only reviews get English.
- Sound like a real person at this restaurant. Vary your opening; never start with "Thank you for your review".
- Keyword budget by rating — ${s} stars means: ${
    s >= 4 ? "include 3-4 natural entities (the location name, any staff the reviewer named, the dish they mentioned, and at most one service attribute or forward invitation)."
    : s === 3 ? "include the location name, and you MAY echo a dish the reviewer themselves praised. Do NOT introduce any dish, attribute or invitation they did not raise."
    : "include ZERO entities. No location, no dish, no attributes."
  }
${s <= 2 ? `- CRITICAL: assert NOTHING. Do not explain what happened, do not defend, do not guess at causes, do not promise specific remedies. Apologize, say you want to make it right, and give a contact route. A reply that makes no claims cannot make a wrong one.` : ""}
- Never use the phrase "near me". Never call yourself the best. Mention the business name at most once.
- The restaurant is "El Pueblo" — always "El Pueblo Del Mar", "El Pueblo Carlsbad", or "our Del Mar location". NEVER "Del Pueblo" — that is a misspelling of the brand.
- If the reviewer named staff, echo their names — that matters more than any keyword.
- If the reviewer mentioned a landmark or neighbourhood, use it.
- Never name a competitor, even if the reviewer does.
- 2-4 sentences. No corporate filler ("we strive for excellence", "your feedback helps us").
- Do NOT invent facts not in the TRUE FACTS list. Do not infer amenities from a word in a fact (a "salsa bar" is not seating).
- NEVER offer, promise or imply anything free, discounted or comped — no "let us treat you", no "next one's on us", no vouchers. You have no authority to give anything away.
- The reviewer's display name may not be a real first name. Use it only if it reads like one; otherwise address them without a name rather than writing something absurd.
- Do not read ambiguous wording as praise. If the review is short and unclear ("a different experience"), stay neutral and do not invent a positive interpretation.
- If the review is ambiguous or mixed, do NOT add a forward dish suggestion — selling to someone with a complaint reads as not listening.
- Proofread: no grammar slips ("a awesome"), no double spaces.
- Vary how you name dishes across replies — natural everyday names, not stiff menu titles.
${recent.length ? `\nANTI-REPETITION — these are replies you just wrote for other reviews. Do NOT reuse their closing line, their opening, or the dish/attribute they suggest. Vary what you recommend; the fish tacos are not the only thing on the menu:\n${recent.map(r => `- "${r}"`).join("\n")}` : ""}

Return ONLY JSON:
{"sentiment":"positive|mixed|negative","theme":"food quality|order accuracy|wait time|service|price|cleanliness|other","staff":["names the reviewer mentioned"],"reply":"the reply text"}`;
}

async function draft(loc, review, recent = []) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": anthropicKey(),
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 700,
      messages: [{ role: "user", content: buildPrompt(loc, review, recent) }],
    }),
  });
  if (!r.ok) throw new Error(`anthropic ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const body = await r.json();
  // Don't assume content[0] is the text block — a refusal or a non-text block
  // first would make content[0].text undefined and blow up with a useless error.
  const block = (body.content || []).find(c => c.type === "text");
  if (!block?.text) {
    throw new Error(`no text block (stop_reason=${body.stop_reason}, types=${JSON.stringify((body.content || []).map(c => c.type))})`);
  }
  const txt = block.text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  try {
    return JSON.parse(txt);
  } catch {
    throw new Error(`unparseable model output: ${txt.slice(0, 160)}`);
  }
}

// ── main ────────────────────────────────────────────────────────────────────
const token = await accessToken();
const locations = cfg.locations.filter(l => l.enabled && (!only || l.slug === only));
if (!locations.length) {
  console.error(only ? `No enabled location "${only}".` : "No enabled locations.");
  process.exit(1);
}

console.log(APPLY ? "MODE: APPLY — will publish replies\n" : "MODE: DRY RUN — nothing will be published\n");


// Scott 2026-08-17: management is only emailed about NEW reviews — old backlog
// low-stars get replies (in reply mode) but no emails at all. Fresh = <48h.
const FRESH_MS = 48 * 3600 * 1000;
const isFresh = createTime => (Date.now() - new Date(createTime).getTime()) < FRESH_MS;
const urgencyFor = s => (cfg.notify.immediateStars.includes(s) ? "immediate" : "digest");

let posted = 0;
const notifications = [];
const recentReplies = []; // rolling window fed back to the model so replies do not converge

for (const loc of locations) {
  const reviews = await listReviews(token, loc.account, loc.location, { max: 200 });

  if (loc.mode === "notify-only") {
    // Never post here (another system replies) — but low stars must still reach
    // management. Its bot replies within a day, so we can't filter on unreplied:
    // we scan ALL recent reviews for un-notified 1-3★.
    const lowAll = reviews.filter(r => stars(r) <= 3 && stars(r) >= 1 && !state.notified[reviewIdOf(r)]);
    const low = lowAll.filter(r => isFresh(r.createTime));
    if (APPLY) for (const r of lowAll) if (!isFresh(r.createTime)) state.notified[reviewIdOf(r)] = "backlog-skipped";
    console.log(`── ${loc.name} (notify-only): ${reviews.length} fetched, ${low.length} low-star to notify`);
    for (const review of low) {
      const id = reviewIdOf(review), s = stars(review);
      notifications.push({
        urgency: urgencyFor(s),
        location: loc.name, managerEmail: loc.managerEmail, stars: s, id,
        reviewer: review.reviewer?.displayName || "",
        text: review.comment || "", theme: "-", staff: [],
        reply: review.reviewReply?.comment || "(no reply posted)",
        replySource: review.reviewReply ? "existing (other system)" : "none",
        createTime: review.createTime,
        link: `https://business.google.com/reviews/l/${loc.location.split("/").pop()}`,
      });
      if (APPLY) state.notified[id] = new Date().toISOString();
      console.log(`   [${s}★] ${review.reviewer?.displayName || "?"} queued for management`);
    }
    continue;
  }

  const pending = reviews
    .filter(r => !isReplied(r) && !state.replied[reviewIdOf(r)])
    .sort((a, b) => String(b.createTime).localeCompare(String(a.createTime)))
    .slice(0, cfg.throttle.backlogPerLocationPerRun);

  console.log(`── ${loc.name}: ${reviews.length} fetched, ${reviews.filter(r => !isReplied(r)).length} unreplied, handling ${pending.length}`);

  for (const review of pending) {
    if (posted >= limit) { console.log(`   (run cap ${limit} reached)`); break; }
    const id = reviewIdOf(review);
    const s = stars(review);
    let d;
    try { d = await draft(loc, review, recentReplies.slice(-6)); }
    catch (e) { console.log(`   ⚠ ${id}: ${e.message}`); continue; }

    console.log(`\n   [${s}★] ${review.reviewer?.displayName || "?"}  (${d.sentiment}/${d.theme}${d.staff?.length ? `, staff: ${d.staff.join(", ")}` : ""})`);
    console.log(`   REVIEW: ${(review.comment || "(rating only)").replace(/\s+/g, " ").slice(0, 200)}`);
    console.log(`   REPLY : ${d.reply}`);

    recentReplies.push(d.reply);

    // Sanity-gate the model output before it can reach a public profile.
    if (typeof d.reply !== "string" || d.reply.trim().length < 20 || d.reply.length > 1500) {
      console.log(`   ⚠ ${id}: reply failed sanity check (${d.reply?.length ?? 0} chars) — skipped`);
      continue;
    }

    // Brand-name gate: deterministic, runs on every reply. Known mangles are
    // auto-corrected; any remaining "Pueblo" not preceded by "El " is an
    // unknown mangle — skip rather than post it (review stays unreplied and
    // retries next run). Posted twice as "Del Pueblo Del Mar" before this gate.
    d.reply = d.reply.replace(/\bDel Pueblo\b/g, "El Pueblo").replace(/\bEl Peublo\b/gi, "El Pueblo");
    if (/(?<!El )Pueblo/.test(d.reply)) {
      console.log(`   ⚠ ${id}: brand-name gate — unrecognized "Pueblo" usage, skipped: ${d.reply.slice(0, 120)}`);
      continue;
    }

    if (APPLY) {
      // A single Google-side failure (429/500) must skip THIS review, not kill
      // the run — dying here would orphan notifications for replies already
      // posted above, so management would never hear about a live 1★ reply.
      try {
        await putReply(token, loc.account, loc.location, id, d.reply);
        state.replied[id] = { at: new Date().toISOString(), location: loc.slug, stars: s };
        console.log("   ✓ published");
      } catch (e) {
        console.log(`   ⚠ ${id}: publish failed — ${e.message.slice(0, 160)}`);
        continue; // unreplied on Google → retried next run; notification stays queued only if posted
      }
    }
    // Queue the management notification only once the reply has definitively
    // posted (or in dry run, where nothing persists anyway) — never email
    // management about a reply that failed to publish.
    if ((cfg.notify.immediateStars.includes(s) || cfg.notify.digestStars.includes(s)) && isFresh(review.createTime)) {
      notifications.push({
        urgency: urgencyFor(s),
        location: loc.name, managerEmail: loc.managerEmail, stars: s, id,
        reviewer: review.reviewer?.displayName || "",
        text: review.comment || "", theme: d.theme, staff: d.staff || [],
        reply: d.reply, createTime: review.createTime,
        link: `https://business.google.com/reviews/l/${loc.location.split("/").pop()}`,
      });
    }
    posted++;
  }
}

const imm = notifications.filter(n => n.urgency === "immediate");
console.log(`\n${"═".repeat(70)}`);
console.log(`${APPLY ? "Published" : "Drafted"}: ${posted}`);
console.log(`Notifications: ${imm.length} immediate (1★), ${notifications.length - imm.length} for daily digest`);
if (!cfg.notify.recipients.length) console.log("⚠ no recipients configured — add them to content/review-config.json");

if (APPLY) {
  state.lastRun = new Date().toISOString();
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n");
  // MERGE with the existing queue — runs are hourly but the digest sends daily,
  // so overwriting here would silently drop every notification but the last hour's.
  // The send step removes entries once they are actually emailed.
  const qPath = path.join(root, "content/review-notifications.json");
  const existing = fs.existsSync(qPath) ? JSON.parse(fs.readFileSync(qPath, "utf8")) : [];
  const seen = new Set(existing.map(n => n.id));
  const merged = [...existing, ...notifications.filter(n => !seen.has(n.id))];
  fs.writeFileSync(qPath, JSON.stringify(merged, null, 2) + "\n");
  console.log(`state written; notification queue: ${merged.length} pending (${notifications.length} new)`);
} else {
  console.log("(dry run — no state written, nothing published, no email sent)");
}
