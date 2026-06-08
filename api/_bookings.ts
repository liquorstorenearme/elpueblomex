import { kv } from "@vercel/kv";

// Catering bookings are transactional records (with mutable status), stored as a
// single Redis hash: field = booking id, value = booking object.
export const BOOKINGS_KEY = "catering:bookings";

export const STATUSES = [
  "Inquiry",
  "Deposit paid",
  "Confirmed",
  "Balance paid",
  "Completed",
  "Cancelled",
] as const;
export type Status = (typeof STATUSES)[number];

export interface Booking {
  id: string;
  createdAt: string; // ISO
  location: string; // slug
  locationName: string;
  name: string;
  email: string;
  phone: string;
  organization: string;
  package: string;
  guests: string;
  date: string; // event date YYYY-MM-DD
  message: string;
  status: Status;
  notes: string; // GM-internal notes
}

export function kvConfigured(): boolean {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

export async function saveBooking(b: Booking): Promise<void> {
  await kv.hset(BOOKINGS_KEY, { [b.id]: b });
}

export async function listBookings(): Promise<Booking[]> {
  const all = await kv.hgetall<Record<string, Booking>>(BOOKINGS_KEY);
  if (!all) return [];
  return Object.values(all).sort((a, b) =>
    (b.createdAt || "").localeCompare(a.createdAt || ""),
  );
}

export async function getBooking(id: string): Promise<Booking | null> {
  return (await kv.hget<Booking>(BOOKINGS_KEY, id)) ?? null;
}

export async function updateBooking(
  id: string,
  patch: Partial<Booking>,
): Promise<Booking | null> {
  const cur = await getBooking(id);
  if (!cur) return null;
  const next: Booking = { ...cur, ...patch, id: cur.id };
  await kv.hset(BOOKINGS_KEY, { [id]: next });
  return next;
}
