/* OpenSky — MagicMirror configuration builder.
 *
 * Don't edit this file to set up your family's screen: edit config/opensky.json (see opensky.example.json).
 * This file reads those settings and builds the module list MagicMirror needs.
 *
 * Secrets (API keys, tokens, PINs) are NEVER placed here: MagicMirror sends this whole config to every device on
 * the network (http://<pi>:8080/config). Modules read secrets from config/secrets.json on the Pi itself.
 */
const fs = require("fs");
const path = require("path");

// MagicMirror ≥ 2.38 evaluates this file from a string, so __dirname isn't the config folder: use its root path
const CONFIG_DIR = path.join(global.root_path || path.resolve(__dirname, ".."), "config");

function readSettings() {
  // OPENSKY_SETTINGS = another settings file (the test harness uses tools/fixtures/opensky.test.json)
  for (const file of [process.env.OPENSKY_SETTINGS, "opensky.json", "opensky.example.json"].filter(Boolean)) {
    const p = path.isAbsolute(file) ? file : path.join(CONFIG_DIR, file);
    if (!fs.existsSync(p)) continue;
    try {
      const settings = JSON.parse(fs.readFileSync(p, "utf8"));
      // (a file holding just null, a list or a number still gives a working screen)
      return { file, dir: path.dirname(p), settings: settings && typeof settings === "object" && !Array.isArray(settings) ? settings : {} };
    } catch (e) {
      console.error(`[OpenSky] ${file} is not valid JSON (${e.message}) — fix it or delete it to use the example settings`);
    }
  }
  return { file: null, settings: {} };
}

// look.accent: a palette color name, or a color code (#rgb / #rrggbb → "#rrggbb"); anything else → null (peach).
// The same rule as lib/accent.js (the Settings panel) and OpenSkyAccent (the screen and the phone page).
function accentOf(v) {
  const s = String(v == null ? "" : v).trim().toLowerCase();
  if (/^[a-z]+$/.test(s)) return s;
  const m = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  return m ? `#${m[1].length === 3 ? m[1].replace(/./g, "$&$&") : m[1]}` : null;
}

// look.textSize: "small" | "normal" | "large" | "xlarge" (same rule as lib/text-size.js)
function textSizeOf(v) {
  const s = String(v == null ? "" : v).trim().toLowerCase().replace(/[\s_-]/g, "");
  const k = s === "extralarge" ? "xlarge" : s;
  return ["small", "normal", "large", "xlarge"].includes(k) ? k : "normal";
}

// look.theme: "light" (default) | "dark" | "auto" (by sun); same rule as lib/theme.js
function themeOf(v) {
  const s = String(v == null ? "" : v).trim().toLowerCase().replace(/[\s_()-]/g, "");
  return s === "dark" ? "dark" : (s === "auto" || s === "autobysun") ? "auto" : "light";
}

const { file: settingsFile, dir: settingsDir, settings: s } = readSettings();
const locale = s.locale || {};

// Sidebar label + icon for every page OpenSky knows (order of `pages` in opensky.json = order in the sidebar)
const PAGE_INFO = {
  home: { label: "Home" },
  calendar: { label: "Calendar" },
  lists: { label: "Lists" },
  meals: { label: "Meals", icon: "food" },
  weather: { label: "Weather", icon: "cloud" },
  countdowns: { label: "Countdowns", icon: "countdowns" },
  smarthome: { label: "Smart Home" },
  chores: { label: "Chores" },
  wordgame: { label: "Word Game" },
  timer: { label: "Timer" },
  music: { label: "Music" },
  devices: { label: "Devices" }
};

// Curbside pickup: trash day + an optional city preset (lib/pickup-presets/<name>.json) + the family's own overrides
const DAYS = { monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5 };
function pickupSchedule(p) {
  if (!p || !p.trashDay) return null;
  const trashDay = DAYS[String(p.trashDay).toLowerCase()] || Number(p.trashDay);
  if (!(trashDay >= 1 && trashDay <= 5)) { console.error(`[OpenSky] pickup.trashDay "${p.trashDay}" isn't a weekday — pickup icons off`); return null; }
  let preset = {};
  if (p.preset) {
    const f = path.join(global.root_path || path.resolve(__dirname, ".."), "modules", "opensky-lib", "pickup-presets", `${String(p.preset).replace(/[^a-z0-9-]/gi, "")}.json`);
    try { preset = JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { console.error(`[OpenSky] pickup preset "${p.preset}" not found (${f})`); }
  }
  const { _about, ...presetData } = preset;
  const own = { ...p }; delete own.preset; delete own.trashDay;
  return { ...presetData, ...own, trashDay };
}

// A folder setting may be relative to the settings file (e.g. the test fixture's "photos")
const folderPath = (f) => (!f ? null : /^[~/]/.test(f) ? f : path.join(settingsDir || CONFIG_DIR, f));

// Profiles (family members): name + color. Calendars and lists link to them by name ("profiles": ["Mom", "Family"]);
// the top bar shows one circle per profile and tapping it filters the calendars and lists.
const profiles = (Array.isArray(s.profiles) ? s.profiles : []).filter((p) => p && String(p.name || "").trim())
  .map((p) => ({ name: String(p.name).trim(), color: p.color || null, ...(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+\/=]{1,60000}$/.test(p.photo || "") ? { photo: p.photo } : {}) }))
  .filter((p, i, all) => all.findIndex((q) => q.name.toLowerCase() === p.name.toLowerCase()) === i);
const linkedProfiles = (v) => {   // a calendar's / list's profile names → the matching profile names (any case), no repeats
  const names = (Array.isArray(v) ? v : []).map((n) => profiles.find((p) => p.name.toLowerCase() === String(n).trim().toLowerCase())).filter(Boolean).map((p) => p.name);
  return [...new Set(names)];
};

// Meals: the Meals page, "Dinner tonight" on Home, the meals on the calendar, and (Mealie) a shopping list for a recipe's
// ingredients. opensky.json → meals: { provider: "mealie" | "local", types: ["dinner"], home: true, calendar: false,
// calendarColor, addToList: { id, name } }. "local" = a plan kept on this Pi (config/meals.json), edited on the Meals page;
// "mealie" = Mealie's meal plan (address and token are in secrets.json → mealie, read by node helpers only).
const mealSettings = (s.meals && typeof s.meals === "object") ? s.meals : {};
const mealsOn = mealSettings.provider === "mealie" || mealSettings.provider === "local";
const mealsLocal = mealSettings.provider === "local";
const mealTypes = (() => {
  const t = (Array.isArray(mealSettings.types) ? mealSettings.types : ["dinner"]).map((x) => String(x).toLowerCase()).filter((x) => ["breakfast", "lunch", "dinner", "side"].includes(x));
  return t.length ? [...new Set(t)] : ["dinner"];
})();
const mealList = !mealsLocal && mealSettings.addToList && /^[0-9a-f-]{8,64}$/i.test(String(mealSettings.addToList.id || ""))
  ? { id: String(mealSettings.addToList.id), name: String(mealSettings.addToList.name || "the shopping list").slice(0, 40) } : null;

// Countdowns: a vacation, birthday or other big day with a days-to-go counter, a title and a photo. opensky.json → countdowns:
// { items: [{ id, title, date: "YYYY-MM-DD", yearly?, photo?, color?, home? }], keepDays }. They show as a card on Home
// (home !== false) and on the Countdowns page (a "countdowns" entry in pages). Once the date has passed they stay `keepDays`
// days (default 0 = through the day itself), then hide. `yearly` ones (birthdays) count to their next day instead. The
// photo (photo: true) is a file in countdown-photos/ beside opensky.json, shown through /opensky-countdown/<id>.
const countdownSettings = (s.countdowns && typeof s.countdowns === "object" && !Array.isArray(s.countdowns)) ? s.countdowns : {};
const countdownItems = (Array.isArray(countdownSettings.items) ? countdownSettings.items : [])
  .filter((c) => c && /^[a-z0-9]{4,24}$/.test(String(c.id)) && String(c.title == null ? "" : c.title).trim() && /^\d{4}-\d{2}-\d{2}$/.test(String(c.date)) && !isNaN(new Date(`${c.date}T12:00:00`)))
  .filter((c, i, all) => all.findIndex((q) => q.id === c.id) === i).slice(0, 24)
  .map((c) => ({ id: String(c.id), title: String(c.title).trim().slice(0, 60), date: String(c.date), yearly: c.yearly === true, photo: c.photo === true,
    color: /^[a-z]+$|^#[0-9a-f]{6}$/i.test(String(c.color || "")) ? String(c.color) : "orange", home: c.home !== false }));
const countdownKeepDays = Number.isFinite(Number(countdownSettings.keepDays)) ? Math.min(365, Math.max(0, Math.round(Number(countdownSettings.keepDays)))) : 0;

// Chores (Greenlight): the children shown on the Chores page. A linked profile gives the color, else the child's own.
const choreKids = (Array.isArray(s.chores && s.chores.kids) ? s.chores.kids : []).filter((k) => k && /^\d+$/.test(String(k.id))).slice(0, 8)
  .map((k) => {
    const p = profiles.find((q) => q.name.toLowerCase() === String(k.profile || "").trim().toLowerCase());
    return { id: String(k.id), name: String(k.name || "").trim().slice(0, 30) || "Chores", ...(p ? { profile: p.name } : {}), color: (p && p.color) || k.color || null };
  })
  // same order as the people circles at the top (children not linked to a person keep their order, after those)
  .map((k, i) => ({ k, at: k.profile ? profiles.findIndex((q) => q.name === k.profile) : profiles.length, i }))
  .sort((a, b) => a.at - b.at || a.i - b.i).map((x) => x.k);

// Calendar sources (a module with no screen of its own; any page can use the events)
const cal = s.calendar || {};
// "colorFromProfile": a calendar for exactly one person takes that person's color (and follows it when it changes)
const profileColor = (c) => {
  const ps = c.colorFromProfile ? linkedProfiles(c.profiles) : [];
  const p = ps.length === 1 ? profiles.find((q) => q.name === ps[0]) : null;
  return p && p.color ? p.color : null;
};
const calendarSources = (Array.isArray(cal.sources) ? cal.sources : []).filter((c) => c && c.name)
  .filter((c) => c.name !== "Pickup" && c.name !== "Holidays" && !(mealsOn && c.name === "Meals"))   // (names OpenSky uses itself)
  .map((c) => ({ name: String(c.name), type: ["local", "caldav", "google", "mealie"].includes(c.type) ? c.type : "link", url: c.url || null, color: profileColor(c) || c.color || null, fetchMinutes: c.fetchMinutes || 5,
    ...(c.role === "shared" ? { role: "shared" } : {}),
    profiles: linkedProfiles(c.profiles),
    ...(c.type === "mealie" ? { meals: Array.isArray(c.meals) ? c.meals.map(String) : ["dinner"] } : {}),
    ...(c.type === "google" ? { calendarId: String(c.calendarId || "primary"), readOnly: !!c.readOnly } : {}) }));
// calendar.colors.calendars (a color per calendar name) wins over a source's own color, so a synced color goes in there too
const syncedColors = Object.fromEntries((Array.isArray(cal.sources) ? cal.sources : []).filter((c) => c && c.name && profileColor(c)).map((c) => [String(c.name), profileColor(c)]));
const eventColors = Object.keys(syncedColors).length ? { ...(cal.colors || {}), calendars: { ...((cal.colors || {}).calendars || {}), ...syncedColors } } : (cal.colors || null);
// who the calendars are, in settings order (initial badges on events shared by several calendars; the family calendar isn't a person)
const calendarPeople = calendarSources.filter((c) => c.role !== "shared").map((c) => ({ name: c.name, color: ((eventColors || {}).calendars || {})[c.name] || c.color || null }));
// CalDAV calendars are read through OpenSky's calendar service on this Pi (the account stays in secrets.json)
const servicePort = (cal.service && cal.service.port) || 5747;
calendarSources.filter((c) => c.type === "caldav").forEach((c) => { c.url = `http://127.0.0.1:${servicePort}/${encodeURIComponent(c.name)}/calendar.ics`; });
if (mealsOn && mealSettings.calendar) calendarSources.push({ name: "Meals", type: mealsLocal ? "localmeals" : "mealie", url: null, meals: mealTypes, color: mealSettings.calendarColor || "orange", fetchMinutes: 5 });
if (cal.holidays === "US") calendarSources.push({ name: "Holidays", url: "https://calendar.google.com/calendar/ical/en.usa%23holiday%40group.v.calendar.google.com/public/basic.ics", color: "tan", fetchMinutes: 720 });
else if (/^[A-Za-z]{2}$/.test(cal.holidays || "")) calendarSources.push({ name: "Holidays", type: "holidays", url: null, country: cal.holidays.toUpperCase(), region: cal.holidaysRegion || null, color: "tan", fetchMinutes: 720 });

// Calendars that can be changed from the screen: the on-device calendar(s) and CalDAV accounts
// Lists (groceries, to-dos…): on-device by default; Todoist with a token in secrets.json
const listSettings = s.lists || {};
const familyLists = (Array.isArray(listSettings.lists) ? listSettings.lists : []).filter((l) => l && l.name)
  .map((l) => ({ name: String(l.name), color: l.color || null, profiles: linkedProfiles(l.profiles), provider: ["todoist", "homeassistant", "mealie", "greenlight"].includes(l.provider) ? l.provider : "local",
    ...(l.project ? { project: String(l.project) } : {}), ...(l.projectId ? { projectId: String(l.projectId) } : {}),
    ...(l.entity ? { entity: String(l.entity) } : {}),
    ...(l.kid ? { kid: String(l.kid) } : {}),
    ...(l.shoppingList ? { shoppingList: String(l.shoppingList) } : {}), ...(l.shoppingListId ? { shoppingListId: String(l.shoppingListId) } : {}) }));
// Trash / recycling days from a calendar link (many cities and ReCollect publish one): opensky.json → pickup.url,
// or a private one in secrets.json → calendar.sources.Pickup (with pickup.url: "secret")
const pk = s.pickup || {};
if (pk.url) calendarSources.push({ name: "Pickup", type: "link", role: "pickup", url: pk.url === "secret" ? null : pk.url, color: "gray", fetchMinutes: 720 });
const editableCalendars = calendarSources.filter((c) => c.type === "local" || c.type === "caldav" || (c.type === "google" && !c.readOnly))
  .map((c) => ({ name: c.name, type: c.type, ...(c.type === "google" ? { calendarId: c.calendarId } : {}) }));
const canAddEvents = editableCalendars.length > 0;

// Timer buttons: whole minutes; anything else (one number instead of a list, words) → the usual buttons
function quickMinutes(v) {
  const list = (Array.isArray(v) ? v : [v]).map(Number).filter((m) => Number.isInteger(m) && m > 0 && m <= 24 * 60);
  return list.length ? list : [5, 10, 15, 30, 45, 60];
}

// Home's right-hand cards: which show and in what order (home.cards; unknown names dropped, repeats ignored; none given = all, as before)
const HOME_CARDS = ["notes", "tonight", "lists", "photos"];
const homeCards = Array.isArray(s.home && s.home.cards) ? [...new Set(s.home.cards.filter((c) => HOME_CARDS.includes(c)))] : HOME_CARDS;

// Each page = the modules that appear on it.
// The photo source settings (Home's photo card and the screensaver share them; only the change interval differs)
const photosConfig = (defaultSeconds) => ({
  enabled: !(s.photos && s.photos.enabled === false),
  provider: (s.photos && s.photos.provider) || "folder",
  folder: folderPath(s.photos && s.photos.folder) || "~/Pictures",
  usb: !(s.photos && s.photos.usb === false),
  url: (s.photos && s.photos.url) || null,
  intervalSeconds: (s.photos && s.photos.intervalSeconds) || defaultSeconds
});

const PAGES = {
  calendar: () => [
    {
      module: "MMM-CalendarExt3",          // month view (community module, MIT, pinned + OpenSky patch)
      position: "fullscreen_above",
      config: {
        mode: "month", instanceId: "OPENSKY", animationSpeed: 0,
        firstDayOfWeek: locale.firstDayOfWeek === 1 ? 1 : 0,
        showHeader: true, customHeader: true, headerTitleOptions: { month: "long", year: "numeric" },
        maxEventLines: 3, showMore: true, fontSize: "20px", eventHeight: "38px",
        eventTimeOptions: { hour: "numeric", minute: "2-digit", hour12: locale.timeFormat !== 24 },
        cellDateOptions: { day: "numeric" }, displayEndTime: false, useSymbol: false, calendars: [],
        // CX3 puts an event's title, place and notes into the page as HTML. Anyone who can name an event (a Google
        // invitation, a shared calendar link) must not be able to run code on the screen, so they go in as plain
        // text (MMM-OpenSky-Calendar decodes them again). A copy: CX3 hands the same event objects in on every redraw.
        // Plus a color class from the shared palette (window.OpenSkyEventColors, loaded by MMM-OpenSky-Calendar).
        eventTransformer: (ev) => {
          const esc = (v) => (typeof v === "string" ? v.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`) : v);
          const out = { ...ev, title: esc(ev.title), description: esc(ev.description), location: esc(ev.location) };
          if (typeof window !== "undefined" && window.OpenSkyEventColors) {
            const multi = window.OpenSkyEventColors.multi(ev);
            if (multi) { out.class = "evc-multi"; out.color = multi; return out; }   // shared by several calendars: box shows all their colors
            const c = window.OpenSkyEventColors.name(ev);
            // a palette name → its class; a color code → evc-custom, colored through CX3's --calendarColor (= out.color)
            if (c.startsWith("#")) { out.class = "evc-custom"; out.color = c; } else out.class = `evc-${c}`;
          }
          return out;
        }
      }
    },
    {
      module: "MMM-OpenSky-Calendar",
      position: "fullscreen_above",
      config: { instanceId: "OPENSKY", canAddEvents, eventColors }
    }
  ],
  home: () => [{
    module: "MMM-OpenSky-Home",
    position: "fullscreen_above",
    config: {
      listsPage: pages.indexOf("lists") >= 0 ? pages.indexOf("lists") : null,
      mealsPage: pages.indexOf("meals") >= 0 ? pages.indexOf("meals") : null,
      tonight: mealsOn && mealSettings.home !== false && mealTypes.includes("dinner") && homeCards.includes("tonight"),
      cards: homeCards,
      countdowns: { items: countdownItems.filter((c) => c.home), keepDays: countdownKeepDays, page: pages.indexOf("countdowns") >= 0 ? pages.indexOf("countdowns") : null },
      canAddEvents,
      maxEventsPerDay: 4,
      eventColors,
      calendarPeople,
      photos: { ...photosConfig(30), enabled: photosConfig(30).enabled && homeCards.includes("photos") },
      pickup: pickupSchedule(s.pickup)
    }
  }],
  lists: () => [{
    module: "MMM-OpenSky-ListsPage",
    position: "fullscreen_above",
    config: { columns: (s.lists && s.lists.columns) || 4 }
  }],
  meals: () => [{
    module: "MMM-OpenSky-MealsPage",
    position: "fullscreen_above",
    config: { firstDayOfWeek: locale.firstDayOfWeek === 1 ? 1 : 0, types: mealTypes, editable: mealsLocal }
  }],
  // hourly forecast, weather alerts (US) and a rain radar: opensky.json → weather: { hourly, alerts, radar } (each on unless false)
  weather: () => {
    const w = (s.weather && typeof s.weather === "object") ? s.weather : {}, l = s.location || {};
    return [{
      module: "MMM-OpenSky-WeatherPage",
      position: "fullscreen_above",
      config: {
        latitude: Number.isFinite(l.latitude) ? l.latitude : null, longitude: Number.isFinite(l.longitude) ? l.longitude : null,
        placeName: String(l.name || "").slice(0, 80), units: locale.units === "metric" ? "metric" : "imperial", hour12: locale.timeFormat !== 24,
        hourly: w.hourly !== false, alerts: w.alerts !== false, radar: w.radar !== false
      }
    }];
  },
  countdowns: () => [{
    module: "MMM-OpenSky-CountdownsPage",
    position: "fullscreen_above",
    config: { items: countdownItems, keepDays: countdownKeepDays }
  }],
  // the kids' chores from Greenlight (unofficial): opensky.json → chores.kids [{ id, name, profile?, color? }]; the login is secrets.json → greenlight
  chores: () => [{
    module: "MMM-OpenSky-Chores",
    position: "fullscreen_above",
    config: { kids: choreKids, refreshMinutes: Math.max(1, Number(s.chores && s.chores.refreshMinutes) || 5), badges: !!(s.chores && s.chores.badges) }
  }],
  wordgame: () => [{
    module: "MMM-OpenSky-WordGame",
    position: "fullscreen_above",
    config: {
      source: (s.wordgame && s.wordgame.source === "opensky") ? "opensky" : "nyt",
      extraWords: (s.wordgame && Array.isArray(s.wordgame.extraWords)) ? s.wordgame.extraWords : []
    }
  }],
  timer: () => [{
    module: "MMM-OpenSky-Timer",
    position: "fullscreen_below",
    config: {
      quickAddButtons: quickMinutes(s.timer && s.timer.quickAddMinutes)
        .map((m) => ({ label: m % 60 === 0 && m >= 60 ? `+${m / 60} hr` : `+${m} min`, seconds: m * 60 })),
      alarm: { volume: (s.timer && s.timer.chimeVolume) ?? 0.6, repeatEverySeconds: 2.5, maxRingSeconds: 180 }
    }
  }],
  // the Music add-on (opensky addon music): the speaker name phones show — same rule as services/music/render.js
  music: () => [{
    module: "MMM-OpenSky-Music",
    position: "fullscreen_above",
    config: {
      name: String((s.music && s.music.name) || (s.family && s.family.name) || "OpenSky").replace(/[\u0000-\u001f"\\]/g, "").trim().slice(0, 40) || "OpenSky",
      spotify: !(s.music && s.music.spotify === false),
      airplay: !(s.music && s.music.airplay === false),
      // other speakers to control: Home Assistant media players (address + token stay in secrets.json)
      speakers: (s.music && Array.isArray(s.music.speakers) ? s.music.speakers : []).filter((e) => /^media_player\.[a-z0-9_]+$/.test(e)).slice(0, 8)
    }
  }],
  // Home Assistant lights, switches, locks and sensors as tiles: opensky.json → devices.tiles [{ entity, name? }];
  // the address + token stay in secrets.json → homeassistant (read by the node helper)
  devices: () => [{
    module: "MMM-OpenSky-Devices",
    position: "fullscreen_above",
    config: {
      tiles: (s.devices && Array.isArray(s.devices.tiles) ? s.devices.tiles : [])
        .filter((t) => t && /^(light|switch|lock|sensor|binary_sensor)\.[a-z0-9_]+$/.test(t.entity))
        .map((t) => ({ entity: t.entity, name: t.name ? String(t.name).slice(0, 40) : undefined })).slice(0, 48)
    }
  }]
};

// Embed pages (a web page on the screen: Home Assistant, a camera…): any key in opensky.json → embeds, listed in pages.
// A PIN (secrets.json → embeds.<key>.pin) locks the page; only whether one is set (and its length) is used here.
const embeds = (s.embeds && typeof s.embeds === "object") ? s.embeds : {};
function embedPin(key) {
  try {
    const sec = JSON.parse(fs.readFileSync(process.env.OPENSKY_SECRETS || path.join(settingsDir || CONFIG_DIR, "secrets.json"), "utf8"));
    const pin = sec && sec.embeds && sec.embeds[key] && sec.embeds[key].pin;
    return pin != null && /^\d{4,8}$/.test(String(pin)) ? String(pin).length : 0;
  } catch (e) { return 0; }
}
for (const [key, e] of Object.entries(embeds)) {
  if (PAGES[key] || !/^[a-z][a-z0-9-]{0,30}$/.test(key) || !e) continue;
  const pinLength = embedPin(key);
  PAGE_INFO[key] = { label: String(e.title || (PAGE_INFO[key] || {}).label || key), icon: e.icon || (key === "smarthome" ? "smarthome" : "embed") };
  PAGES[key] = () => [{
    module: "MMM-OpenSky-Embed",
    classes: `opensky-embed-${key}`,   // MMM-pages tells embed pages apart by this class
    position: "fullscreen_above",
    config: { key, title: PAGE_INFO[key].label, url: pinLength ? null : (e.url || null), locked: pinLength > 0, pinLength: pinLength || 4, zoom: Number(e.zoom) || 1 }
  }];
}

const pages = (Array.isArray(s.pages) && s.pages.length ? s.pages : ["home", "timer"]).filter((p) => {
  if (p === "meals" && !mealsOn) { console.error(`[OpenSky] the "meals" page needs meals.provider "mealie" or "local" in ${settingsFile} — skipped`); return false; }
  if (PAGES[p]) return true;
  console.error(`[OpenSky] unknown page "${p}" in ${settingsFile} — skipped`);
  return false;
});
// Screen profiles: named presets a screen picks in Settings (which pages it shows, whose calendars, text size, accent). opensky.json →
// screens: [{ name, pages?: [page keys], person?: profile name, textSize?, accent? }]. Each screen remembers its pick in its own browser.
const screenProfiles = (Array.isArray(s.screens) ? s.screens : []).filter((x) => x && String(x.name || "").trim())
  .map((x) => {
    const person = linkedProfiles([x.person])[0] || null;
    return {
      name: String(x.name).trim().slice(0, 30),
      pages: (Array.isArray(x.pages) ? x.pages : []).map(String).filter((k, i, a) => pages.includes(k) && a.indexOf(k) === i),
      person,
      textSize: ((t) => (t !== "normal" || /^normal$/i.test(String(x.textSize || "").trim()) ? t : null))(textSizeOf(x.textSize)),   // an unknown size = follow the default
      accent: x.accent ? accentOf(x.accent) : null
    };
  })
  .filter((x, i, all) => all.findIndex((y) => y.name.toLowerCase() === x.name.toLowerCase()) === i)
  .slice(0, 12);

const pageModules = pages.map((p) => PAGES[p]());
const familyName = String((s.family && s.family.name) || "").trim();

const loc = s.location || {};
const units = locale.units === "metric" ? "metric" : "imperial";
const header = s.header || {};
const saver = s.screensaver || {};

// Event reminders: opensky.json -> reminders { minutes (0/absent = off), chime, banner, allDay, people: [profile names] }.
// "people" limits it to the calendars linked to those people (or named like them); empty = every calendar.
const remSet = (s.reminders && typeof s.reminders === "object") ? s.reminders : {};
const remMinutes = Number.isInteger(remSet.minutes) && remSet.minutes >= 1 && remSet.minutes <= 120 ? remSet.minutes : 0;
const remPeople = linkedProfiles(remSet.people);
const remCalendars = remPeople.length
  ? calendarSources.filter((c) => c.profiles.some((n) => remPeople.includes(n)) || remPeople.some((n) => n.toLowerCase() === c.name.toLowerCase())).map((c) => c.name)
  : null;


// Modules shown on every page
const fixed = [
  { module: "MMM-OpenSky-Settings", config: {} },
  { module: "MMM-OpenSky-Setup", config: {} },
  ...(s.keyboard && s.keyboard.enabled === false ? [] : [{ module: "MMM-OpenSky-Keyboard", config: { layout: (s.keyboard && s.keyboard.layout) || "en" } }]),
  ...(mealsOn ? [{ module: "MMM-OpenSky-Meals", config: { types: mealTypes, addToList: mealList, local: mealsLocal } }] : []),
  ...(familyLists.length ? [{ module: "MMM-OpenSky-Lists", config: { lists: familyLists, refreshMinutes: listSettings.refreshMinutes || 2 } }] : []),
  ...(calendarSources.length ? [{ module: "MMM-OpenSky-EventEditor", config: { editable: editableCalendars, servicePort } }] : []),
  ...(saver.enabled === true ? [{
    module: "MMM-OpenSky-Screensaver",
    config: {
      afterMinutes: Number.isFinite(saver.afterMinutes) && saver.afterMinutes > 0 ? saver.afterMinutes : 10,
      upNext: saver.upNext !== false, showClock: saver.showClock !== false, showWeather: saver.showWeather !== false,
      hour12: locale.timeFormat !== 24, eventColors,
      photos: { ...photosConfig(20), intervalSeconds: Number.isFinite(saver.photoSeconds) && saver.photoSeconds >= 5 ? saver.photoSeconds : 20 }
    }
  }] : []),
  ...(remMinutes && calendarSources.length && (remSet.chime !== false || remSet.banner !== false) ? [{
    module: "MMM-OpenSky-Reminders",
    config: { minutes: remMinutes, chime: remSet.chime !== false, banner: remSet.banner !== false, allDay: remSet.allDay === true, calendars: remCalendars, hour12: locale.timeFormat !== 24 }
  }] : []),
  ...(calendarSources.length ? [{ module: "MMM-OpenSky-Calendars", config: { sources: calendarSources, mergeShared: !!cal.mergeShared, eventColors } }] : []),
  {
    module: "MMM-OpenSky-Header",
    position: "top_bar",
    config: {
      title: familyName || "Our Family",
      profiles,
      time: { format12: locale.timeFormat !== 24, showSeconds: false, updateInterval: 1000 },
      weather: {
        provider: (s.weather && s.weather.provider) || "open-meteo",
        latitude: Number.isFinite(loc.latitude) ? loc.latitude : null,
        longitude: Number.isFinite(loc.longitude) ? loc.longitude : null,
        units, refreshMinutes: 15
      },
      countdown: {
        // US: built-in list (with Mother's Day, Halloween…); other countries: from the Holidays calendar
        holidays: header.holidays === "none" ? "none" : (!cal.holidays || cal.holidays === "US") ? "US" : (cal.holidays === "none" ? "none" : "calendar"),
        custom: Array.isArray(header.occasions) ? header.occasions : [],
        birthdays: header.birthdaysFromCalendar !== false
      },
      sports: header.sports && header.sports.team ? { league: header.sports.league || "nfl", team: header.sports.team } : null
    }
  },
  {
    module: "MMM-OpenSky-Sidebar",
    position: "fullscreen_above",
    config: {
      pages: pages.map((key, index) => ({ key, index, label: (PAGE_INFO[key] || {}).label || key, icon: (PAGE_INFO[key] || {}).icon || key })),
      familyInitial: (familyName.replace(/^the\s+/i, "")[0] || "H").toUpperCase(),
      idleReturnMinutes: (s.sidebar && Number.isFinite(s.sidebar.idleReturnMinutes)) ? s.sidebar.idleReturnMinutes : 5,
      screenServiceUrl: (s.screen && s.screen.serviceUrl) || null,
      showSettings: true,
      accent: accentOf(s.look && s.look.accent),
      scale: (s.look && s.look.scale) || "auto",
      textSize: textSizeOf(s.look && s.look.textSize),
      theme: themeOf(s.look && s.look.theme),
      lightSensor: !!(s.look && s.look.lightSensor === true) && process.env.OPENSKY_DOCKER !== "1",   // no sensor in a container: sun only
      latitude: Number.isFinite(loc.latitude) ? loc.latitude : null,
      longitude: Number.isFinite(loc.longitude) ? loc.longitude : null,
      screens: screenProfiles
    }
  }
];

let config = {
  address: process.env.OPENSKY_ADDRESS || "localhost",
  port: Number(process.env.OPENSKY_PORT) || 8080,
  basePath: "/",
  // OPENSKY_IP_WHITELIST: comma-separated addresses allowed to open the page (Docker/tablets); "all" = anyone on the network
  ipWhitelist: process.env.OPENSKY_IP_WHITELIST === "all" ? [] : process.env.OPENSKY_IP_WHITELIST ? process.env.OPENSKY_IP_WHITELIST.split(",").map((a) => a.trim()).filter(Boolean) : ["127.0.0.1", "::ffff:127.0.0.1", "::1"],
  language: locale.language || "en",
  locale: locale.locale || "en-US",
  timeFormat: locale.timeFormat === 24 ? 24 : 12,
  units,
  customCss: "css/opensky.css",
  // embed pages show web pages in a <webview> (it can show sites that refuse to be framed, like Home Assistant)
  electronOptions: { webPreferences: { webviewTag: true } },

  modules: [
    {
      module: "MMM-pages",
      config: {
        timings: { default: 0 },
        animationTime: 0,
        modules: pageModules.map((mods) => mods.map((m) => m.classes || m.module)),
        fixed: fixed.map((m) => m.module)
      }
    },
    ...fixed,
    ...pageModules.flat()
  ]
};

/*************** DO NOT EDIT THE LINE BELOW ***************/
if (typeof module !== "undefined") { module.exports = config; }
