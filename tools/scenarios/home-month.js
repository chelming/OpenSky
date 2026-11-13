// Home's calendar card: Week | Month. Month is a grid of the month inside Home (no page change): the arrows move by month, Today
// comes back, a day / an event opens the same popups as the week, a busy day says "+N more", and nothing overflows its cell
// (landscape, portrait). Idle puts it back to the week. The events are injected relative to today, so the date doesn't matter.
module.exports = async (page, h) => {
  const R = {}; const ok = (k, v, i) => { R[k] = v; h.log(`${v ? "PASS" : "FAIL"}  ${k}${i !== undefined ? "  — " + JSON.stringify(i) : ""}`); };
  const home = (fn, arg) => page.evaluate(`(() => { const m = MM.getModules().withClass("MMM-OpenSky-Home")[0]; return (${fn})(m, ${JSON.stringify(arg === undefined ? null : arg)}); })()`);
  const label = () => page.evaluate(() => document.querySelector(".hd-week-range").textContent);
  const cells = () => page.evaluate(() => document.querySelectorAll(".hd-m-day").length);
  const overflow = () => page.evaluate(() => [...document.querySelectorAll(".hd-m-day")].filter((c) => { const r = c.getBoundingClientRect(), l = c.querySelector(".hd-m-events").lastElementChild; return l && l.getBoundingClientRect().bottom > r.bottom + 1; }).length);

  await h.sleep(1500);
  await h.tap(".os-page-home"); await h.sleep(600);
  // events: 2 tomorrow, 9 three days on (a busy day), one all-day today
  await home((m) => {
    const t = new Date(), at = (d, min) => new Date(t.getFullYear(), t.getMonth(), t.getDate() + d, 0, min).getTime();
    const ev = (title, d, s, e, allDay) => ({ title, calendarName: "Family", fullDayEvent: !!allDay, startDate: String(at(d, s)), endDate: String(at(d, e)) });
    const list = [ev("Tomorrow A", 1, 540, 600), ev("Tomorrow B", 1, 900, 960), ev("All day today", 0, 0, 1440, true)];
    for (let i = 0; i < 9; i++) list.push(ev(`Busy ${i + 1}`, 3, 480 + i * 30, 500 + i * 30));
    m.notificationReceived("CALENDAR_EVENTS", list, { identifier: "test_calendar" });
  });
  await h.sleep(600);

  ok("the card starts on Week, with a Week | Month toggle", await page.evaluate(() => document.querySelector(".hd-seg-week").classList.contains("on") && !document.querySelector(".hd-seg-month").classList.contains("on") && !document.querySelector(".hd-week").hidden));
  const weekLabel = await label();

  await h.tap(".hd-seg-month"); await h.sleep(600);
  const n = await cells();
  ok("Month shows a grid of whole weeks (4 to 6) and hides the week", n % 7 === 0 && n / 7 >= 4 && n / 7 <= 6 && await page.evaluate(() => document.querySelector(".hd-week").hidden && !document.querySelector(".hd-month").hidden), n);
  ok("seven weekday names; the title is the month and year", await page.evaluate(() => document.querySelectorAll(".hd-m-dow span").length === 7) && /\d{4}/.test(await label()) && (await label()) !== weekLabel, await label());
  ok("today is marked, once", await page.evaluate(() => document.querySelectorAll(".hd-m-today").length === 1));
  ok("events show as chips in their day", await page.evaluate(() => /Tomorrow A/.test(document.body.innerText) || document.querySelectorAll(".hd-m-chip").length > 0));
  ok("nothing spills out of its cell", (await overflow()) === 0, await overflow());
  await h.shot("home-month-tab");

  // the busy day says how many more
  ok("a busy day shows '+N more' instead of clipping", await page.evaluate(() => [...document.querySelectorAll(".hd-m-more")].some((b) => /\+\d+ more|\d+ events/.test(b.textContent))));

  // taps
  await home((m) => { m._sent = []; m.sendNotification = (a, b) => { m._sent.push([a, b]); }; });   // (recorded, not forwarded: no popup opens over the card)
  await page.evaluate(() => [...document.querySelectorAll(".hd-m-chip")].find((c) => /Tomorrow A/.test(c.textContent))?.click());
  const evTap = await home((m) => m._sent.find((x) => x[0] === "CALENDAR_EVENT_CLICKED"));
  ok("tapping a chip opens that event", !!evTap && evTap[1].title === "Tomorrow A", evTap && evTap[1].title);
  await page.evaluate(() => document.querySelector(".hd-m-today").click());
  const dayTap = await home((m) => m._sent.find((x) => x[0] === "CALENDAR_DAY_CLICKED"));
  ok("tapping a day opens that day (with its events)", !!dayTap && Array.isArray(dayTap[1].events) && dayTap[1].events.some((e) => e.title === "All day today"), dayTap && dayTap[1].events.map((e) => e.title));

  // arrows and Today
  const thisMonth = await label();
  await h.tap(".hd-next"); await h.sleep(400);
  const next = await label();
  await h.tap(".hd-prev"); await h.tap(".hd-prev"); await h.sleep(400);
  const prev = await label();
  ok("the arrows move by month", next !== thisMonth && prev !== thisMonth && prev !== next, [prev, thisMonth, next]);
  await h.tap(".hd-today"); await h.sleep(400);
  ok("Today comes back to this month", (await label()) === thisMonth && await page.evaluate(() => document.querySelector(".hd-today").classList.contains("active")));

  // back to Week
  await h.tap(".hd-seg-week"); await h.sleep(500);
  ok("Week brings the week back", await page.evaluate(() => !document.querySelector(".hd-week").hidden && document.querySelectorAll(".hd-day").length >= 7 && document.querySelector(".hd-month").hidden && !document.querySelector(".hd-m-day")));

  // idle returns to Week
  await h.tap(".hd-seg-month"); await h.tap(".hd-next"); await h.sleep(300);
  await home((m) => m.notificationReceived("OPENSKY_IDLE_RESET"));
  await h.sleep(500);
  ok("the idle reset goes back to this week", await page.evaluate(() => document.querySelector(".hd-seg-week").classList.contains("on") && !document.querySelector(".hd-week").hidden));

  // portrait
  await page.setViewportSize({ width: 1080, height: 1920 }); await h.sleep(1500);
  await h.tap(".os-page-home"); await h.sleep(600);
  await h.tap(".hd-seg-month"); await h.sleep(700);
  const g = await page.evaluate(() => { const r = (s) => { const e = document.querySelector(s); return e && e.getBoundingClientRect(); }; const card = r(".hd-calendar"), seg = r(".hd-seg"), grid = r(".hd-m-grid"); return { card: [card.left, card.right, card.bottom], seg: [seg.left, seg.right], grid: [grid.left, grid.right, grid.bottom] }; });
  ok("portrait: the toggle and the grid stay inside the card", g.seg[0] >= g.card[0] && g.seg[1] <= g.card[1] + 1 && g.grid[0] >= g.card[0] && g.grid[1] <= g.card[1] + 1 && g.grid[2] <= g.card[2] + 1, g);
  ok("portrait: nothing spills out of its cell", (await overflow()) === 0, await overflow());
  await h.shot("home-month-tab-portrait");

  const f = Object.entries(R).filter(([, v]) => !v).map(([k]) => k);
  h.log(`SUMMARY: ${f.length ? "FAILED: " + f.join("; ") : "ALL CHECKS PASSED"} (${Object.keys(R).length} checks)`);
};
