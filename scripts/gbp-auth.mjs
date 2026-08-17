#!/usr/bin/env node
// One-time OAuth helper for the Google Business Profile API.
// Runs the Desktop-app loopback flow and prints a long-lived refresh token.
//
// Prereqs (Google Cloud Console, same project as Places API):
//   1. Business Profile API access approved (the manual request form).
//   2. OAuth consent screen = Internal, scope business.manage added.
//   3. OAuth client ID, type "Desktop app" -> gives client_id + client_secret.
//
// Usage:
//   GBP_CLIENT_ID=xxx GBP_CLIENT_SECRET=yyy node scripts/gbp-auth.mjs
//
// It opens your browser, you consent as the El Pueblo Workspace owner/manager,
// and it prints GBP_REFRESH_TOKEN to store in Vercel + the GitHub Action.

import http from "node:http";
import crypto from "node:crypto";
import { exec } from "node:child_process";

const clientId = process.env.GBP_CLIENT_ID;
const clientSecret = process.env.GBP_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error("Set GBP_CLIENT_ID and GBP_CLIENT_SECRET in the environment.");
  process.exit(1);
}

const SCOPE = "https://www.googleapis.com/auth/business.manage";
const PORT = 4571; // loopback port; must match nothing else running
const REDIRECT = `http://localhost:${PORT}`;
const state = crypto.randomBytes(16).toString("hex");

function authUrl() {
  const p = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",   // required to receive a refresh token
    prompt: "consent",        // force refresh-token issuance every run
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

async function exchange(code) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT,
      grant_type: "authorization_code",
    }),
  });
  if (!r.ok) throw new Error(`token exchange ${r.status}: ${await r.text()}`);
  return r.json();
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT);
  if (!url.searchParams.get("code") && !url.searchParams.get("error")) {
    res.writeHead(204).end();
    return;
  }
  const err = url.searchParams.get("error");
  if (err) {
    res.writeHead(400, { "Content-Type": "text/plain" }).end(`Auth error: ${err}`);
    console.error(`Auth error: ${err}`);
    server.close();
    process.exit(1);
  }
  if (url.searchParams.get("state") !== state) {
    res.writeHead(400, { "Content-Type": "text/plain" }).end("State mismatch.");
    console.error("State mismatch — aborting.");
    server.close();
    process.exit(1);
  }
  try {
    const tok = await exchange(url.searchParams.get("code"));
    res.writeHead(200, { "Content-Type": "text/html" }).end(
      "<h2>Authorized.</h2><p>Refresh token printed in your terminal. You can close this tab.</p>"
    );
    console.log("\n=== SUCCESS ===");
    console.log("GBP_REFRESH_TOKEN=" + tok.refresh_token);
    if (!tok.refresh_token) {
      console.log("\n(no refresh_token returned — revoke prior grant at");
      console.log(" https://myaccount.google.com/permissions and re-run.)");
    }
    console.log("\nStore that as an env var in Vercel and the GitHub Action.");
  } catch (e) {
    res.writeHead(500, { "Content-Type": "text/plain" }).end(String(e));
    console.error(e.message);
  } finally {
    // server.close() alone only stops NEW connections — the browser holds a
    // keep-alive socket open, so node hangs until you manually close the tab.
    // Drop live sockets and exit explicitly so the script always returns.
    res.on("finish", () => {
      server.closeAllConnections?.();
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 1000).unref();
    });
  }
});

server.listen(PORT, () => {
  const u = authUrl();
  console.log("Opening browser to authorize. If it doesn't open, visit:\n" + u + "\n");
  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  exec(`${opener} "${u}"`);
});
