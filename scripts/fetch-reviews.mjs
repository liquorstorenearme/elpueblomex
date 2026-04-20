#!/usr/bin/env node
// Fetch Google reviews via Places API (New).
// Usage: GOOGLE_PLACES_API_KEY=xxx node scripts/fetch-reviews.mjs
// Writes content/reviews.json. Auto-discovers googlePlaceId via text search if missing.

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

async function searchText(query, fieldMask) {
  const r = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": fieldMask,
    },
    body: JSON.stringify({ textQuery: query }),
  });
  if (!r.ok) throw new Error(`searchText ${r.status}: ${await r.text()}`);
  return r.json();
}

async function placeDetails(placeId, fieldMask) {
  const r = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
    headers: {
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": fieldMask,
    },
  });
  if (!r.ok) throw new Error(`placeDetails ${r.status}: ${await r.text()}`);
  return r.json();
}

async function findPlaceId(loc) {
  const query = `El Pueblo Mexican Food ${loc.short} ${loc.address.street} ${loc.address.city} ${loc.address.region}`;
  const data = await searchText(query, "places.id,places.displayName,places.formattedAddress,places.primaryType");
  if (!data.places?.length) throw new Error(`No match for ${loc.slug}`);
  // Skip pure address results (no business type)
  const biz = data.places.find(p => p.primaryType && p.primaryType !== "street_address" && p.primaryType !== "premise") || data.places[0];
  return biz.id;
}

async function getReviews(placeId) {
  return placeDetails(placeId, "id,displayName,rating,userRatingCount,reviews,googleMapsUri");
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
    const d = await getReviews(placeId);
    out.locations[loc.slug] = {
      placeId,
      name: d.displayName?.text || loc.name,
      rating: d.rating ?? null,
      total: d.userRatingCount ?? 0,
      googleUrl: d.googleMapsUri || `https://www.google.com/maps/place/?q=place_id:${placeId}`,
      reviews: (d.reviews || []).map(rv => ({
        author: rv.authorAttribution?.displayName || "Anonymous",
        profilePhoto: rv.authorAttribution?.photoUri || null,
        authorUrl: rv.authorAttribution?.uri || null,
        rating: rv.rating,
        text: rv.text?.text || rv.originalText?.text || "",
        relativeTime: rv.relativePublishTimeDescription || "",
        publishTime: rv.publishTime || null,
      })),
    };
    console.log(`${loc.slug}: ${d.rating} ★ · ${d.userRatingCount} reviews · ${d.reviews?.length || 0} cached`);
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
