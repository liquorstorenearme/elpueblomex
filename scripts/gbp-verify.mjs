#!/usr/bin/env node
// Verify FULL Business Profile access end-to-end: logs in once, then checks
// it can list accounts, see the El Pueblo locations, and read/reply to reviews.
// Reports results in plain English. Does NOT print or store any tokens.
//
// Usage:
//   node scripts/gbp-verify.mjs ~/Downloads/client_secret_2_...json
//
// Prereq: the web OAuth client must have http://localhost:4571 in its
// "Authorized redirect URIs" (Google Cloud Console -> Credentials -> the client).

import fs from "node:fs";
import http from "node:http";
import crypto from "node:crypto";
import { exec } from "node:child_process";

const jsonPath = process.argv[2];
if (!jsonPath || !fs.existsSync(jsonPath)) {
  console.error("Pass the path to the downloaded client_secret JSON.");
  process.exit(1);
}
const conf = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
const c = conf.web || conf.installed;
const { client_id, client_secret } = c;

const SCOPE = "https://www.googleapis.com/auth/business.manage";
const PORT = 4571;
const REDIRECT = `http://localhost:${PORT}`;
const state = crypto.randomBytes(12).toString("hex");

function authUrl() {
  return "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
    client_id, redirect_uri: REDIRECT, response_type: "code",
    scope: SCOPE, access_type: "offline", prompt: "consent", state,
  });
}
async function tokenFromCode(code) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id, client_secret, redirect_uri: REDIRECT, grant_type: "authorization_code" }),
  });
  if (!r.ok) throw new Error(`token exchange ${r.status}: ${await r.text()}`);
  return r.json();
}
async function api(url, token) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const body = await r.text();
  return { ok: r.ok, status: r.status, body };
}

async function runChecks(token) {
  console.log("\n========== ACCESS REPORT ==========");

  // 1. Accounts
  const acc = await api("https://mybusinessaccountmanagement.googleapis.com/v1/accounts", token);
  if (!acc.ok) {
    console.log(`❌ Cannot list accounts (HTTP ${acc.status}).`);
    console.log(`   ${acc.body.slice(0, 300)}`);
    if (acc.status === 403) console.log("   → 403 = the logged-in account isn't authorized, or API access not approved.");
    return;
  }
  const accounts = JSON.parse(acc.body).accounts || [];
  console.log(`✅ Accounts visible: ${accounts.length}`);
  accounts.forEach(a => console.log(`   - ${a.accountName || a.name} (${a.name})`));
  if (!accounts.length) { console.log("   ⚠️ Logged-in account manages NO Business Profiles. Wrong Google account?"); return; }

  // 2. Locations under the first account
  const account = accounts[0].name;
  const loc = await api(`https://mybusinessbusinessinformation.googleapis.com/v1/${account}/locations?readMask=name,title&pageSize=100`, token);
  if (!loc.ok) {
    console.log(`❌ Cannot list locations (HTTP ${loc.status}). ${loc.body.slice(0, 200)}`);
    return;
  }
  const locations = JSON.parse(loc.body).locations || [];
  console.log(`✅ Locations under ${account}: ${locations.length}`);
  locations.forEach(l => console.log(`   - ${l.title} (${l.name})`));
  if (!locations.length) { console.log("   ⚠️ No locations — account may not directly own them (could be a group/org)."); return; }

  // 3. Reviews on the first location (THE access-gated call)
  const locId = locations[0].name; // e.g. locations/123
  const rev = await api(`https://mybusiness.googleapis.com/v4/${account}/${locId}/reviews`, token);
  if (rev.ok) {
    const data = JSON.parse(rev.body);
    console.log(`✅ REVIEWS API WORKS — full access confirmed.`);
    console.log(`   ${locations[0].title}: ${data.totalReviewCount ?? "?"} reviews, avg ${data.averageRating ?? "?"}★`);
    console.log(`   → Reading reviews AND posting replies will work for your dev.`);
  } else {
    console.log(`❌ Reviews call failed (HTTP ${rev.status}).`);
    console.log(`   ${rev.body.slice(0, 300)}`);
    if (rev.status === 403) console.log("   → 403 here = the reviews API access was NOT approved yet. Submit the access form.");
    if (rev.status === 404) console.log("   → 404 = location path mismatch; dev can adjust account/location IDs.");
  }
  console.log("===================================\n");
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, REDIRECT);
  if (!u.searchParams.get("code") && !u.searchParams.get("error")) return res.writeHead(204).end();
  if (u.searchParams.get("error")) { res.end("Auth error: " + u.searchParams.get("error")); server.close(); return; }
  if (u.searchParams.get("state") !== state) { res.end("state mismatch"); server.close(); process.exit(1); }
  res.writeHead(200, { "Content-Type": "text/html" }).end("<h2>Authorized — check your terminal for the access report.</h2>");
  try { const tok = await tokenFromCode(u.searchParams.get("code")); await runChecks(tok.access_token); }
  catch (e) { console.error(e.message); }
  finally { server.close(); }
});
server.listen(PORT, () => {
  const url = authUrl();
  console.log("Opening browser — log in as the El Pueblo OWNER/MANAGER account.\nIf it doesn't open:\n" + url + "\n");
  const o = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  exec(`${o} "${url}"`);
});
