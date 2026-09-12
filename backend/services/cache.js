const fs = require("fs");
const path = require("path");

// One Gemini call per PLACE, not per REQUEST. Without this every dropdown change
// (English -> Hindi -> Tourist -> Child) burns a fresh call, and a live demo can
// hit the free-tier rate limit in under a minute. Persisted to disk so a restart
// between the practice run and the real demo does not throw the work away.
const FILE = path.join(__dirname, "..", "data", "cache.json");
const MAX_ENTRIES = 500;

let store = new Map();
let writeTimer = null;

try {
  if (fs.existsSync(FILE)) store = new Map(Object.entries(JSON.parse(fs.readFileSync(FILE, "utf8"))));
} catch {
  store = new Map();
}

function flush() {
  writeTimer = null;
  try {
    fs.writeFileSync(FILE, JSON.stringify(Object.fromEntries(store)));
  } catch (err) {
    console.error("Cache write failed:", err.message);
  }
}

const key = (...parts) => parts.map(p => String(p).trim().toLowerCase()).join("|");

function get(k) {
  return store.get(k) || null;
}

function set(k, value) {
  store.set(k, value);
  // Map preserves insertion order, so the first key is the oldest.
  if (store.size > MAX_ENTRIES) store.delete(store.keys().next().value);
  // Debounced: a burst of guide requests should not mean a burst of disk writes.
  if (!writeTimer) {
    writeTimer = setTimeout(flush, 2000);
    writeTimer.unref?.();
  }
}

/** Run fn only on a miss. Failures are never cached. */
async function remember(k, fn) {
  const hit = get(k);
  if (hit) return { value: hit, cached: true };
  const value = await fn();
  set(k, value);
  return { value, cached: false };
}

const stats = () => ({ entries: store.size });

module.exports = { key, get, set, remember, stats };
