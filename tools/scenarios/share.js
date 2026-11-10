// The family share page: the passcode is chosen in phone setup; a family phone signs in with it, posts a note (it appears
// on the Home screen, a tap removes it) and adds a photo (it lands in the photo folder). A new passcode signs the phone out.
const fs = require("fs"), path = require("path");
const OUT = path.join(__dirname, "..", "out");
const PICS = path.join(OUT, "share-photos");
const PORT = 8095;
const PASS = "kitchen-table-7";
fs.rmSync(PICS, { recursive: true, force: true });

module.exports = async (page, h, app) => {
  const R = {}; const ok = (k, v, i) => { R[k] = v; h.log(`${v ? "PASS" : "FAIL"}  ${k}${i !== undefined ? "  — " + JSON.stringify(i) : ""}`); };
  const until = async (fn, tries = 40) => { for (let i = 0; i < tries && !(await fn()); i++) await h.sleep(250); return fn(); };
  const secretsText = () => fs.readFileSync(path.join(OUT, "secrets.test.json"), "utf8");
  const refresh = () => page.evaluate(() => MM.getModules().withClass("MMM-OpenSky-Home")[0].sendSocketNotification("NOTES_GET"));
  const noteTexts = () => page.evaluate(() => [...document.querySelectorAll(".hd-note-text")].map((e) => e.textContent));
  const win = async (url, wait) => {
    await app.evaluate(({ BrowserWindow }, u) => { const w = new BrowserWindow({ width: 390, height: 844, show: true }); w.loadURL(u); }, url);
    const w = await app.waitForEvent("window", { predicate: wait, timeout: 20000 });
    await w.waitForLoadState();
    return w;
  };

  ok("the Home page has no note card while there are no notes", await page.evaluate(() => document.querySelector(".hd-notes")?.hidden === true));

  // ---- phone setup: choose the passcode ----
  await page.evaluate(() => MM.getModules().withClass("MMM-OpenSky-Sidebar")[0].sendNotification("OPENSKY_SETUP_OPEN"));
  await until(() => page.evaluate(() => document.querySelectorAll(".osu-code span").length === 6));
  const code = await page.evaluate(() => [...document.querySelectorAll(".osu-code span")].map((s) => s.textContent).join(""));
  const admin = await win("http://localhost:8091/", (w) => w.url().includes(":8091"));
  await until(() => admin.evaluate(() => !!document.querySelector(".code-input")));
  await admin.fill(".code-input", code);
  await until(() => admin.evaluate(() => !!document.querySelector("#share input[type=password]")));
  ok("phone setup asks for a family passcode and shows the share page's address", await admin.evaluate((p) => /Choose a passcode/.test(document.querySelector("#share input[type=password]").placeholder) && !!document.querySelector("#share .addr") && document.querySelector("#share .addr").textContent.endsWith(`:${p}`), PORT));
  await admin.fill("#share input[type=password]", "short");
  await admin.evaluate(() => [...document.querySelectorAll("#share .btn")].find((b) => /Save passcode/.test(b.textContent)).click());
  await until(() => admin.evaluate(() => /at least/.test(document.querySelector("#share .err")?.textContent || "")));
  ok("a passcode that is too short is refused, in plain words", await admin.evaluate(() => /at least 6/.test(document.querySelector("#share .err").textContent)));
  await admin.fill("#share input[type=password]", PASS);
  await admin.evaluate(() => [...document.querySelectorAll("#share .btn")].find((b) => /Save passcode/.test(b.textContent)).click());
  await until(() => admin.evaluate(() => /Change passcode/.test(document.querySelector("#share")?.innerText || "")));
  ok("the passcode is saved, and only as a hash", !secretsText().includes(PASS) && /scrypt\$/.test(secretsText()));

  // ---- a family phone ----
  const phone = await win(`http://localhost:${PORT}/`, (w) => w.url().includes(`:${PORT}`));
  await until(() => phone.evaluate(() => !!document.querySelector("input[type=password]")));
  ok("a phone that hasn't signed in sees only a passcode box (no notes, no upload)", await phone.evaluate(() => !document.querySelector("textarea") && !document.querySelector("input[type=file]")));
  await phone.screenshot({ path: path.join(OUT, "share-login.png") });
  await phone.fill("input[type=password]", "not-the-passcode");
  await phone.click(".btn");
  await until(() => phone.evaluate(() => /not the passcode/.test(document.body.innerText)));
  ok("a wrong passcode is refused, plainly", await phone.evaluate(() => /not the passcode/.test(document.body.innerText) && !document.querySelector("textarea")));
  await phone.fill("input[type=password]", PASS);
  await phone.click(".btn");
  await until(() => phone.evaluate(() => !!document.querySelector("textarea")));
  ok("the right passcode opens the page: a note box and a photo button", await phone.evaluate(() => !!document.querySelector("textarea") && /Choose photos/.test(document.body.innerText)));
  await phone.fill("textarea", "Dentist moved to Thursday");
  await phone.fill("input[type=text]", "Mom");
  await phone.click(".btn:not(.plain)");
  await until(() => phone.evaluate(() => /Posted/.test(document.body.innerText)));
  ok("the phone says the note was posted and lists it", await phone.evaluate(() => /Posted/.test(document.body.innerText) && /Dentist moved/.test(document.querySelector(".notes")?.innerText || "")));
  await phone.screenshot({ path: path.join(OUT, "share-page.png") });
  await refresh();
  await until(async () => (await noteTexts()).length === 1);
  ok("the note shows on the Home screen", (await noteTexts())[0] === "Dentist moved to Thursday", await noteTexts());
  const geo = await page.evaluate(() => { const n = document.querySelector(".hd-note").getBoundingClientRect(), r = document.querySelector(".hd-right").getBoundingClientRect(), l = document.querySelector(".hd-lists").getBoundingClientRect(); return { inside: n.left >= r.left - 1 && n.right <= r.right + 1, above: n.bottom <= l.top + 1, listsOnScreen: l.bottom <= innerHeight + 1 }; });
  ok("...above the lists, inside the right column, nothing pushed off screen", geo.inside && geo.above && geo.listsOnScreen, geo);
  await h.shot("share-note");
  await page.evaluate(() => document.querySelector(".hd-note-x").click());
  await until(async () => (await noteTexts()).length === 0);
  ok("tapping the x on the screen removes it", (await noteTexts()).length === 0 && JSON.parse(fs.readFileSync(path.join(OUT, "notes.test.json"), "utf8")).notes.length === 0);

  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
  await phone.setInputFiles("input[type=file]", { name: "Beach.png", mimeType: "image/png", buffer: png });
  await until(() => phone.evaluate(() => /Added/.test(document.body.innerText)));
  ok("a photo from the phone lands in the photo folder", fs.existsSync(path.join(PICS, "Beach.png")) && await phone.evaluate(() => /Added/.test(document.body.innerText)));

  // the page keeps the phone signed in; a new passcode signs it out
  await phone.reload();
  await until(() => phone.evaluate(() => !!document.querySelector("textarea")));
  ok("reloading keeps the phone signed in", await phone.evaluate(() => !!document.querySelector("textarea")));
  await admin.fill("#share input[type=password]", "dining-room-3");
  await admin.evaluate(() => [...document.querySelectorAll("#share .btn")].find((b) => /Change passcode/.test(b.textContent)).click());
  await until(async () => (await phone.evaluate(async () => (await fetch("/api/state")).status)) === 401);
  ok("a new passcode signs the phone out", await phone.evaluate(async () => (await fetch("/api/state")).status) === 401);
  ok("no passcode appears in the logs", !h.serverLog().includes(PASS) && !h.serverLog().includes("dining-room-3"));

  const f = Object.entries(R).filter(([, v]) => !v).map(([k]) => k);
  h.log(`SUMMARY: ${f.length ? "FAILED: " + f.join("; ") : "ALL CHECKS PASSED"} (${Object.keys(R).length} checks)`);
};
module.exports.patchSettings = (s) => { s.share = { enabled: true }; s.photos = { ...(s.photos || {}), folder: PICS }; };
module.exports.env = { OPENSKY_SHARE_PORT: String(PORT) };
