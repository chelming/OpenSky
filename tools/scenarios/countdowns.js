// Countdowns: a card on Home (a banner under the header on a portrait screen), a Countdowns page with every one, dates that
// have passed hidden, yearly ones counting to the next; and the phone page: add a countdown with a photo, change it, remove it.
// Uses writable copies of the settings (tools/out), never the fixtures.
const fs = require("fs"), path = require("path");
const OUT = path.join(__dirname, "..", "out");
const PHOTOS = path.join(OUT, "countdown-photos.test");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

const day = (offset, year) => { const d = new Date(); d.setDate(d.getDate() + offset); if (year) d.setFullYear(year); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

module.exports = async (page, h, app) => {
  const R = {}; const ok = (k, v, i) => { R[k] = v; h.log(`${v ? "PASS" : "FAIL"}  ${k}${i !== undefined ? "  — " + JSON.stringify(i) : ""}`); };
  const until = async (fn, tries = 60) => { for (let i = 0; i < tries && !(await fn()); i++) await h.sleep(250); return fn(); };
  const settings = () => JSON.parse(fs.readFileSync(path.join(OUT, "opensky.test.json"), "utf8"));
  fs.mkdirSync(PHOTOS, { recursive: true });
  fs.writeFileSync(path.join(PHOTOS, "cbeach01.png"), PNG);

  const card = () => page.evaluate(() => {
    const c = document.querySelector(".hd-countdowns");
    if (!c || c.hidden) return null;
    return { rows: [...c.querySelectorAll(".hd-cd-row")].map((r) => ({ title: r.querySelector(".hd-cd-text b").textContent, count: r.querySelector(".hd-cd-count").textContent.replace(/\s+/g, " ").trim(), img: !!r.querySelector("img"), w: Math.round(r.getBoundingClientRect().width), h: Math.round(r.getBoundingClientRect().height) })),
      seeAll: !!c.querySelector(".hd-see-all"), top: Math.round(c.getBoundingClientRect().top), left: Math.round(c.getBoundingClientRect().left), right: Math.round(c.getBoundingClientRect().right), bottom: Math.round(c.getBoundingClientRect().bottom), W: innerWidth, H: innerHeight, injected: !!c.querySelector("b b") };
  });

  // ---- Home, landscape ----
  await h.tap(".os-page-home"); await h.sleep(1200);
  let c = await until(async () => (await card()) && (await card()).rows.length) && await card();
  ok("Home card: the soonest two (today, tomorrow); past and Home-off ones are not there",
    c && JSON.stringify(c.rows.map((r) => r.title)) === JSON.stringify(["Dentist day", "Zoe's <b>birthday</b>"]), c);
  ok("counts: today and tomorrow in words, a title is text (never HTML)", c && c.rows[0].count === "Today" && c.rows[1].count === "Tomorrow" && !c.injected, c && c.rows.map((r) => r.count));
  ok("a third one exists, so 'See all' (the Countdowns page) is offered", c && c.seeAll);
  ok("rows are finger-sized and inside the screen", c && c.rows.every((r) => r.h >= 44) && c.right <= c.W && c.bottom <= c.H, c);
  await h.shot("countdowns-home");

  // ---- the page ----
  await page.evaluate(() => document.querySelector(".hd-countdowns .hd-see-all").click());
  await until(() => page.evaluate(() => document.querySelectorAll(".cp-card").length > 0));
  await until(() => page.evaluate(() => { const i = document.querySelector(".cp-card img"); return !i || (i.complete && i.naturalWidth > 0); }));
  const pg = await page.evaluate(() => ({ cards: [...document.querySelectorAll(".cp-card")].map((x) => ({ name: x.querySelector(".cp-name").textContent, count: x.querySelector(".cp-count").textContent.replace(/\s+/g, " ").trim(), img: x.querySelector("img") ? x.querySelector("img").complete && x.querySelector("img").naturalWidth : 0 })), msg: document.querySelector(".cp-msg").hidden }));
  ok("Countdowns page: every current one, soonest first (also the one not on Home), the passed one hidden",
    JSON.stringify(pg.cards.map((x) => x.name)) === JSON.stringify(["Dentist day", "Zoe's <b>birthday</b>", "Beach trip", "Only on the page"]) && pg.msg, pg.cards.map((x) => x.name));
  ok("…with days to go (12), and the photo loaded from the Pi", /^12\s*days to go$/.test(pg.cards[2].count) && pg.cards[2].img > 0 && /^30\s*days to go$/.test(pg.cards[3].count), pg.cards);
  await h.shot("countdowns-page");

  // ---- portrait: a banner under the header, above Today ----
  await page.setViewportSize({ width: 1080, height: 1920 }); await h.sleep(1500);
  await h.tap(".os-page-home"); await h.sleep(1000);
  c = await card();
  const today = await page.evaluate(() => Math.round(document.querySelector(".hd-today-slot").getBoundingClientRect().top));
  ok("portrait: a banner with the soonest three side by side, above Today, inside the screen",
    c && c.rows.length === 3 && c.bottom <= today && c.left >= 0 && c.right <= c.W && c.rows.every((r) => r.h >= 44), { c, today });
  const bannerFits = await page.evaluate(() => [...document.querySelectorAll(".hd-countdowns .hd-cd-row")].every((r) => r.scrollWidth <= r.clientWidth + 1));
  ok("portrait: nothing in the banner spills out", bannerFits);
  await h.shot("countdowns-portrait");
  await h.tap(".os-page-countdowns"); await h.sleep(800);
  ok("portrait: the page fits", await page.evaluate(() => { const r = document.querySelector(".cp-root").getBoundingClientRect(); return r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1; }));
  await h.shot("countdowns-portrait-page");

  // ---- compact ----
  await page.setViewportSize({ width: 1280, height: 720 }); await h.sleep(1500);
  await h.tap(".os-page-home"); await h.sleep(1000);
  c = await card();
  ok("compact: the card fits and the rows are still finger-sized", c && c.rows.length === 2 && c.bottom <= c.H && c.right <= c.W && c.rows.every((r) => r.h >= 44), c);
  await h.shot("countdowns-compact");
  await page.setViewportSize({ width: 1920, height: 1080 }); await h.sleep(1000);

  // ---- the phone page: add one with a photo, change it, remove it ----
  await page.evaluate(() => MM.getModules().withClass("MMM-OpenSky-Sidebar")[0].sendNotification("OPENSKY_SETUP_OPEN"));
  await until(() => page.evaluate(() => document.querySelectorAll(".osu-code span").length === 6));
  const code = await page.evaluate(() => [...document.querySelectorAll(".osu-code span")].map((s) => s.textContent).join(""));
  await app.evaluate(({ BrowserWindow }) => { const w = new BrowserWindow({ width: 390, height: 844, show: true }); w.loadURL("http://localhost:8091/"); });
  const phone = await app.waitForEvent("window", { timeout: 20000 });
  await phone.waitForLoadState();
  await until(() => phone.evaluate(() => !!document.querySelector(".code-input")));
  await phone.fill(".code-input", code);
  await until(() => phone.evaluate(() => !!document.querySelector("#countdowns")));
  const tap = async (scope, selector, label) => {
    const done = await phone.evaluate(([sc, sel, t]) => { const b = [...document.querySelector(sc).querySelectorAll(sel)].find((x) => x.textContent.trim() === t || x.getAttribute("aria-label") === t); if (b) b.click(); return !!b; }, [scope, selector, label]);
    if (!done) throw new Error(`nothing to tap: ${scope} ${selector} "${label}"`);
    await h.sleep(300);
  };
  const tapRow = async (title) => {
    const done = await phone.evaluate((t) => { const r = [...document.querySelectorAll("#countdowns .row")].find((x) => x.querySelector("b").textContent === t); if (r) r.click(); return !!r; }, title);
    if (!done) throw new Error(`no countdown row "${title}"`);
    await h.sleep(300);
  };
  const rows = () => phone.evaluate(() => [...document.querySelectorAll("#countdowns .row")].map((r) => r.querySelector("b").textContent));
  ok("phone: the Countdowns card lists the existing ones", (await rows()).includes("Beach trip") && (await rows()).length === 5, await rows());
  await tap("#countdowns", ".btn.block", "Add a countdown");
  await until(() => phone.evaluate(() => !!document.querySelector(".sheet")));
  await tap(".sheet", ".sheet-foot .btn", "Done");
  ok("phone: an empty name is refused kindly", await phone.evaluate(() => /name/i.test(document.querySelector(".sheet .err").textContent)));
  await phone.fill('.sheet input[placeholder^="e.g. Beach"]', "Camping");
  await tap(".sheet", ".sheet-foot .btn", "Done");
  ok("phone: …and so is a missing date", await phone.evaluate(() => /date/i.test(document.querySelector(".sheet .err").textContent)));
  await phone.fill('.sheet input[type="date"]', day(40));
  await phone.setInputFiles('.sheet input[type="file"]', { name: "tent.png", mimeType: "image/png", buffer: PNG });
  await until(() => phone.evaluate(() => /url\(/.test(document.querySelector(".cd-prev").style.backgroundImage)));
  await tap(".sheet", ".toggle", "Every year");
  await h.sleep(200);
  await phone.screenshot({ path: path.join(OUT, "countdowns-phone-sheet.png") });
  await tap(".sheet", ".sheet-foot .btn", "Done");
  await until(() => phone.evaluate(() => !document.querySelector(".sheet")));
  await tap(".bar", ".btn", "Save");
  await until(() => phone.evaluate(() => /Saved ✓/.test(document.querySelector(".bar")?.textContent || "")));
  const added = settings().countdowns.items.find((x) => x.title === "Camping");
  ok("phone: saved in opensky.json (id, title, date, yearly, photo flag)", added && /^[a-z0-9]{4,24}$/.test(added.id) && added.date === day(40) && added.yearly === true && added.photo === true, added);
  const stored = added && fs.readdirSync(PHOTOS).filter((f) => f.startsWith(added.id));
  ok("…and its photo is a JPEG file on the Pi", stored && stored.length === 1 && stored[0].endsWith(".jpg"), stored);
  const served = await phone.evaluate(async (id) => { const r = await fetch(`/api/countdowns/photo/${id}`); return [r.status, r.headers.get("content-type")]; }, added.id);
  ok("…which the phone can see again", served[0] === 200 && served[1] === "image/jpeg", served);
  const evil = await phone.evaluate(async () => { const r = await fetch("/api/countdowns/photo?id=../../etc/x", { method: "POST", headers: { "X-OpenSky": "1" }, body: "x" }); return r.status; });
  ok("the photo route refuses an id that isn't a plain id", evil === 400, evil);

  // change it, then remove it
  await tapRow("Camping");
  await phone.fill('.sheet input[placeholder^="e.g. Beach"]', "Camping trip");
  await tap(".sheet", ".sheet-foot .btn", "Done");
  await until(() => phone.evaluate(() => !document.querySelector(".sheet")));
  await tap(".bar", ".btn", "Save");
  await h.sleep(800);
  ok("phone: renamed (same id, one entry)", settings().countdowns.items.filter((x) => x.id === added.id).length === 1 && settings().countdowns.items.find((x) => x.id === added.id).title === "Camping trip");
  await tapRow("Camping trip");
  await tap(".sheet", ".sheet-foot .btn", "Remove");
  await h.sleep(500);
  await tap(".bar", ".btn", "Save");
  await h.sleep(800);
  ok("phone: removed from the settings and its photo deleted", !settings().countdowns.items.some((x) => x.id === added.id) && !fs.readdirSync(PHOTOS).some((f) => f.startsWith(added.id)));
  await phone.screenshot({ path: path.join(OUT, "countdowns-phone.png") });

  const f = Object.entries(R).filter(([, v]) => !v).map(([k]) => k);
  h.log(`SUMMARY: ${f.length ? "FAILED: " + f.join("; ") : "ALL CHECKS PASSED"} (${Object.keys(R).length} checks)`);
};

module.exports.patchSettings = (s) => {
  s.pages = s.pages.filter((p) => p !== "countdowns");
  s.pages.splice(1, 0, "countdowns");
  s.countdowns = { keepDays: 0, items: [
    { id: "cbeach01", title: "Beach trip", date: day(12), color: "blue", photo: true },
    { id: "czoe0001", title: "Zoe's <b>birthday</b>", date: day(1, 2019), yearly: true, color: "pink" },
    { id: "cdentist", title: "Dentist day", date: day(0), color: "green" },
    { id: "cold0001", title: "Old trip", date: day(-3), color: "gray" },
    { id: "cpageonl", title: "Only on the page", date: day(30), home: false }
  ] };
};
