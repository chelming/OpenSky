// Dark mode: Light by default (today's look), Dark / Auto from Settings on this screen (per screen, survives a refresh, nothing
// written to the Pi), Auto follows the sun at the configured location and an optional light sensor, every page, the Settings
// popup and the screensaver are really dark (measured on a screenshot) and the evening dim still dims.
module.exports = async (page, h) => {
  const R = {}; const ok = (k, v, i) => { R[k] = v; h.log(`${v ? "PASS" : "FAIL"}  ${k}${i !== undefined ? "  — " + JSON.stringify(i) : ""}`); };
  const theme = () => page.evaluate(() => document.documentElement.dataset.osTheme);
  const sb = (fn, ...a) => page.evaluate(([f, a]) => { const m = MM.getModules().withClass("MMM-OpenSky-Sidebar")[0]; return m[f](...a); }, [fn, a]);
  const reload = async () => { await page.reload(); await page.waitForFunction(() => window.MM && MM.getModules && MM.getModules().length > 5, null, { timeout: 30000 }); await h.sleep(3500); };
  // average brightness (0..1) of what is really on the screen
  const bright = async () => {
    const b64 = (await page.screenshot()).toString("base64");
    return page.evaluate(async (b64) => {
      const img = new Image(); img.src = "data:image/png;base64," + b64; await img.decode();
      const c = document.createElement("canvas"); c.width = 96; c.height = 54;
      const x = c.getContext("2d"); x.drawImage(img, 0, 0, 96, 54);
      const d = x.getImageData(0, 0, 96, 54).data; let s = 0;
      for (let i = 0; i < d.length; i += 4) s += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
      return s / (d.length / 4);
    }, b64);
  };
  await page.setViewportSize({ width: 1920, height: 1080 }); await h.sleep(1000);

  ok("existing installs: no setting → Light, as before", (await theme()) === "light" && (await bright()) > 0.6, await theme());
  const pick = async (v) => {
    await page.evaluate(() => MM.getModules().withClass("MMM-OpenSky-Sidebar")[0].sendNotification("OPENSKY_SETTINGS_OPEN")); await h.sleep(800);
    await page.evaluate((v) => document.querySelector(`[data-seg="theme"] button[data-v="${v}"]`).click(), v); await h.sleep(600);
  };
  await pick("dark");
  ok("Settings → Dark mode → Dark: the page goes dark at once", (await theme()) === "dark");
  await h.sleep(500);
  ok("the Settings popup itself is dark and readable (not a white block)", (await bright()) < 0.4, await bright());
  await h.shot("dark-settings");
  await page.evaluate(() => document.querySelector(".ost-close, .ost-x, [aria-label='Close']")?.click()); await h.sleep(500);

  // every page
  const pages = await page.evaluate(() => MM.getModules().withClass("MMM-OpenSky-Sidebar")[0].config.pages.map((p) => [p.key, p.index]));
  const embeds = await page.evaluate(() => MM.getModules().withClass("MMM-OpenSky-Embed").map((m) => m.config.key));
  for (const [key, idx] of pages) {
    await page.evaluate((i) => MM.getModules().withClass("MMM-OpenSky-Sidebar")[0].goPage(i), idx); await h.sleep(1500);
    const b = await bright();
    // a web page the family added (Smart Home, Vault…) is shown as the website made it: light sites stay light on purpose
    if (embeds.includes(key)) { h.log(`page ${key}: embedded web page, shown as is (brightness ${b.toFixed(2)})`); await h.shot(`dark-${key}`); continue; }
    ok(`page ${key}: dark (average brightness ${b.toFixed(2)} < 0.45)`, b < 0.45, b);
    await h.shot(`dark-${key}`);
  }
  await page.evaluate(() => MM.getModules().withClass("MMM-OpenSky-Sidebar")[0].goPage(0)); await h.sleep(800);

  // the evening dim layer still dims (it is a black layer; the dark filter must not turn it into a white one)
  await page.evaluate(() => MM.getModules().withClass("MMM-OpenSky-Settings")[0].softDim(40)); await h.sleep(700);
  const dimmed = await bright();
  await page.evaluate(() => MM.getModules().withClass("MMM-OpenSky-Settings")[0].softDim(100)); await h.sleep(700);
  const undimmed = await bright();
  ok("dark + evening dim: dimmer, not brighter", dimmed < undimmed, [dimmed, undimmed]);

  // screensaver: stays as it is (already dark, photos untouched)
  await page.evaluate(() => { const sb = MM.getModules().withClass("MMM-OpenSky-Sidebar")[0]; sb.lastActivity = Date.now() - 11 * 60 * 1000; const s = MM.getModules().withClass("MMM-OpenSky-Screensaver")[0]; if (s) s.checkIdle(); });
  await h.sleep(2500);
  const ssOn = await page.evaluate(() => { const r = document.querySelector(".ss-root"); return !!r && !r.hidden && r.classList.contains("on"); });
  if (ssOn) {
    const info = await page.evaluate(() => { const c = document.querySelector(".ss-clock"), cs = getComputedStyle(c); return { color: cs.color, filter: getComputedStyle(document.querySelector(".ss-root")).filter }; });
    ok("screensaver text is white on its dark photo in dark mode too (its own inversion cancels the page's)", /invert/.test(info.filter) && info.color === "rgb(255, 255, 255)", info);
    await h.shot("dark-screensaver");
    await page.mouse.click(960, 540); await h.sleep(1200);
  } else h.log("screensaver not enabled in this fixture: skipped");

  // per screen: survives a refresh, Default follows opensky.json (Light), nothing written on the Pi
  await reload();
  ok("this screen's Dark survives a refresh", (await theme()) === "dark");
  await pick("default");
  ok("Default → back to the opensky.json setting (Light)", (await theme()) === "light");
  await page.evaluate(() => document.querySelector(".ost-close, .ost-x, [aria-label='Close']")?.click());

  // Auto follows the sun at the configured location: pick longitudes where it is solar noon / solar midnight right now
  const lons = await page.evaluate(() => { const u = new Date(), h = u.getUTCHours() + u.getUTCMinutes() / 60, wrap = (x) => ((x + 540) % 360) - 180; return { noon: wrap((12 - h) * 15), midnight: wrap((12 - h) * 15 + 180) }; });
  const auto = async (lon, lux) => page.evaluate(([lon, lux]) => {
    const m = MM.getModules().withClass("MMM-OpenSky-Sidebar")[0];
    m.config.latitude = 20; m.config.longitude = lon; m._lux = lux == null ? null : { v: lux, at: Date.now() }; m.config.lightSensor = lux != null;
    m.setTheme("auto"); return document.documentElement.dataset.osTheme;
  }, [lon, lux]);
  ok("Auto at a place where the sun is up → Light", (await auto(lons.noon)) === "light", lons);
  ok("Auto at a place where it is night → Dark", (await auto(lons.midnight)) === "dark", lons);
  ok("Auto + light sensor: a dark room (2 lux) at noon → Dark", (await auto(lons.noon, 2)) === "dark");
  ok("Auto + light sensor: a bright room (200 lux) at midnight → Light", (await auto(lons.midnight, 200)) === "light");
  ok("Auto + stale or missing sensor reading → follows the sun again", (await auto(lons.midnight, null)) === "dark");
  ok("no light sensor in this browser: starting it is harmless", await page.evaluate(() => { const m = MM.getModules().withClass("MMM-OpenSky-Sidebar")[0]; m._sensorTried = false; m.config.lightSensor = true; try { m.startLightSensor(); return true; } catch (e) { return false; } }));
  await sb("setTheme", "default");

  const fs = require("fs"), path = require("path");
  const saved = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "out", "opensky.test.json"), "utf8"));
  ok("nothing about the screen's choice was written to the Pi's settings", !(saved.look && saved.look.theme), saved.look);
  const f = Object.entries(R).filter(([, v]) => !v).map(([k]) => k);
  h.log(`SUMMARY: ${f.length ? "FAILED: " + f.join("; ") : "ALL CHECKS PASSED"} (${Object.keys(R).length} checks)`);
};
module.exports.patchSettings = (st) => { st.screensaver = { ...(st.screensaver || {}), enabled: true, afterMinutes: 10 }; };
