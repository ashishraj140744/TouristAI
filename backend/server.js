require("dotenv").config();
const express = require("express");
const multer = require("multer");
const path = require("path");
const { identifyLandmark, generateGuide, askAbout } = require("./services/gemini");
const { nearbyPlaces, placeContext } = require("./services/places");
const cache = require("./services/cache");

const app = express();
const PORT = process.env.PORT || 3000;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "frontend")));

/** Raw SDK errors are not for a projector screen. Translate the ones that actually happen. */
function friendly(err) {
  const m = String(err?.message || "");
  if (/429|RESOURCE_EXHAUSTED|quota/i.test(m)) return { status: 429, error: "Free tier limit reached for now. Wait a minute and try again." };
  if (/API_KEY|API key|PERMISSION_DENIED|401|403/i.test(m)) return { status: 500, error: "Server is not configured correctly. Check GEMINI_API_KEY in backend/.env." };
  if (/404|not found|NOT_FOUND/i.test(m)) return { status: 500, error: "The configured Gemini model is unavailable. Check GEMINI_MODEL in backend/.env." };
  if (/timeout|ETIMEDOUT|abort|fetch failed|ENOTFOUND/i.test(m)) return { status: 503, error: "Network problem reaching the AI service. Check your connection and retry." };
  return { status: 500, error: "Something went wrong. Please try again." };
}

function fail(res, err) {
  console.error(err);
  const f = friendly(err);
  res.status(f.status).json({ error: f.error });
}

const validCoords = (lat, lon) =>
  Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;

/**
 * Called the moment the page gets a GPS fix, before any photo exists.
 * This is what makes the app feel alive on open: you arrive somewhere and it
 * already knows what is around you.
 */
app.get("/api/nearby", async (req, res) => {
  try {
    const lat = Number(req.query.lat), lon = Number(req.query.lon);
    if (!validCoords(lat, lon)) return res.status(400).json({ error: "Valid lat and lon are required." });
    const places = await nearbyPlaces(lat, lon, Number(req.query.radius) || 400);
    res.json({
      count: places.length,
      places: places.map(p => ({ name: p.name, category: p.category, distance: Math.round(p.distance), source: p.source }))
    });
  } catch (err) {
    fail(res, err);
  }
});

app.post("/api/analyze", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Please upload an image." });
    if (!/^image\//.test(req.file.mimetype)) return res.status(400).json({ error: "That file is not an image." });

    const lat = Number(req.body.latitude), lon = Number(req.body.longitude);
    const nearby = validCoords(lat, lon) ? await nearbyPlaces(lat, lon, Number(req.body.radius) || 400) : [];
    const result = await identifyLandmark(req.file.buffer, req.file.mimetype, nearby);

    // The model answers with an index, not a free-text name. Matching names by
    // string equality used to fail on any punctuation or article difference
    // ("Shoolini Mata Temple" vs "Shoolini Mata temple") and silently threw the
    // location signal away.
    const idx = Number(result.chosen_index);
    const matched = idx >= 1 && idx <= nearby.length ? nearby[idx - 1] : null;

    const visual = Math.max(0, Math.min(100, Number(result.confidence) || 0));

    // Location is a BONUS and can never reduce the score. The old formula was
    // visual*0.6 + location*0.4, which meant switching GPS on actively hurt a
    // correct, confident identification - a 99-confidence match 5 km away
    // scored 59 and got rejected, while the same photo with GPS off passed.
    let locationBonus = 0;
    if (matched) locationBonus = Math.round(Math.max(0, 15 - matched.distance / 200));

    const overall = Math.min(100, visual + locationBonus);
    const accepted = Boolean(result.is_landmark) && overall >= 60;
    const name = accepted ? (matched ? matched.name : result.candidate_name) : "UNKNOWN";

    res.json({
      landmark: name,
      is_landmark: accepted,
      confidence: overall,
      visual_confidence: visual,
      location_bonus: locationBonus,
      confirmed_by_location: Boolean(matched),
      distance_m: matched ? Math.round(matched.distance) : null,
      wikipedia: matched?.wikipedia || null,
      candidates_considered: nearby.length,
      category: result.category || "Unknown",
      evidence: Array.isArray(result.visual_evidence) ? result.visual_evidence : [],
      needs_wider_photo: !accepted || Boolean(result.needs_wider_photo),
      description: result.description || ""
    });
  } catch (err) {
    fail(res, err);
  }
});

app.post("/api/guide", async (req, res) => {
  try {
    const { name, language = "English", mode = "Tourist", wikipedia = null } = req.body;
    if (!name) return res.status(400).json({ error: "Place name is required." });

    const { value, cached } = await cache.remember(cache.key("guide", name, language, mode), async () => {
      const context = wikipedia ? await placeContext(wikipedia) : "";
      return generateGuide(name, language, mode, context);
    });
    res.json({ ...value, cached });
  } catch (err) {
    fail(res, err);
  }
});

app.post("/api/ask", async (req, res) => {
  try {
    const { name, question, language = "English" } = req.body;
    if (!name || !question) return res.status(400).json({ error: "Place and question are required." });
    const { value, cached } = await cache.remember(cache.key("ask", name, language, question), () =>
      askAbout(name, question, language)
    );
    res.json({ answer: value, cached });
  } catch (err) {
    fail(res, err);
  }
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, model: require("./services/gemini").MODEL, keyConfigured: Boolean(process.env.GEMINI_API_KEY), cache: cache.stats() });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "frontend", "index.html"));
});

// Without this, multer rejecting an oversized phone photo escapes the route's
// try/catch and Express replies with an HTML stack trace, so the frontend's
// res.json() throws and the user sees nothing at all.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err instanceof multer.MulterError) {
    const msg = err.code === "LIMIT_FILE_SIZE" ? "That photo is too large. Please try again." : "Could not read that upload.";
    return res.status(400).json({ error: msg });
  }
  fail(res, err);
});

if (!process.env.GEMINI_API_KEY) {
  console.warn("WARNING: GEMINI_API_KEY is not set. Copy backend/.env.example to backend/.env and add your key.");
}

app.listen(PORT, () => console.log(`TouristAI running at http://localhost:${PORT}`));
