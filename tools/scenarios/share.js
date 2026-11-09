// The family share page: a phone opens the private link, posts a note (it appears on the Home screen, a tap removes
// it) and adds a photo (it lands in the photo folder). Phone setup shows the link and can replace it.
const fs = require("fs"), path = require("path");
const OUT = path.join(__dirname, "..", "out");
const PICS = path.join(OUT, "share-photos");
const PORT = 8095;
fs.rmSync(PICS, { recursive: true, force: true });

module.exports = async (page, h, app) => {
  const R = {}; const ok = (k, v, i) => { R[k] = v; h.log(`${v ? "PASS" : "FAIL"}  ${k}${i !== undefined ? "  — " + JSON.stringify(i) : ""}`); };
  const until = async (fn, tries = 40) => { for (let i = 0; i < tries && !(await fn()); i++) await h.sleep(250); return fn(); };
  const secrets = () => JSON.parse(fs.readFileSync(path.join(OUT, "secrets.test.json"), "utf8"));
  const refresh = () => page.evaluate(() => MM.getModules().withClass("MMM-OpenSky-Home")[0].sendSocketNotification("NOTES_GET"));
  const noteTexts = () => page.evaluate(() => [...document.querySelectorAll(".hd-note-text")].map((e) => e.textContent));

  await until(() => !!(secrets().share && secrets().share.token));
  const token = secrets().share.token;
  ok("the link token was made and kept in secrets.json (not in the settings)", /^[a-f0-9]{48}$/.test(token) && !JSON.stringify(JSON.parse(fs.readFileSync(path.join(OUT, "opensky.test.json"), "utf8"))).includes(token));
  ok("the Home page has no note card while there are no notes", await page.evaluate(() => document.querySelector(".hd-notes")?.hidden === true));

  // ---- a family phone ----
  await app.evaluate(({ BrowserWindow }, p) => { const w = new BrowserWindow({ width: 390, height: 844, show: true }); w.loadURL(`http://localhost:${p}/s/abc123`); }, PORT);
  const wrong = await app.waitForEvent("window", { timeout: 20000 });
  await wrong.waitForLoadState();
  ok("a wrong link says so, plainly", /link doesn.t work/i.test(await wrong.evaluate(() => document.body.innerText)));
  await wrong.goto(`http://localhost:${PORT}/s/${token}`);
  await until(() => wrong.evaluate(() => !!document.querySelector("textarea")));
  const phone = wrong;
  ok("the right link opens the share page: a note box and a photo button", await phone.evaluate(() => !!document.querySelector("textarea") && /Choose photos/.test(document.body.innerText)));
  await phone.fill("textarea", "Dentist moved to Thursday");
  await phone.fill("input[type=text]", "Mom");
  await phone.click(".btn:not(.plain)");
  await until(() => phone.evaluate(() => /Posted/.test(document.body.innerText)));
  ok("the phone says the note was posted and lists it", await phone.evaluate(() => /Posted/.test(document.body.innerText) && /Dentist moved/.test(document.querySelector(".notes")?.innerText || "")));
  await refresh();
  await until(async () => (await noteTexts()).length === 1);
  ok("the note shows on the Home screen", (await noteTexts())[0] === "Dentist moved to Thursday", await noteTexts());
  const geo = await page.evaluate(() => { const n = document.querySelector(".hd-note").getBoundingClientRect(), r = document.querySelector(".hd-right").getBoundingClientRect(), l = document.querySelector(".hd-lists").getBoundingClientRect(); return { inside: n.left >= r.left - 1 && n.right <= r.right + 1, above: n.bottom <= l.top + 1, listsOnScreen: l.bottom <= innerHeight + 1 }; });
  ok("...above the lists, inside the right column, nothing pushed off screen", geo.inside && geo.above && geo.listsOnScreen, geo);
  await h.shot("share-note");
  await page.evaluate(() => document.querySelector(".hd-note-x").click());
  await until(async () => (await noteTexts()).length === 0);
  ok("tapping the x on the screen removes it", (await noteTexts()).length === 0 && JSON.parse(fs.readFileSync(path.join(OUT, "notes.test.json"), "utf8")).notes.length === 0);

  // a photo from the phone
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
  await phone.setInputFiles("input[type=file]", { name: "Beach.png", mimeType: "image/png", buffer: png });
  await until(() => phone.evaluate(() => /added/.test(document.body.innerText)));
  ok("a photo from the phone lands in the photo folder", fs.existsSync(path.join(PICS, "Beach.png")) && await phone.evaluate(() => /Added/.test(document.body.innerText)));

  // ---- phone setup: the link, and a new one ----
  await page.evaluate(() => MM.getModules().withClass("MMM-OpenSky-Sidebar")[0].sendNotification("OPENSKY_SETUP_OPEN"));
  await until(() => page.evaluate(() => document.querySelectorAll(".osu-code span").length === 6));
  const code = await page.evaluate(() => [...document.querySelectorAll(".osu-code span")].map((s) => s.textContent).join(""));
  await app.evaluate(({ BrowserWindow }) => { const w = new BrowserWindow({ width: 390, height: 844, show: true }); w.loadURL("http://localhost:8091/"); });
  const admin = await app.waitForEvent("window", { predicate: (w) => w.url().includes(":8091"), timeout: 20000 });
  await admin.waitForLoadState();
  await until(() => admin.evaluate(() => !!document.querySelector(".code-input")));
  await admin.fill(".code-input", code);
  await until(() => admin.evaluate(() => !!document.querySelector("#share input[readonly]")));
  const shown = await admin.evaluate(() => document.querySelector("#share input[readonly]").value);
  ok("phone setup shows the family link", shown.endsWith(`:${PORT}/s/${token}`), shown.replace(token, "<token>"));
  await admin.evaluate(() => [...document.querySelectorAll("#share .btn")].find((b) => b.textContent === "New link").click());
  await until(() => admin.evaluate(() => !!document.querySelector(".sheet")));
  await admin.evaluate(() => [...document.querySelectorAll(".sheet .btn")].find((b) => b.textContent === "New link").click());
  await until(() => !!(secrets().share && secrets().share.token !== token));
  ok("a new link replaces the old one", secrets().share.token !== token);
  ok("...and the old phone is locked out", await phone.evaluate(async () => (await fetch("/api/state")).status) === 401);
  ok("no share token appears in the logs", !h.serverLog().includes(token) && !h.serverLog().includes(secrets().share.token));

  const f = Object.entries(R).filter(([, v]) => !v).map(([k]) => k);
  h.log(`SUMMARY: ${f.length ? "FAILED: " + f.join("; ") : "ALL CHECKS PASSED"} (${Object.keys(R).length} checks)`);
};
module.exports.patchSettings = (s) => { s.share = { enabled: true }; s.photos = { ...(s.photos || {}), folder: PICS }; };
module.exports.env = { OPENSKY_SHARE_PORT: String(PORT) };
