// Unit test for config/config.js (the settings → MagicMirror config builder): every setting reaches the right
// module, private things never appear in the built config (which MagicMirror serves to the network).
const fs = require("fs"), os = require("os"), path = require("path");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "opensky-cfg-"));
let passed = 0, failed = 0;
const ok = (n, c, i) => { c ? passed++ : failed++; console.log(`${c ? "PASS" : "FAIL"}  ${n}${i !== undefined ? "  — " + JSON.stringify(i) : ""}`); };

function build(settings, secrets = {}) {
  fs.writeFileSync(path.join(tmp, "opensky.json"), JSON.stringify(settings));
  fs.writeFileSync(path.join(tmp, "secrets.json"), JSON.stringify(secrets));
  process.env.OPENSKY_SETTINGS = path.join(tmp, "opensky.json");
  process.env.OPENSKY_SECRETS = path.join(tmp, "secrets.json");
  global.root_path = path.join(__dirname, "..");
  const src = fs.readFileSync(path.join(__dirname, "..", "config", "config.js"), "utf8");
  const m = { exports: {} };
  new Function("module", "exports", "require", "__dirname", src)(m, m.exports, require, path.join(__dirname, "..", "config"));
  return m.exports;
}
const mod = (c, name) => c.modules.find((m) => m.module === name);
// the defaults are what's tested: Docker (and the test container) set these two on purpose
delete process.env.OPENSKY_ADDRESS; delete process.env.OPENSKY_IP_WHITELIST;
const errs = []; const origErr = console.error; console.error = (...a) => errs.push(a.join(" "));

const c = build({
  family: { name: "The Testers" }, locale: { timeFormat: 24, units: "metric", locale: "en-GB" },
  profiles: [{ name: "Mom", color: "pink" }, { name: " Zoe ", color: "#3b82f6" }, { name: "mom" }, { name: "Pic", photo: "data:image/jpeg;base64,AAAA" }, { name: "Bad", photo: "javascript:alert(1)" }, { name: "" }],
  pages: ["home", "calendar", "lists", "smarthome", "money", "chores", "wordgame", "timer", "nope"],
  calendar: { holidays: "GB", holidaysRegion: "GB-SCT", sources: [
    { name: "Family", type: "local", color: "blue", role: "shared" }, { name: "Shared", type: "caldav", color: "green" },
    { name: "Work", type: "google", calendarId: "primary" }, { name: "Club", type: "google", calendarId: "c@group.calendar.google.com", readOnly: true },
    { name: "Mom", profiles: ["mom", "Zoe", "Nobody"], colorFromProfile: true, color: "red" }, { name: "ZoeCal", profiles: ["zoe"], colorFromProfile: true, color: "red" }, { name: "ZoeOwn", profiles: ["zoe"], color: "red" }, { name: "Dinner", type: "mealie", meals: ["dinner", "lunch"] }, { name: "Holidays", url: "https://x/evil.ics" }], service: { port: 5099 }, mergeShared: true },
  lists: { lists: [{ name: "Shopping", provider: "homeassistant", entity: "todo.shopping" }, { name: "Chores", profiles: ["Zoe"] }, { name: "Food", provider: "mealie", shoppingList: "Weekly", shoppingListId: "L1" }, { name: "Reese chores", provider: "greenlight", kid: "101" }], columns: 3 },
  pickup: { trashDay: "monday", url: "secret" },
  chores: { kids: [{ id: "101", name: "Zoe", profile: "zoe" }, { id: "102", name: "Max", color: "green" }, { id: "103", name: "Mama", profile: "mom" }, { id: "x", name: "Bad" }] },
  embeds: { smarthome: { title: "Smart Home", url: "http://ha.local:8123" }, money: { title: "Money" } },
  wordgame: { source: "opensky", extraWords: ["emoji"] }, look: { accent: "teal" }, keyboard: { enabled: false }, header: {}
}, { embeds: { money: { url: "http://192.168.1.9/private", pin: "246810" } }, calendar: { sources: { Mom: "https://calendar.google.com/private-xyz/basic.ics" } } });
console.error = origErr;

const cals = mod(c, "MMM-OpenSky-Calendars").config.sources;
const byName = (n) => cals.find((s) => s.name === n);
ok("1 CalDAV source → the local calendar service on the chosen port", byName("Shared").url === "http://127.0.0.1:5099/Shared/calendar.ics");
ok("2 Google sources keep their calendarId; read-only kept", byName("Work").calendarId === "primary" && byName("Club").readOnly === true);
ok("3 holidays by country (+ region), no US Google feed; a user calendar can't take the name Holidays",
  byName("Holidays").type === "holidays" && byName("Holidays").country === "GB" && byName("Holidays").region === "GB-SCT" && cals.filter((s) => s.name === "Holidays").length === 1);
ok("4 a private pickup link → a pickup-role source with no url in the config", byName("Pickup").role === "pickup" && byName("Pickup").url === null);
const ed = mod(c, "MMM-OpenSky-EventEditor").config;
ok("5 editable: on-screen, CalDAV, Google (not the read-only one, not links); service port", JSON.stringify(ed.editable.map((e) => e.name)) === '["Family","Shared","Work"]' && ed.servicePort === 5099, ed.editable);
ok("6 lists: Home Assistant entity passed on; Lists page columns", mod(c, "MMM-OpenSky-Lists").config.lists[0].entity === "todo.shopping" && mod(c, "MMM-OpenSky-ListsPage").config.columns === 3);
const hdr = mod(c, "MMM-OpenSky-Header").config;
ok("8 profiles: trimmed, blank and repeated names dropped; the top bar gets name + color",
  JSON.stringify(hdr.profiles.slice(0, 2)) === '[{"name":"Mom","color":"pink"},{"name":"Zoe","color":"#3b82f6"}]', hdr.profiles);
ok("8b profile photos: an image data URL is kept, anything else dropped",
  hdr.profiles.length === 4 && hdr.profiles[2].photo === "data:image/jpeg;base64,AAAA" && !("photo" in hdr.profiles[3]), hdr.profiles);
ok("9 calendars and lists link to profiles by name (any case); unknown names dropped; unlinked → []",
  JSON.stringify(byName("Mom").profiles) === '["Mom","Zoe"]' && byName("Family").profiles.length === 0
  && JSON.stringify(mod(c, "MMM-OpenSky-Lists").config.lists[1].profiles) === '["Zoe"]', byName("Mom").profiles);
const ec = mod(c, "MMM-OpenSky-Calendars").config.eventColors;
ok("10 a calendar for one person can take their color (colorFromProfile), also over a per-calendar color; for two people, or without the flag, it keeps its own",
  byName("ZoeCal").color === "#3b82f6" && ec.calendars.ZoeCal === "#3b82f6" && byName("ZoeOwn").color === "red" && !("ZoeOwn" in ec.calendars) && byName("Mom").color === "red" && !("Mom" in ec.calendars),
  { zoe: byName("ZoeCal").color, own: byName("ZoeOwn").color, mom: byName("Mom").color, ec });
const people = mod(c, "MMM-OpenSky-Home").config.calendarPeople;
ok("14 Home gets the calendars as people for the shared-event badges: settings order, the shared family calendar and OpenSky's own names left out, each with its color",
  JSON.stringify(people.map((p) => p.name)) === '["Shared","Work","Club","Mom","ZoeCal","ZoeOwn","Dinner"]' && people.find((p) => p.name === "ZoeCal").color === "#3b82f6" && people.find((p) => p.name === "Shared").color === "green" && people.find((p) => p.name === "Work").color === null, people);
ok("6b Mealie: a meal plan source (meals passed on, not editable) and a Mealie shopping list",
  byName("Dinner").type === "mealie" && JSON.stringify(byName("Dinner").meals) === '["dinner","lunch"]' && !ed.editable.some((e) => e.name === "Dinner") &&
  mod(c, "MMM-OpenSky-Lists").config.lists[2].provider === "mealie" && mod(c, "MMM-OpenSky-Lists").config.lists[2].shoppingList === "Weekly" && mod(c, "MMM-OpenSky-Lists").config.lists[2].shoppingListId === "L1", mod(c, "MMM-OpenSky-Lists").config.lists[2]);
ok("6c Greenlight chores list: provider and the child kept",
  mod(c, "MMM-OpenSky-Lists").config.lists[3].provider === "greenlight" && mod(c, "MMM-OpenSky-Lists").config.lists[3].kid === "101", mod(c, "MMM-OpenSky-Lists").config.lists[3]);
const chores = mod(c, "MMM-OpenSky-Chores").config;
ok("6d Chores page: in the order of the people circles at the top (unlinked last), children with a numeric id only, a linked profile gives the color, else their own; the sidebar has a Chores button",
  JSON.stringify(chores.kids.map((k) => [k.id, k.name, k.color])) === JSON.stringify([["103", "Mama", "pink"], ["101", "Zoe", "#3b82f6"], ["102", "Max", "green"]]) && mod(c, "MMM-OpenSky-Sidebar").config.pages.some((p) => p.key === "chores" && p.label === "Chores"), chores.kids);
const pages = mod(c, "MMM-pages").config.modules;
ok("7 pages in order; embed pages told apart by class; an unknown page skipped with a message",
  JSON.stringify(pages) === JSON.stringify([["MMM-OpenSky-Home"], ["MMM-CalendarExt3", "MMM-OpenSky-Calendar"], ["MMM-OpenSky-ListsPage"], ["opensky-embed-smarthome"], ["opensky-embed-money"], ["MMM-OpenSky-Chores"], ["MMM-OpenSky-WordGame"], ["MMM-OpenSky-Timer"]]) && errs.some((e) => /unknown page "nope"/.test(e)), pages);
const money = c.modules.find((m) => m.classes === "opensky-embed-money").config;
ok("8 a PIN page: locked, PIN length only, no address", money.locked === true && money.pinLength === 6 && money.url === null);
ok("9 word game source + extra words; accent; keyboard off; 24 h / metric", mod(c, "MMM-OpenSky-WordGame").config.source === "opensky" && mod(c, "MMM-OpenSky-WordGame").config.extraWords[0] === "emoji" &&
  mod(c, "MMM-OpenSky-Sidebar").config.accent === "teal" && !mod(c, "MMM-OpenSky-Keyboard") && c.timeFormat === 24 && c.units === "metric");
ok("10 header countdown follows the country's holiday calendar", mod(c, "MMM-OpenSky-Header").config.countdown.holidays === "calendar");
const served = JSON.stringify(c);
ok("10b mergeShared and a shared-role calendar reach the calendars module", mod(c, "MMM-OpenSky-Calendars").config.mergeShared === true && byName("Family").role === "shared" && byName("Mom").role === undefined);
ok("11 nothing private in the built config (served to the network)", !/private|246810|192\.168\.1\.9|xyz/.test(served));
ok("12 security basics: localhost only, webview on", c.address === "localhost" && c.ipWhitelist.includes("127.0.0.1") && c.electronOptions.webPreferences.webviewTag === true);
// Meals (Mealie's meal plan): the data module, the page, Home's card, a derived calendar, the ingredients list
const LISTID = "11111111-aaaa-4000-8000-000000000001";
const mc = build({ pages: ["home", "meals", "timer"], locale: { firstDayOfWeek: 1 }, calendar: { sources: [{ name: "Meals", type: "local" }] },
  meals: { provider: "mealie", types: ["lunch", "Dinner", "snack", "dinner"], home: true, calendar: true, calendarColor: "teal", addToList: { id: LISTID, name: "Weekly Shop" } } });
const mm = mod(mc, "MMM-OpenSky-Meals").config, mpages = mod(mc, "MMM-pages").config.modules;
ok("16 Meals: the data module gets the meal types (unknown dropped, repeats merged) and the ingredients list; the page follows the week start",
  JSON.stringify(mm.types) === '["lunch","dinner"]' && mm.addToList.id === LISTID && mm.addToList.name === "Weekly Shop" &&
  JSON.stringify(mpages) === JSON.stringify([["MMM-OpenSky-Home"], ["MMM-OpenSky-MealsPage"], ["MMM-OpenSky-Timer"]]) &&
  mod(mc, "MMM-OpenSky-MealsPage").config.firstDayOfWeek === 1, [mm, mpages]);
const mhome = mod(mc, "MMM-OpenSky-Home").config, mcal = mod(mc, "MMM-OpenSky-Calendars").config.sources.filter((x) => x.name === "Meals");
ok("17 Meals: Home gets the page's index and the 'Dinner tonight' card; the meals are one calendar source (a user calendar can't take that name)",
  mhome.mealsPage === 1 && mhome.tonight === true && mcal.length === 1 && mcal[0].type === "mealie" && mcal[0].color === "teal" && JSON.stringify(mcal[0].meals) === '["lunch","dinner"]', [mhome.mealsPage, mhome.tonight, mcal]);
const mc2 = build({ pages: ["home", "meals"], meals: { provider: "mealie", types: ["lunch"], home: true, addToList: { id: "../x", name: "Hack" } } });
ok("18 Meals: no dinner → no card; no 'calendar' → no source; a bad list id → no ingredients button",
  mod(mc2, "MMM-OpenSky-Home").config.tonight === false && !((mod(mc2, "MMM-OpenSky-Calendars") || { config: { sources: [] } }).config.sources.some((x) => x.name === "Meals")) && mod(mc2, "MMM-OpenSky-Meals").config.addToList === null);
const mc3 = build({ pages: ["home", "meals"], meals: { provider: "mealie", home: false } });
ok("19 Meals: Home card switched off", mod(mc3, "MMM-OpenSky-Home").config.tonight === false && mod(mc3, "MMM-OpenSky-Meals") && JSON.stringify(mod(mc3, "MMM-OpenSky-Meals").config.types) === '["dinner"]');
const mc4 = build({ pages: ["home", "meals"] });
ok("20 Meals: a 'meals' page with Meals not set up is skipped (and no Meals module)", JSON.stringify(mod(mc4, "MMM-pages").config.modules) === '[["MMM-OpenSky-Home"]]' && !mod(mc4, "MMM-OpenSky-Meals") && mod(mc4, "MMM-OpenSky-Home").config.tonight === false);
const ml = build({ pages: ["home", "meals"], meals: { provider: "local", types: ["dinner", "lunch"], home: true, calendar: true, calendarColor: "teal", addToList: { id: LISTID, name: "Weekly Shop" } } });
const mlcal = mod(ml, "MMM-OpenSky-Calendars").config.sources.filter((x) => x.name === "Meals");
ok("21 Meals on this screen: the page is editable, the data module is local with no ingredients list, the calendar source is the local plan",
  mod(ml, "MMM-OpenSky-MealsPage").config.editable === true && mod(ml, "MMM-OpenSky-Meals").config.local === true && mod(ml, "MMM-OpenSky-Meals").config.addToList === null &&
  mlcal.length === 1 && mlcal[0].type === "localmeals" && mod(ml, "MMM-OpenSky-Home").config.tonight === true, [mod(ml, "MMM-OpenSky-Meals").config, mlcal]);
ok("22 Meals on Mealie stays read-only", mod(mc, "MMM-OpenSky-MealsPage").config.editable === false && mod(mc, "MMM-OpenSky-Meals").config.local === false);
const d = build({});
ok("13 empty settings → a working default (home + timer, no crash)", JSON.stringify(mod(d, "MMM-pages").config.modules) === JSON.stringify([["MMM-OpenSky-Home"], ["MMM-OpenSky-Timer"]]));

// Event names come from anyone who can send an invitation: the month view (CX3 draws them as HTML) gets plain text,
// and a tapped event reads back exactly as it was named
const cx3 = mod(c, "MMM-CalendarExt3").config;
const evil = { title: `Party <img src=x onerror="alert(1)"> & 'cake'`, location: "<b>Gym</b>", description: "<script>x()</script>", startDate: "1", endDate: "2" };
const shown = cx3.eventTransformer(evil);
ok("14 month view: event title, place and notes can't carry HTML", !/[<>"']/.test(shown.title + shown.location + shown.description) && evil.title.startsWith("Party <img"),
  shown.title);
let calModule = null;
global.Module = { register: (n, o) => { calModule = o; } };
require(path.join(__dirname, "..", "modules", "MMM-OpenSky-Calendar", "MMM-OpenSky-Calendar.js"));
const back = calModule.eventFromElement.call(calModule, { dataset: { ...shown, startDate: "1", endDate: "2", fullDayEvent: "false" } });
ok("15 tapping that event gives back the real title, place and notes (the editor finds it by title)",
  back.title === evil.title && back.location === evil.location && back.description === evil.description, back.title);

// Odd but plausible hand edits give a working screen, never a crash (MagicMirror can't start without its config)
const timerOf = (cfg) => mod(cfg, "MMM-OpenSky-Timer").config.quickAddButtons.map((b) => b.seconds / 60).join(",");
let odd = null;
try {
  odd = [build(null), build({ family: { name: 1990 }, pages: ["timer", "cams"], timer: { quickAddMinutes: 10 }, embeds: { cams: { title: 7, url: "http://x" } } }),
    build({ pages: ["timer"], timer: { quickAddMinutes: ["5", "soon", -3] } })];
} catch (e) { odd = e.message; }
ok("16 odd settings (a null file, a number for the family name / a page name, one timer minute) → no crash", Array.isArray(odd) &&
  mod(odd[1], "MMM-OpenSky-Header").config.title === "1990" && timerOf(odd[1]) === "10" && timerOf(odd[2]) === "5" &&
  mod(odd[1], "MMM-OpenSky-Embed").config.title === "7", typeof odd === "string" ? odd : undefined);

// accent color: a palette name or any color code; the config, the Pi (lib/accent.js) and the screen + phone
// (OpenSkyAccent in opensky-client.js) follow the same rule
const accentIn = (v) => mod(build({ look: { accent: v } }), "MMM-OpenSky-Sidebar").config.accent;
const cases = [["teal", "teal"], [" Teal ", "teal"], ["#3B82F6", "#3b82f6"], ["#abc", "#aabbcc"], ["3b82f6", null], ["#12345", null],
  ["red;background:url(x)", null], ["#3b82f6\"><b>", null], ["", null], [7, null]];
const got = cases.map(([v]) => accentIn(v));
ok("17 accent: names and color codes (#rrggbb, #rgb, any case) reach the screen; anything else → peach (null)",
  got.every((g, i) => g === cases[i][1]), got);
const libAccent = require(path.join(__dirname, "..", "lib", "accent.js"));
global.window = {}; global.document = { addEventListener() {} };   // (just enough of a page for opensky-client.js)
require(path.join(__dirname, "..", "lib", "client", "opensky-client.js"));
const SA = global.window.OpenSkyAccent;
const same = cases.filter(([v]) => typeof v === "string").every(([v, want]) => libAccent.normalize(v) === want && SA.normalize(v) === want);
ok("18 the Pi's rule (lib/accent.js) and the screen/phone's (OpenSkyAccent) agree; a typed code may leave out the #; light colors are flagged",
  same && SA.code("3B82F6") === "#3b82f6" && SA.code("teal") === null && SA.hex("teal") === "#11998e" && SA.hex("peach") === "#e8663f" &&
  SA.light("#fff4cc") && SA.light("#ffffff") && !SA.light("#e8663f") && !SA.light("#1d4ed8"));

// text size: small / normal / large / xlarge — the config, the Pi (lib/text-size.js) and the screen + phone (OpenSkyTextSize) agree
const sizeIn = (v) => mod(build({ look: { textSize: v } }), "MMM-OpenSky-Sidebar").config.textSize;
const sizeCases = [["large", "large"], [" Extra Large ", "xlarge"], ["extra-large", "xlarge"], ["SMALL", "small"], ["huge", "normal"], ["", "normal"], [3, "normal"], [undefined, "normal"]];
const sizeGot = sizeCases.map(([v]) => sizeIn(v));
ok("19 text size: names reach the screen; anything else → normal", sizeGot.every((g, i) => g === sizeCases[i][1]), sizeGot);
const libSize = require(path.join(__dirname, "..", "lib", "text-size.js")), ST = global.window.OpenSkyTextSize;
ok("20 the Pi's rule (lib/text-size.js) and the screen/phone's (OpenSkyTextSize) agree; unknown → 1×",
  sizeCases.filter(([v]) => typeof v === "string").every(([v]) => (libSize.normalize(v) || "normal") === sizeIn(v) && (ST.normalize(v) || "normal") === sizeIn(v)) &&
  ST.factor("xlarge") === 1.3 && ST.factor("small") === 0.9 && ST.factor("nope") === 1 && ST.factor() === 1);
// dark mode: look.theme light (default) / dark / auto — config, the Pi (lib/theme.js) and the screen (OpenSkyTheme) agree; sun maths
const themeIn = (v) => mod(build({ look: { theme: v } }), "MMM-OpenSky-Sidebar").config.theme;
const themeCases = [["dark", "dark"], [" Auto ", "auto"], ["Auto (by sun)", "auto"], ["LIGHT", "light"], ["night", "light"], ["", "light"], [3, "light"], [undefined, "light"]];
const themeGot = themeCases.map(([v]) => themeIn(v));
ok("23 dark mode: names reach the screen; absent / anything else → light (today's look)", themeGot.every((g, i) => g === themeCases[i][1]), themeGot);
const libTheme = require(path.join(__dirname, "..", "lib", "theme.js")), TH = global.window.OpenSkyTheme;
ok("24 the Pi's rule (lib/theme.js) and the screen/phone's (OpenSkyTheme) agree", themeCases.filter(([v]) => typeof v === "string").every(([v]) => (libTheme.normalize(v) || "light") === themeIn(v) && (TH.normalize(v) || "light") === themeIn(v)));
const sbT = mod(build({ look: { theme: "auto", lightSensor: true }, location: { latitude: 42.3601, longitude: -71.0589 } }), "MMM-OpenSky-Sidebar").config;
ok("25 dark mode: location and light sensor reach the Sidebar; no location → null", sbT.latitude === 42.3601 && sbT.longitude === -71.0589 && sbT.lightSensor === true && mod(build({}), "MMM-OpenSky-Sidebar").config.latitude === null && mod(build({}), "MMM-OpenSky-Sidebar").config.lightSensor === false);
process.env.OPENSKY_DOCKER = "1";
ok("26 dark mode in Docker: the light sensor is never used (time / sun only)", mod(build({ look: { theme: "auto", lightSensor: true } }), "MMM-OpenSky-Sidebar").config.lightSensor === false);
delete process.env.OPENSKY_DOCKER;
// Boston, 10 Nov 2026: sunrise about 06:30 and sunset about 16:30 (EST = UTC-5; the maths is in UTC so check as instants)
const bos = TH.sunTimes(new Date(2026, 10, 10, 12), 42.3601, -71.0589), minUtc = (d) => d.getUTCHours() * 60 + d.getUTCMinutes();
ok("27 sun times: Boston in November (sunrise ~11:30 UTC, sunset ~21:30 UTC, on the same day); polar day / night; no location", bos && !bos.polar && Math.abs(minUtc(bos.rise) - 11 * 60 - 30) <= 15 && Math.abs(minUtc(bos.set) - 21 * 60 - 30) <= 15 && Math.abs(bos.set - bos.rise - 10 * 3600000) < 3600000 && bos.rise.getTime() > new Date(2026, 10, 10, 12).getTime() - 24 * 3600000 && bos.set.getTime() < new Date(2026, 10, 10, 12).getTime() + 24 * 3600000 &&
  TH.sunTimes(new Date(Date.UTC(2026, 5, 21, 12)), 80, 0).polar === "day" && TH.sunTimes(new Date(Date.UTC(2026, 11, 21, 12)), 80, 0).polar === "night" && TH.sunTimes(new Date(), null, null) === null, bos);
const at = (h, m) => new Date(2026, 5, 1, h, m);   // a local time; without a location the rule is 19:00-07:00
ok("28 Auto: no location → dark 19:00-07:00; Light / Dark ignore the sun; sensor overrules with hysteresis",
  TH.isDark("auto", at(20, 0), null, null) && TH.isDark("auto", at(6, 59), null, null) && !TH.isDark("auto", at(12, 0), null, null) && !TH.isDark("light", at(23, 0), null, null) && TH.isDark("dark", at(12, 0), null, null) &&
  TH.isDark("auto", at(12, 0), null, null, 2) && !TH.isDark("auto", at(23, 0), null, null, 200) && TH.isDark("auto", at(12, 0), null, null, 15, true) && !TH.isDark("auto", at(23, 0), null, null, 15, false));
// screensaver: off unless enabled; settings reach the module (photos share the Home settings)
const ssOf = (v) => mod(build(v === undefined ? {} : { screensaver: v, locale: { timeFormat: 24 } }), "MMM-OpenSky-Screensaver");
ok("21 screensaver: absent / not enabled → no module", !ssOf() && !ssOf({ afterMinutes: 5 }) && !ssOf({ enabled: "yes" }));
const ss = ssOf({ enabled: true, afterMinutes: 3, upNext: false, photoSeconds: 8 }), ssd = ssOf({ enabled: true, afterMinutes: -2, photoSeconds: 1 });
ok("22 screensaver: settings reach the module; bad numbers → defaults (10 min, 20 s)", ss && ss.config.afterMinutes === 3 && ss.config.upNext === false && ss.config.photos.intervalSeconds === 8 &&
  ss.config.hour12 === false && ssd.config.afterMinutes === 10 && ssd.config.photos.intervalSeconds === 20 && ssd.config.upNext === true, ss && ss.config);

delete global.window; delete global.document;


fs.rmSync(tmp, { recursive: true, force: true });
console.log(`SUMMARY pass=${passed} fail=${failed}`);
