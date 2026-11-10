// Weather page (Right now, Next 24 hours, Plan around it, This week, Radar inset + full-screen radar, the header's alerts pill) against a fake
// Open-Meteo / NWS / RainViewer / map tiles (tools/fixtures/fake-weather.js): everything shows, the week's highs are the header's shared forecast,
// text from outside stays text, a refresh does not redraw an unchanged part, the radar says so when the map can't load, each extra can be
// switched off, and it fits portrait and compact screens without sideways scrolling.
const PORT = 8098;
let fake = null;
require("../fixtures/fake-weather.js").create(PORT).then((f) => { fake = f; });

module.exports = async (page, h) => {
  const R = {}; const ok = (k, v, i) => { R[k] = v; h.log(`${v ? "PASS" : "FAIL"}  ${k}${i !== undefined ? "  — " + JSON.stringify(i) : ""}`); };
  const until = async (fn, tries = 80) => { for (let i = 0; i < tries && !(await fn()); i++) await h.sleep(250); return fn(); };
  const mod = (fn, arg) => page.evaluate(`(() => { const m = MM.getModules().withClass("MMM-OpenSky-WeatherPage")[0]; return (${fn.toString()})(m, ${JSON.stringify(arg === undefined ? null : arg)}); })()`);

  // the header's forecast (the same one the Home calendar shows): tomorrow and the days after, with known highs
  const daily = await page.evaluate(() => {
    const out = {}, hi = [55, 45, 40, 41, 43, 43, 44, 45], ids = [500, 804, 804, 804, 500, 500, 804, 800];
    for (let i = 0; i < 8; i++) { const d = new Date(); d.setDate(d.getDate() + i); out[`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`] = { high: hi[i], low: hi[i] - 8, id: ids[i] }; }
    return out;
  });
  const feed = () => page.evaluate((d) => MM.getModules().withClass("MMM-OpenSky-WeatherPage")[0].notificationReceived("OPENSKY_WEATHER", { current: { temp: 50, id: 800 }, daily: d, units: "imperial" }), daily);

  await h.tap(".os-page-weather"); await h.sleep(800);
  await feed();
  await until(() => page.evaluate(() => document.querySelectorAll(".wp-mark").length >= 2 && document.querySelectorAll(".wp-pcard").length >= 2));

  const hero = await page.evaluate(() => ({
    place: document.querySelector(".wp-hero-place").textContent, temp: document.querySelector(".wp-big").textContent, cond: document.querySelector(".wp-hero-cond").textContent,
    text: document.querySelector(".wp-hero-text").textContent, stats: [...document.querySelectorAll(".wp-stat")].map((s) => s.textContent), ico: !!document.querySelector(".wp-hero-ico svg"),
    size: getComputedStyle(document.querySelector(".wp-big")).fontSize
  }));
  ok("right now: the town, the temperature, a label, an icon and a generated sentence", hero.place === "Boston, MA · Now" && hero.temp === "50°" && /^Sunny/.test(hero.cond) && hero.ico && hero.text.length > 20, hero);
  ok("right now: feels like, wind and humidity from the forecast", hero.stats.length === 3 && /Feels like48°/.test(hero.stats[0]) && /Wind8 mph/.test(hero.stats[1]) && /Humidity62%/.test(hero.stats[2]), hero.stats);

  const day = await page.evaluate(() => ({
    sub: document.querySelector(".wp-sub").textContent, path: !!document.querySelector(".wp-line") && document.querySelector(".wp-line").getAttribute("d").length > 100,
    marks: [...document.querySelectorAll(".wp-mark-l")].map((e) => e.textContent), ticks: [...document.querySelectorAll(".wp-tick")].map((e) => e.textContent), rain: document.querySelector(".wp-rain-t").textContent,
    rainW: document.querySelector(".wp-rain-bar i").style.width, vector: document.querySelector(".wp-line").getAttribute("vector-effect"), hourTiles: document.querySelectorAll(".wp-hour").length
  }));
  ok("next 24 hours: a subtitle with the high and low, the curve, Now/High markers, a tick every 3 hours", /^High 73° at .* · Low 50° at /.test(day.sub) && day.path && day.marks[0] === "Now 50°" && day.marks.some((m) => m === "High 73°") && day.ticks.length === 8 && day.ticks[0] === "Now" && day.vector === "non-scaling-stroke", day);
  ok("next 24 hours: the rain strip says when; the old row of hour tiles is gone", /^Rain around /.test(day.rain) && day.hourTiles === 0 && parseInt(day.rainW) > 50, day.rain);

  const plan = await page.evaluate(() => [...document.querySelectorAll(".wp-pcard")].map((c) => ({ when: c.querySelector(".wp-pwhen").textContent, range: c.querySelector(".wp-prange").textContent, chip: c.querySelector(".wp-chip").className.replace("wp-chip ", ""), label: c.querySelector(".wp-chip").textContent })));
  const tm = plan[plan.length - 1];
  ok("plan around it: periods from the hours, Tomorrow last from the daily forecast with a rain jacket (70%)", plan.length >= 2 && plan.length <= 4 && tm.when === "Tomorrow" && tm.range === "37–45°" && tm.chip === "wp-chip-rain" && /^Now to /.test(plan[0].when), plan);

  const week = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".wp-day-row")];
    return {
      n: rows.length, his: rows.map((r) => r.querySelector(".wp-wk-hi").textContent), icons: rows.filter((r) => r.querySelector(".wp-wk-ico svg")).length, pills: rows.map((r) => r.querySelector(".wp-wk-rain").textContent),
      bar: rows.map((r) => { const i = r.querySelector(".wp-wk-bar i"); return [parseFloat(i.style.left), parseFloat(i.style.width)]; }), cols: getComputedStyle(rows[0]).gridTemplateColumns.split(" ").length
    };
  });
  const tomorrowKey = Object.keys(daily).sort()[1];
  ok("this week: six days after today, the highs are the header's shared forecast", week.n === 6 && JSON.stringify(week.his) === JSON.stringify(Object.keys(daily).sort().slice(1, 7).map((k) => `${daily[k].high}°`)) && week.icons === 6 && tomorrowKey, week.his);
  ok("this week: a rain pill only from 30% up; the bars share one scale", JSON.stringify(week.pills) === '["70%","","","60%","","50%"]' && week.bar[0][0] + week.bar[0][1] > week.bar[2][0] + week.bar[2][1] && week.bar[2][0] < week.bar[0][0] && week.cols === 7, [week.pills, week.bar]);

  // the header's alerts pill: worst alert first, tap opens the text
  await until(() => page.evaluate(() => !!document.querySelector(".hb-alert")));
  const pill = await page.evaluate(() => { const p = document.querySelector(".hb-alert"); return { text: p.textContent.trim(), cls: p.className, tag: p.tagName, h: Math.round(p.getBoundingClientRect().height) }; });
  ok("alerts: the header shows the worst alert, red for a warning, tall enough to tap", pill.text === "Tornado Warning +1" && /hb-alert-hot/.test(pill.cls) && pill.tag === "BUTTON" && pill.h >= 44, pill);
  await h.tap(".os-page-home"); await h.sleep(600);
  await h.tap(".hb-alert"); await h.sleep(1200);
  const modal = await page.evaluate(() => ({
    open: !document.querySelector(".wp-modal").hidden, events: [...document.querySelectorAll(".wp-alert-event")].map((e) => e.textContent), injected: !!document.querySelector(".wp-alert-head b"),
    head: [...document.querySelectorAll(".wp-alert-head")].map((e) => e.textContent), text: document.querySelector(".wp-alert-list").textContent, weatherShown: getComputedStyle(document.querySelector(".wp-root")).opacity !== "0"
  }));
  ok("alerts: tapping the pill opens the Weather page with every alert's text; HTML from the service stays text", modal.open && modal.events.join() === "Tornado Warning,Flood Watch" && !modal.injected && modal.head.some((t) => t.includes("<b>x</b>")) && /Stay away from rivers/.test(modal.text), modal);
  await h.tap(".wp-modal-x"); await h.sleep(300);
  ok("alerts: Close closes it", await page.evaluate(() => document.querySelector(".wp-modal").hidden));
  ok("the old alerts box is gone", await page.evaluate(() => !document.querySelector(".wp-alerts")));

  // radar inset -> full screen -> back
  await until(() => page.evaluate(() => document.querySelectorAll(".wp-base img").length > 0 && !!document.querySelector(".wp-stamp").textContent));
  await h.sleep(1500);
  const rd = await page.evaluate(() => ({
    base: document.querySelectorAll(".wp-base img").length, baseLoaded: [...document.querySelectorAll(".wp-base img")].filter((i) => i.naturalWidth > 0).length,
    frames: document.querySelectorAll(".wp-frame").length, on: document.querySelectorAll(".wp-frame.on").length, stamp: document.querySelector(".wp-stamp").textContent,
    msgHidden: document.querySelector(".wp-map-msg").hidden, map: document.querySelector(".wp-map").getBoundingClientRect().height, status: document.querySelector(".wp-radar-status").textContent,
    inset: !!document.querySelector(".wp-slot .wp-map"), full: document.querySelector(".wp-full").hidden
  }));
  ok("radar inset: map tiles, 6 radar frames, a time stamp, a one-line status, no error", rd.base > 0 && rd.baseLoaded === rd.base && rd.frames === 6 && rd.on === 1 && rd.stamp && rd.msgHidden && rd.map > 120 && /rain nearby/i.test(rd.status) && rd.inset && rd.full, rd);
  await h.shot("weather-landscape");
  await h.tap(".wp-open-full"); await h.sleep(1500);
  const full = await page.evaluate(() => {
    const b = (s) => { const r = document.querySelector(s).getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; };
    return { open: !document.querySelector(".wp-full").hidden, inStage: !!document.querySelector(".wp-stage .wp-map"), back: b(".wp-back"), zin: b(".wp-zin"), play: b(".wp-play"), map: b(".wp-map"), dry: document.querySelector(".wp-dry").textContent, title: document.querySelector(".wp-full-title").textContent,
      range: document.querySelector(".wp-range").max, legend: !!document.querySelector(".wp-legend"), t0: document.querySelector(".wp-t0").textContent.length > 0, label: document.querySelector(".wp-play").getAttribute("aria-label") };
  });
  ok("full radar: opens with a back button, title, a 'Dry near Boston' pill, zoom buttons, play/pause, scrubber and legend", full.open && full.inStage && full.back[1] >= 48 && full.zin[0] >= 48 && full.play[0] >= 48 && full.map[0] > 800 && /^Dry near Boston for the next/.test(full.dry) && full.range === "5" && full.legend && full.t0 && full.title === "Rain radar", full);
  const s1 = await page.evaluate(() => document.querySelector(".wp-stamp-full").textContent);
  await until(() => page.evaluate((s) => document.querySelector(".wp-stamp-full").textContent !== s, s1), 16);
  ok("full radar: the frames play", await page.evaluate((s) => document.querySelector(".wp-stamp-full").textContent !== s, s1));
  await h.shot("weather-radar-full");
  await h.tap(".wp-play");
  const paused = await page.evaluate(() => document.querySelector(".wp-stamp-full").textContent);
  await h.sleep(1800);
  ok("full radar: Pause stops the animation (and says Play)", await page.evaluate((s) => document.querySelector(".wp-stamp-full").textContent === s && /Play/.test(document.querySelector(".wp-play").getAttribute("aria-label")), paused));
  await page.evaluate(() => { const r = document.querySelector(".wp-range"); r.value = "0"; r.dispatchEvent(new Event("input", { bubbles: true })); });
  ok("full radar: the scrubber picks a frame", await page.evaluate(() => document.querySelectorAll(".wp-frame.on").length === 1 && document.querySelector(".wp-frame.on") === document.querySelectorAll(".wp-frame")[0]));
  await h.tap(".wp-play");
  await h.tap(".wp-zin"); await h.sleep(800);
  ok("full radar: zoom in rebuilds the map (stops at the closest level)", await page.evaluate(() => document.querySelector(".wp-zin").disabled && document.querySelectorAll(".wp-base img").length > 0 && document.querySelector(".wp-map-msg").hidden));
  // no internet: the map pictures fail to load -> a friendly message, nothing blank
  fake.state.up = false;
  await h.tap(".wp-zout");
  await until(() => page.evaluate(() => !document.querySelector(".wp-map-msg").hidden), 60);
  const off = await page.evaluate(() => document.querySelector(".wp-map-msg").textContent);
  ok("map can't load: says so in plain words", /radar map can't be reached/.test(off) && /internet/.test(off), off);
  fake.state.up = true;
  await h.tap(".wp-zin");
  await until(() => page.evaluate(() => document.querySelector(".wp-map-msg").hidden), 40);
  ok("…and it clears once the pictures load again", await page.evaluate(() => document.querySelector(".wp-map-msg").hidden));
  await h.tap(".wp-back"); await h.sleep(1200);
  ok("back returns to the Weather page with the map in its inset", await page.evaluate(() => document.querySelector(".wp-full").hidden && !!document.querySelector(".wp-slot .wp-map") && document.querySelectorAll(".wp-base img").length > 0));

  // a refresh with the same data must not redraw (no jumping)
  const before = await page.evaluate(() => { window.__pc = document.querySelector(".wp-pcard"); window.__row = document.querySelector(".wp-day-row"); window.__mark = document.querySelector(".wp-mark"); return true; });
  await mod((m) => { m.socketNotificationReceived("OS_WX_DATA", { hourly: JSON.parse(JSON.stringify(m.state.hourly)), alerts: JSON.parse(JSON.stringify(m.state.alerts)) }); });
  ok("a refresh with unchanged data redraws nothing", before && await page.evaluate(() => window.__pc === document.querySelector(".wp-pcard") && window.__row === document.querySelector(".wp-day-row") && window.__mark === document.querySelector(".wp-mark")));

  // the services fail later: the last good data stays, with a note; a first failure says what happened
  await mod((m) => m.socketNotificationReceived("OS_WX_DATA", { hourly: { ok: false, error: "HTTP 503" }, alerts: { ok: false, error: "HTTP 503" }, radar: { ok: false, error: "HTTP 503" } }));
  const stale = await page.evaluate(() => ({ marks: document.querySelectorAll(".wp-mark").length, note: document.querySelector(".wp-day .wp-note").textContent, hidden: document.querySelector(".wp-day .wp-note").hidden, pills: !!document.querySelector(".hb-alert") }));
  ok("a later failure keeps the last forecast, with a note", stale.marks >= 2 && /last forecast/.test(stale.note) && !stale.hidden, stale);
  await mod((m) => { m.state = {}; m.sig = {}; m.socketNotificationReceived("OS_WX_DATA", { hourly: { ok: false, error: "HTTP 503" }, alerts: { ok: false, error: "HTTP 503" }, radar: { ok: false, error: "HTTP 503" } }); });
  const first = await page.evaluate(() => ({ h: document.querySelector(".wp-day .wp-note").textContent, r: document.querySelector(".wp-map-msg").textContent, week: document.querySelectorAll(".wp-day-row").length }));
  ok("a first failure: the forecast and radar say they can't load; the week still shows (header forecast)", /hourly forecast can't be loaded/.test(first.h) && /radar can't be loaded/.test(first.r) && first.week === 6, first);

  // alerts: none = a calm green pill; outside the US = no pill at all
  await mod((m) => m.socketNotificationReceived("OS_WX_DATA", { alerts: { ok: true, supported: true, alerts: [] } }));
  await until(() => page.evaluate(() => /No weather alerts/.test(document.querySelector(".hb-alert")?.textContent || "")));
  ok("no alerts: a green 'No weather alerts' pill", await page.evaluate(() => { const p = document.querySelector(".hb-alert"); return /No weather alerts/.test(p.textContent) && /hb-alert-none/.test(p.className); }));
  await mod((m) => m.socketNotificationReceived("OS_WX_DATA", { alerts: { ok: true, supported: false, alerts: [] } }));
  await until(() => page.evaluate(() => !document.querySelector(".hb-alert")));
  ok("outside the US: no pill (nothing to say)", await page.evaluate(() => !document.querySelector(".hb-alert")));
  await mod((m) => { m.state = {}; m.sig = {}; m.sentAlerts = null; m.render(); });
  await page.evaluate(() => MM.getModules().withClass("MMM-OpenSky-WeatherPage")[0].sendSocketNotification("OS_WX_INIT", MM.getModules().withClass("MMM-OpenSky-WeatherPage")[0].config));
  await until(() => page.evaluate(() => document.querySelectorAll(".wp-mark").length >= 2 && document.querySelectorAll(".wp-frame.on").length === 1 && !!document.querySelector(".hb-alert-hot")));

  // each extra can be switched off
  await mod((m) => { m.config.radar = false; m.render(); });
  ok("radar off: no radar card, the week takes the width", await page.evaluate(() => document.querySelector(".wp-radar").hidden && document.querySelector(".wp-week").getBoundingClientRect().width > document.querySelector(".wp-main").getBoundingClientRect().width * 0.9));
  await mod((m) => { m.config.radar = true; m.config.hourly = false; m.render(); });
  ok("hourly off: no 24-hour card and no plan row, the hero and the week stay", await page.evaluate(() => document.querySelector(".wp-day").hidden && document.querySelector(".wp-plan").hidden && !document.querySelector(".wp-hero").hidden && document.querySelectorAll(".wp-day-row").length === 6));
  await mod((m) => { m.config.hourly = true; m.sig = {}; m.render(); });

  // portrait, compact and a narrow tablet: nothing scrolls sideways, every card is inside the page
  for (const [w, hh, name] of [[1080, 1920, "portrait"], [1280, 720, "compact"], [820, 1180, "tablet"]]) {
    await page.setViewportSize({ width: w, height: hh }); await h.sleep(2000);
    await h.tap(".os-page-home"); await h.sleep(500); await h.tap(".os-page-weather"); await h.sleep(1500);
    const fit = await page.evaluate(() => {
      const root = document.querySelector(".wp-root"), r = root.getBoundingClientRect();
      const wide = (s) => { const e = document.querySelector(s); if (!e || e.hidden) return true; const b = e.getBoundingClientRect(); return b.left >= r.left - 1 && b.right <= r.right + 1; };
      const map = document.querySelector(".wp-map").getBoundingClientRect(), rows = [...document.querySelectorAll(".wp-day-row")];
      return { sideways: root.scrollWidth > root.clientWidth + 1, page: document.documentElement.scrollWidth > innerWidth, cards: [".wp-hero", ".wp-day", ".wp-plans", ".wp-week", ".wp-radar"].every(wide), mapW: Math.round(map.width), mapH: Math.round(map.height), rowsFit: rows.every((x) => x.scrollWidth <= x.clientWidth + 1), scrolls: root.scrollHeight > root.clientHeight };
    });
    ok(`${name}: no sideways scrolling, every card inside, the week rows fit, the map is usable`, !fit.sideways && !fit.page && fit.cards && fit.rowsFit && fit.mapW >= 250 && fit.mapH >= 150, fit);
    await h.shot(`weather-${name}`);
    await page.evaluate(() => document.querySelector(".wp-open-full").scrollIntoView({ block: "center" })); await h.sleep(400);
    await h.tap(".wp-open-full"); await h.sleep(1200);
    ok(`${name}: the full radar fits the screen`, await page.evaluate(() => { const f = document.querySelector(".wp-full").getBoundingClientRect(), m = document.querySelector(".wp-map").getBoundingClientRect(); return m.width > f.width * 0.8 && m.height > 300 && f.right <= innerWidth + 1; }));
    await h.tap(".wp-back"); await h.sleep(500);
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
