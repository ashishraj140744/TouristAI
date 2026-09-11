const fileInput = document.getElementById("fileInput");
const cameraInput = document.getElementById("cameraInput");
const previewWrap = document.getElementById("previewWrap");
const preview = document.getElementById("preview");
const dropzone = document.getElementById("dropzone");
const analyzeBtn = document.getElementById("analyzeBtn");
const locationBtn = document.getElementById("locationBtn");
const status = document.getElementById("status");
let selectedFile = null;
let coords = null;
let currentLandmark = null;

[fileInput, cameraInput].forEach(input => input.addEventListener("change", e => {
  const file = e.target.files[0];
  if (!file) return;
  selectedFile = file;
  preview.src = URL.createObjectURL(file);
  previewWrap.classList.remove("hidden");
  dropzone.classList.add("hidden");
  analyzeBtn.disabled = false;
  status.textContent = "Image ready.";
}));

document.getElementById("removeBtn").onclick = () => {
  selectedFile = null;
  previewWrap.classList.add("hidden");
  dropzone.classList.remove("hidden");
  analyzeBtn.disabled = true;
  fileInput.value = "";
  cameraInput.value = "";
};

locationBtn.onclick = () => {
  if (!navigator.geolocation) return status.textContent = "Location is not supported by this browser.";
  status.textContent = "Requesting location…";
  navigator.geolocation.getCurrentPosition(
    p => {
      coords = { latitude: p.coords.latitude, longitude: p.coords.longitude };
      locationBtn.textContent = "Enabled ✓";
      locationBtn.classList.add("on");
      status.textContent = "Location enabled. It will be used only as supporting context.";
    },
    () => status.textContent = "Location not available. You can continue without it.",
    { enableHighAccuracy: true, timeout: 8000 }
  );
};

analyzeBtn.onclick = async () => {
  if (!selectedFile) return;
  analyzeBtn.disabled = true;
  status.textContent = "Gemini is studying the image…";
  const fd = new FormData();
  fd.append("image", selectedFile);
  if (coords) {
    fd.append("latitude", coords.latitude);
    fd.append("longitude", coords.longitude);
  }
  try {
    const res = await fetch("/api/analyze", { method:"POST", body:fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Analysis failed.");
    showResult(data);
  } catch (e) {
    status.textContent = e.message;
  } finally {
    analyzeBtn.disabled = false;
  }
};

function showResult(data) {
  document.getElementById("resultSection").classList.remove("hidden");
  const known = data.is_landmark;
  currentLandmark = known ? data.landmark : null;
  document.getElementById("resultBadge").textContent = known ? "● VERIFIED CANDIDATE" : "● NEEDS MORE EVIDENCE";
  document.getElementById("resultBadge").style.background = known ? "#e4eee3" : "#fff0dc";
  document.getElementById("resultBadge").style.color = known ? "#315a39" : "#72501f";
  document.getElementById("landmarkName").textContent = known ? data.landmark : "Landmark not confidently identified";
  document.getElementById("description").textContent = data.description || (known ? "TouristAI found a possible landmark." : "The image does not contain enough visual evidence to identify a specific landmark.");
  document.getElementById("confidenceText").textContent = `${data.confidence}%`;
  document.getElementById("confidenceBar").style.width = `${data.confidence}%`;
  document.getElementById("confidenceDetail").textContent =
    data.location_confidence != null ? `Visual ${data.visual_confidence}% · Location support ${data.location_confidence}%` : `Visual confidence ${data.visual_confidence}% · Location not used`;
  const warning = document.getElementById("warning");
  warning.classList.toggle("hidden", known);
  warning.textContent = "🟠 TouristAI is not confident enough to name this place. Try uploading a wider photograph showing the full structure.";
  document.getElementById("guideArea").classList.toggle("hidden", !known);
  document.getElementById("resultSection").scrollIntoView({behavior:"smooth"});
  status.textContent = known ? "Landmark identified." : "Try a wider photograph.";
  if (known) loadGuide();
}

async function loadGuide() {
  const language = document.getElementById("language").value;
  const mode = document.getElementById("mode").value;
  document.getElementById("history").textContent = "Generating…";
  try {
    const res = await fetch("/api/guide", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({name:currentLandmark, language, mode})});
    const d = await res.json();
    if (!res.ok) throw new Error(d.error);
    document.getElementById("history").textContent = d.history || "";
    document.getElementById("architecture").textContent = d.architecture || "";
    document.getElementById("significance").textContent = d.cultural_significance || "";
    document.getElementById("facts").innerHTML = (d.interesting_facts || []).map(x => `<li>${escapeHtml(x)}</li>`).join("");
  } catch(e) { document.getElementById("history").textContent = e.message; }
}
document.getElementById("language").onchange = loadGuide;
document.getElementById("mode").onchange = loadGuide;

document.getElementById("askBtn").onclick = async () => {
  const q = document.getElementById("question").value.trim();
  if (!q || !currentLandmark) return;
  document.getElementById("answer").textContent = "Thinking…";
  const language = document.getElementById("language").value;
  try {
    const res = await fetch("/api/ask",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:currentLandmark,question:q,language})});
    const d = await res.json();
    if (!res.ok) throw new Error(d.error);
    document.getElementById("answer").textContent = d.answer;
  } catch(e) { document.getElementById("answer").textContent = e.message; }
};

document.getElementById("listenBtn").onclick = () => {
  const text = [
    document.getElementById("history").textContent,
    document.getElementById("architecture").textContent,
    document.getElementById("significance").textContent
  ].join(". ");
  if ("speechSynthesis" in window) speechSynthesis.speak(new SpeechSynthesisUtterance(text));
};

function escapeHtml(s){return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));}
