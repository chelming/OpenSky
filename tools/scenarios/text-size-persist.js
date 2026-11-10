// The text size picked in Settings survives a page refresh (the screen's own config is from the last restart, so the
// Settings module tells the Sidebar what is saved), and going back to Normal sticks too.
module.exports = async (page, h) => {
  const R = {}; const ok = (k, v, i) => { R[k] = v; h.log(`${v ? "PASS" : "FAIL"}  ${k}${i !== undefined ? "  — " + JSON.stringify(i) : ""}`); };
  const zoom = () => page.evaluate(() => Number(getComputedStyle(document.documentElement).getPropertyValue("--os-zoom")));
  const pick = async (v) => {
    await page.evaluate(() => MM.getModules().withClass("MMM-OpenSky-Sidebar")[0].sendNotification("OPENSKY_SETTINGS_OPEN")); await h.sleep(800);
    await page.evaluate(() => MM.getModules().withClass("MMM-OpenSky-Settings")[0].renderPrefs && document.querySelector('[data-seg="textSize"]'));
    await page.evaluate((v) => { const b = document.querySelector(`[data-seg="textSize"] button[data-v="${v}"]`); if (b) b.scrollIntoView(); }, v); await h.sleep(300);
    await page.evaluate((v) => document.querySelector(`[data-seg="textSize"] button[data-v="${v}"]`).click(), v); await h.sleep(800);
  };
  await page.setViewportSize({ width: 1920, height: 1080 }); await h.sleep(800);
  ok("starts at normal size", Math.abs(await zoom() - 1) < 0.01);
  await pick("xlarge");
  ok("Extra large applies at once", Math.abs(await zoom() - 1.3) < 0.01, await zoom());
  await page.reload(); await page.waitForFunction(() => window.MM && MM.getModules && MM.getModules().length > 5, null, { timeout: 30000 }); await h.sleep(3500);
  ok("after a refresh it is still Extra large", Math.abs(await zoom() - 1.3) < 0.01, await zoom());
  await pick("normal");
  ok("Normal applies at once", Math.abs(await zoom() - 1) < 0.01, await zoom());
  await page.reload(); await page.waitForFunction(() => window.MM && MM.getModules && MM.getModules().length > 5, null, { timeout: 30000 }); await h.sleep(3500);
  ok("after a refresh it is still Normal (not back to Extra large)", Math.abs(await zoom() - 1) < 0.01, await zoom());
  const f = Object.entries(R).filter(([, v]) => !v).map(([k]) => k);
  h.log(`SUMMARY: ${f.length ? "FAILED: " + f.join("; ") : "ALL CHECKS PASSED"} (${Object.keys(R).length} checks)`);
};
module.exports.writableSettings = true;
