// Screensaver: starts after the idle time, shows the clock / date / weather and "Up next" (today's rest, then tomorrow,
// "+N more"), a touch brings the dashboard back without pressing what is underneath, and it never starts while asleep.
module.exports = async (page, h) => {
  const R = {}; const ok = (k, v, i) => { R[k] = v; h.log(`${v ? "PASS" : "FAIL"}  ${k}${i !== undefined ? "  — " + JSON.stringify(i) : ""}`); };
  const shown = () => page.evaluate(() => { const r = document.querySelector(".ss-root"); return !!r && !r.hidden && r.classList.contains("on"); });
  await h.sleep(1500);
  ok("not showing while the screen is in use", !(await shown()));

  // pinned clock + events: 10:45; today: all-day, 11:00 (live later), 14:00, 15:00, 19:00; tomorrow 12:00
  await page.evaluate(() => {
    const t = new Date(), at = (dayOff, hh, mm = 0) => new Date(t.getFullYear(), t.getMonth(), t.getDate() + dayOff, hh, mm).getTime();
    const ss = MM.getModules().withClass("MMM-OpenSky-Screensaver")[0];
    ss.nowMs = () => at(0, 10, 45);
    const ev = (title, s, e, extra = {}) => ({ title, calendarName: "Kids", fullDayEvent: false, startDate: String(s), endDate: String(e), ...extra });
    ss.notificationReceived("CALENDAR_EVENTS", [
      ev("Science fair project due", at(0, 0), at(1, 0), { fullDayEvent: true }),
      ev("Dentist", at(0, 11), at(0, 11, 45)), ev("Pickup from rehearsal", at(0, 19), at(0, 20)),
      ev("Piano", at(0, 14), at(0, 15)), ev("Book club", at(0, 15), at(0, 16)),
      ev("Early dismissal", at(1, 12), at(1, 13))
    ], { identifier: "t" });
    ss.notificationReceived("OPENSKY_WEATHER", { current: { temp: 72.2, id: 800 }, daily: {} });
  });
  // idle long enough → starts by itself
  await page.evaluate(() => { const sb = MM.getModules().withClass("MMM-OpenSky-Sidebar")[0]; sb.lastActivity = Date.now() - 11 * 60 * 1000; MM.getModules().withClass("MMM-OpenSky-Screensaver")[0].checkIdle(); });
  await h.sleep(1500);
  ok("after the idle time the screensaver starts", await shown());
  const g = await page.evaluate(() => {
    const q = (s) => document.querySelector(`.ss-root ${s}`), all = (s) => [...document.querySelectorAll(`.ss-root ${s}`)].map((e) => e.textContent);
    return { clock: q(".ss-clock").textContent, date: q(".ss-date").textContent, wx: q(".ss-weather").textContent, titles: all(".ss-card-title"), subs: all(".ss-card-sub"), more: q(".ss-more")?.textContent, photo: !!document.querySelector(".ss-root .ss-img"), top: document.elementFromPoint(960, 540).closest(".ss-root") !== null };
  });
  ok("clock + weather", g.clock === "10:45" && g.wx.includes("72°") && /\d/.test(g.date), g);
  ok("Up next: all-day first, then what is next; three cards and “+N more”", g.titles.length === 3 && g.titles[0] === "Science fair project due" && g.subs[0] === "All day" && g.titles[1] === "Dentist" && /^\+3 more events today$/.test(g.more || ""), g);
  ok("covers the dashboard", g.top);
  ok("a photo is on screen", g.photo, g);
  await h.shot("screensaver");

  // a touch brings the dashboard back and doesn't press what is underneath (the Timer tile is at the left)
  const before = await page.evaluate(() => document.querySelector(".os-tile.active")?.dataset.key);
  const tile = await h.box(".os-page-timer");
  await page.mouse.click(tile.x + tile.width / 2, tile.y + tile.height / 2); await h.sleep(900);
  ok("a touch dismisses it", !(await shown()));
  ok("…without pressing the tile under it", (await page.evaluate(() => document.querySelector(".os-tile.active")?.dataset.key)) === before);
  ok("…and the idle clock restarted (doesn't come straight back)", await page.evaluate(() => { const ss = MM.getModules().withClass("MMM-OpenSky-Screensaver")[0]; ss.checkIdle(); return !ss.visible; }));

  // nothing left today → tomorrow fills in; no events at all → a friendly line
  await page.evaluate(() => { const ss = MM.getModules().withClass("MMM-OpenSky-Screensaver")[0], t = new Date(); ss.nowMs = () => new Date(t.getFullYear(), t.getMonth(), t.getDate(), 22, 0).getTime();
    const at = (d, hh) => new Date(t.getFullYear(), t.getMonth(), t.getDate() + d, hh).getTime();
    ss.pools.clear();   // only the one event tomorrow (the fixture calendars add their own)
    ss.notificationReceived("CALENDAR_EVENTS", [{ title: "Early dismissal", calendarName: "Kids", fullDayEvent: false, startDate: String(at(1, 12)), endDate: String(at(1, 13)) }], { identifier: "late" });
    ss.open(); });
  await h.sleep(800);
  const late = await page.evaluate(() => ({ t: [...document.querySelectorAll(".ss-card-title")].map((e) => e.textContent), s: [...document.querySelectorAll(".ss-card-sub")].map((e) => e.textContent) }));
  ok("evening: tomorrow's first event, marked Tomorrow", late.t.length === 1 && late.t[0] === "Early dismissal" && /^Tomorrow, 12pm$/.test(late.s[0]), late);
  await page.evaluate(() => { const ss = MM.getModules().withClass("MMM-OpenSky-Screensaver")[0]; ss.pools.clear(); ss.renderInfo(); });
  ok("no events → “Nothing else on the calendar today”", await page.evaluate(() => /Nothing else/.test(document.querySelector(".ss-card-empty")?.textContent || "")));
  await page.evaluate(() => MM.getModules().withClass("MMM-OpenSky-Screensaver")[0].close(true));

  // it never starts under the sleep cover, and going to sleep ends it
  await page.evaluate(() => { const sb = MM.getModules().withClass("MMM-OpenSky-Sidebar")[0]; sb.sleep(); });
  await h.sleep(500);
  await page.evaluate(() => { const sb = MM.getModules().withClass("MMM-OpenSky-Sidebar")[0]; sb.lastActivity = Date.now() - 20 * 60 * 1000; MM.getModules().withClass("MMM-OpenSky-Screensaver")[0].checkIdle(); });
  ok("not while the screen sleeps", !(await shown()));
  await page.mouse.click(960, 540); await h.sleep(900);

  // portrait
  await page.setViewportSize({ width: 1080, height: 1920 }); await h.sleep(800);
  await page.evaluate(() => { const ss = MM.getModules().withClass("MMM-OpenSky-Screensaver")[0]; ss.nowMs = () => Date.now(); ss.open(); });
  await h.sleep(1200); await h.shot("screensaver-portrait");
  const inside = await page.evaluate(() => { const i = document.querySelector(".ss-info").getBoundingClientRect(); return i.left >= 0 && i.right <= innerWidth + 1 && i.bottom <= innerHeight + 1; });
  ok("portrait: the text stays on screen", inside);
  await page.evaluate(() => MM.getModules().withClass("MMM-OpenSky-Screensaver")[0].close(true));
  await page.setViewportSize({ width: 1920, height: 1080 });

  const f = Object.entries(R).filter(([, v]) => !v).map(([k]) => k);
  h.log(`SUMMARY: ${f.length ? "FAILED: " + f.join("; ") : "ALL CHECKS PASSED"} (${Object.keys(R).length} checks)`);
};
