export const LOCATION_EMAILS: Record<string, string> = {
  "cardiff-by-the-sea": "cardiff@elpueblomex.com",
  "carlsbad": "carlsbad@elpueblomex.com",
  "carmel-valley": "carmelvalley@elpueblomex.com",
  "del-mar": "delmar@elpueblomex.com",
  "la-jolla": "lajolla@elpueblomex.com",
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
