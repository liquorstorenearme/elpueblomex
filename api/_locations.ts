import { FORM_TO } from "./_recipients";

export const LOCATION_EMAILS: Record<string, string> = {
  "cardiff-by-the-sea": "cardiff@elpueblomex.com",
  "carlsbad": "carlsbad@elpueblomex.com",
  "carmel-valley": "carmelvalley@elpueblomex.com",
  "del-mar": "delmar@elpueblomex.com",
  "la-jolla": "lajolla@elpueblomex.com",
};

export const LOCATION_NAMES: Record<string, string> = {
  "cardiff-by-the-sea": "Cardiff-by-the-Sea",
  "carlsbad": "Carlsbad",
  "carmel-valley": "Carmel Valley",
  "del-mar": "Del Mar",
  "la-jolla": "La Jolla",
};

// Per-location routing is switched off: every form goes to FORM_TO regardless of
// the slug (owner decision, 2026-09-24). LOCATION_EMAILS is kept for reference only.
export function resolveRecipients(
  _locationSlug: string,
  _fallback: string,
): { to: string[]; cc: string[] } {
  const to = FORM_TO.split(",").map((s) => s.trim()).filter(Boolean);
  return { to, cc: [] };
}
