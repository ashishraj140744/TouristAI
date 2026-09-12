const { GoogleGenAI } = require("@google/genai");

const MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
let client = null;

function getClient() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not configured.");
  if (!client) client = new GoogleGenAI({ apiKey: key });
  return client;
}

// Structured output means we never parse free text. A prose reply (safety refusal,
// "I can't identify people") used to throw and surface as a raw error on screen.
const IDENTIFY_SCHEMA = {
  type: "object",
  properties: {
    chosen_index: { type: "integer", description: "1-based index into the candidate list, or 0 for none of them" },
    is_landmark: { type: "boolean" },
    candidate_name: { type: "string" },
    category: { type: "string" },
    confidence: { type: "integer" },
    visual_evidence: { type: "array", items: { type: "string" } },
    needs_wider_photo: { type: "boolean" },
    description: { type: "string" }
  },
  required: ["chosen_index", "is_landmark", "candidate_name", "category", "confidence", "visual_evidence", "needs_wider_photo", "description"]
};

const GUIDE_SCHEMA = {
  type: "object",
  properties: {
    history: { type: "string" },
    architecture: { type: "string" },
    cultural_significance: { type: "string" },
    important_dates: { type: "array", items: { type: "string" } },
    historical_figures: { type: "array", items: { type: "string" } },
    interesting_facts: { type: "array", items: { type: "string" } },
    // Practical fields. Google Lens structurally cannot answer these.
    dress_code: { type: "string" },
    photography_allowed: { type: "string" },
    timings: { type: "string" },
    aarti_time: { type: "string" }
  },
  required: ["history", "architecture", "cultural_significance", "interesting_facts"]
};

const UNKNOWN = {
  chosen_index: 0,
  is_landmark: false,
  candidate_name: "UNKNOWN",
  category: "Unknown",
  confidence: 0,
  visual_evidence: [],
  needs_wider_photo: true,
  description: "Not enough visual evidence to name a place."
};

async function generateJson(contents, schema, temperature = 0.2) {
  const res = await getClient().models.generateContent({
    model: MODEL,
    contents,
    // The identify prompt's first rule is "do NOT guess" — temperature 1.0 fights that.
    config: { responseMimeType: "application/json", responseSchema: schema, temperature }
  });
  try {
    return JSON.parse(res.text);
  } catch {
    return null;
  }
}

async function identifyLandmark(buffer, mimeType, nearby) {
  const list = nearby.length
    ? nearby.map((x, i) => `${i + 1}. ${x.name}${x.category ? ` (${x.category})` : ""} — ${Math.round(x.distance)}m away`).join("\n")
    : "(none — no candidates were found near these coordinates)";

  const prompt = `You are TouristAI, a cautious visual heritage identification assistant.

A user photographed something and we know roughly where they were standing. Below is the list of
real places near those coordinates, pulled live from OpenStreetMap and Wikipedia.

CANDIDATES:
${list}

Your task is MULTIPLE CHOICE, not open-ended recognition.
- If the photo shows one of the candidates, set chosen_index to its number and candidate_name to that exact name.
- If the photo clearly shows a notable landmark that is NOT in the list, set chosen_index to 0 and name it yourself.
- If it is a generic wall, road, tree, person, vehicle, interior, meme, or an unclear/blurry image,
  set chosen_index 0, is_landmark false, candidate_name "UNKNOWN", needs_wider_photo true.
- Do NOT pick a candidate merely because it is nearby. The photo must actually support it.
- Being wrong is far worse than saying UNKNOWN. When unsure, say UNKNOWN.
- confidence is 0-100 and reflects VISUAL evidence only — ignore proximity when scoring it.
- visual_evidence: short concrete things you actually see (dome shape, carving style, signage, colour, material).
- description: two sentences, plain and factual.`;

  const out = await generateJson(
    [{ role: "user", parts: [{ text: prompt }, { inlineData: { mimeType, data: buffer.toString("base64") } }] }],
    IDENTIFY_SCHEMA
  );
  return out || UNKNOWN;
}

async function generateGuide(name, language = "English", mode = "Tourist", context = "") {
  const prompt = `You are TouristAI, an accurate and engaging guide. Write about "${name}" in ${language}.
Audience mode: ${mode} (Tourist = practical and vivid, Student = historical depth, Child = simple and playful).
${context ? `Known facts about this place, treat as ground truth:\n${context}\n` : ""}
Rules: never invent facts. If something is uncertain, say so plainly in ${language}.
If it is a temple, gurudwara, church, mosque or any religious site, fill dress_code, photography_allowed,
timings and aarti_time. If you genuinely do not know one of those, write "not known" — never guess them.
Write ALL prose in ${language}.`;

  const out = await generateJson([{ role: "user", parts: [{ text: prompt }] }], GUIDE_SCHEMA, 0.4);
  if (!out) throw new Error("Could not generate a guide for this place. Please try again.");
  return out;
}

async function askAbout(name, question, language = "English") {
  const res = await getClient().models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts: [{ text: `You are TouristAI. Answer a visitor's question about "${name}" in ${language}.
Be concise, natural and factual. Never invent information — say you do not know if you do not.

Question: ${question}` }] }],
    config: { temperature: 0.4 }
  });
  return res.text;
}

module.exports = { identifyLandmark, generateGuide, askAbout, MODEL };
