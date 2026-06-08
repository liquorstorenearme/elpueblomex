// Shared helpers for catering: base64 (edge-safe) + .ics calendar invite.

export function toBase64(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

// YYYY-MM-DD -> YYYYMMDD (all-day VALUE=DATE)
function dateOnly(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}

// UTC stamp YYYYMMDDTHHMMSSZ
function stamp(d: Date): string {
  return `${dateOnly(d)}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

function fold(line: string): string {
  // RFC 5545 line folding at 75 octets; simple char-based fold is fine for our content.
  if (line.length <= 73) return line;
  const chunks: string[] = [];
  let rest = line;
  chunks.push(rest.slice(0, 73));
  rest = rest.slice(73);
  while (rest.length > 72) {
    chunks.push(" " + rest.slice(0, 72));
    rest = rest.slice(72);
  }
  if (rest.length) chunks.push(" " + rest);
  return chunks.join("\r\n");
}

function escapeText(s: string): string {
  return String(s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

export interface IcsEvent {
  uid: string;
  summary: string;
  description: string;
  location: string;
  date: string; // YYYY-MM-DD (event day; rendered as an all-day hold)
}

/**
 * Build an all-day calendar invite (METHOD:PUBLISH = informational hold, not a
 * meeting request). Returns null if the date is missing/unparseable.
 */
export function buildIcs(ev: IcsEvent): string | null {
  if (!ev.date || !/^\d{4}-\d{2}-\d{2}$/.test(ev.date)) return null;
  const start = new Date(`${ev.date}T00:00:00Z`);
  if (isNaN(start.getTime())) return null;
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000); // DTEND = next day for all-day
  const now = new Date();

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//El Pueblo Mexican Food//Catering//EN",
    "METHOD:PUBLISH",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${ev.uid}@elpueblomex.com`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART;VALUE=DATE:${dateOnly(start)}`,
    `DTEND;VALUE=DATE:${dateOnly(end)}`,
    fold(`SUMMARY:${escapeText(ev.summary)}`),
    fold(`DESCRIPTION:${escapeText(ev.description)}`),
    fold(`LOCATION:${escapeText(ev.location)}`),
    "STATUS:TENTATIVE",
    "TRANSP:TRANSPARENT",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.join("\r\n");
}
