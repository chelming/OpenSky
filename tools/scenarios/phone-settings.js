// Phone setup: EVERY setting on the phone page, changed the way a person would (taps, typing, pickers), saved, and
// checked in opensky.json / secrets.json; the saved settings build a working screen config. Also: saving several
// times, closing the card on the screen while the phone is still editing, and what the phone says when the screen
// can't be reached (the browser's own words are just "Load failed").
// Uses writable copies of the settings (tools/out), never the fixtures.
const fs = require("fs"), path = require("path"), http = require("http");
const OUT = path.join(__dirname, "..", "out");
const DEST = path.join(OUT, "backup-dest"), MOUNTS = path.join(OUT, "mounts.test");
fs.rmSync(DEST, { recursive: true, force: true }); fs.mkdirSync(DEST, { recursive: true });
fs.writeFileSync(MOUNTS, "");
fs.rmSync(path.join(OUT, "backup-status.test.json"), { force: true });

// a stand-in for the town search (Open-Meteo geocoding) on port 8093
const GEO = 8093;
const fakeGeo = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ results: [{ name: "Toronto", admin1: "Ontario", country: "Canada", country_code: "CA", latitude: 43.70011, longitude: -79.4163, timezone: "America/Toronto" }] }));
});
fakeGeo.listen(GEO, "127.0.0.1"); fakeGeo.unref();
// a stand-in Home Assistant for the Music page's other speakers (port 8098)
const HA = 8098;
const fakeHA = http.createServer((req, res) => {
  res.writeHead(req.headers.authorization === "Bearer ha-phone-token" ? 200 : 401, { "Content-Type": "application/json" });
  res.end(JSON.stringify(req.url === "/api/states" ? [{ entity_id: "media_player.kitchen", state: "playing", attributes: { friendly_name: "Kitchen" } }, { entity_id: "media_player.attic", state: "off", attributes: { friendly_name: "Attic" } }, { entity_id: "light.hall", state: "on", attributes: {} }] : {}));
});
fakeHA.listen(HA, "127.0.0.1"); fakeHA.unref();

// a stand-in Mealie (port 8099): one token, two shopping lists
const MEALIE = 8099, LIST1 = "11111111-aaaa-4000-8000-000000000001";
const fakeMealie = http.createServer((req, res) => {
  res.writeHead(req.headers.authorization === "Bearer mealie-phone-token" ? 200 : 401, { "Content-Type": "application/json" });
  res.end(JSON.stringify(req.url.startsWith("/api/households/shopping/lists") ? { items: [{ id: "11111111-aaaa-4000-8000-000000000001", name: "Weekly Shop" }, { id: "22222222-bbbb-4000-8000-000000000002", name: "Hardware" }] } : { id: "u1" }));
});
fakeMealie.listen(MEALIE, "127.0.0.1"); fakeMealie.unref();

module.exports = async (page, h, app) => {
  const R = {}; const ok = (k, v, i) => { R[k] = v; h.log(`${v ? "PASS" : "FAIL"}  ${k}${i !== undefined ? "  — " + JSON.stringify(i) : ""}`); };
  const until = async (fn, tries = 40) => { for (let i = 0; i < tries && !(await fn()); i++) await h.sleep(250); return fn(); };
  const settings = () => JSON.parse(fs.readFileSync(path.join(OUT, "opensky.test.json"), "utf8"));
  const secrets = () => JSON.parse(fs.readFileSync(path.join(OUT, "secrets.test.json"), "utf8"));

  // open setup on the screen, pair a phone
  await page.evaluate(() => MM.getModules().withClass("MMM-OpenSky-Sidebar")[0].sendNotification("OPENSKY_SETUP_OPEN"));
  await until(() => page.evaluate(() => document.querySelectorAll(".osu-code span").length === 6));
  const code = await page.evaluate(() => [...document.querySelectorAll(".osu-code span")].map((s) => s.textContent).join(""));
  await app.evaluate(({ BrowserWindow }) => { const w = new BrowserWindow({ width: 390, height: 844, show: true }); w.loadURL("http://localhost:8091/"); });
  const phone = await app.waitForEvent("window", { timeout: 20000 });
  await phone.waitForLoadState();
  await until(() => phone.evaluate(() => !!document.querySelector(".code-input")));
  await phone.fill(".code-input", code);
  await until(() => phone.evaluate(() => !!document.querySelector("#family")));

  // ---- tap helpers (by visible text / label, like a person) ----
  const tap = async (scope, selector, label) => {
    const done = await phone.evaluate(([sc, sel, t]) => {
      const root = sc ? document.querySelector(sc) : document;
      const b = [...root.querySelectorAll(sel)].find((x) => (t == null) || x.textContent.trim() === t || x.getAttribute("aria-label") === t);
      if (!b) return false; b.click(); return true;
    }, [scope, selector, label]);
    if (!done) throw new Error(`nothing to tap: ${scope || ""} ${selector} "${label}"`);
    await h.sleep(250);
  };
  const pick = async (scope, label, value) => {   // a <select> in the field with this label
    const done = await phone.evaluate(([sc, l, v]) => {
      const f = [...document.querySelector(sc).querySelectorAll(".field")].find((x) => x.querySelector(".label")?.textContent.trim() === l);
      const s = f && f.querySelector("select");
      if (!s || ![...s.options].some((o) => o.value === String(v))) return false;
      s.value = String(v); s.dispatchEvent(new Event("change", { bubbles: true })); return true;
    }, [scope, label, value]);
    if (!done) throw new Error(`no choice "${value}" in ${scope} "${label}"`);
    await h.sleep(200);
  };
  const type = async (selector, value) => { await phone.fill(selector, value); await h.sleep(100); };
  const sheetButton = (label) => tap(".sheet", ".sheet-foot .btn", label);
  const row = async (scope, title) => {   // a list row (calendar, list, web page) by its title
    const done = await phone.evaluate(([sc, t]) => { const r = [...document.querySelector(sc).querySelectorAll(".row")].find((x) => x.querySelector("b")?.textContent === t); if (r) r.click(); return !!r; }, [scope, title]);
    if (!done) throw new Error(`no row "${title}" in ${scope}`);
    await h.sleep(300);
  };
  const save = async () => {
    await tap(".bar", ".btn", "Save");
    return until(() => phone.evaluate(() => /Saved ✓/.test(document.querySelector(".bar")?.textContent || "")));
  };
  const bar = () => phone.evaluate(() => document.querySelector(".bar")?.textContent || "");

  // ---- Family: name, town (search), °F/°C, clock, week start ----
  await type("#family input.input", "The Phone Testers");
  await tap("#family", ".place .btn", "Change");
  await type(".sheet .search input", "Toronto");
  await tap(".sheet", ".search .btn", "Search");
  await until(() => phone.evaluate(() => !!document.querySelector(".sheet .results .row")));
  await tap(".sheet", ".results .row", null);
  await h.sleep(400);
  await tap("#family", ".seg button", "24-hour");
  await tap("#family", ".seg button", "Monday");
  ok("the bar says 'Unsaved changes' with a Save button", /Unsaved changes/.test(await bar()));
  ok("save #1 (family)", await save());
  let S = settings();
  ok("family: name, town (search) with °C, 24-hour clock, Monday", S.family.name === "The Phone Testers" && S.location.name === "Toronto, Canada" && S.location.latitude === 43.7001 &&
    S.locale.units === "metric" && S.locale.country === "CA" && S.locale.timeFormat === 24 && S.locale.firstDayOfWeek === 1, { family: S.family, location: S.location, locale: S.locale });
  await tap("#family", ".seg button", "°F");
  await save();
  ok("save #2: °F back (saving again and again works)", settings().locale.units === "imperial");

  // ---- Calendars: holidays off, on-screen calendar, iCloud, color change, remove ----
  await tap("#calendars", ".toggle", "Public holidays");
  await tap("#calendars", ".toggle", "Show shared events once");
  await tap("#calendars", ".add", null);
  await tap(".sheet", ".seg button", "On screen");
  await type(".sheet input.input[type=text]", "Kids");
  await tap(".sheet", ".chip", "purple");
  await sheetButton("Add");
  await tap("#calendars", ".add", null);
  await tap(".sheet", ".seg button", "iCloud & co.");
  await type(".sheet .field:first-of-type input.input", "Work");
  await type(".sheet input[inputmode=email]", "someone@example.com");
  await type(".sheet input[type=password]", "abcd-efgh-ijkl-mnop");
  await sheetButton("Add");
  await row("#calendars", "Family");
  await tap(".sheet", ".chip", "teal");
  await tap(".sheet", ".toggle", "Shared family calendar");
  await sheetButton("Done");
  await row("#calendars", "School");
  await sheetButton("Remove");
  await save();
  S = settings(); let sec = secrets();
  const src = (n) => S.calendar.sources.find((c) => c.name === n);
  ok("calendars: holidays off, on-screen 'Kids' (purple), iCloud 'Work' (password only in secrets), Family → teal, School removed (and its link)",
    S.calendar.holidays === "none" && src("Kids")?.type === "local" && src("Kids")?.color === "purple" && src("Work")?.type === "caldav" &&
    sec.calendar.caldav?.Work?.password === "abcd-efgh-ijkl-mnop" && sec.calendar.caldav.Work.url === "https://caldav.icloud.com/" && !JSON.stringify(S).includes("abcd-efgh") &&
    src("Family")?.color === "teal" && !src("School") && !(sec.calendar.sources && sec.calendar.sources.School), S.calendar.sources.map((c) => `${c.name}:${c.type || "link"}:${c.color}`));

  ok("calendars: 'Show shared events once' on, and Family marked as the shared family calendar", S.calendar.mergeShared === true && src("Family")?.role === "shared" && !src("Kids")?.role, [S.calendar.mergeShared, src("Family")?.role]);

  // ---- Lists: a Todoist list + token, a color change, a removal ----
  await tap("#lists", ".add", null);
  await type(".sheet .field:first-of-type input.input", "Errands");
  await tap(".sheet", ".seg button", "Todoist");
  await type(".sheet input[placeholder^='Same as']", "Errands Project");
  await sheetButton("Add");
  await type("#lists input[placeholder='Paste your token']", "todoist-token-123456");
  await row("#lists", "Groceries");
  await tap(".sheet", ".chip", "orange");
  await sheetButton("Done");
  await row("#lists", "Chores");
  await sheetButton("Remove");
  await save();
  S = settings(); sec = secrets();
  ok("lists: Todoist 'Errands' (project, token in secrets), Groceries → orange, Chores removed",
    JSON.stringify(S.lists.lists) === JSON.stringify([{ name: "Groceries", color: "orange" }, { name: "Errands", color: S.lists.lists[1]?.color, provider: "todoist", project: "Errands Project" }]) &&
    sec.lists?.todoist?.token === "todoist-token-123456", S.lists.lists);

  // ---- Mealie: connect from the phone (a wrong token first), a shopping list, and the meal plan as a calendar ----
  await tap("#lists", ".add", null);
  await tap(".sheet", ".seg button", "Mealie");
  await type(".sheet input[inputmode=url]", `http://127.0.0.1:${MEALIE}`);
  await type(".sheet input[type=password]", "wrong-token");
  await tap(".sheet", ".btn.block", "Connect to Mealie");
  await until(() => phone.evaluate(() => /refused the API token/.test(document.querySelector(".sheet .err")?.textContent || "")));
  ok("mealie: a wrong token is explained, and nothing is saved", await phone.evaluate(() => /refused the API token/.test(document.querySelector(".sheet .err")?.textContent || "")) && !(secrets().mealie), secrets().mealie);
  await type(".sheet input[type=password]", "mealie-phone-token");
  await tap(".sheet", ".btn.block", "Connect to Mealie");
  await until(() => phone.evaluate(() => !!document.querySelector(".sheet .good-note")));
  ok("mealie: connected; the address and token are already kept on the Pi (no need to Save first)", secrets().mealie?.token === "mealie-phone-token" && secrets().mealie?.url === `http://127.0.0.1:${MEALIE}`, secrets().mealie);
  await pick(".sheet", "Which shopping list?", LIST1);
  ok("mealie: picking a shopping list names the list after it", await phone.evaluate(() => document.querySelector(".sheet input.input[type=text]")?.value === "Weekly Shop"));
  await sheetButton("Add");
  await save();
  S = settings(); sec = secrets();
  ok("mealie: the shopping list (with its Mealie id) is saved; the token only in secrets",
    JSON.stringify(S.lists.lists.find((l) => l.provider === "mealie")) === JSON.stringify({ name: "Weekly Shop", color: S.lists.lists.find((l) => l.provider === "mealie")?.color, provider: "mealie", shoppingList: "Weekly Shop", shoppingListId: LIST1 }) &&
    sec.mealie.token === "mealie-phone-token" && !JSON.stringify(S).includes("mealie-phone-token"), S.lists.lists.at(-1));

  // ---- Meals card: the meal plan as a page, a Home card, the calendar, and recipe ingredients → a shopping list ----
  await tap("#meals", ".seg button", "Mealie");
  await until(() => phone.evaluate(() => !!document.querySelector("#meals .good-note")));
  ok("meals: already connected (the saved Mealie is checked without typing anything)", await phone.evaluate(() => /Connected to Mealie/.test(document.querySelector("#meals .good-note")?.textContent || "")));
  await tap("#meals", ".toggle", "Lunch");
  await tap("#meals", ".toggle", "Meals page");
  await tap("#meals", ".toggle", "Meals on the calendar");
  await pick("#meals", "Shopping list for “Add ingredients”", LIST1);
  await save();
  S = settings();
  ok("meals: provider, meals chosen, Home card on, calendar on, the shopping list for ingredients; the Meals page is in the pages",
    S.meals?.provider === "mealie" && JSON.stringify(S.meals.types) === '["lunch","dinner"]' && S.meals.home === true && S.meals.calendar === true &&
    S.meals.addToList?.id === LIST1 && S.meals.addToList?.name === "Weekly Shop" && S.pages.includes("meals"), [S.meals, S.pages]);
  await tap("#meals", ".toggle", "Lunch");
  await tap("#meals", ".toggle", "Meals on the calendar");
  await tap("#meals", ".toggle", "Dinner tonight on Home");
  await save();
  S = settings();
  ok("meals: changed later — dinner only, not on the calendar, no Home card", JSON.stringify(S.meals.types) === '["dinner"]' && !S.meals.calendar && S.meals.home === false, S.meals);
  await tap("#meals", ".toggle", "Meals page");
  ok("meals: the Meals page can be turned off without losing the rest", !(await phone.evaluate(() => [...document.querySelectorAll("#pages .pagerow")].some((r) => r.textContent.includes("Meals") && !r.classList.contains("off")))) && settings().meals.provider === "mealie");

  // ---- Colors as codes: a calendar's typed (upper case), a list's from the phone's color picker ----
  await row("#calendars", "Kids");
  await type(".sheet .hex-input", "#8CBFC4");
  await sheetButton("Done");
  await row("#lists", "Groceries");
  await phone.fill(".sheet .color-pick", "#5f8f38"); await h.sleep(200);
  await sheetButton("Done");
  await save();
  S = settings();
  ok("calendar and list colors as codes (typed / the phone's color picker), saved as #rrggbb",
    S.calendar.sources.find((c) => c.name === "Kids")?.color === "#8cbfc4" && S.lists.lists.find((l) => l.name === "Groceries")?.color === "#5f8f38",
    { kids: S.calendar.sources.find((c) => c.name === "Kids")?.color, groceries: S.lists.lists.find((l) => l.name === "Groceries")?.color });
  ok("…and the rows' dots show those colors", await phone.evaluate(() => { const dot = (sc, t) => { const r = [...document.querySelectorAll(`${sc} .row`)].find((x) => x.querySelector("b")?.textContent === t); return r && getComputedStyle(r.querySelector(".dot")).getPropertyValue("--c").trim(); }; return dot("#calendars", "Kids") === "#8cbfc4" && dot("#lists", "Groceries") === "#5f8f38"; }));

  // ---- People: add two, link calendars and lists to them (a calendar can belong to both), rename, remove ----
  ok("people: nothing to choose in a calendar's sheet while there is no one", await (async () => { await row("#calendars", "Kids"); const n = await phone.evaluate(() => document.querySelectorAll(".sheet .person").length); await sheetButton("Done"); return n === 0; })());
  await tap("#people", ".add", null);
  await type(".sheet input.input[type=text]", "Mom");
  await tap(".sheet", ".chip", "pink");
  await sheetButton("Add");
  await tap("#people", ".add", null);
  await type(".sheet input.input[type=text]", "Zoe");
  await tap(".sheet", ".chip", "teal");
  await sheetButton("Add");
  await row("#calendars", "Kids"); await tap(".sheet", ".person", "Mom"); await tap(".sheet", ".person", "Zoe"); await sheetButton("Done");
  await row("#calendars", "Family"); await tap(".sheet", ".person", "Zoe"); await sheetButton("Done");
  await row("#lists", "Groceries"); await tap(".sheet", ".person", "Mom"); await sheetButton("Done");
  await tap("#lists", ".add", null);
  await type(".sheet .field:first-of-type input.input", "Homework");
  await tap(".sheet", ".person", "Zoe");
  await sheetButton("Add");
  const subOf = (sc, t) => phone.evaluate(([s, n]) => [...document.querySelectorAll(`${s} .row`)].find((x) => x.querySelector("b")?.textContent === n)?.querySelector("small")?.textContent, [sc, t]);
  await save();
  S = settings();
  const byName = (arr, n) => arr.find((x) => x.name === n) || {};
  ok("people: saved with name + color; calendars and lists carry their names (Kids → both, a new list → Zoe, unlinked → no key)",
    JSON.stringify(S.profiles) === JSON.stringify([{ name: "Mom", color: "pink" }, { name: "Zoe", color: "teal" }]) &&
    JSON.stringify(byName(S.calendar.sources, "Kids").profiles) === '["Mom","Zoe"]' && JSON.stringify(byName(S.calendar.sources, "Family").profiles) === '["Zoe"]' && !("profiles" in byName(S.calendar.sources, "Work")) &&
    JSON.stringify(byName(S.lists.lists, "Groceries").profiles) === '["Mom"]' && JSON.stringify(byName(S.lists.lists, "Homework").profiles) === '["Zoe"]', S.profiles);
  ok("people: each row says how many calendars and lists", (await subOf("#people", "Mom")) === "1 calendar · 1 list" && (await subOf("#people", "Zoe")) === "2 calendars · 1 list", [await subOf("#people", "Mom"), await subOf("#people", "Zoe")]);
  await row("#people", "Zoe"); await type(".sheet input.input[type=text]", "Zoey"); await sheetButton("Done");
  await row("#people", "Mom"); await sheetButton("Remove");
  await save();
  S = settings();
  ok("people: renaming Zoe → Zoey follows into her calendars and lists; removing Mom unlinks her (and drops an empty link)",
    JSON.stringify(S.profiles.map((p) => p.name)) === '["Zoey"]' && JSON.stringify(byName(S.calendar.sources, "Kids").profiles) === '["Zoey"]' && JSON.stringify(byName(S.calendar.sources, "Family").profiles) === '["Zoey"]' &&
    !("profiles" in byName(S.lists.lists, "Groceries")) && JSON.stringify(byName(S.lists.lists, "Homework").profiles) === '["Zoey"]', S);
  // a calendar for one person can take their color; with two people there is no such switch
  await row("#calendars", "Family");
  await tap(".sheet", ".toggle", "Use Zoey's color");
  ok("sync color: the calendar's own color chooser goes away while it follows the person", await phone.evaluate(() => !document.querySelector(".sheet .chips")));
  await sheetButton("Done");
  await save();
  S = settings();
  const dotOf = (sc, t) => phone.evaluate(([s, n]) => { const r = [...document.querySelectorAll(`${s} .row`)].find((x) => x.querySelector("b")?.textContent === n); return r && getComputedStyle(r.querySelector(".dot")).getPropertyValue("--c").trim(); }, [sc, t]);
  ok("sync color: saved as colorFromProfile; the row's dot shows the person's color", byName(S.calendar.sources, "Family").colorFromProfile === true && (await dotOf("#calendars", "Family")) === (await dotOf("#people", "Zoey")), [await dotOf("#calendars", "Family"), await dotOf("#people", "Zoey")]);
  await row("#calendars", "Family"); await tap(".sheet", ".person", "Zoey");
  ok("sync color: no switch for a calendar that is for nobody", await phone.evaluate(() => !document.querySelector(".sheet .toggle[aria-label^='Use ']")));
  await tap(".sheet", ".person", "Zoey"); await sheetButton("Done");
  // the same switch when ADDING a calendar for one person
  await tap("#calendars", ".add", null);
  await tap(".sheet", ".seg button", "On screen");
  await type(".sheet input.input[type=text]", "ZoeyCal");
  ok("sync color: with no one chosen the sheet says to choose a person", await phone.evaluate(() => /Choose one person/.test(document.querySelector(".sheet").textContent)));
  await tap(".sheet", ".person", "Zoey");
  await tap(".sheet", ".toggle", "Use Zoey's color");
  await sheetButton("Add");
  await save();
  S = settings();
  ok("sync color: a new calendar added for one person with the switch on is saved synced", byName(S.calendar.sources, "ZoeyCal").colorFromProfile === true && JSON.stringify(byName(S.calendar.sources, "ZoeyCal").profiles) === '["Zoey"]', byName(S.calendar.sources, "ZoeyCal"));
  await row("#calendars", "ZoeyCal"); await sheetButton("Remove");
  // (back to the state the later checks expect)
  await row("#people", "Zoey"); await sheetButton("Remove"); await save();
  ok("sync color: removing the person ends the sync", !("colorFromProfile" in byName(settings().calendar.sources, "Family")));

  // ---- Photos: Immich (address, key, every minute) → saved; then back to a folder, USB stick on ----
  await tap("#photos", ".seg button", "Immich");
  await type("#photos input[inputmode=url]", "http://192.168.1.20:2283");
  await type("#photos input[type=password]", "immich-key-abcdef");
  await pick("#photos", "Change photo every", 60);
  await save();
  S = settings(); sec = secrets();
  ok("photos: Immich address + key (secret) + every minute", S.photos.provider === "immich" && S.photos.url === "http://192.168.1.20:2283" && S.photos.intervalSeconds === 60 && sec.photos?.immich?.apiKey === "immich-key-abcdef", S.photos);
  await tap("#photos", ".seg button", "Off");
  await save();
  ok("photos: Off", settings().photos.enabled === false);
  await tap("#photos", ".seg button", "On the Pi");
  await type("#photos .field input.input", "~/Family Photos");
  await tap("#photos", ".toggle", "USB stick");   // the test settings start with it off
  await save();
  S = settings();
  ok("photos: a folder on the Pi, USB stick switched on", S.photos.enabled === true && S.photos.provider === "folder" && S.photos.folder === "~/Family Photos" && S.photos.usb === true, S.photos);

  // ---- Photos: add one from the phone, see it, delete it (in a scratch folder, then back to the family's) ----
  const PICS = path.join(OUT, "phone-photos");
  fs.rmSync(PICS, { recursive: true, force: true });
  await type("#photos .field input.input", PICS);
  await save();
  await phone.reload(); await phone.waitForLoadState();
  await until(() => phone.evaluate(() => !!document.querySelector("#photos .pm")));
  const fixtures = path.join(__dirname, "..", "fixtures", "photos");
  const jpg = path.join(fixtures, fs.readdirSync(fixtures).find((f) => /\.jpe?g$/i.test(f)));
  await phone.setInputFiles("#photos input[type=file]", jpg);
  ok("photos: a photo added from the phone shows up as a thumbnail and lands in the folder",
    await until(() => phone.evaluate(() => document.querySelectorAll("#photos .pm-item").length === 1)) && fs.readdirSync(PICS).length === 1, fs.existsSync(PICS) && fs.readdirSync(PICS));
  await tap("#photos", ".pm-item", null);
  await sheetButton("Delete");
  ok("photos: tapping a thumbnail and confirming deletes it",
    await until(() => phone.evaluate(() => document.querySelectorAll("#photos .pm-item").length === 0)) && fs.readdirSync(PICS).length === 0);
  await type("#photos .field input.input", "~/Family Photos");
  await save();

  // ---- Web pages: one plain, one with a PIN, one removed ----
  await tap("#web", ".add", null);
  await type(".sheet input[maxlength='14']", "Cameras");
  await type(".sheet input[inputmode=url]", "http://cameras.local:5000");
  await tap(".sheet", ".icon-pick", "camera");
  await sheetButton("Add");
  await tap("#web", ".add", null);
  await type(".sheet input[maxlength='14']", "Bank");
  await type(".sheet input[inputmode=url]", "http://192.168.1.50:8080");
  await tap(".sheet", ".icon-pick", "chart");
  await type(".sheet input[inputmode=numeric]", "4826");
  await sheetButton("Add");
  await row("#web", "Smart Home");
  await sheetButton("Remove");
  await save();
  S = settings(); sec = secrets();
  ok("web pages: Cameras (address + camera icon), Bank (PIN + address only in secrets), Smart Home removed (page too)",
    S.embeds.cameras?.url === "http://cameras.local:5000" && S.embeds.cameras.icon === "camera" && S.embeds.bank?.icon === "chart" && !S.embeds.bank.url &&
    sec.embeds?.bank?.pin === "4826" && sec.embeds.bank.url === "http://192.168.1.50:8080" && !S.embeds.smarthome && !S.pages.includes("smarthome") &&
    S.pages.includes("cameras") && S.pages.includes("bank"), { embeds: S.embeds, pages: S.pages });

  // ---- Pages: Timer off, Lists moved up ----
  await tap("#pages", ".toggle", "Timer");
  await phone.evaluate(() => { const r = [...document.querySelectorAll("#pages .pagerow")].find((x) => x.querySelector("b").textContent === "Lists"); r.querySelector("[aria-label=Up]").click(); });
  await h.sleep(250);
  await save();
  S = settings();
  ok("pages: Timer off, Lists moved up one", !S.pages.includes("timer") && S.pages.indexOf("lists") === 1, S.pages);

  // ---- Pages: drag the last page's grip up to fourth place ----
  const pagesNow = settings().pages, dragKey = pagesNow[pagesNow.length - 1];
  await phone.evaluate(() => { const rows = [...document.querySelectorAll("#pages .pagerow:not(.off)")]; rows[rows.length - 1].scrollIntoView({ block: "center", behavior: "instant" }); }); await h.sleep(400);
  const pos = await phone.evaluate(() => { const rows = [...document.querySelectorAll("#pages .pagerow:not(.off)")], g = rows[rows.length - 1].querySelector(".grip").getBoundingClientRect(), t = rows[3].getBoundingClientRect(); return { fx: g.x + g.width / 2, fy: g.y + g.height / 2, ty: t.top + 4 }; });
  await phone.mouse.move(pos.fx, pos.fy); await phone.mouse.down();
  await phone.mouse.move(pos.fx, (pos.fy + pos.ty) / 2, { steps: 4 }); await phone.mouse.move(pos.fx, pos.ty, { steps: 6 });
  await phone.mouse.up(); await h.sleep(250);
  await save();
  S = settings();
  ok("pages: dragging a page by its grip moves it (saved)", S.pages.indexOf(dragKey) === 3, S.pages);

  // ---- Extras: accent, trash day, city schedule, pickup link, sports, word game, weather + key ----
  await tap("#extras", ".chip", "teal");
  await pick("#extras", "Trash day", "thursday");
  await pick("#extras", "City pickup schedule", "");
  await type("#extras input[inputmode=url]", "https://recollect.example/ics/abc123");
  await pick("#extras", "Sports league", "nba");
  await type("#extras input[maxlength='5']", "bos");
  await tap("#extras", ".seg button", "OpenSky's words");
  await tap("#extras", ".seg button", "OpenWeatherMap");
  await type("#extras input[placeholder='Paste the key']", "owm-key-123456");
  await save();
  S = settings(); sec = secrets();
  ok("extras: accent teal, Thursday trash, no city schedule, pickup link (secret), NBA/BOS, OpenSky's words, OpenWeatherMap + key (secret)",
    S.look?.accent === "teal" && S.pickup.trashDay === "thursday" && S.pickup.preset === "" && S.pickup.url === "secret" && sec.calendar.sources?.Pickup === "https://recollect.example/ics/abc123" &&
    S.header.sports.league === "nba" && S.header.sports.team === "BOS" && S.wordgame.source === "opensky" && S.weather.provider === "openweathermap" && sec.weather?.openweathermap?.apiKey === "owm-key-123456",
    { look: S.look, pickup: S.pickup, sports: S.header.sports, wordgame: S.wordgame, weather: S.weather });

  // ---- Screensaver: after N minutes / off, and the Up next toggle ----
  await pick("#extras", "Screensaver", 30);
  await tap("#extras", ".toggle", "Show what's up next on the screensaver");
  await save();
  S = settings();
  ok("extras: screensaver after 30 minutes, Up next off", S.screensaver?.enabled === true && S.screensaver.afterMinutes === 30 && S.screensaver.upNext === false, S.screensaver);
  await pick("#extras", "Screensaver", 0);
  await tap("#extras", ".toggle", "Show what's up next on the screensaver");
  await save();
  S = settings();
  ok("extras: screensaver Off, Up next back on", S.screensaver?.enabled === false && S.screensaver.upNext === undefined, S.screensaver);

  // ---- accent: any color as a code (typed, any case) or from the phone's color picker; then back to teal ----
  await type("#extras .hex-input", "#2E7D32");
  const chipOff = await phone.evaluate(() => !document.querySelector("#extras .chip.on") && document.querySelector("#extras .color-pick").value === "#2e7d32");
  await save();
  ok("accent: a typed color code → saved as #rrggbb, the chips let go, the color picker follows", settings().look?.accent === "#2e7d32" && chipOff, settings().look);
  await type("#extras .color-pick", "#fff8dc");
  const fromPicker = await phone.evaluate(() => ({ code: document.querySelector("#extras .hex-input").value, warn: !document.querySelector("#extras .hint.bad").hidden }));
  await save();
  ok("accent: the phone's color picker → saved, the code box follows, a very light color gets a warning", settings().look?.accent === "#fff8dc" && fromPicker.code === "#fff8dc" && fromPicker.warn, fromPicker);
  await type("#extras .hex-input", "#12zz45");
  await phone.evaluate(() => document.querySelector("#extras .hex-input").blur());
  const bad = await phone.evaluate(() => document.querySelector("#extras .hex-input").classList.contains("bad"));
  await tap("#extras", ".chip", "teal");
  await save();
  ok("accent: a code that isn't a color is marked and not used; a chip still works afterwards", bad && settings().look?.accent === "teal", settings().look);

  // ---- Music add-on: the page on → its settings appear in Extras (speaker name, AirPlay / Spotify) ----
  ok("Music settings are hidden until the Music page is on", !(await phone.evaluate(() => /Speaker name/.test(document.querySelector("#extras").textContent))));
  await tap("#pages", ".toggle", "Music");
  ok("…then show, with how to install the add-on", await phone.evaluate(() => /Speaker name/.test(document.querySelector("#extras").textContent) && /opensky addon music/.test(document.querySelector("#extras").textContent)));
  await type("#extras input[maxlength='40']", "Kitchen speaker");
  await tap("#extras", ".toggle", "AirPlay");
  await save();
  S = settings();
  ok("music: page on, speaker name, AirPlay off, Spotify left on", S.pages.includes("music") && S.music?.name === "Kitchen speaker" && S.music.airplay === false && S.music.spotify !== false, { pages: S.pages, music: S.music });
  // other speakers: Home Assistant address + token, save, Find my speakers, pick one
  await type("#extras input[placeholder='http://homeassistant.local:8123']", `http://127.0.0.1:${HA}`);
  await type("#extras input[placeholder='Paste a long-lived access token']", "ha-phone-token");
  await save();
  await tap("#extras", ".btn.block", "Find my speakers");
  await until(() => phone.evaluate(() => /Attic/.test(document.querySelector("#extras").textContent)));
  const found = await phone.evaluate(() => [...document.querySelectorAll("#extras .rows .line b")].map((b) => b.textContent));
  await tap("#extras", ".toggle", "Kitchen");
  await save();
  S = settings(); sec = secrets();
  ok("other speakers: Find my speakers lists Home Assistant's speakers; Kitchen picked and saved (address + token only in secrets)",
    found.join() === "Attic,Kitchen" && JSON.stringify(S.music.speakers) === '["media_player.kitchen"]' && sec.homeassistant?.token === "ha-phone-token" && !JSON.stringify(S).includes("ha-phone-token"), { found, speakers: S.music.speakers });

  // ---- Backup: nightly to a folder, time, how many, with passwords; then Back up now ----
  await until(() => phone.evaluate(() => !!document.querySelector("#backup .auto-backup select")));
  await pick("#backup", "Back up every night to", DEST);
  await pick("#backup", "Time", "02:00");
  await pick("#backup", "Keep", 30);
  await tap("#backup", ".toggle", "Include passwords in automatic backups");
  await save();
  S = settings();
  ok("automatic backups: place, 2 AM, keep 30, with passwords", S.backup?.destination === DEST && S.backup.time === "02:00" && S.backup.keep === 30 && S.backup.includeSecrets === true, S.backup);
  await tap("#backup", ".btn.block", "Back up now");
  await until(() => phone.evaluate(() => /Backed up/.test(document.querySelector(".toast")?.textContent || "")));
  const made = fs.existsSync(path.join(DEST, "OpenSky-backups")) ? fs.readdirSync(path.join(DEST, "OpenSky-backups")) : [];
  ok("Back up now: a backup file in the chosen place", made.length === 1 && /^opensky-backup-\d{4}-\d\d-\d\d\.json$/.test(made[0]), made);

  // ---- Screens: a screen profile (pages, text size, accent) ----
  await tap("#screens", ".add", null);
  await type(".sheet input.input[type=text]", "Kitchen");
  const pageLabels = await phone.evaluate(() => [...document.querySelectorAll(".sheet .toggle")].map((t) => t.getAttribute("aria-label")));
  await tap(".sheet", ".toggle", pageLabels[pageLabels.length - 1]);   // leave out the last page
  const sheetSelects = await phone.evaluate(() => [...document.querySelectorAll(".sheet .field")].map((f) => f.querySelector(".label")?.textContent.trim()).filter(Boolean));
  await phone.evaluate(() => { const sel = (l, v) => { const f = [...document.querySelectorAll(".sheet .field")].find((x) => x.querySelector(".label")?.textContent.trim() === l); const e = f.querySelector("select"); e.value = v; e.dispatchEvent(new Event("change", { bubbles: true })); }; sel("Text size", "large"); sel("Accent color", "teal"); });
  await sheetButton("Done");
  ok("Screens: the new profile shows as a row with its summary", await phone.evaluate(() => /Kitchen/.test(document.querySelector("#screens .row")?.textContent || "") && /Large/.test(document.querySelector("#screens .row")?.textContent || "")), sheetSelects);
  ok("save (screens)", await save());
  S = settings();
  ok("Screens: saved in opensky.json -> screens (one page left out, Large, teal)", S.screens && S.screens.length === 1 && S.screens[0].name === "Kitchen" && S.screens[0].textSize === "large" && S.screens[0].accent === "teal" &&
    S.screens[0].pages.length === pageLabels.length - 1 && S.screens[0].pages.every((k) => S.pages.includes(k)), S.screens);
  await row("#screens", "Kitchen");
  await sheetButton("Remove");
  await save();
  ok("Screens: Remove deletes it", (settings().screens || []).length === 0);

  // ---- nothing lost along the way: everything from the earlier saves is still there ----
  S = settings(); sec = secrets();
  ok("every earlier change is still saved after 16 saves", S.family.name === "The Phone Testers" && S.location.name === "Toronto, Canada" && S.locale.units === "imperial" &&
    S.calendar.sources.some((c) => c.name === "Kids") && S.lists.lists.some((l) => l.name === "Errands") && S.photos.folder === "~/Family Photos" && S.embeds.cameras && S.look.accent === "teal" &&
    sec.calendar.caldav.Work && sec.lists.todoist.token && sec.embeds.bank.pin);

  // ---- the saved settings build a working screen config (what Finish restarts into) ----
  const tmpCfg = fs.mkdtempSync(path.join(OUT, "cfg-"));
  process.env.OPENSKY_SETTINGS = path.join(OUT, "opensky.test.json");
  process.env.OPENSKY_SECRETS = path.join(OUT, "secrets.test.json");
  const prevRoot = global.root_path; global.root_path = path.join(__dirname, "..", "..");
  let cfg, cfgErr = null;
  try {
    const srcCfg = fs.readFileSync(path.join(__dirname, "..", "..", "config", "config.js"), "utf8");
    const m = { exports: {} };
    new Function("module", "exports", "require", "__dirname", srcCfg)(m, m.exports, require, path.join(__dirname, "..", "..", "config"));
    cfg = m.exports;
  } catch (e) { cfgErr = e.message; }
  global.root_path = prevRoot; fs.rmSync(tmpCfg, { recursive: true, force: true });
  const built = cfg ? JSON.stringify(cfg) : "";
  ok("the saved settings build the screen's config (no error, no passwords in it)", !!cfg && Array.isArray(cfg.modules) && cfg.modules.length > 5 &&
    !/abcd-efgh|todoist-token|immich-key|owm-key|4826|recollect\.example/.test(built), cfgErr || (cfg && cfg.modules.length));

  // ---- closing the card on the screen while the phone is still editing ----
  await page.evaluate(() => document.querySelector(".osu-x")?.click());
  await h.sleep(500);
  ok("the card closes on the screen", await page.evaluate(() => !document.querySelector(".osu-host")?.children.length));
  await type("#family input.input", "Closed On Screen");
  ok("…and the phone can still save (setup stays open for the connected phone)", await save() && settings().family.name === "Closed On Screen", await bar());

  // ---- the screen can't be reached: a clear message, the change kept for another try ----
  await phone.evaluate(() => fetch("/api/done", { method: "POST", headers: { "X-OpenSky": "1" } }));
  await h.sleep(800);
  await type("#family input.input", "After Finish");
  await tap(".bar", ".btn", "Save");
  await until(() => phone.evaluate(() => /Can't reach the screen/.test(document.querySelector(".toast")?.textContent || "")));
  const msg = await phone.evaluate(() => document.querySelector(".toast")?.textContent || "");
  ok("can't reach the screen: a clear message (not 'Load failed'), the change stays unsaved for another try", /Can't reach the screen/.test(msg) && /same Wi-Fi/.test(msg) && /Unsaved changes/.test(await bar()) && settings().family.name === "Closed On Screen", msg);
  await phone.evaluate(() => window.scrollTo(0, 0)); await h.sleep(300);
  await phone.screenshot({ path: path.join(OUT, "phone-settings-offline.png") });

  fakeGeo.close(); fakeHA.close();
  const f = Object.entries(R).filter(([, v]) => !v).map(([k]) => k);
  h.log(`SUMMARY: ${f.length ? "FAILED: " + f.join("; ") : "ALL CHECKS PASSED"} (${Object.keys(R).length} checks)`);
};
module.exports.writableSettings = true;
module.exports.env = {
  OPENSKY_GEOCODE_URL: `http://127.0.0.1:${GEO}/search`,
  OPENSKY_BACKUP_HOME: DEST, OPENSKY_MOUNTS: MOUNTS, OPENSKY_GVFS: path.join(OUT, "no-gvfs"),
  OPENSKY_BACKUP_STATUS: path.join(OUT, "backup-status.test.json"),
  OPENSKY_MUSIC_INSTALLED: ""   // the Music add-on not installed (whatever this computer has)
};
// start with no people (the shared fixture has some): the phone page is where a family adds them
module.exports.patchSettings = (s) => { delete s.profiles; [...s.calendar.sources, ...s.lists.lists].forEach((x) => delete x.profiles); };
