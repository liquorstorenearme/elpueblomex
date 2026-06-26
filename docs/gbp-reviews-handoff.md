# Google Business Profile — Reviews/Reply Integration Hand-off

Hand-off for the developer building the in-admin "reply to reviews" dashboard.
Everything below is for the El Pueblo Mexican Food Business Profiles (5 SD County locations).

## Google Cloud project
- **Project name:** `restart-elpueblo`
- **Project number:** `374419218276`

## APIs enabled (verified 2026-06-26)
- ✅ **Google My Business API** — `mybusiness.googleapis.com` v4 → **reviews + replies live here**
- ✅ My Business Account Management API — `mybusinessaccountmanagement.googleapis.com` v1 → list accounts
- ✅ My Business Business Information API — `mybusinessbusinessinformation.googleapis.com` v1 → list locations
- ✅ Business Profile Performance API — metrics (not needed for reviews)

> The legacy `mybusiness.googleapis.com` reviews/reply endpoints are access-gated.
> The API is enabled, which usually means project access was already approved.
> **Confirm with your first real call** — if it returns `403 PERMISSION_DENIED`,
> the owner must submit the access form: https://support.google.com/business/workflow/16726127
> (Application for Basic API Access, project number above.)

## ✅ Access verified — 2026-06-26
Ran a live end-to-end test (OAuth login as IT@elpueblomex.com → list accounts →
list locations → read reviews). Result: **FULL ACCESS CONFIRMED.** The reviews
API returned data (read 221 reviews on a test location) — so reading reviews AND
posting replies both work. No access form needed; approval was already granted.

**IMPORTANT — listings span TWO accounts. Walk BOTH (verified full enumeration 2026-06-26):**

`accounts/102408089622182212349` — "IT Department" (type PERSONAL)
- `locations/14329118829848193610` — Bomber Squad Academy (El Cajon) ← NOT El Pueblo; filter out if dashboard is El-Pueblo-only
- `locations/14836919300882504669` — El Pueblo Mexican Food – La Jolla ← the odd one out, lives here not in the group below

`accounts/107556498414456817580` — "El Pueblo Mexican Food" (type LOCATION_GROUP)
- `locations/10328738512596809280` — El Pueblo – Carlsbad
- `locations/7240440297771033418`  — El Pueblo & Bar – Del Mar
- `locations/14071145588987116045` — El Pueblo – Cardiff (Encinitas)
- `locations/1189929405054644351`  — El Pueblo & Bar – Carmel Valley (San Diego)

GOTCHA: La Jolla is in the PERSONAL account, not the El Pueblo group — loop both
accounts or you'll silently miss it. Authorizing account: IT@elpueblomex.com.

## OAuth (how the app authenticates)
- **Type:** OAuth 2.0, user consent (NOT an API key, NOT a service account — GBP
  requires a real Owner/Manager of the listings to authorize).
- **Scope:** `https://www.googleapis.com/auth/business.manage`  (single scope, covers all of the above)
- **Existing client:** "ElPuebloMex-Business-Profile-Performance" (Web application type)
  - Client ID / Secret: provided separately by Scott over a private channel.
  - If you build the consent flow into the dashboard, add your dashboard's
    redirect URI to this client (or ask Scott to create a fresh client for you).
- **Consent screen:** Internal (Workspace) — no Google verification, refresh tokens don't expire.

## API flow for reviews
1. **Find the account:**
   `GET https://mybusinessaccountmanagement.googleapis.com/v1/accounts`
   → grab `accounts[].name` (e.g. `accounts/123456789`)
2. **List locations:**
   `GET https://mybusinessbusinessinformation.googleapis.com/v1/{account}/locations?readMask=name,title`
   → grab `locations[].name` (e.g. `locations/987654321`)
3. **List reviews (all of them, paginated):**
   `GET https://mybusiness.googleapis.com/v4/{account}/{location}/reviews`
4. **Reply to a review:**
   ```
   PUT https://mybusiness.googleapis.com/v4/{account}/{location}/reviews/{reviewId}/reply
   Authorization: Bearer <oauth-access-token>
   Content-Type: application/json

   { "comment": "Thanks for visiting El Pueblo!" }
   ```
5. **Delete a reply:** `DELETE …/reviews/{reviewId}/reply`

## Notes
- Unlike the Places API (which only returns ~5 reviews and can't reply), this returns
  ALL reviews and supports posting/editing/deleting replies.
- The site's public review display still uses the Places API key
  (`GOOGLE_PLACES_API_KEY`, GitHub Action `refresh-reviews.yml`) — that stays as-is;
  this integration is separate, for the admin dashboard.
