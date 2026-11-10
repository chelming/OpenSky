// The text size is per screen: Settings on this screen sets this browser's own size (localStorage), it survives a page
// refresh, "Default" follows the setting from opensky.json (here: Large), and nothing about it is saved on the Pi.
const fs = require("fs"), path = require("path");
module.exports = async (page, h) => {
  const R = {}; const ok = (k, v, i) => { R[k] = v; h.log(`${v ? "PASS" : "FAIL"}  ${k}${i !== undefined ? "  — " + JSON.stringify(i) : ""}`); };
  const zoom = () => page.evaluate(() => Number(getComputedStyle(document.documentElement).getPropertyValue("--os-zoom")));
  const near = async (want) => Math.abs((await zoom()) - want) < 0.01;
  const reload = async () => { await page.reload(); await page.waitForFunction(() => window.MM && MM.getModules && MM.getModules().length > 5, null, { timeout: 30000 }); await h.sleep(3500); };
  const pick = async (v) => {
    await page.evaluate(() => MM.getModules().withClass("MMM-OpenSky-Sidebar")[0].sendNotification("OPENSKY_SETTINGS_OPEN")); await h.sleep(800);
    await page.evaluate((v) => document.querySelector(`[data-seg="textSize"] button[data-v="${v}"]`).click(), v); await h.sleep(600);
    await page.evaluate(() => document.querySelector(".ost-close, .ost-x, [aria-label='Close']")?.click()); await h.sleep(300);
  };
  await page.setViewportSize({ width: 1920, height: 1080 }); await h.sleep(800);
  ok("no choice on this screen → the default from opensky.json (Large, 1.15×)", await near(1.15), await zoom());
  await pick("xlarge");
  ok("this screen picks Extra large → 1.3× at once", await near(1.3), await zoom());
  await reload();
  ok("after a refresh it is still Extra large (this browser remembers)", await near(1.3), await zoom());
  await pick("default");
  ok("Default → back to the opensky.json size (Large)", await near(1.15), await zoom());
  await reload();
  ok("after a refresh still the default", await near(1.15), await zoom());
  await pick("small"); await reload();
  ok("Small survives a refresh", await near(0.9), await zoom());
  await page.evaluate(() => localStorage.clear()); await reload();   // "another device": a browser that never chose
  ok("a screen that never chose follows the default (Large), whatever another one picked", await near(1.15), await zoom());
  const saved = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "out", "opensky.test.json"), "utf8"));
  ok("nothing about the screen's choice was written to the Pi's settings (still Large)", saved.look && saved.look.textSize === "large", saved.look);
  const f = Object.entries(R).filter(([, v]) => !v).map(([k]) => k);
  h.log(`SUMMARY: ${f.length ? "FAILED: " + f.join("; ") : "ALL CHECKS PASSED"} (${Object.keys(R).length} checks)`);
};
module.exports.patchSettings = (st) => { st.look = { ...(st.look || {}), textSize: "large" }; };
