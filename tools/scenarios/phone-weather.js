// Phone setup → Weather card: the Weather page is switched on from the phone (it joins the pages), each extra (hourly, radar,
// alerts) has its own switch, and the saved settings are what the screen reads. Writable copies of the settings (tools/out).
const fs = require("fs"), path = require("path");
const OUT = path.join(__dirname, "..", "out");

module.exports = async (page, h, app) => {
  const R = {}; const ok = (k, v, i) => { R[k] = v; h.log(`${v ? "PASS" : "FAIL"}  ${k}${i !== undefined ? "  — " + JSON.stringify(i) : ""}`); };
  const until = async (fn, tries = 40) => { for (let i = 0; i < tries && !(await fn()); i++) await h.sleep(250); return fn(); };
  const settings = () => JSON.parse(fs.readFileSync(path.join(OUT, "opensky.test.json"), "utf8"));

  await page.evaluate(() => MM.getModules().withClass("MMM-OpenSky-Sidebar")[0].sendNotification("OPENSKY_SETUP_OPEN"));
  await until(() => page.evaluate(() => document.querySelectorAll(".osu-code span").length === 6));
  const code = await page.evaluate(() => [...document.querySelectorAll(".osu-code span")].map((s) => s.textContent).join(""));
  await app.evaluate(({ BrowserWindow }) => { const w = new BrowserWindow({ width: 390, height: 844, show: true }); w.loadURL("http://localhost:8091/"); });
  const phone = await app.waitForEvent("window", { timeout: 20000 });
  await phone.waitForLoadState();
  await until(() => phone.evaluate(() => !!document.querySelector(".code-input")));
  await phone.fill(".code-input", code);
  await until(() => phone.evaluate(() => !!document.querySelector("#weather")));

  const toggles = () => phone.evaluate(() => [...document.querySelectorAll("#weather .line")].map((l) => [l.querySelector("b").textContent, l.querySelector(".toggle").classList.contains("on")]));
  const tap = async (label) => {
    const done = await phone.evaluate((t) => { const l = [...document.querySelectorAll("#weather .line")].find((x) => x.querySelector("b").textContent === t); if (!l) return false; l.querySelector(".toggle").click(); return true; }, label);
    if (!done) throw new Error(`nothing to tap: ${label}`);
    await h.sleep(300);
  };
  const save = async () => {
    await phone.evaluate(() => [...document.querySelectorAll(".bar .btn")].find((b) => b.textContent.trim() === "Save").click());
    return until(() => phone.evaluate(() => /Saved ✓/.test(document.querySelector(".bar")?.textContent || "")));
  };

  ok("a Weather card is on the phone page and in its jump bar", await phone.evaluate(() => !!document.querySelector("#weather") && [...document.querySelectorAll(".jump a")].some((a) => a.textContent === "Weather")));
  ok("with the page off, only the page switch shows", JSON.stringify(await toggles()) === '[["Weather page",false]]', await toggles());
  await tap("Weather page");
  ok("Weather page on: the three extras appear, all on", JSON.stringify(await toggles()) === '[["Weather page",true],["Hour by hour",true],["Rain radar",true],["Weather alerts",true]]', await toggles());
  await tap("Rain radar"); await tap("Weather alerts");
  ok("save", await save());
  let S = settings();
  ok("saved: the page is in the pages; radar and alerts are off, hourly stays on (not written)", S.pages.includes("weather") && S.weather.radar === false && S.weather.alerts === false && S.weather.hourly === undefined && S.weather.provider === "open-meteo", { pages: S.pages, weather: S.weather });
  await phone.evaluate(() => document.querySelector("#weather").scrollIntoView());
  await phone.screenshot({ path: path.join(OUT, "phone-weather.png") });
  await tap("Rain radar"); await tap("Weather alerts"); await tap("Weather page");
  ok("save again", await save());
  S = settings();
  ok("switching everything off again removes the page and clears the extras' switches", !S.pages.includes("weather") && S.weather.radar === undefined && S.weather.alerts === undefined, { pages: S.pages, weather: S.weather });

  const f = Object.entries(R).filter(([, v]) => !v).map(([k]) => k);
  h.log(`SUMMARY: ${f.length ? "FAILED: " + f.join("; ") : "ALL CHECKS PASSED"} (${Object.keys(R).length} checks)`);
};
module.exports.writableSettings = true;
module.exports.patchSettings = (s) => { s.pages = s.pages.filter((p) => p !== "weather"); };
