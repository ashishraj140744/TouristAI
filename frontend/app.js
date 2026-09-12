const $ = id => document.getElementById(id);
const hide = (el, yes) => el.classList.toggle("hidden", yes);

let selectedFile = null;
let coords = null;
let currentPlace = null;
let currentWiki = null;
let guideToken = 0;

const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function setStatus(msg, isError = false) {
  $("status").textContent = msg;
  $("status").style.color = isError ? "#ff6b6b" : "";
}

/** fetch with a deadline — a phone on venue wifi can otherwise hang forever with no feedback. */
async function api(url, options = {}, ms = 45000) {
  const res = await fetch(url, { ...options, signal: AbortSignal.timeout(ms) });
  let data = {};
  try { data = await res.json(); } catch { /* non-JSON body */ }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

/* ---------------- location ---------------- */

async function loadNearby(lat, lon) {
  coords = { latitude: lat, longitude: lon };
  $("locTitle").textContent = "📍 Location locked";
  $("locDetail").textContent = `${lat.toFixed(4)}, ${lon.toFixed(4)} — looking around you…`;

  try {
    const data = await api(`/api/nearby?lat=${lat}&lon=${lon}`, {}, 25000);
    renderNearby(data.places);
    $("locDetail").textContent = data.count
      ? `${lat.toFixed(4)}, ${lon.toFixed(4)} · ${data.count} place${data.count > 1 ? "s" : ""} around you`
      : `${lat.toFixed(4)}, ${lon.toFixed(4)} — nothing mapped nearby, photo only`;
  } catch (err) {
    $("locDetail").textContent = "Could not load nearby places. Photo still works.";
  }
}

function renderNearby(places) {
  if (!places || !places.length) return hide($("nearbyPanel"), true);
  $("nearbyCount").textContent = "Around you right now";
  $("nearbyList").innerHTML = places.map(p =>
    `<button class="chip" data-name="${escapeHtml(p.name)}">
       <strong>${escapeHtml(p.name)}</strong><span>${p.distance} m</span>
     </button>`).join("");
  hide($("nearbyPanel"), false);

  // Tapping a place gives a guide with no photo at all. Indoors, at night, or
  // when the camera is refused, the app is still useful.
  $("nearbyList").querySelectorAll(".chip").forEach(btn => {
    btn.onclick = () => {
      currentPlace = btn.dataset.name;
      currentWiki = null;
      showPlace(currentPlace, "Selected from the places around you.", null);
      loadGuide();
    };
  });
}

function locate() {
  if (!navigator.geolocation) {
    $("locTitle").textContent = "📍 Location unavailable";
    $("locDetail").textContent = "This browser has no geolocation. Set it manually.";
    hide($("manualBox"), false);
    return;
  }
  navigator.geolocation.getCurrentPosition(
    pos => { hide($("locationBtn"), true); loadNearby(pos.coords.latitude, pos.coords.longitude); },
    err => {
      $("locTitle").textContent = "📍 Location unavailable";
      $("locDetail").textContent = err.code === 1
        ? "Permission denied — set it manually below."
        : (window.isSecureContext ? "Could not get a fix. Set it manually below." : "Needs HTTPS. Use a tunnel, or set it manually.");
      hide($("locationBtn"), false);
      hide($("manualBox"), false);
    },
    // High accuracy costs 10+ seconds on a cold GPS. Within 400 m a cached
    // network fix is good enough, and arriving instantly matters more.
    { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 }
  );
}

function applyManual(text) {
  const m = String(text).split(/[,\s]+/).map(Number).filter(n => !Number.isNaN(n));
  if (m.length < 2) return setStatus("Enter coordinates as: latitude, longitude", true);
  hide($("manualBox"), true);
  setStatus("");
  loadNearby(m[0], m[1]);
}

$("locationBtn").onclick = locate;
$("manualBtn").onclick = () => $("manualBox").classList.toggle("hidden");
$("manualGo").onclick = () => applyManual($("manualCoords").value);
$("manualCoords").onkeydown = e => { if (e.key === "Enter") applyManual($("manualCoords").value); };
document.querySelectorAll(".presets button").forEach(b => { b.onclick = () => applyManual(b.dataset.c); });

// The whole point: the app starts working the moment it opens.
locate();

/* ---------------- photo ---------------- */

/** Downscale before upload. A 12 MP phone photo is ~6 MB and was being sent raw. */
function compress(file) {
  return new Promise(resolve => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob(blob => resolve(blob && blob.size < file.size ? blob : file), "image/jpeg", 0.75);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

function pick(file) {
  if (!file) return;
  selectedFile = file;
  $("preview").src = URL.createObjectURL(file);
  hide($("previewWrap"), false);
  hide($("dropzone"), true);
  $("analyzeBtn").disabled = false;
  setStatus("");
}

$("fileInput").onchange = e => pick(e.target.files[0]);
$("cameraInput").onchange = e => pick(e.target.files[0]);
$("removeBtn").onclick = () => {
  selectedFile = null;
  $("fileInput").value = $("cameraInput").value = "";
  hide($("previewWrap"), true);
  hide($("dropzone"), false);
  $("analyzeBtn").disabled = true;
};

$("analyzeBtn").onclick = async () => {
  if (!selectedFile) return;
  $("analyzeBtn").disabled = true;
  setStatus("Compressing photo…");

  try {
    const blob = await compress(selectedFile);
    const fd = new FormData();
    fd.append("image", blob, "photo.jpg");
    if (coords) {
      fd.append("latitude", coords.latitude);
      fd.append("longitude", coords.longitude);
    }
    setStatus("Analyzing with Gemini…");
    const data = await api("/api/analyze", { method: "POST", body: fd });
    showResult(data);
  } catch (err) {
    setStatus(err.name === "TimeoutError" ? "That took too long. Check your connection and try again." : err.message, true);
  } finally {
    $("analyzeBtn").disabled = false;
  }
};

/* ---------------- results ---------------- */

function showPlace(name, description, confidence) {
  $("landmarkName").textContent = name;
  $("description").textContent = description || "";
  hide($("resultSection"), false);
  hide($("guideArea"), false);
  hide($("warning"), true);
  $("resultSection").scrollIntoView({ behavior: "smooth", block: "start" });

  const known = confidence == null;
  $("resultBadge").textContent = known ? "● SELECTED NEARBY" : "";
  $("resultBadge").style.background = "";
  $("confidenceText").textContent = known ? "—" : `${confidence}%`;
  $("confidenceBar").style.width = known ? "100%" : `${confidence}%`;
  $("confidenceDetail").textContent = known ? "Chosen from mapped places at your location." : "";
}

function showResult(data) {
  const ok = data.is_landmark;
  currentPlace = ok ? data.landmark : null;
  currentWiki = data.wikipedia || null;

  hide($("resultSection"), false);
  $("resultBadge").textContent = ok ? "● VERIFIED" : "● NEEDS MORE EVIDENCE";
  $("resultBadge").style.background = ok ? "" : "#7a2222";
  $("landmarkName").textContent = ok ? data.landmark : "Not confident enough to name this";
  $("description").textContent = data.description || "";

  $("confidenceText").textContent = `${data.confidence}%`;
  $("confidenceBar").style.width = `${data.confidence}%`;

  const bits = [`${data.visual_confidence}% from the photo`];
  if (data.confirmed_by_location) bits.push(`confirmed by GPS, ${data.distance_m} m away (+${data.location_bonus})`);
  else if (data.candidates_considered) bits.push(`${data.candidates_considered} nearby places checked`);
  else bits.push("location not used");
  $("confidenceDetail").textContent = bits.join(" · ");

  const warn = $("warning");
  hide(warn, ok);
  if (!ok) warn.textContent = data.needs_wider_photo
    ? "Try stepping back and capturing the whole structure, with a signboard if there is one."
    : "Try a clearer photo of the building itself.";

  hide($("guideArea"), !ok);
  if (ok) loadGuide();
}

async function loadGuide() {
  if (!currentPlace) return;
  const token = ++guideToken;  // stale responses from a rapid dropdown change must not overwrite newer ones
  const language = $("language").value;

  $("history").textContent = $("architecture").textContent = $("significance").textContent = "Loading…";
  $("facts").innerHTML = "";

  try {
    const g = await api("/api/guide", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: currentPlace, language, mode: $("mode").value, wikipedia: currentWiki })
    });
    if (token !== guideToken) return;

    $("history").textContent = g.history || "";
    $("architecture").textContent = g.architecture || "";
    $("significance").textContent = g.cultural_significance || "";
    $("facts").innerHTML = (g.interesting_facts || []).map(f => `<li>${escapeHtml(f)}</li>`).join("");

    const practical = [
      ["Dress code", g.dress_code], ["Photography", g.photography_allowed],
      ["Timings", g.timings], ["Aarti", g.aarti_time]
    ].filter(([, v]) => v && !/^not known$/i.test(v));
    hide($("practical"), !practical.length);
    $("practicalList").innerHTML = practical.map(([k, v]) => `<li><strong>${k}:</strong> ${escapeHtml(v)}</li>`).join("");
  } catch (err) {
    if (token !== guideToken) return;
    $("history").textContent = err.message;
    $("architecture").textContent = $("significance").textContent = "";
  }
}

$("language").onchange = loadGuide;
$("mode").onchange = loadGuide;

$("askBtn").onclick = async () => {
  const question = $("question").value.trim();
  if (!question || !currentPlace) return;
  $("answer").textContent = "Thinking…";
  try {
    const data = await api("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: currentPlace, question, language: $("language").value })
    });
    $("answer").textContent = data.answer;
  } catch (err) {
    $("answer").textContent = err.message;
  }
};
$("question").onkeydown = e => { if (e.key === "Enter") $("askBtn").click(); };

$("listenBtn").onclick = () => {
  const text = [$("landmarkName").textContent, $("history").textContent, $("architecture").textContent, $("significance").textContent]
    .filter(Boolean).join(". ");
  if (!text) return;

  // Without cancel(), a second tap queues behind the first instead of restarting.
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  // Hindi text read by an en-US voice is unintelligible — this was silently
  // breaking half the product's pitch.
  u.lang = $("language").value === "Hindi" ? "hi-IN" : "en-IN";
  const voice = speechSynthesis.getVoices().find(v => v.lang === u.lang) || speechSynthesis.getVoices().find(v => v.lang.startsWith(u.lang.split("-")[0]));
  if (voice) u.voice = voice;
  u.rate = 0.95;
  speechSynthesis.speak(u);
};
