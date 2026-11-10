/* MMM-OpenSky-EventEditor node helper — makes the change the page asked for.
 *   OS_EV {id, op: "create"|"update"|"delete", calendar, ref: {originalTitle, originalStart}, data} → OS_EV_RESULT {id, ok, error}
 * type "local"  → lib/local-calendar.js (the on-device calendar)
 * type "caldav" → OpenSky's calendar service on this Pi (services/calendar-service, 127.0.0.1 only)
 * type "google" → the Google Calendar API (lib/google-calendar.js)
 */
const NodeHelper = require("node_helper");
const fs = require("fs");
const path = require("path");
const local = require(path.join(global.root_path, "modules", "opensky-lib", "local-calendar.js"));
const google = require(path.join(global.root_path, "modules", "opensky-lib", "google-calendar.js"));
const quickAdd = require(path.join(global.root_path, "modules", "opensky-lib", "quick-add.js"));
const llm = require(path.join(global.root_path, "modules", "opensky-lib", "llm.js"));

const SETTINGS = process.env.OPENSKY_SETTINGS || path.join(global.root_path, "config", "opensky.json");
const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]{2,}$/;
// The people and calendars quick add works from, read from opensky.json each time (the page never gets people's emails).
function house() {
  let s = {};
  try { s = JSON.parse(fs.readFileSync(SETTINGS, "utf8")); } catch (e) { /* none yet */ }
  const profiles = (Array.isArray(s.profiles) ? s.profiles : []).filter((p) => p && p.name).map((p) => ({ name: String(p.name), email: EMAIL.test(p.email || "") ? String(p.email) : "" }));
  const sources = ((s.calendar && s.calendar.sources) || []).filter((c) => c && c.name).map((c) => ({ name: String(c.name), type: c.type, calendarId: c.calendarId ? String(c.calendarId) : "", role: c.role === "shared" ? "shared" : "", profiles: Array.isArray(c.profiles) ? c.profiles.map(String) : [] }));
  return { profiles, sources };
}

module.exports = NodeHelper.create({
  socketNotificationReceived(n, p) {
    if (n === "OS_QA") { this.quickAdd(p || {}); return; }
    if (n === "OS_EV_INIT") { this.editable = (p && p.editable) || []; this.servicePort = (p && p.servicePort) || 5747; return; }
    if (n !== "OS_EV" || !p || !p.id) return;
    this.handle(p).then(
      () => this.sendSocketNotification("OS_EV_RESULT", { id: p.id, ok: true }),
      (e) => this.sendSocketNotification("OS_EV_RESULT", { id: p.id, ok: false, error: e.message })
    );
  },

  /* OS_QA {id, text | audio (base64 16 kHz wav), mime} → OS_QA_RESULT {id, ok, draft, plan, error}: words → a draft for the form. Saves nothing. */
  async quickAdd({ id, text, audio, mime }) {
    const reply = (o) => this.sendSocketNotification("OS_QA_RESULT", { id, ...o });
    try {
      if (!llm.enabled()) throw new Error("The AI helper isn't set up — add its address in phone setup");
      const h = house(), names = (this.editable || []).map((c) => c.name);
      const sources = h.sources.filter((c) => names.includes(c.name));
      const opt = { now: new Date(), calendars: names, people: h.profiles.map((x) => x.name) };
      const draft = audio ? await quickAdd.parseAudio(Buffer.from(String(audio), "base64"), mime || "audio/wav", opt) : await quickAdd.parseText(text, opt);
      const plan = quickAdd.plan(draft, { sources, profiles: h.profiles });
      // what the page may show: no addresses, only names (the invite list is re-checked when the event is made)
      reply({ ok: true, draft, plan: { calendar: plan.calendar, invite: plan.invite.map((i) => i.name), skipped: plan.skipped, notes: plan.notes, description: plan.description } });
    } catch (e) {
      reply({ ok: false, error: e.message });
    }
  },

  // names the page asked to invite → addresses, only for people OpenSky knows (the page can't invite anyone else)
  guests(names, calendarName) {
    if (!Array.isArray(names) || !names.length) return [];
    const h = house();
    const own = String((h.sources.find((c) => c.name === calendarName) || {}).calendarId || "").toLowerCase();
    const out = [];
    for (const n of names.slice(0, 12)) {
      const email = quickAdd.emailFor(String(n), h.sources, h.profiles);
      if (email && email.toLowerCase() !== own && !out.includes(email)) out.push(email);
    }
    return out;
  },

  async handle({ op, calendar, ref, data }) {
    const cal = (this.editable || []).find((c) => c.name === calendar);
    if (!cal) throw new Error(`"${calendar}" can't be changed from this screen`);
    if (!["create", "update", "delete"].includes(op)) throw new Error("Unknown change");
    if (data) {   // invitations: by name only, only on Google calendars, only to known people
      if (cal.type === "google" && op === "create") data = { ...data, attendees: this.guests(data.invite, calendar) };
      else data = { ...data, attendees: [] };
      delete data.invite;
    }
    if (cal.type === "local") {
      if (op === "create") return local.create(calendar, data);
      if (op === "update") return local.update(calendar, ref, data);
      return local.remove(calendar, ref);
    }
    if (cal.type === "google") {
      const id = cal.calendarId || "primary";
      if (op === "create") return google.create(id, data);
      if (op === "update") return google.update(id, ref, data);
      return google.remove(id, ref);
    }
    // CalDAV through the calendar service (it holds the account; the page never sees it)
    let res;
    try {
      res = await fetch(`http://127.0.0.1:${this.servicePort}/${encodeURIComponent(calendar)}/${op}-event`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(ref || {}), ...(data || {}) }), signal: AbortSignal.timeout(25000)
      });
    } catch (e) {
      throw new Error("Can't reach the calendar service. Try again in a minute.");
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `Calendar service error (HTTP ${res.status})`);
  }
});
