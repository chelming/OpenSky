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
  pages: ["home", "calendar", "lists", "smarthome", "money", "chores", "devices", "wordgame", "timer", "nope"],
  devices: { tiles: [{ entity: "light.hall", name: "Hall" }, { entity: "lock.front" }, { entity: "media_player.tv" }, { entity: "switch.x/../y" }, { entity: "sensor.temp", name: "T" }] },
  calendar: { holidays: "GB", holidaysRegion: "GB-SCT", sources: [
    { name: "Family", type: "local", color: "blue", role: "shared" }, { name: "Shared", type: "caldav", color: "green" },
    { name: "Work", type: "google", calendarId: "primary" }, { name: "Club", type: "google", calendarId: "c@group.calendar.google.com", readOnly: true },
    { name: "Mom", profiles: ["mom", "Zoe", "Nobody"], colorFromProfile: true, color: "red" }, { name: "ZoeCal", only: "(unclosed", profiles: ["zoe"], colorFromProfile: true, color: "red" }, { name: "ZoeOwn", profiles: ["zoe"], color: "red", only: " ^Day [1-6]$ ", header: true }, { name: "Dinner", type: "mealie", meals: ["dinner", "lunch"] }, { name: "Holidays", url: "https://x/evil.ics" }], service: { port: 5099 }, mergeShared: true },
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
ok("5b a calendar can keep only events whose title matches (trimmed); an invalid pattern is dropped", byName("ZoeOwn").only === "^Day [1-6]$" && byName("ZoeCal").only === undefined && byName("Family").only === undefined, [byName("ZoeOwn").only, byName("ZoeCal").only]);
ok("5c a calendar can show today's event in the header: the Header module gets those calendar names", byName("ZoeOwn").header === true && byName("Family").header === undefined && JSON.stringify(mod(c, "MMM-OpenSky-Header").config.todayPills) === '["ZoeOwn"]', mod(c, "MMM-OpenSky-Header").config.todayPills);
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
const dev = mod(c, "MMM-OpenSky-Devices").config;
ok("6e Devices page: Home Assistant tiles (light, lock, sensor) with chosen names; non-device and malformed entities dropped; sidebar entry; no token in the config",
  JSON.stringify(dev.tiles.map((t) => [t.entity, t.name])) === JSON.stringify([["light.hall", "Hall"], ["lock.front", undefined], ["sensor.temp", "T"]]) &&
  mod(c, "MMM-OpenSky-Sidebar").config.pages.some((p) => p.key === "devices" && p.label === "Devices") && !JSON.stringify(dev).includes("token"), dev);
ok("6c Greenlight chores list: provider and the child kept",
  mod(c, "MMM-OpenSky-Lists").config.lists[3].provider === "greenlight" && mod(c, "MMM-OpenSky-Lists").config.lists[3].kid === "101", mod(c, "MMM-OpenSky-Lists").config.lists[3]);
const chores = mod(c, "MMM-OpenSky-Chores").config;
ok("6d Chores page: in the order of the people circles at the top (unlinked last), children with a numeric id only, a linked profile gives the color, else their own; the sidebar has a Chores button",
  JSON.stringify(chores.kids.map((k) => [k.id, k.name, k.color])) === JSON.stringify([["103", "Mama", "pink"], ["101", "Zoe", "#3b82f6"], ["102", "Max", "green"]]) && mod(c, "MMM-OpenSky-Sidebar").config.pages.some((p) => p.key === "chores" && p.label === "Chores"), chores.kids);
const pages = mod(c, "MMM-pages").config.modules;
ok("7 pages in order; embed pages told apart by class; an unknown page skipped with a message",
  JSON.stringify(pages) === JSON.stringify([["MMM-OpenSky-Home"], ["MMM-CalendarExt3", "MMM-OpenSky-Calendar"], ["MMM-OpenSky-ListsPage"], ["opensky-embed-smarthome"], ["opensky-embed-money"], ["MMM-OpenSky-Chores"], ["MMM-OpenSky-Devices"], ["MMM-OpenSky-WordGame"], ["MMM-OpenSky-Timer"]]) && errs.some((e) => /unknown page "nope"/.test(e)), pages);
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
const wx = build({ pages: ["home", "weather"], location: { name: "Boston, MA", latitude: 42.36, longitude: -71.06 }, locale: { timeFormat: 24, units: "metric" }, weather: { radar: false } });
const wxm = mod(wx, "MMM-OpenSky-WeatherPage");
ok("23 Weather page: location, units and clock reach it; each extra is on unless switched off", wxm && wxm.config.latitude === 42.36 && wxm.config.placeName === "Boston, MA" && wxm.config.units === "metric" && wxm.config.hour12 === false &&
  wxm.config.hourly === true && wxm.config.alerts === true && wxm.config.radar === false && mod(wx, "MMM-pages").config.modules.length === 2, wxm && wxm.config);
ok("24b the header knows which page is Weather (its alerts pill opens it); no Weather page = no link",
  mod(wx, "MMM-OpenSky-Header").config.weatherPage === 1 && mod(build({ pages: ["home"] }), "MMM-OpenSky-Header").config.weatherPage === null, mod(wx, "MMM-OpenSky-Header").config.weatherPage);
const wx2 = build({ pages: ["weather"], weather: { hourly: false, alerts: false } });
ok("24 Weather page without a location still builds (the page says to set the town); no key or secret in its config",
  mod(wx2, "MMM-OpenSky-WeatherPage").config.latitude === null && mod(wx2, "MMM-OpenSky-WeatherPage").config.hourly === false && mod(wx2, "MMM-OpenSky-WeatherPage").config.radar === true && !/key|token|secret/i.test(JSON.stringify(mod(wx2, "MMM-OpenSky-WeatherPage").config)));
// Countdowns: cleaned items reach Home (only the ones shown on Home) and the Countdowns page; odd entries dropped; the page needs the "countdowns" page
const cdc = build({ pages: ["home", "countdowns", "timer"], countdowns: { keepDays: 3.4, items: [
  { id: "cbeach01", title: "  Beach trip  ", date: "2031-07-04", photo: true, color: "blue" },
  { id: "czoe0001", title: "Zoe", date: "2019-11-11", yearly: true, home: false, color: "url(x)" },
  { id: "Bad Id", title: "No", date: "2031-07-04" }, { id: "cnotitle", title: "  ", date: "2031-07-04" }, { id: "cbaddate", title: "Bad", date: "2031-02-31x" },
  { id: "cbeach01", title: "Repeated id", date: "2031-07-04" }, null, 7] } });
const cdp = mod(cdc, "MMM-OpenSky-CountdownsPage").config;
ok("26 Countdowns: bad ids, empty titles, bad dates and repeats are dropped; the title is trimmed; a bad color → orange; photo/yearly only when true",
  JSON.stringify(cdp.items.map((x) => [x.id, x.title, x.photo, x.yearly, x.color, x.home])) === '[["cbeach01","Beach trip",true,false,"blue",true],["czoe0001","Zoe",false,true,"orange",false]]', cdp.items);
ok("27 Countdowns: Home gets only the ones set to show on Home, the keep-days (whole, 0-365) and the page index",
  JSON.stringify(mod(cdc, "MMM-OpenSky-Home").config.countdowns) === '{"items":[{"id":"cbeach01","title":"Beach trip","date":"2031-07-04","yearly":false,"photo":true,"color":"blue","home":true}],"keepDays":3,"page":1}' && cdp.keepDays === 3, mod(cdc, "MMM-OpenSky-Home").config.countdowns);
const cd0 = build({ pages: ["home"], countdowns: { keepDays: -5, items: "nope" } });
ok("28 Countdowns: no page in 'pages' → Home has no 'See all' (page null); nonsense settings → nothing, keep 0, no crash",
  mod(cd0, "MMM-OpenSky-Home").config.countdowns.page === null && mod(cd0, "MMM-OpenSky-Home").config.countdowns.keepDays === 0 && mod(cd0, "MMM-OpenSky-Home").config.countdowns.items.length === 0 && !mod(cd0, "MMM-OpenSky-CountdownsPage"));
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
const themeCases = [["dark", "dark"], ["System", "system"], [" Auto ", "auto"], ["Auto (by sun)", "auto"], ["LIGHT", "light"], ["night", "light"], ["", "light"], [3, "light"], [undefined, "light"]];
const themeGot = themeCases.map(([v]) => themeIn(v));
ok("23 dark mode: names reach the screen; absent / anything else → light (today's look)", themeGot.every((g, i) => g === themeCases[i][1]), themeGot);
const libTheme = require(path.join(__dirname, "..", "lib", "theme.js")), TH = global.window.OpenSkyTheme;
ok("24 the Pi's rule (lib/theme.js) and the screen/phone's (OpenSkyTheme) agree", themeCases.filter(([v]) => typeof v === "string").every(([v]) => (libTheme.normalize(v) || "light") === themeIn(v) && (TH.normalize(v) || "light") === themeIn(v)));
const sbT = mod(build({ look: { theme: "auto", lightSensor: true }, location: { latitude: 42.3601, longitude: -71.0589 } }), "MMM-OpenSky-Sidebar").config;
ok("25 dark mode: location and light sensor reach the Sidebar; no location → null", sbT.latitude === 42.3601 && sbT.longitude === -71.0589 && sbT.lightSensor === true && mod(build({}), "MMM-OpenSky-Sidebar").config.latitude === null && mod(build({}), "MMM-OpenSky-Sidebar").config.lightSensor === false);
process.env.OPENSKY_DOCKER = "1";
ok("26 dark mode in Docker: the light sensor is never used (time / sun only)", mod(build({ look: { theme: "auto", lightSensor: true } }), "MMM-OpenSky-Sidebar").config.lightSensor === false);
delete process.env.OPENSKY_DOCKER;
ok("26b System follows the browser: isDark(\"system\") is the device's answer, not the clock", TH.isDark("system", new Date(), 0, 0, null, false, true) === true && TH.isDark("system", new Date(), 0, 0, null, true, false) === false && TH.isDark("light", new Date(), 0, 0, null, false, true) === false);
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

const hcOf = (home) => mod(build({ pages: ["home"], ...(home ? { home } : {}), meals: { provider: "local", types: ["dinner"] } }), "MMM-OpenSky-Home").config;
const hc0 = hcOf(), hc1 = hcOf({ cards: ["photos", "bogus", "lists", "photos"] }), hc2 = hcOf({ cards: ["lists"] });
ok("23 Home cards: not set → all four in the old order; a list → that order (unknown/repeats dropped); a missing card is off (photos, tonight)",
  JSON.stringify(hc0.cards) === '["notes","tonight","lists","photos"]' && hc0.photos.enabled === true && hc0.tonight === true &&
  JSON.stringify(hc1.cards) === '["photos","lists"]' && hc1.photos.enabled === true && hc1.tonight === false &&
  hc2.photos.enabled === false && hc2.tonight === false, [hc0.cards, hc1.cards, hc2.cards]);

// reminders: off unless a lead time is set (and there are calendars); choices reach the module; people -> their calendars
const remOf = (v, extra = {}) => mod(build({ reminders: v, locale: { timeFormat: 24 }, calendar: { sources: [{ name: "Mom", type: "local" }, { name: "Shared", type: "local", profiles: ["Dad"] }, { name: "Work", type: "local", profiles: ["Mom"] }] }, profiles: [{ name: "Mom" }, { name: "Dad" }], ...extra }), "MMM-OpenSky-Reminders");
ok("24 reminders: absent / no lead time / bad lead time / chime and banner both off → no module", !remOf(undefined) && !remOf({ chime: true }) && !remOf({ minutes: 0 }) && !remOf({ minutes: "10" }) && !remOf({ minutes: 500 }) && !remOf({ minutes: 10, chime: false, banner: false }));
const rem = remOf({ minutes: 15, chime: false, allDay: true, people: ["dad"] }), rem2 = remOf({ minutes: 5 }), rem3 = remOf({ minutes: 10, people: ["Mom"] });
ok("25 reminders: choices reach the module; no people = every calendar; people = their calendars (linked, or named like them); no calendars at all → no module",
  rem && rem.config.minutes === 15 && rem.config.chime === false && rem.config.banner === true && rem.config.allDay === true && rem.config.hour12 === false && JSON.stringify(rem.config.calendars) === '["Shared"]' &&
  rem2.config.calendars === null && rem2.config.allDay === false && JSON.stringify(rem3.config.calendars.sort()) === '["Mom","Work"]' &&
  !mod(build({ reminders: { minutes: 10 }, calendar: { sources: [] } }), "MMM-OpenSky-Reminders"), [rem && rem.config, rem3 && rem3.config]);

// screen profiles: named presets; unknown pages / people / colors are dropped, repeats and a missing name ignored
const scr = (v) => mod(build({ profiles: [{ name: "Mom" }, { name: "Kid" }], pages: ["home", "calendar", "lists", "timer"], ...(v === undefined ? {} : { screens: v }) }), "MMM-OpenSky-Sidebar").config.screens;
const sc = scr([{ name: " Kitchen ", pages: ["home", "lists", "lists", "nope"], person: "mom", textSize: "Extra large", accent: "Teal" },
  { name: "Kids room", pages: ["timer"], person: "Nobody", textSize: "huge", accent: "#3B82F6" }, { name: "kitchen" }, { name: "" }, null, { pages: ["home"] }]);
ok("29 screen profiles: none by default; names trimmed, pages/person/size/accent checked, repeats and nameless dropped",
  Array.isArray(scr()) && scr().length === 0 && sc.length === 2 && sc[0].name === "Kitchen" && sc[0].pages.join() === "home,lists" && sc[0].person === "Mom" && sc[0].textSize === "xlarge" && sc[0].accent === "teal" &&
  sc[1].person === null && sc[1].textSize === null && sc[1].accent === "#3b82f6", sc);

// quick add (AI helper): the page only learns whether the box / mic button show; addresses and people's emails never reach the built config
const qaCfg = (ai, sources = [{ name: "Family", type: "local" }]) => build({ profiles: [{ name: "Mia", email: "mia.secret@example.com" }, { name: "Dad" }], calendar: { sources }, ...(ai === undefined ? {} : { ai }) });
const qaOf = (c2) => mod(c2, "MMM-OpenSky-EventEditor").config;
const qaOn = qaCfg({ url: " https://ai.example.test/ ", transcribeUrl: "http://asr.example.test:8082" });
ok("30 quick add: off by default; on with a valid AI address (+ mic only with a valid speech address); no editable calendar → off; a bad address → off",
  qaOf(qaCfg()).quickAdd.enabled === false && qaOf(qaCfg()).quickAdd.voice === false &&
  qaOf(qaOn).quickAdd.enabled === true && qaOf(qaOn).quickAdd.voice === true &&
  qaOf(qaCfg({ url: "https://ai.example.test" })).quickAdd.voice === false &&
  qaOf(qaCfg({ transcribeUrl: "http://asr.example.test" })).quickAdd.enabled === false && qaOf(qaCfg({ transcribeUrl: "http://asr.example.test" })).quickAdd.voice === false &&
  qaOf(qaCfg({ url: "https://ai.example.test" }, [{ name: "Holidays link", type: "link", url: "https://x.test/a.ics" }])).quickAdd.enabled === false &&
  qaOf(qaCfg({ url: "javascript:alert(1)" })).quickAdd.enabled === false, qaOf(qaOn).quickAdd);
const qaText = JSON.stringify(qaOn);
ok("31 quick add: the AI addresses and people's emails are not in the built config (MagicMirror serves it to the whole network)",
  !qaText.includes("ai.example.test") && !qaText.includes("asr.example.test") && !qaText.includes("mia.secret@example.com") && mod(qaOn, "MMM-OpenSky-Header").config.profiles.length === 2 && mod(qaOn, "MMM-OpenSky-Header").config.profiles.every((p) => !("email" in p)), qaText.length);

delete global.window; delete global.document;


fs.rmSync(tmp, { recursive: true, force: true });
console.log(`SUMMARY pass=${passed} fail=${failed}`);
