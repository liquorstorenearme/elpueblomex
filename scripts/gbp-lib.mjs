// Shared Google Business Profile helpers. No deps, native fetch.
//
// Auth: needs GBP_CLIENT_ID, GBP_CLIENT_SECRET, GBP_REFRESH_TOKEN in the env.
// Locally those come from ~/Downloads/client_secret_2_374419*.json and
// ~/.config/gbp-refresh-token (see scripts/gbp-get-token.sh); in Actions they
// come from repo secrets.
//
// Reviews live on the OLD v4 host (mybusiness.googleapis.com) — the newer
// mybusinessbusinessinformation host has no reviews endpoint. Replying is v4 only.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const V4 = "https://mybusiness.googleapis.com/v4";

// Local fallback so the script runs on Scott's Mac without exporting anything.
function localCreds() {
  const dl = path.join(os.homedir(), "Downloads");
  const f = fs.existsSync(dl) && fs.readdirSync(dl).find(n => n.startsWith("client_secret_2_374419"));
  const tokFile = path.join(os.homedir(), ".config/gbp-refresh-token");
  if (!f || !fs.existsSync(tokFile)) return null;
  const j = JSON.parse(fs.readFileSync(path.join(dl, f), "utf8"));
  const k = Object.keys(j)[0];
  return {
    clientId: j[k].client_id,
    clientSecret: j[k].client_secret,
    refreshToken: fs.readFileSync(tokFile, "utf8").trim(),
  };
}

export function creds() {
  const env = {
    clientId: process.env.GBP_CLIENT_ID,
    clientSecret: process.env.GBP_CLIENT_SECRET,
    refreshToken: process.env.GBP_REFRESH_TOKEN,
  };
  if (env.clientId && env.clientSecret && env.refreshToken) return env;
  const local = localCreds();
  if (local) return local;
  throw new Error("No GBP credentials. Set GBP_CLIENT_ID/SECRET/REFRESH_TOKEN, or run scripts/gbp-get-token.sh.");
}

export async function accessToken() {
  const c = creds();
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: c.clientId,
      client_secret: c.clientSecret,
      refresh_token: c.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!r.ok) throw new Error(`token refresh ${r.status}: ${await r.text()}`);
  return (await r.json()).access_token;
}

async function api(token, url, init = {}) {
  const r = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  // Status + body must survive the caller's log truncation — a full v4 URL is
  // ~200 chars and used to push the actual failure reason past the cutoff.
  if (!r.ok) throw new Error(`${init.method || "GET"} /${url.replace(/\?.*/, "").split("/").pop()} → ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r.json();
}

// Reviews are paginated at 50. Pull every page so backlog counts are real.
export async function listReviews(token, account, location, { max = 200 } = {}) {
  const out = [];
  let pageToken = "";
  while (out.length < max) {
    const u = `${V4}/${account}/${location}/reviews?pageSize=50${pageToken ? `&pageToken=${pageToken}` : ""}`;
    const page = await api(token, u);
    out.push(...(page.reviews || []));
    pageToken = page.nextPageToken || "";
    if (!pageToken) break;
  }
  return out.slice(0, max);
}

export async function putReply(token, account, location, reviewId, comment) {
  return api(token, `${V4}/${account}/${location}/reviews/${reviewId}/reply`, {
    method: "PUT",
    body: JSON.stringify({ comment }),
  });
}

export const STARS = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
export const stars = r => STARS[r.starRating] || 0;
export const isReplied = r => Boolean(r.reviewReply);
export const reviewIdOf = r => String(r.reviewId || r.name || "").split("/").pop();
