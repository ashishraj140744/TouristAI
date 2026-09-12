const fs = require("fs");
const path = require("path");

// Hardcoding a monument list was the original design and it does not survive contact
// with Solan: the nearest entry in the old landmarks.json was Red Fort, 271 km away.
// So candidates are resolved LIVE from OpenStreetMap + Wikipedia instead. Both are
// free and keyless. seed.json is only a no-signal fallback.
const SEED = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "places.json"), "utf8"));

const OVERPASS = "https://overpass-api.de/api/interpreter";
const WIKI = "https://en.wikipedia.org/w/api.php";

function distanceM(lat1, lon1, lat2, lon2) {
  const R = 6371000, toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// Wikipedia geosearch returns administrative areas too ("Solan district",
// "Solan Assembly constituency"). Those are not things you can point a camera at,
// and every junk candidate makes the multiple-choice harder.
const NOT_A_PLACE = /\b(district|assembly constituency|tehsil|subdivision|census|lok sabha|municipal|block|mandal|taluka)\b/i;

async function getJson(url, options = {}, ms = 12000) {
  const res = await fetch(url, { ...options, signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

async function fromOverpass(lat, lon, radius) {
  const q = `[out:json][timeout:15];
(
  nwr(around:${radius},${lat},${lon})[historic][name];
  nwr(around:${radius},${lat},${lon})[tourism~"^(attraction|museum|viewpoint|artwork|gallery)$"][name];
  nwr(around:${radius},${lat},${lon})[amenity="place_of_worship"][name];
  nwr(around:${radius},${lat},${lon})[building~"^(temple|church|cathedral|mosque|castle|monastery|palace)$"][name];
  nwr(around:${radius},${lat},${lon})[man_made~"^(tower|bridge|lighthouse)$"][name];
  nwr(around:${radius},${lat},${lon})[natural~"^(peak|waterfall|spring)$"][name];
);
out center 60;`;

  const data = await getJson(OVERPASS, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "data=" + encodeURIComponent(q)
  }, 15000);

  return (data.elements || []).map(el => {
    const t = el.tags || {};
    const plat = el.lat ?? el.center?.lat;
    const plon = el.lon ?? el.center?.lon;
    if (plat == null || !t.name) return null;
    return {
      name: t.name,
      category: t.historic || t.tourism || t.building || t.man_made || t.natural || t.amenity || "place",
      latitude: plat,
      longitude: plon,
      distance: distanceM(lat, lon, plat, plon),
      source: "osm",
      wikipedia: t.wikipedia || null
    };
  }).filter(Boolean);
}

async function fromWikipedia(lat, lon, radius) {
  const url = `${WIKI}?action=query&list=geosearch&gscoord=${lat}%7C${lon}&gsradius=${Math.min(radius, 10000)}&gslimit=20&format=json&origin=*`;
  const data = await getJson(url);
  return (data.query?.geosearch || [])
    .filter(p => !NOT_A_PLACE.test(p.title))
    .map(p => ({
    name: p.title,
    category: "wikipedia",
    latitude: p.lat,
    longitude: p.lon,
    distance: p.dist,
    source: "wikipedia",
    wikipedia: `en:${p.title}`
  }));
}

function fromSeed(lat, lon, radius) {
  return SEED
    .map(p => ({ ...p, distance: distanceM(lat, lon, p.latitude, p.longitude), source: "seed" }))
    .filter(p => p.distance <= radius);
}

/**
 * Candidates near a point. Widens the radius only if the tight one comes back thin —
 * a short list is the whole anti-hallucination mechanism, so we do not widen eagerly.
 */
async function nearbyPlaces(lat, lon, radius = 400) {
  const tiers = [radius, radius * 3, radius * 10];
  let found = [];

  for (const r of tiers) {
    const results = await Promise.allSettled([fromOverpass(lat, lon, r), fromWikipedia(lat, lon, r)]);
    found = results.flatMap(x => (x.status === "fulfilled" ? x.value : []));
    found.push(...fromSeed(lat, lon, r));

    const seen = new Map();
    for (const p of found.sort((a, b) => a.distance - b.distance)) {
      const key = norm(p.name);
      if (!key) continue;
      // Same place from two sources: keep the closer one but inherit the wikipedia link.
      if (seen.has(key)) {
        const existing = seen.get(key);
        if (!existing.wikipedia && p.wikipedia) existing.wikipedia = p.wikipedia;
        continue;
      }
      seen.set(key, p);
    }
    found = [...seen.values()];
    if (found.length >= 3) break;
  }

  return found.slice(0, 12);
}

/** Wikipedia intro text, used as ground truth so the guide is grounded rather than recalled. */
async function placeContext(title) {
  const clean = String(title).replace(/^[a-z]{2}:/, "");
  try {
    const url = `${WIKI}?action=query&prop=extracts&exintro&explaintext&redirects=1&titles=${encodeURIComponent(clean)}&format=json&origin=*`;
    const data = await getJson(url, {}, 8000);
    const pages = data.query?.pages || {};
    const page = Object.values(pages)[0];
    return page?.extract ? page.extract.slice(0, 1500) : "";
  } catch {
    return "";
  }
}

module.exports = { nearbyPlaces, placeContext, distanceM };
