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

export function resolveRecipients(
  locationSlug: string,
  fallback: string,
): { to: string[]; cc: string[] } {
  const locEmail = LOCATION_EMAILS[locationSlug];
  if (locEmail) return { to: [locEmail], cc: [] };
  const to = fallback.split(",").map((s) => s.trim()).filter(Boolean);
  return { to, cc: [] };
}
