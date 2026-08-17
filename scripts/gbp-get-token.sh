#!/bin/bash
# Runs the GBP OAuth loopback flow and saves ONLY the refresh token to
# ~/.config/gbp-refresh-token (chmod 600). Nothing secret is printed.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

CRED=$(ls "$HOME"/Downloads/client_secret_2_374419*.json 2>/dev/null | head -1)
if [ -z "$CRED" ]; then echo "❌ credentials JSON not found in ~/Downloads"; exit 1; fi
echo "✓ credentials: $(basename "$CRED" | cut -c1-30)…"

CID=$(python3 -c "import json;d=json.load(open('$CRED'));k=list(d)[0];print(d[k]['client_id'])") || exit 1
CSEC=$(python3 -c "import json;d=json.load(open('$CRED'));k=list(d)[0];print(d[k]['client_secret'])") || exit 1
if [ -z "$CID" ] || [ -z "$CSEC" ]; then echo "❌ could not read client_id/secret"; exit 1; fi
echo "✓ client id ends …${CID: -24}"

OUT=$(mktemp /tmp/gbp.XXXXXX)
echo "→ opening browser — consent as IT@elpueblomex.com"
GBP_CLIENT_ID="$CID" GBP_CLIENT_SECRET="$CSEC" node scripts/gbp-auth.mjs 2>&1 | tee "$OUT" | grep -v "GBP_REFRESH_TOKEN="

mkdir -p "$HOME/.config"
sed -n 's/^GBP_REFRESH_TOKEN=//p' "$OUT" | tr -d '\n' > "$HOME/.config/gbp-refresh-token"
chmod 600 "$HOME/.config/gbp-refresh-token"
rm -f "$OUT"

if [ -s "$HOME/.config/gbp-refresh-token" ]; then
  echo "✅ refresh token saved → ~/.config/gbp-refresh-token ($(wc -c < "$HOME/.config/gbp-refresh-token" | tr -d ' ') bytes)"
else
  rm -f "$HOME/.config/gbp-refresh-token"
  echo "❌ no refresh token returned. Most likely a prior grant already exists."
  echo "   Revoke at myaccount.google.com/permissions (⚠️ this kills the dev's token too), then re-run."
fi
