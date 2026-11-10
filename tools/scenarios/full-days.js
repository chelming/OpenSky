// Busy days (8–9 events each) on every screen shape and text size: a day shows as many events as fit, the rest become
// "+N more" (and the count is right), nothing is silently clipped, and tapping "+N more" opens the day.
module.exports = async (page, h) => {
  const R = {}; const ok = (k, v, i) => { R[k] = v; h.log(`${v ? "PASS" : "FAIL"}  ${k}${i !== undefined ? "  — " + JSON.stringify(i) : ""}`); };
  const N = 8;
  const seed = () => page.evaluate((N) => {
    const t = new Date(), at = (m, d = 0) => new Date(t.getFullYear(), t.getMonth(), t.getDate() + d, 0, m).getTime();
    const home = MM.getModules().withClass("MMM-OpenSky-Home")[0];
    home.nowMs = () => at(6 * 60); home.pools.clear();
    const evs = [];
    for (let d = 0; d < 14; d++) for (let i = 0; i < N; i++) evs.push({ title: `Day ${d} event ${i + 1} with a rather long title`, calendarName: ["Family", "Kids", "Mom"][i % 3], fullDayEvent: false, startDate: String(at(420 + i * 60, d)), endDate: String(at(450 + i * 60, d)) });
    home.notificationReceived("CALENDAR_EVENTS", evs, { identifier: "t" });
  }, N);
  for (const [w, hh, size] of [[1920, 1080, "normal"], [1920, 1080, "xlarge"], [1280, 720, "normal"], [1024, 600, "xlarge"], [800, 480, "xlarge"], [1080, 1920, "normal"], [1080, 1920, "xlarge"]]) {
    await page.setViewportSize({ width: w, height: hh }); await h.sleep(500);
    await page.evaluate((s) => MM.getModules().withClass("MMM-OpenSky-Sidebar")[0].setTextSize(s), size);
    await h.tap(".os-page-home"); await h.sleep(700);
    await seed(); await h.sleep(1200);
    const g = await page.evaluate((N) => {
      const tiles = [...document.querySelectorAll(".hd-day:not(.hd-nextweek)")];
      return tiles.map((tile) => {
        const list = tile.querySelector(".hd-day-events"), last = list.lastElementChild;
        const inner = tile.getBoundingClientRect().bottom - parseFloat(getComputedStyle(tile).paddingBottom);
        const pills = list.querySelectorAll(":scope > .hd-event:not(.recent):not(.done)").length, more = list.querySelector(":scope > .hd-more:not(.hd-done-chip)");
        return { day: tile.querySelector(".hd-day-name").textContent, fits: !last || last.getBoundingClientRect().bottom <= inner + 0.5, pills, more: more ? Number((more.textContent.match(/\d+/) || [])[0]) : 0, today: tile.classList.contains("hd-is-today"), scrolls: tile.classList.contains("hd-done-open") };
      });
    }, N);
    const bad = g.filter((t) => !t.fits || (!t.today && t.pills + t.more !== N) || (t.today && t.more && t.pills + t.more > N + 0));
    ok(`${w}×${hh} ${size}: ${g.length} busy days, nothing clipped, shown + "+N more" = ${N} events`, g.length >= 7 && bad.length === 0, bad.length ? bad : g.map((t) => `${t.day}:${t.pills}+${t.more}`).join(" "));
    await h.shot(`full-days-${w}x${hh}-${size}`);
  }
  // tapping "+N more" opens that day
  await page.setViewportSize({ width: 1280, height: 720 }); await h.sleep(600);
  await page.evaluate(() => MM.getModules().withClass("MMM-OpenSky-Sidebar")[0].setTextSize("normal")); await h.tap(".os-page-home"); await h.sleep(600); await seed(); await h.sleep(1000);
  await page.evaluate(() => { const hm = MM.getModules().withClass("MMM-OpenSky-Home")[0]; window.__sent = []; const o = hm.sendNotification.bind(hm); hm.sendNotification = (n, p) => { window.__sent.push(n); return o(n, p); }; });
  await h.tap(".hd-week > .hd-day:not(.hd-is-today) .hd-more"); await h.sleep(500);
  const sent = await page.evaluate(() => window.__sent);
  ok('tapping "+N more" opens the day', sent.includes("CALENDAR_DAY_CLICKED"), sent);
  await page.evaluate(() => { document.querySelector(".event-close-btn")?.click(); });
  await page.evaluate(() => MM.getModules().withClass("MMM-OpenSky-Sidebar")[0].setTextSize("normal"));
  await page.setViewportSize({ width: 1920, height: 1080 });
  const f = Object.entries(R).filter(([, v]) => !v).map(([k]) => k);
  h.log(`SUMMARY: ${f.length ? "FAILED: " + f.join("; ") : "ALL CHECKS PASSED"} (${Object.keys(R).length} checks)`);
};
