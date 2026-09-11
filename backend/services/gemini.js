const { GoogleGenerativeAI } = require("@google/generative-ai");

function getModel() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not configured.");
  const genAI = new GoogleGenerativeAI(key);
  return genAI.getGenerativeModel({ model: "gemini-3.8-flash" });
}

function cleanJson(text) {
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error("Gemini returned an invalid JSON response.");
  return JSON.parse(cleaned.slice(start, end + 1));
}

async function identifyLandmark(buffer, mimeType, nearby) {
  const model = getModel();
  const nearbyText = nearby.length
    ? nearby.map((x, i) => `${i + 1}. ${x.name} — ${Math.round(x.distance)}m away`).join("\n")
    : "No nearby landmark candidates were provided.";

  const prompt = `You are TouristAI, a cautious visual heritage identification assistant.

Analyze the image. Determine whether it contains a recognizable monument, historical site,
religious site, tourist attraction, or architectural landmark.

IMPORTANT:
- Do NOT guess.
- A generic wall, pillar, road, tree, ordinary building fragment, or unclear image must be UNKNOWN.
- Nearby location candidates are only supporting context. Never select a landmark just because it is nearby.
- Return confidence from 0 to 100.
- If evidence is insufficient, is_landmark must be false, candidate_name must be UNKNOWN,
  and needs_wider_photo must be true.

Nearby candidates:
${nearbyText}

Return ONLY valid JSON:
{
  "is_landmark": true,
  "candidate_name": "Qutub Minar",
  "category": "Historical Monument",
  "confidence": 94,
  "visual_evidence": ["..."],
  "needs_wider_photo": false,
  "description": "..."
}`;

  const result = await model.generateContent([
    { text: prompt },
    { inlineData: { data: buffer.toString("base64"), mimeType } }
  ]);
  return cleanJson(result.response.text());
}

async function generateGuide(name, language = "English", mode = "Tourist") {
  const model = getModel();
  const prompt = `You are TouristAI, an accurate and engaging tourist guide.
Create a concise guide for "${name}" in ${language}. Mode: ${mode}.
Avoid invented facts. If a fact is uncertain, say so.
Return ONLY valid JSON:
{
  "history": "...",
  "architecture": "...",
  "cultural_significance": "...",
  "important_dates": ["..."],
  "historical_figures": ["..."],
  "interesting_facts": ["...", "...", "..."]
}`;
  const result = await model.generateContent(prompt);
  return cleanJson(result.response.text());
}

async function askAbout(name, question, language = "English") {
  const model = getModel();
  const prompt = `You are TouristAI. Answer a tourist's question about "${name}" in ${language}.
Be concise, natural and factual. Do not invent information.
Question: ${question}`;
  const result = await model.generateContent(prompt);
  return result.response.text();
}

module.exports = { identifyLandmark, generateGuide, askAbout };
