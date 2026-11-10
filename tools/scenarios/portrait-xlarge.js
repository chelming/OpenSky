// Portrait (1080x1920) with Extra large text: the page is only ~830x1480 design px, so Today (up to 3 rows) used to leave the week's
// day rows so little room that a busy week showed only "+N more" chips. In that combination Today now keeps two rows, and the week
// rows show real events. The clock is pinned like in portrait.js so the result doesn't depend on when the test runs.
module.exports = async (page, h) => {
  const R = {}; const ok = (k, v, i) => { R[k] = v; h.log(`${v ? "PASS" : "FAIL"}  ${k}${i !== undefined ? "  — " + JSON.stringify(i) : ""}`); };
  const e = (title, cal, s, en) => ({ title, cal, s, e: en });
  const BUSY = [e("OT", "Kids", 600, 660), e("Swim lessons", "Mom", 780, 840), e("Piano", "Kids", 930, 960), e("Soccer practice", "Kids", 990, 1050), e("Family dinner", "Family", 1110, 1170), e("Call with Grandma", "Family", 1200, 1230), e("Book club", "Mom", 1230, 1320)];
  const set = (min, evs, days) => page.evaluate(({ min, evs, days }) => {
    const t = new Date(), at = (m, d = 0) => new Date(t.getFullYear(), t.getMonth(), t.getDate() + d, 0, m).getTime();
    const home = MM.getModules().withClass("MMM-OpenSky-Home")[0];
    home.nowMs = () => at(min); home.doneOpen = false; home.weekOffset = 0; home.pools.clear();
    const all = evs.map((x) => ({ title: x.title, calendarName: x.cal, fullDayEvent: false, startDate: String(at(x.s)), endDate: String(at(x.e)) }));
    for (let d = 1; d <= days; d++) for (let i = 0; i < 2; i++) all.push({ title: `Day ${d} event ${i + 1}`, calendarName: i ? "Kids" : "Family", fullDayEvent: false, startDate: String(at(540 + i * 120, d)), endDate: String(at(600 + i * 120, d)) });   // two events on each other day
    home.notificationReceived("CALENDAR_EVENTS", all, { identifier: "test_calendar" });
  }, { min, evs, days });
  const read = () => page.evaluate(() => {
    const rows = [...document.querySelectorAll(".hd-week > .hd-day")];
    const chips = rows.map((r) => r.querySelectorAll(".hd-day-events > .hd-event").length);
    const only = rows.filter((r) => r.querySelector(".hd-more") && !r.querySelector(".hd-event")).length;   // rows that show nothing but "+N more"
    const hr = document.querySelector(".hd-root").getBoundingClientRect(), nav = document.querySelector(".os-side-wrap").getBoundingClientRect(), photo = document.querySelector(".hd-photo").getBoundingClientRect();
    return { layout: document.documentElement.dataset.layout, zoom: Number(getComputedStyle(document.documentElement).getPropertyValue("--os-zoom")), rows: rows.length, chips, onlyMore: only,
      todayRows: document.querySelectorAll(".hd-today-slot .hd-day-events > .hd-event").length, fits: photo.bottom <= nav.top + 1 && hr.right <= innerWidth + 1,
      weekRowH: Math.round(rows[0].getBoundingClientRect().height / (Number(getComputedStyle(document.documentElement).getPropertyValue("--os-zoom")) || 1)) };
  });

  await page.setViewportSize({ width: 1080, height: 1920 }); await h.sleep(1500);
  await h.tap(".os-page-home"); await h.sleep(800);
  await set(8 * 60, BUSY, 6); await h.sleep(900);
  const normal = await read();
  ok("Normal text: Today has 3 rows and the week rows show events", normal.layout === "portrait" && normal.todayRows === 3 && normal.onlyMore === 0 && normal.chips.every((c) => c >= 1), normal);

  await page.evaluate(() => MM.getModules().withClass("MMM-OpenSky-Sidebar")[0].setTextSize("xlarge")); await h.sleep(1500);
  await set(8 * 60, BUSY, 6); await h.sleep(900);
  const big = await read();
  ok("Extra large: still the portrait layout at 1.3x", big.layout === "portrait" && Math.abs(big.zoom - 1.3) < 0.01, big);
  ok("Extra large: Today keeps two rows (a busy day) to free room", big.todayRows <= 2, big);
  ok("Extra large: the week rows show their two events each (not one chip and \"+1 more\")", big.onlyMore === 0 && big.chips.every((c) => c >= 2), big);
  ok("Extra large: everything still fits above the bottom bar", big.fits, big);
  await h.shot("portrait-xlarge-busy");

  await page.evaluate(() => MM.getModules().withClass("MMM-OpenSky-Sidebar")[0].setTextSize("normal")); await h.sleep(1500);
  await set(8 * 60, BUSY, 6); await h.sleep(900);
  const back = await read();
  ok("back to Normal: Today has 3 rows again", back.todayRows === 3, back);

  const f = Object.entries(R).filter(([, v]) => !v).map(([k]) => k);
  h.log(`SUMMARY: ${f.length ? "FAILED: " + f.join("; ") : "ALL CHECKS PASSED"} (${Object.keys(R).length} checks)`);
};
