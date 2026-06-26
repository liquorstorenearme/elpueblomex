#!/usr/bin/env node
// Full Business Profile structure dump: EVERY account, EVERY location (paginated).
// Logs in once, prints the complete tree. No tokens printed/stored.
//
// Usage: node scripts/gbp-structure.mjs ~/Downloads/client_secret_2_...json

import fs from "node:fs";
import http from "node:http";
import crypto from "node:crypto";
import { exec } from "node:child_process";

const conf = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const { client_id, client_secret } = conf.web || conf.installed;
const SCOPE = "https://www.googleapis.com/auth/business.manage";
const PORT = 4571, REDIRECT = `http://localhost:${PORT}`;
const state = crypto.randomBytes(12).toString("hex");

const authUrl = () => "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
  client_id, redirect_uri: REDIRECT, response_type: "code", scope: SCOPE,
  access_type: "offline", prompt: "consent", state,
});
async function tokenFromCode(code) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id, client_secret, redirect_uri: REDIRECT, grant_type: "authorization_code" }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
async function getAll(urlBase, token, key) {
  const out = []; let pageToken = "";
  do {
    const sep = urlBase.includes("?") ? "&" : "?";
    const url = urlBase + (pageToken ? `${sep}pageToken=${pageToken}` : "");
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) { console.log(`   (HTTP ${r.status} on ${key}: ${(await r.text()).slice(0,160)})`); break; }
    const d = await r.json();
    (d[key] || []).forEach(x => out.push(x));
    pageToken = d.nextPageToken || "";
  } while (pageToken);
  return out;
}

async function dump(token) {
  console.log("\n======== FULL BUSINESS PROFILE STRUCTURE ========");
  const accounts = await getAll("https://mybusinessaccountmanagement.googleapis.com/v1/accounts?pageSize=100", token, "accounts");
  console.log(`Accounts: ${accounts.length}\n`);
  let grand = 0;
  for (const a of accounts) {
    console.log(`■ ${a.accountName || "(no name)"}  [${a.name}]  type=${a.type || "?"}`);
    const locs = await getAll(
      `https://mybusinessbusinessinformation.googleapis.com/v1/${a.name}/locations?readMask=name,title,storefrontAddress&pageSize=100`,
      token, "locations");
    grand += locs.length;
    if (!locs.length) { console.log("    (no locations)"); }
    locs.forEach(l => {
      const city = l.storefrontAddress?.locality || "";
      const region = l.storefrontAddress?.administrativeArea || "";
      const where = city ? ` — ${city}${region ? ", " + region : ""}` : "";
      console.log(`    • ${l.title}${where}  [${l.name}]`);
    });
    console.log("");
  }
  console.log(`Total locations across all accounts: ${grand}`);
  console.log("=================================================\n");
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, REDIRECT);
  if (!u.searchParams.get("code") && !u.searchParams.get("error")) return res.writeHead(204).end();
  if (u.searchParams.get("error")) { res.end("Auth error"); server.close(); return; }
  res.writeHead(200, { "Content-Type": "text/html" }).end("<h2>Authorized — see your terminal for the full structure.</h2>");
  try { const t = await tokenFromCode(u.searchParams.get("code")); await dump(t.access_token); }
  catch (e) { console.error(e.message); }
  finally { server.close(); }
});
server.listen(PORT, () => {
  const url = authUrl();
  console.log("Opening browser — log in as IT@elpueblomex.com.\nIf it doesn't open:\n" + url + "\n");
  const o = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  exec(`${o} "${url}"`);
});
