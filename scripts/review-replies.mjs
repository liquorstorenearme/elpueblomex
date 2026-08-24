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
state.suggest ||= {}; // per-location dish-suggestion cooldown (survives across runs)
state.recent ||= {};  // per-location recent reply texts (cross-run anti-repetition)
state.locPhrase ||= {}; // per-location location-wording rotation (cross-run)

const dishCfgPath = path.join(root, "content/dish-suggestions.json");
const dishCfg = fs.existsSync(dishCfgPath) ? JSON.parse(fs.readFileSync(dishCfgPath, "utf8")) : null;

// Menu-drift check: every pool dish should still be findable on the live menu
// (content/menu.json). WARN-ONLY — pools are human-curated, and colloquial
// names legitimately differ from menu titles ("carne asada fries" = the menu's
// "Protein Fries"), so a human decides; automation only surfaces the drift.
{
  const menuPath = path.join(root, "content/menu.json");
  if (dishCfg && fs.existsSync(menuPath)) {
    const menuNames = JSON.parse(fs.readFileSync(menuPath, "utf8")).categories
      .flatMap(c => c.items.map(i => i.name.toLowerCase()));
    for (const [slug, pool] of Object.entries(dishCfg.pools)) {
      for (const e of pool) {
        if (/margarita|guacamole/i.test(e.dish)) continue; // bar/side items, POS-verified separately
        const tokens = e.dish.toLowerCase().replace(/\(.*?\)/g, "").replace(/^(the|a)\s+/, "")
          .split(/\s+/).filter(w => w && !["and", "from", "full", "bar", "we", "serve", "them", "all", "day"].includes(w))
          .map(w => w.replace(/s$/, ""));
        const found = menuNames.some(n => tokens.every(t => n.includes(t)));
        if (!found) console.log(`⚠ MENU-DRIFT [${slug}]: pool dish "${e.dish}" not found on content/menu.json — verify it's still served (colloquial names are OK if intentional)`);
      }
    }
  }
}

// Any dish vocabulary a reviewer might use — if the review itself mentions food,
// the reply ECHOES it and gets no forward suggestion (selling past a customer
// who already told you what they ate reads as not listening).
const DISH_WORDS = /taco|burrito|quesadilla|nacho|carnitas|enchilada|menudo|torta|fries|margarita|guac|horchata|rolled|ceviche|salsa/i;

// True when a and b are within Damerau-Levenshtein distance 1: equal, one
// substitution, one insertion/deletion, or one ADJACENT TRANSPOSITION. The
// transposition case is not optional garnish — both real reviewer typos that
// motivated this ("gauc"→guac, "fires"→fries) are swaps, which plain
// Levenshtein scores as distance 2.
function damerau1(a, b) {
  if (a === b) return true;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  if (la === lb) {
    const diffs = [];
    for (let i = 0; i < la; i++) if (a[i] !== b[i]) { diffs.push(i); if (diffs.length > 2) return false; }
    if (diffs.length === 1) return true; // one substitution
    return diffs.length === 2 && diffs[1] === diffs[0] + 1 &&
           a[diffs[0]] === b[diffs[1]] && a[diffs[1]] === b[diffs[0]]; // adjacent swap
  }
  const [s, l] = la < lb ? [a, b] : [b, a]; // one insertion/deletion
  let i = 0, j = 0, skipped = false;
  while (i < s.length) {
    if (s[i] === l[j]) { i++; j++; }
    else if (!skipped) { skipped = true; j++; }
    else return false;
  }
  return true;
}

// Variation engine: CODE, not the model, decides whether a reply may carry a
// forward dish suggestion and which dish it is — the model only weaves it in.
// suggestRate caps how often a sales line appears at all; the per-location
// cooldown stops the same dish repeating down the profile page. Weights come
// from measured POS sales.
function pickSuggestion(loc, review) {
  if (!dishCfg || stars(review) < 4) return null;
  if (DISH_WORDS.test(review.comment || "")) return null; // echo mode
  const pool = dishCfg.pools[loc.slug];
  if (!pool?.length) return null;
  if (Math.random() >= (dishCfg.suggestRate ?? 0.3)) return null;
  const st = (state.suggest[loc.slug] ||= { recentDishes: [] });
  const eligible = pool.filter(p => !st.recentDishes.includes(p.dish));
  const pickFrom = eligible.length ? eligible : pool;
  const total = pickFrom.reduce((a, p) => a + p.w, 0);
  let r = Math.random() * total, chosen = pickFrom[pickFrom.length - 1];
  for (const p of pickFrom) { r -= p.w; if (r <= 0) { chosen = p; break; } }
  st.recentDishes.push(chosen.dish);
  while (st.recentDishes.length > (dishCfg.cooldown ?? 3)) st.recentDishes.shift();
  return chosen.dish;
}

// Location-wording engine: the location mention is REQUIRED content, and
// required content + prompt-level "vary it" always converges (measured
// 2026-08-21: 83 of 97 published replies used "our {city} spot/location" —
// La Jolla hit 23/25 "our La Jolla spot"). So CODE picks the exact wording,
// rotating with a cooldown, exactly like the dish engine.
const LOC_TEMPLATES = [
  c => `here in ${c}`,
  c => `at our ${c} location`,
  c => `at El Pueblo ${c}`,
  c => `the ${c} team`,
  c => `our ${c} crew`,
  c => `next time you're in ${c}`,
  c => `the ${c} location`,
  c => `our ${c} spot`,
];
function pickLocPhrase(loc) {
  const st = (state.locPhrase[loc.slug] ||= { recent: [] });
  const eligible = LOC_TEMPLATES.map((_, i) => i).filter(i => !st.recent.includes(i));
  const pickFrom = eligible.length ? eligible : LOC_TEMPLATES.map((_, i) => i);
  const i = pickFrom[Math.floor(Math.random() * pickFrom.length)];
  st.recent.push(i);
  while (st.recent.length > 4) st.recent.shift();
  return LOC_TEMPLATES[i](loc.city);
}

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const only = argv.includes("--location") ? argv[argv.indexOf("--location") + 1] : null;
const limitArg = argv.includes("--limit") ? Number(argv[argv.indexOf("--limit") + 1]) : NaN;
// A bare/typo'd --limit must fall back to the throttle, never disable it (NaN comparisons are always false).
const limit = Number.isFinite(limitArg) && limitArg > 0 ? limitArg : cfg.throttle.maxRepliesPerRun;
// --redo-template-since <iso>: repair mode. Instead of unreplied reviews, target
// reviews WE replied to since <iso> whose live reply uses the convergent
// "our {city} spot/location" template, and re-draft them in place (putReply on
// an already-replied review updates it). Same engine, same gates.
const redoSince = argv.includes("--redo-template-since") ? argv[argv.indexOf("--redo-template-since") + 1] : null;

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
function buildPrompt(loc, review, recent = [], suggestion = null, locPhrase = null) {
  const s = stars(review);
  const facts = [...cfg.sharedFacts];
  if (loc.fullBar) facts.push("Full bar — you may say 'the full bar' or mention margaritas (a POS-verified top seller); do NOT name any other specific drink or cocktail");
  const constraints = loc.constraints || [];

  return `You write Google review replies for El Pueblo Mexican Food, a 5-location San Diego County Mexican restaurant. You are replying as the restaurant.

LOCATION: ${loc.name} (${loc.city})
TRUE FACTS you may reference: ${facts.join("; ")}
${constraints.length ? `HARD CONSTRAINTS for this location:\n${constraints.map(c => `- ${c}`).join("\n")}\n` : ""}
REVIEW (${s} stars) by ${review.reviewer?.displayName || "a guest"}:
"""${review.comment || "(no text — rating only)"}"""

RULES:
- Reply in the language the review is written in (Spanish review → Spanish reply). Rating-only reviews get English. In Spanish, use gender-neutral phrasing (e.g. "esperamos verte pronto") — never guess the reviewer's gender.
- BANNED phrases (overused): "a favorite among our regulars" / "fan favorite" / "free parking waiting out front". Say such things a different way each time, or not at all.
- Sound like a real person at this restaurant. Vary your opening; never start with "Thank you for your review".
- Keyword budget by rating — ${s} stars means: ${
    s >= 4 ? (suggestion
      ? `include 3-4 natural entities (the location — worded EXACTLY as: "${locPhrase}" — any staff the reviewer named, the dish they mentioned). You may ALSO suggest exactly ONE dish and it must be this one: ${suggestion}. Weave it in naturally in your own words — vary the framing, never reuse a suggestion phrasing that appears in the recent-replies list — or drop it entirely if it doesn't fit. NEVER suggest any other dish.`
      : `include 3-4 natural entities (the location — worded EXACTLY as: "${locPhrase}" — any staff the reviewer named, the dish THEY mentioned, a service attribute like the patio/free parking/salsa bar, an occasion like family dinner or beach day, or a nearby landmark). Do NOT suggest or introduce any dish the reviewer did not mention themselves.`)
    : s === 3 ? `include the location, worded EXACTLY as: "${locPhrase}", and you MAY echo a dish the reviewer themselves praised. Do NOT introduce any dish, attribute or invitation they did not raise.`
    : "include ZERO entities. No location, no dish, no attributes."
  }
${s <= 2 ? `- CRITICAL: assert NOTHING. Do not explain what happened, do not defend, do not guess at causes, do not promise specific remedies. Apologize, say you want to make it right, and give a contact route. A reply that makes no claims cannot make a wrong one.` : ""}
- Never use the phrase "near me". Never call yourself the best. Mention the business name at most once.
- Use the given location wording exactly once; do NOT write any other location construction (no "our ${loc.city} spot", no "our ${loc.city} location") unless it IS the given wording. If it genuinely doesn't fit the sentence, use just "${loc.city}" alone instead.
- The restaurant name is exactly "El Pueblo" (e.g. "El Pueblo Del Mar", "our Del Mar location"). Write it correctly the first time; never write a correction, aside, or "wait—" into the reply itself.
- If the reviewer named staff, echo their names — that matters more than any keyword.
- If the reviewer mentioned a landmark or neighbourhood, use it.
- Never name a competitor, even if the reviewer does.
- 2-4 sentences. No corporate filler ("we strive for excellence", "your feedback helps us").
- Do NOT invent facts not in the TRUE FACTS list. Do not infer amenities from a word in a fact (a "salsa bar" is not seating).
- NEVER offer, promise or imply anything free, discounted or comped — no "let us treat you", no "next one's on us", no vouchers. You have no authority to give anything away.
- The reviewer's display name may not be a real first name. Use it only if it reads like one; otherwise address them without a name rather than writing something absurd.
- You are speaking TO the reviewer, ABOUT the staff. Never open by addressing a staff member the reviewer praised ("Nate, you rock!" when Nate is the employee) — the reviewer is the audience; the staff member is not reading this.
- Never state, repeat, or confirm a price — not even one the reviewer mentions. Prices change and reviews disagree with each other; an owner reply affirming a wrong or stale price is a real problem. Praise the value without the number.
- Do not read ambiguous wording as praise. If the review is short and unclear ("a different experience"), stay neutral and do not invent a positive interpretation.
- Do not attribute to the reviewer anything they did not actually say — never thank them for praising the price, speed, or anything else that is not in their words.
- If the review is ambiguous or mixed, do NOT add a forward dish suggestion — selling to someone with a complaint reads as not listening.
- Proofread: no grammar slips ("a awesome"), no double spaces.
- Vary how you name dishes across replies — natural everyday names, not stiff menu titles.
${recent.length ? `\nANTI-REPETITION — these are replies you just wrote for other reviews. Do NOT reuse their closing line, their opening, their sales phrasing, or the dish/service attribute they mention (if one of them plugs free parking, you talk about something else). Vary sentence count too — some replies should be a single short sentence:\n${recent.map(r => `- "${r}"`).join("\n")}` : ""}

Return ONLY JSON:
{"sentiment":"positive|mixed|negative","theme":"food quality|order accuracy|wait time|service|price|cleanliness|other","staff":["names the reviewer mentioned"],"reply":"the reply text"}`;
}

async function draft(loc, review, recent = [], suggestion = null, locPhrase = null) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": anthropicKey(),
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      // Sonnet 5 runs ADAPTIVE THINKING by default when `thinking` is omitted —
      // on a hard review it can spend the whole cap thinking and return zero
      // text blocks ("no text block, stop_reason=max_tokens, types=[thinking]",
      // seen 2x on 8/24). max_tokens is a ceiling, not a spend: replies bill
      // ~400 tokens either way, so headroom here costs nothing.
      max_tokens: 4000,
      messages: [{ role: "user", content: buildPrompt(loc, review, recent, suggestion, locPhrase) }],
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
  // Reply-mode locations fetch deep: the newest-200 window was a silent stall
  // waiting to happen — full-history count 2026-08-20 found ~4,970 unreplied
  // across the four reply locations, most of them older than any 200-window.
  // Notify-only (Cardiff) stays shallow: it only scans for FRESH low stars.
  const fetchMax = loc.mode === "notify-only" ? 200 : 2500;
  const reviews = await listReviews(token, loc.account, loc.location, { max: fetchMax });

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

  const redoRe = new RegExp(`our\\s+${loc.city}\\s+(spot|location|team|crew)`, "i");
  const pending = redoSince
    ? reviews.filter(r => {
        const st = state.replied[reviewIdOf(r)];
        return st && st.at >= redoSince && r.reviewReply && redoRe.test(r.reviewReply.comment || "");
      }).slice(0, cfg.throttle.backlogPerLocationPerRun)
    : reviews
        .filter(r => !isReplied(r) && !state.replied[reviewIdOf(r)])
        .sort((a, b) => String(b.createTime).localeCompare(String(a.createTime)))
        .slice(0, cfg.throttle.backlogPerLocationPerRun);

  console.log(`── ${loc.name}: ${reviews.length} fetched, ${redoSince ? `${pending.length} template replies to redo` : `${reviews.filter(r => !isReplied(r)).length} unreplied, handling ${pending.length}`}`);

  // Cross-run anti-repetition: within-run window alone resets every day, which
  // is how the taco clustering happened — seed with this location's last
  // posted replies from previous runs too.
  const locRecent = state.recent[loc.slug] || [];

  for (const review of pending) {
    if (posted >= limit) { console.log(`   (run cap ${limit} reached)`); break; }
    const id = reviewIdOf(review);
    const s = stars(review);
    const suggestion = pickSuggestion(loc, review);
    const locPhrase = s >= 3 ? pickLocPhrase(loc) : null;
    let d;
    try { d = await draft(loc, review, [...locRecent.slice(-4), ...recentReplies.slice(-6)], suggestion, locPhrase); }
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

    // Brand-name gate: deterministic, runs on every reply. Any "Pueblo" not
    // preceded by "El ", and any narrated self-correction, SKIPS the reply for
    // next-run retry. Do NOT auto-correct in place — QA showed the model can
    // write "our Del Pueblo team - wait, El Pueblo Del Mar team!" and an
    // auto-fix would launder that incoherence straight onto the public profile.
    if (/(?<!El )Pueblo/.test(d.reply) || /\bwait\s*[,—]/i.test(d.reply) || /I mean\b/i.test(d.reply)) {
      console.log(`   ⚠ ${id}: brand-name gate — mangle or narrated correction, skipped: ${d.reply.slice(0, 120)}`);
      continue;
    }

    // NO generic phrase-convergence BLOCKING gate — considered and REJECTED
    // 2026-08-24. Replayed against the 8/24 run's real replies, a "shares a
    // 4-gram with 3+ recent replies" gate would have blocked 78 of 97 drafts:
    // the tripwires are natural courtesy closers ("hope to see you", "thanks
    // for the five stars") that healthy replies legitimately repeat. Template
    // collapse is instead surfaced by the post-run convergence audit below and
    // handled with targeted deterministic gates like the two that follow.

    // Price gate: deterministic, like the brand gate — prompt rules alone don't
    // hold. A reply must never carry a price, even one echoed from the reviewer
    // (QA 8/24: "That $1.50 taco deal" — reviews disagree $1/$1.39/$1.50, and a
    // stale price in an owner reply reads as a promise).
    if (/[$]\s*\d|\b\d+(?:[.,]\d{2})?\s*(?:dollars|bucks|dlls)\b/i.test(d.reply)) {
      console.log(`   ⚠ ${id}: price gate — reply states a price, skipped for retry: ${d.reply.slice(0, 120)}`);
      continue;
    }

    // Location-template gate: the convergent constructions may appear only when
    // they ARE the assigned wording. Deterministic — recurrence is impossible,
    // not just discouraged.
    const locTemplate = new RegExp(`our\\s+${loc.city}\\s+(spot|location)`, "i");
    if (locPhrase && locTemplate.test(d.reply) && !d.reply.toLowerCase().includes(locPhrase.toLowerCase())) {
      console.log(`   ⚠ ${id}: location-template gate — used "our ${loc.city} spot/location" instead of assigned wording, skipped for retry`);
      continue;
    }

    // Introduced-dish gate: a dish may appear in the reply only if the REVIEWER
    // mentioned it or it is the code-chosen suggestion. Measured 8/19: the model
    // introduced tacos unprompted in 37 of 118 posted replies (47% taco rate) —
    // this gate makes freelancing impossible rather than discouraged.
    // Reviewer typos must count as mentions ("gauc", "fires the most" — both real
    // 8/24 cases, both adjacent-letter swaps): exact-substring matching re-blocks
    // the same correct reply every run, forever, because the typo is permanent.
    const reviewWords = (review.comment || "").toLowerCase().split(/[^a-záéíóúñü]+/).filter(Boolean);
    const reviewerSaid = w => {
      const lw = w.toLowerCase();
      if ((review.comment || "").toLowerCase().includes(lw)) return true;
      if (lw.length < 4) return false; // fuzzy on short words over-matches
      return reviewWords.some(rw =>
        damerau1(rw, lw) || damerau1(rw.replace(/s$/, ""), lw) || damerau1(rw, lw.replace(/s$/, "")));
    };
    const introduced = (d.reply.match(new RegExp(DISH_WORDS.source, "gi")) || [])
      .filter(w => !reviewerSaid(w) &&
                   !(suggestion || "").toLowerCase().includes(w.toLowerCase()) &&
                   !/salsa/i.test(w)); // "salsa bar" is a service attribute, not a dish
    if (introduced.length) {
      console.log(`   ⚠ ${id}: introduced-dish gate — model added "${introduced.join('/')}" uninvited, skipped for retry`);
      continue;
    }

    if (APPLY) {
      // A single Google-side failure (429/500) must skip THIS review, not kill
      // the run — dying here would orphan notifications for replies already
      // posted above, so management would never hear about a live 1★ reply.
      try {
        await putReply(token, loc.account, loc.location, id, d.reply);
        state.replied[id] = { at: new Date().toISOString(), location: loc.slug, stars: s };
        (state.recent[loc.slug] ||= []).push(d.reply);
        while (state.recent[loc.slug].length > 12) state.recent[loc.slug].shift();
        console.log("   ✓ published");
      } catch (e) {
        console.log(`   ⚠ ${id}: publish failed — ${e.message.slice(0, 240)}`);
        continue; // unreplied on Google → retried next run; notification stays queued only if posted
      }
    }
    // Queue the management notification only once the reply has definitively
    // posted (or in dry run, where nothing persists anyway) — never email
    // management about a reply that failed to publish.
    if (!redoSince && (cfg.notify.immediateStars.includes(s) || cfg.notify.digestStars.includes(s)) && isFresh(review.createTime)) {
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

// Post-run convergence audit: measure phrase clustering across everything this
// run drafted. REPORT-ONLY — a blocking version was replayed against the 8/24
// run and would have gated 78/97 drafts on courtesy closers ("hope to see
// you", "thanks for the five stars"), which healthy replies legitimately
// repeat. The 🚨 fires only on CONTENT phrases (dish/brand/location tokens):
// both real collapses were content phrases (taco 47% on 8/19, "our La Jolla
// spot" 83% on 8/21); courtesy phrases report quietly for trend-watching.
if (recentReplies.length >= 8) {
  const contentTokens = new RegExp(
    `${DISH_WORDS.source}|pueblo|${cfg.locations.flatMap(l => [l.name, l.city]).map(s => s.toLowerCase().split(/\s+/)).flat().filter(w => w.length > 3).join("|")}`, "i");
  const freq = {};
  for (const r of recentReplies) {
    const w = r.toLowerCase().replace(/[^a-z0-9áéíóúñü\s]/g, " ").split(/\s+/).filter(Boolean);
    const seen = new Set();
    for (let i = 0; i + 4 <= w.length; i++) seen.add(w.slice(i, i + 4).join(" "));
    for (const g of seen) freq[g] = (freq[g] || 0) + 1;
  }
  const top = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 5).filter(([, n]) => n > 1);
  if (top.length) {
    console.log(`\nConvergence audit (${recentReplies.length} replies this run) — most-shared 4-word phrases:`);
    for (const [g, n] of top) {
      const pct = Math.round(100 * n / recentReplies.length);
      console.log(`   ${pct >= 25 && contentTokens.test(g) ? "🚨" : "  "} ${n}x (${pct}%) "${g}"`);
    }
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
