/* OpenSky family countdowns (server side) — big days (a trip, a birthday) that family members add from the share page.
 *
 * Kept apart from opensky.json on purpose: the share page can never change settings (see lib/share.js), so what it adds
 * lives in family-countdowns.json next to opensky.json (OPENSKY_FAMILY_COUNTDOWNS = another file, for tests):
 *   { version: 1, items: [{ id, title, date: "YYYY-MM-DD", yearly, color, from, at }] }
 * Home and the Countdowns page add these to the ones from phone setup (they never have a photo).
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { EventEmitter } = require("events");

const bus = new EventEmitter();   // "change" after every write (see lib/notes.js)

const MM_ROOT = global.root_path || process.cwd();
const SETTINGS = process.env.OPENSKY_SETTINGS || path.join(MM_ROOT, "config", "opensky.json");
const FILE = () => process.env.OPENSKY_FAMILY_COUNTDOWNS || path.join(path.dirname(SETTINGS), "family-countdowns.json");
const MAX_ITEMS = 12, MAX_TITLE = 60;
const fail = (m, status) => Object.assign(new Error(m), { status });
const validDate = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ""));
  if (!m) return false;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return d.getFullYear() === +m[1] && d.getMonth() === +m[2] - 1 && d.getDate() === +m[3];
};

function read() {
  try {
    const d = JSON.parse(fs.readFileSync(FILE(), "utf8"));
    return (Array.isArray(d.items) ? d.items : []).filter((c) => c && /^[a-z0-9]{4,24}$/.test(String(c.id)) && String(c.title || "").trim() && validDate(c.date));
  } catch (e) {
    if (e.code !== "ENOENT") {
      try { fs.copyFileSync(FILE(), `${FILE()}.damaged-${Date.now()}`); } catch (x) { /* ignore */ }
      console.error(`[OpenSky] family-countdowns.json unreadable (${e.message}); a copy was kept`);
    }
    return [];
  }
}

function write(items) {
  const f = FILE();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(`${f}.tmp`, JSON.stringify({ version: 1, items }, null, 1));
  fs.renameSync(`${f}.tmp`, f);   // atomic: a power cut can't leave half a file
  bus.emit("change");
}

/** Cleaned items, soonest date first (the screen hides passed ones itself, see lib/client/countdowns.js). */
function list() {
  return read().sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .map((c) => ({ id: String(c.id), title: String(c.title).trim().slice(0, MAX_TITLE), date: String(c.date), yearly: c.yearly === true, photo: false,
      color: /^[a-z]+$|^#[0-9a-f]{6}$/i.test(String(c.color || "")) ? String(c.color) : "orange", home: true, from: String(c.from || "").slice(0, 30), shared: true }));
}

function add(title, date, yearly, from) {
  const t = String(title || "").replace(/\s+/g, " ").trim();
  if (!t) throw fail("Please give it a name first", 400);
  if (t.length > MAX_TITLE) throw fail(`That name is a bit long — keep it under ${MAX_TITLE} characters`, 400);
  if (!validDate(date)) throw fail("Please choose a date", 400);
  const items = read();
  if (items.length >= MAX_ITEMS) throw fail("The screen has a lot of family countdowns already — remove some first", 409);
  const item = { id: crypto.randomBytes(6).toString("hex"), title: t, date: String(date), yearly: yearly === true, color: "orange",
    from: String(from || "").replace(/\s+/g, " ").trim().slice(0, 30), at: Date.now() };
  write([...items, item]);
  return item;
}

function remove(id) {
  const items = read(), left = items.filter((c) => c.id !== id);
  if (left.length === items.length) throw fail("That countdown is already gone", 404);
  write(left);
}

module.exports = { bus, list, add, remove, MAX_ITEMS, MAX_TITLE };
