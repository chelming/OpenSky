// Weather page (hourly forecast, weather alerts, rain radar) against a fake Open-Meteo / NWS / RainViewer / map tiles
// (tools/fixtures/fake-weather.js): everything shows, text from outside stays text, the radar says so when the map can't load,
// each extra can be switched off, and it fits portrait and compact screens.
const PORT = 8098;
let fake = null;
require("../fixtures/fake-weather.js").create(PORT).then((f) => { fake = f; });

module.exports = async (page, h) => {
  const R = {}; const ok = (k, v, i) => { R[k] = v; h.log(`${v ? "PASS" : "FAIL"}  ${k}${i !== undefined ? "  — " + JSON.stringify(i) : ""}`); };
  const until = async (fn, tries = 80) => { for (let i = 0; i < tries && !(await fn()); i++) await h.sleep(250); return fn(); };
  const mod = (fn, arg) => page.evaluate(`(() => { const m = MM.getModules().withClass("MMM-OpenSky-WeatherPage")[0]; return (${fn.toString()})(m, ${JSON.stringify(arg === undefined ? null : arg)}); })()`);

  await h.tap(".os-page-weather"); await h.sleep(800);
  await until(() => page.evaluate(() => document.querySelectorAll(".wp-hour").length === 24));
  const hrs = await page.evaluate(() => ({
    n: document.querySelectorAll(".wp-hour").length, first: document.querySelector(".wp-hour-time").textContent, temp: document.querySelector(".wp-hour-temp").textContent,
    icons: document.querySelectorAll(".wp-hour-ico svg").length, rain: [...document.querySelectorAll(".wp-hour-rain")].map((e) => e.textContent).filter(Boolean).length,
    place: document.querySelector(".wp-place").textContent
  }));
  ok("hourly: 24 hours, the first is 'Now', with temperature, icon and chance of rain", hrs.n === 24 && hrs.first === "Now" && hrs.temp === "50°" && hrs.icons === 24 && hrs.rain >= 10, hrs);
  ok("the page names the town", hrs.place === "Boston, MA", hrs.place);

  await until(() => page.evaluate(() => document.querySelectorAll(".wp-alert").length === 2));
  const al = await page.evaluate(() => ({
    events: [...document.querySelectorAll(".wp-alert-event")].map((e) => e.textContent), sev: [...document.querySelectorAll(".wp-alert")].map((e) => e.className.match(/wp-sev-(\w+)/)[1]),
    injected: !!document.querySelector(".wp-alert-head b"), head: [...document.querySelectorAll(".wp-alert-head")].map((e) => e.textContent)
  }));
  ok("alerts: worst first, colored by severity, the test message left out", JSON.stringify(al.events) === '["Tornado Warning","Flood Watch"]' && JSON.stringify(al.sev) === '["extreme","moderate"]', al);
  ok("alert text from the service stays text (no HTML)", !al.injected && al.head.some((t) => t.includes("<b>x</b>")), al.head);
  await page.evaluate(() => document.querySelectorAll(".wp-alert")[1].click());
  ok("tapping an alert opens its full text", await page.evaluate(() => { const m = document.querySelectorAll(".wp-alert")[1].querySelector(".wp-alert-more"); return !m.hidden && /Stay away from rivers/.test(m.textContent); }));

  await until(() => page.evaluate(() => document.querySelectorAll(".wp-base img").length > 0 && !!document.querySelector(".wp-stamp").textContent));
  await h.sleep(1500);
  const rd = await page.evaluate(() => ({
    base: document.querySelectorAll(".wp-base img").length, baseLoaded: [...document.querySelectorAll(".wp-base img")].filter((i) => i.naturalWidth > 0).length,
    frames: document.querySelectorAll(".wp-frame").length, on: document.querySelectorAll(".wp-frame.on").length, stamp: document.querySelector(".wp-stamp").textContent,
    msgHidden: document.querySelector(".wp-map-msg").hidden, map: document.querySelector(".wp-map").getBoundingClientRect().height
  }));
  ok("radar: map tiles and 6 radar frames, one showing, a time stamp, no error", rd.base > 0 && rd.baseLoaded === rd.base && rd.frames === 6 && rd.on === 1 && rd.stamp && rd.msgHidden && rd.map > 200, rd);
  const s1 = await page.evaluate(() => document.querySelector(".wp-stamp").textContent);
  await until(() => page.evaluate((s) => document.querySelector(".wp-stamp").textContent !== s, s1), 16);
  ok("radar: the frames play", await page.evaluate((s) => document.querySelector(".wp-stamp").textContent !== s, s1));
  await h.shot("weather-landscape");
  await page.evaluate(() => document.querySelector(".wp-play").click());
  const paused = await page.evaluate(() => document.querySelector(".wp-stamp").textContent);
  await h.sleep(1800);
  ok("radar: Pause stops the animation", await page.evaluate((s) => document.querySelector(".wp-stamp").textContent === s, paused));
  await page.evaluate(() => document.querySelector(".wp-play").click());

  await page.evaluate(() => document.querySelector(".wp-zin").click()); await h.sleep(800);
  ok("zoom in rebuilds the map (and stops at the closest level)", await page.evaluate(() => document.querySelector(".wp-zin").disabled && document.querySelectorAll(".wp-base img").length > 0 && document.querySelector(".wp-map-msg").hidden));

  // no internet: the map pictures fail to load -> a friendly message, nothing blank
  fake.state.up = false;
  await page.evaluate(() => document.querySelector(".wp-zout").click());
  await until(() => page.evaluate(() => !document.querySelector(".wp-map-msg").hidden), 60);
  const off = await page.evaluate(() => document.querySelector(".wp-map-msg").textContent);
  ok("map can't load: says so in plain words", /radar map can't be reached/.test(off) && /internet/.test(off), off);
  fake.state.up = true;
  await page.evaluate(() => document.querySelector(".wp-zin").click());
  await until(() => page.evaluate(() => document.querySelector(".wp-map-msg").hidden), 40);
  ok("…and it clears once the pictures load again", await page.evaluate(() => document.querySelector(".wp-map-msg").hidden));

  // the services fail later: the last good data stays, with a note; a first failure says what happened
  await mod((m) => m.socketNotificationReceived("OS_WX_DATA", { hourly: { ok: false, error: "HTTP 503" }, alerts: { ok: false, error: "HTTP 503" }, radar: { ok: false, error: "HTTP 503" } }));
  const stale = await page.evaluate(() => ({ hours: document.querySelectorAll(".wp-hour").length, note: document.querySelector(".wp-hourly .wp-note").textContent, alerts: document.querySelectorAll(".wp-alert").length, noteA: document.querySelector(".wp-alert-list .wp-note")?.textContent }));
  ok("a later failure keeps the last forecast and alerts, with a note", stale.hours === 24 && /last forecast/.test(stale.note) && stale.alerts === 2 && /last alerts/.test(stale.noteA), stale);
  await mod((m) => { m.state = {}; m.socketNotificationReceived("OS_WX_DATA", { hourly: { ok: false, error: "HTTP 503" }, alerts: { ok: false, error: "HTTP 503" }, radar: { ok: false, error: "HTTP 503" } }); });
  const first = await page.evaluate(() => ({ h: document.querySelector(".wp-hourly .wp-note").textContent, a: document.querySelector(".wp-alert-list .wp-note").textContent, r: document.querySelector(".wp-map-msg").textContent }));
  ok("a first failure: each part says it can't load, in plain words", /hourly forecast can't be loaded/.test(first.h) && /alerts can't be checked/.test(first.a) && /radar can't be loaded/.test(first.r), first);

  // outside the US
  await mod((m) => m.socketNotificationReceived("OS_WX_DATA", { alerts: { ok: true, supported: false, alerts: [] } }));
  ok("outside the US: alerts explain they are US-only", await page.evaluate(() => /National Weather Service/.test(document.querySelector(".wp-alert-list").textContent)));
  await mod((m) => m.socketNotificationReceived("OS_WX_DATA", { alerts: { ok: true, supported: true, alerts: [] } }));
  ok("no alerts: says so calmly", await page.evaluate(() => /No weather alerts/.test(document.querySelector(".wp-alert-list").textContent)));

  // each extra can be switched off
  await mod((m) => { m.config.radar = false; m.render(); });
  ok("radar off: no map, alerts take the width", await page.evaluate(() => document.querySelector(".wp-radar").hidden && !document.querySelector(".wp-alerts").hidden && document.querySelector(".wp-alerts").getBoundingClientRect().width > innerWidth * 0.6));
  await mod((m) => { m.config.radar = true; m.config.alerts = false; m.config.hourly = false; m.render(); });
  ok("alerts + hourly off: only the map is left", await page.evaluate(() => document.querySelector(".wp-alerts").hidden && document.querySelector(".wp-hourly").hidden && !document.querySelector(".wp-radar").hidden));
  await mod((m) => { m.config.hourly = m.config.alerts = true; m.state.radar = undefined; m.render(); });
  await page.evaluate(() => MM.getModules().withClass("MMM-OpenSky-WeatherPage")[0].sendSocketNotification("OS_WX_INIT", MM.getModules().withClass("MMM-OpenSky-WeatherPage")[0].config));
  await until(() => page.evaluate(() => document.querySelectorAll(".wp-hour").length === 24 && document.querySelectorAll(".wp-alert").length === 2 && document.querySelectorAll(".wp-frame.on").length === 1));

  // portrait and compact: everything inside the screen, the map still a usable size
  for (const [w, hh, name] of [[1080, 1920, "portrait"], [1280, 720, "compact"]]) {
    await page.setViewportSize({ width: w, height: hh }); await h.sleep(2000);
    await h.tap(".os-page-home"); await h.sleep(500); await h.tap(".os-page-weather"); await h.sleep(1500);
    const fit = await page.evaluate(() => {
      const inside = (s) => { const e = document.querySelector(s); if (!e || e.hidden) return false; const b = e.getBoundingClientRect(), r = document.querySelector(".wp-root").getBoundingClientRect(); return b.left >= r.left - 1 && b.right <= r.right + 1 && b.top >= r.top - 1 && b.bottom <= r.bottom + 1; };
      const map = document.querySelector(".wp-map").getBoundingClientRect(), strip = document.querySelector(".wp-hours");
      return { hourly: inside(".wp-hourly"), alerts: inside(".wp-alerts"), map: inside(".wp-map"), mapW: Math.round(map.width), mapH: Math.round(map.height), scrolls: strip.scrollWidth > strip.clientWidth, pageScroll: document.documentElement.scrollWidth > innerWidth };
    });
    ok(`${name}: hourly strip, alerts and map fit; the map is big enough; the strip scrolls sideways`, fit.hourly && fit.alerts && fit.map && fit.mapW >= 250 && fit.mapH >= 150 && fit.scrolls && !fit.pageScroll, fit);
    await h.shot(`weather-${name}`);
  }
  await page.setViewportSize({ width: 1920, height: 1080 }); await h.sleep(1000);
  const f = Object.entries(R).filter(([, v]) => !v).map(([k]) => k);
  h.log(`SUMMARY: ${f.length ? "FAILED: " + f.join("; ") : "ALL CHECKS PASSED"} (${Object.keys(R).length} checks)`);
};
module.exports.patchSettings = (s) => {
  s.weather = { provider: "open-meteo" };
  if (!s.pages.includes("weather")) s.pages.splice(Math.min(2, s.pages.length), 0, "weather");
};
module.exports.env = {
  OPENSKY_WEATHER_URL: `http://127.0.0.1:${PORT}`, OPENSKY_NWS_URL: `http://127.0.0.1:${PORT}`, OPENSKY_RADAR_URL: `http://127.0.0.1:${PORT}`,
  OPENSKY_RADAR_BASE: `http://127.0.0.1:${PORT}/base/{z}/{x}/{y}.png`
};
