#!/usr/bin/env node
// Fetch Google reviews for each location via Places API (legacy).
// Usage: GOOGLE_PLACES_API_KEY=xxx node scripts/fetch-reviews.mjs
// Writes content/reviews.json. Auto-discovers googlePlaceId if missing.

import fs from "node:fs";
import path from "node:path";

const key = process.env.GOOGLE_PLACES_API_KEY;
if (!key) {
  console.error("Set GOOGLE_PLACES_API_KEY in the environment.");
  process.exit(1);
}

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const locPath = path.join(root, "content/locations.json");
const outPath = path.join(root, "content/reviews.json");

const locFile = JSON.parse(fs.readFileSync(locPath, "utf8"));
const locations = locFile.locations.filter(l => !l.comingSoon);

async function findPlaceId(loc) {
  const query = `${loc.name} ${loc.address.street} ${loc.address.city} ${loc.address.region}`;
  const u = new URL("https://maps.googleapis.com/maps/api/place/findplacefromtext/json");
  u.searchParams.set("input", query);
  u.searchParams.set("inputtype", "textquery");
  u.searchParams.set("fields", "place_id,name,formatted_address");
  u.searchParams.set("key", key);
  const r = await fetch(u);
  const j = await r.json();
  if (j.status !== "OK" || !j.candidates?.length) {
    throw new Error(`findPlaceFromText ${j.status} for ${loc.slug}: ${j.error_message || ""}`);
  }
  return j.candidates[0].place_id;
}

async function getDetails(placeId) {
  const u = new URL("https://maps.googleapis.com/maps/api/place/details/json");
  u.searchParams.set("place_id", placeId);
  u.searchParams.set("fields", "name,rating,user_ratings_total,reviews,url");
  u.searchParams.set("reviews_sort", "newest");
  u.searchParams.set("key", key);
  const r = await fetch(u);
  const j = await r.json();
  if (j.status !== "OK") throw new Error(`placeDetails ${j.status}: ${j.error_message || ""}`);
  return j.result;
}

const out = { fetched_at: new Date().toISOString(), locations: {} };
let updatedLocations = false;

for (const loc of locations) {
  try {
    let placeId = loc.googlePlaceId;
    if (!placeId) {
      placeId = await findPlaceId(loc);
      loc.googlePlaceId = placeId;
      updatedLocations = true;
      console.log(`Discovered ${loc.slug}: ${placeId}`);
    }
    const details = await getDetails(placeId);
    out.locations[loc.slug] = {
      placeId,
      name: details.name,
      rating: details.rating ?? null,
      total: details.user_ratings_total ?? 0,
      googleUrl: details.url || `https://search.google.com/local/reviews?placeid=${placeId}`,
      reviews: (details.reviews || []).map(rv => ({
        author: rv.author_name,
        profilePhoto: rv.profile_photo_url || null,
        rating: rv.rating,
        text: rv.text || "",
        relativeTime: rv.relative_time_description,
        timestamp: rv.time,
      })),
    };
    console.log(`${loc.slug}: ${details.rating} ★ · ${details.user_ratings_total} reviews`);
  } catch (err) {
    console.error(`Failed ${loc.slug}:`, err.message);
  }
}

fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(`Wrote ${outPath}`);

if (updatedLocations) {
  fs.writeFileSync(locPath, JSON.stringify(locFile, null, 2));
  console.log(`Updated ${locPath} with discovered Place IDs`);
}
