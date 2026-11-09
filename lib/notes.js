/* OpenSky notes (server side) — short messages family members post from their phones (the share page) that show
 * on the Home screen until they expire or someone taps them away.
 *
 * Kept on the Pi in notes.json next to opensky.json (OPENSKY_NOTES = another file, for tests):
 *   { version: 1, notes: [{ id, text, from, at, until }] }     `until` = ms timestamp, or null = until removed
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const MM_ROOT = global.root_path || process.cwd();
const SETTINGS = process.env.OPENSKY_SETTINGS || path.join(MM_ROOT, "config", "opensky.json");
const FILE = () => process.env.OPENSKY_NOTES || path.join(path.dirname(SETTINGS), "notes.json");
const MAX_NOTES = 20, MAX_TEXT = 280, DAY = 24 * 60 * 60 * 1000;

function read() {
  try {
    const d = JSON.parse(fs.readFileSync(FILE(), "utf8"));
    return Array.isArray(d.notes) ? d.notes.filter((n) => n && typeof n.text === "string") : [];
  } catch (e) {
    if (e.code !== "ENOENT") {
      try { fs.copyFileSync(FILE(), `${FILE()}.damaged-${Date.now()}`); } catch (x) { /* ignore */ }
      console.error(`[OpenSky] notes.json unreadable (${e.message}); a copy was kept`);
    }
    return [];
  }
}

function write(notes) {
  const f = FILE();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(`${f}.tmp`, JSON.stringify({ version: 1, notes }, null, 1));
  fs.renameSync(`${f}.tmp`, f);   // atomic: a power cut can't leave half a file
}

/** The notes that are still current, newest first (expired ones are dropped from the file too). */
function list(now = Date.now()) {
  const all = read();
  const live = all.filter((n) => !n.until || n.until > now);
  if (live.length !== all.length) write(live);
  return live.sort((a, b) => b.at - a.at).map(({ id, text, from, at, until }) => ({ id, text, from: from || "", at, until: until || null }));
}

/** days: 1, 7 … or 0 / null = until someone removes it */
function add(text, from, days, now = Date.now()) {
  const t = String(text || "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (!t) throw Object.assign(new Error("Please type something first"), { status: 400 });
  if (t.length > MAX_TEXT) throw Object.assign(new Error(`That's a bit long — keep it under ${MAX_TEXT} characters`), { status: 400 });
  const d = Number(days);
  const keep = d > 0 ? Math.min(d, 30) : 0;
  const notes = list(now);
  if (notes.length >= MAX_NOTES) throw Object.assign(new Error("The screen has a lot of notes already — remove some first"), { status: 409 });
  const note = { id: crypto.randomBytes(8).toString("hex"), text: t, from: String(from || "").replace(/\s+/g, " ").trim().slice(0, 30), at: now, until: keep ? now + keep * DAY : null };
  write([...notes, note]);
  return note;
}

function remove(id) {
  const notes = read();
  const left = notes.filter((n) => n.id !== id);
  if (left.length === notes.length) throw Object.assign(new Error("That note is already gone"), { status: 404 });
  write(left);
  return true;
}

module.exports = { list, add, remove, MAX_TEXT, MAX_NOTES };
