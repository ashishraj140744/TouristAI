require("dotenv").config();
const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { identifyLandmark, generateGuide, askAbout } = require("./services/gemini");

const app = express();
const PORT = process.env.PORT || 3000;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
const landmarks = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "landmarks.json"), "utf8"));

app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "frontend")));

function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2-lat1) * Math.PI/180;
  const dLon = (lon2-lon1) * Math.PI/180;
  const a = Math.sin(dLat/2)**2 +
    Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function nearbyLandmarks(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
  return landmarks
    .map(l => ({...l, distance: distanceKm(lat, lon, l.latitude, l.longitude) * 1000}))
    .filter(l => l.distance <= 5000)
    .sort((a,b) => a.distance-b.distance)
    .slice(0, 5);
}

app.post("/api/analyze", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Please upload an image." });
    const lat = Number(req.body.latitude);
    const lon = Number(req.body.longitude);
    const nearby = nearbyLandmarks(lat, lon);
    const result = await identifyLandmark(req.file.buffer, req.file.mimetype, nearby);

    let locationConfidence = null;
    if (nearby.length && result.candidate_name && result.candidate_name !== "UNKNOWN") {
      const match = nearby.find(x => x.name.toLowerCase() === result.candidate_name.toLowerCase());
      if (match) locationConfidence = Math.max(0, Math.min(100, 100 - (match.distance / 50)));
    }

    const visual = Number(result.confidence) || 0;
    const overall = locationConfidence == null ? visual : Math.round(visual * 0.6 + locationConfidence * 0.4);
    const accepted = Boolean(result.is_landmark) && overall >= 60;

    res.json({
      landmark: accepted ? result.candidate_name : "UNKNOWN",
      is_landmark: accepted,
      confidence: overall,
      visual_confidence: visual,
      location_confidence: locationConfidence == null ? undefined : Math.round(locationConfidence),
      category: result.category || "Unknown",
      evidence: result.visual_evidence || [],
      needs_wider_photo: !accepted || Boolean(result.needs_wider_photo),
      description: result.description || ""
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Analysis failed." });
  }
});

app.post("/api/guide", async (req, res) => {
  try {
    const { name, language = "English", mode = "Tourist" } = req.body;
    if (!name) return res.status(400).json({ error: "Landmark name is required." });
    res.json(await generateGuide(name, language, mode));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Guide generation failed." });
  }
});

app.post("/api/ask", async (req, res) => {
  try {
    const { name, question, language = "English" } = req.body;
    if (!name || !question) return res.status(400).json({ error: "Landmark and question are required." });
    const answer = await askAbout(name, question, language);
    res.json({ answer });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Question failed." });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "frontend", "index.html"));
});

app.listen(PORT, () => console.log(`TouristAI running at http://localhost:${PORT}`));
