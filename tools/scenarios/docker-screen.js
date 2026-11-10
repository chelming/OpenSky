// Docker: no Sound / "Sleep turns off by" in Settings; brightness, evening dim and the sleep schedule are this browser's own
// (localStorage "opensky.screen"), not the shared device.json; the page dims itself.
module.exports = async (page, h, app) => {
  const R = {}; const ok = (k, v, i) => { R[k] = v; h.log(`${v ? "PASS" : "FAIL"}  ${k}${i !== undefined ? "  — " + JSON.stringify(i) : ""}`); };
  const until = async (fn, tries = 40) => { for (let i = 0; i < tries && !(await fn()); i++) await h.sleep(250); return fn(); };
  const fs = require("fs"), path = require("path");
  const devFile = path.join(__dirname, "..", "out", "device.test.json");
  const devBefore = fs.existsSync(devFile) ? fs.readFileSync(devFile, "utf8") : null;

  await page.evaluate(() => MM.getModules().withClass("MMM-OpenSky-Sidebar")[0].sendNotification("OPENSKY_SETTINGS_OPEN"));
  await until(async () => page.evaluate(() => !!document.querySelector(".ost-slider")));
  const has = (sel) => page.evaluate((s) => !!document.querySelector(s), sel);
  ok("no Sound section", !(await has(".ost-sound")) && !(await page.evaluate(() => /No speaker/.test(document.body.textContent))));
  ok("no 'Sleep turns off by' (a browser has no screen to switch off)", !(await has("[data-screenoff]")));
  ok("brightness note says it's this screen only", await page.evaluate(() => /this screen only/.test(document.querySelector(".ost-note").textContent)));

  // brightness: the slider dims this page, is kept in localStorage, and device.json is not touched
  await page.evaluate(() => { const s = document.querySelector('.ost-slider[data-id="brightness"]'); s.value = 60; s.dispatchEvent(new Event("input", { bubbles: true })); s.dispatchEvent(new Event("change", { bubbles: true })); });
  await h.sleep(700);
  const opacity = await page.evaluate(() => Number(document.querySelector(".ost-dim")?.style.opacity || 0));
  ok("brightness 60% dims the page (opacity 0.4)", Math.abs(opacity - 0.4) < 0.01, opacity);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("opensky.screen") || "{}"));
  ok("the choice is kept in this browser", saved.brightness === 60, saved);
  const devAfter = fs.existsSync(devFile) ? fs.readFileSync(devFile, "utf8") : null;
  ok("device.json (shared) is not changed", devBefore === devAfter);

  // a reload keeps it
  await page.evaluate(() => document.querySelector(".ost-x").click());
  await page.reload(); await h.sleep(8000);
  const opacity2 = await page.evaluate(() => Number(document.querySelector(".ost-dim")?.style.opacity || 0));
  ok("after a reload the page is still dimmed", Math.abs(opacity2 - 0.4) < 0.01, opacity2);

  const f = Object.entries(R).filter(([, v]) => !v).map(([k]) => k);
  h.log(`SUMMARY: ${f.length ? "FAILED: " + f.join("; ") : "ALL CHECKS PASSED"} (${Object.keys(R).length} checks)`);
};
module.exports.env = { OPENSKY_DOCKER: "1" };
