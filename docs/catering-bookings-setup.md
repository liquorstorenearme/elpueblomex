# Catering bookings — setup & how it works

The catering program (`/catering-preview/`, will replace `/catering/` once approved)
captures every request, emails the servicing location, and shows all bookings in the
admin **Catering** tab. Payment is **not** taken on the site — GMs send the 50% deposit
and balance as **Toast invoices** (money stays in the existing Toast books).

## What you need to provision (one-time)

Bookings are stored in **Vercel KV (Upstash Redis)**. Until the store is connected, the
form still works (it just emails) and the admin Catering tab shows a "not set up yet" note.

1. In the Vercel dashboard → the **elpueblomex** project → **Storage** → **Create Database**
   → **KV / Upstash Redis** (free tier is plenty).
2. **Connect** the store to the project. Vercel auto-injects these env vars:
   `KV_REST_API_URL` and `KV_REST_API_TOKEN` (also `KV_URL`, `KV_REST_API_READ_ONLY_TOKEN`).
3. **Redeploy** (any push works). The deploy installs `@vercel/kv` and bookings start saving.

No Google/Calendar setup is required — calendar holds are delivered as `.ics` attachments.

## How it flows

1. Customer submits the catering form → `POST /api/catering`.
2. The request is saved to KV (`catering:bookings` hash, status **Inquiry**) **and** emailed
   to the nearest location (`cardiff@`, `carlsbad@`, `carmelvalley@`, `delmar@`, `lajolla@`).
3. The email includes a **`.ics` calendar invite** (all-day tentative hold on the event date)
   the GM clicks to drop onto their calendar — helps enforce the 2-events/day cap.
4. GM works the booking: confirms availability, sets delivery fee + county tax, sends the
   **Toast deposit invoice**, and updates the status in the admin **Catering** tab.

### Booking statuses
`Inquiry → Deposit paid → Confirmed → Balance paid → Completed` (plus `Cancelled`).
Toast notifies the GM when a payment actually lands; the admin tab is the at-a-glance pipeline.

## Files

- `api/catering.ts` — saves the booking, emails the location, attaches the `.ics`.
- `api/_bookings.ts` — KV data model (single `catering:bookings` hash) + helpers.
- `api/_ics.ts` — `.ics` invite builder + edge-safe base64.
- `api/admin/bookings.ts` — `GET` list / `PATCH` status+notes (gated by middleware).
- `public/edit/index.html` — the admin **Catering** tab (self-managed, KV-backed).
- `middleware.ts` — auth gate for `/api/admin/bookings`.

## Notes

- No payment/PCI code lives on the site; deposits and balances run through Toast.
- KV reads/writes are non-fatal in `/api/catering` — if KV is down or unset, the lead still
  emails so nothing is lost.
