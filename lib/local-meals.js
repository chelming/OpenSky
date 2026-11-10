/* OpenSky on-device meal plan (server side) — a meal plan that needs no account: entries are kept on the Pi in
 * config/meals.json (OPENSKY_LOCAL_MEALS) and added / changed / removed on the Meals page.
 * Used by MMM-OpenSky-Meals (plan + edits) and MMM-OpenSky-Calendars (meals on the calendar). Both node helpers run in
 * the same Node process, so a change is shown at once ("change" event).
 *
 * Stored entry: { id, date: "YYYY-MM-DD", type: "breakfast"|"lunch"|"dinner"|"side", title }
 * Answers the same entry shape as lib/mealie.js planEntries (no recipe: slug / recipeId null, hasImage false).
 * Writes are atomic (temp file + rename), so a power cut can't leave a half-written file.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { EventEmitter } = require("events");

const MEAL_TYPES = ["breakfast", "lunch", "dinner", "side"];
const FILE = process.env.OPENSKY_LOCAL_MEALS || path.join(global.root_path || process.cwd(), "config", "meals.json");
const bus = new EventEmitter();

function readAll() {
  try {
    const data = JSON.parse(fs.readFileSync(FILE, "utf8"));
    return Array.isArray(data.entries) ? data.entries : [];
  } catch (e) {
    if (e.code !== "ENOENT") {
      try { fs.copyFileSync(FILE, `${FILE}.damaged-${Date.now()}`); } catch (x) { /* ignore */ }   // keep a copy, start empty
      console.error(`[OpenSky] meals.json unreadable (${e.message}); a copy was kept`);
    }
    return [];
  }
}

function writeAll(entries) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, entries }, null, 1));
  fs.renameSync(tmp, FILE);
  bus.emit("change");
}

const ymd = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const chosenTypes = (meals) => { const w = (Array.isArray(meals) ? meals : []).map((m) => String(m).toLowerCase()).filter((m) => MEAL_TYPES.includes(m)); return w.length ? w : ["dinner"]; };

function clean(d) {
  const title = String((d && d.title) || "").replace(/\s+/g, " ").trim();
  if (!title) throw new Error("Please type what's for the meal");
  if (title.length > 200) throw new Error("That's a bit long — keep it under 200 characters");
  const date = String((d && d.date) || "");
  if (!/^\d{4}-\d\d-\d\d$/.test(date) || isNaN(new Date(`${date}T12:00:00`))) throw new Error("Please pick a day");
  const type = String((d && d.type) || "dinner").toLowerCase();
  if (!MEAL_TYPES.includes(type)) throw new Error("Please pick breakfast, lunch, dinner or a side");
  return { date, type, title };
}

/** Entries between two times (local dates), the chosen meal types only, same shape as Mealie's. */
function planEntries(fromMs, toMs, meals) {
  const types = chosenTypes(meals), from = ymd(fromMs), to = ymd(toMs);
  return readAll().filter((e) => e && typeof e.date === "string" && e.date >= from && e.date <= to && types.includes(e.type) && String(e.title || "").trim())
    .map((e) => ({ id: String(e.id), date: e.date, type: e.type, title: String(e.title), recipeId: null, slug: null, hasImage: false, time: "" }))
    .sort((a, b) => a.date.localeCompare(b.date) || MEAL_TYPES.indexOf(a.type) - MEAL_TYPES.indexOf(b.type));
}

/** The same entries as all-day calendar events: "Dinner: Tacos" (just "Tacos" for a single meal type). */
function mealEvents(fromMs, toMs, meals) {
  const many = chosenTypes(meals).length > 1;
  return planEntries(fromMs, toMs, meals).map((e) => {
    const [y, m, d] = e.date.split("-").map(Number);
    return { title: many ? `${cap(e.type)}: ${e.title}` : e.title, startDate: String(new Date(y, m - 1, d).getTime()), endDate: String(new Date(y, m - 1, d + 1).getTime()),
      fullDayEvent: true, recurringEvent: false, class: "PUBLIC", location: false, geo: false, description: false, uid: `local-meal-${e.id}` };
  });
}

function add(d) {
  const e = { id: crypto.randomUUID(), ...clean(d) };
  const all = readAll(); all.push(e); writeAll(all);
  return e;
}

function update(id, d) {
  const all = readAll(), i = all.findIndex((e) => e.id === id);
  if (i < 0) throw new Error("That meal was already removed");
  all[i] = { id, ...clean(d) };
  writeAll(all);
  return all[i];
}

function remove(id) {
  const all = readAll(), left = all.filter((e) => e.id !== id);
  if (left.length === all.length) throw new Error("That meal was already removed");
  writeAll(left);
}

module.exports = { MEAL_TYPES, FILE, bus, planEntries, mealEvents, add, update, remove };
