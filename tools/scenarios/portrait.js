// Portrait (a 1080×1920 monitor): the sidebar is a bar along the bottom, Home is one column — Today card, one row per
// other day (at most 3 chips + "+N more"), Lists + Next Week side by side, a photo strip — and nothing overflows.
// The clock is pinned like in home-today.js so the result doesn't depend on when the test runs.
module.exports = async (page, h) => {
  const R = {}; const ok = (k, v, i) => { R[k] = v; h.log(`${v ? "PASS" : "FAIL"}  ${k}${i !== undefined ? "  — " + JSON.stringify(i) : ""}`); };
  const e = (title, cal, s, en) => ({ title, cal, s, e: en });
  const BASE = [e("OT", "Kids", 600, 660), e("Swim lessons", "Mom", 780, 840), e("Soccer practice", "Kids", 990, 1050), e("Family dinner", "Family", 1110, 1170)];
  const BUSY = [...BASE, e("Piano", "Kids", 930, 960), e("Call with Grandma", "Family", 1200, 1230), e("Book club", "Mom", 1230, 1320)];
  const set = (min, evs, extraDays) => page.evaluate(({ min, evs, extraDays }) => {
    const t = new Date(), at = (m, d = 0) => new Date(t.getFullYear(), t.getMonth(), t.getDate() + d, 0, m).getTime();
    const home = MM.getModules().withClass("MMM-OpenSky-Home")[0];
    home.nowMs = () => at(min); home.doneOpen = false; home.weekOffset = 0; home.pools.clear();
    const all = evs.map((x) => ({ title: x.title, calendarName: x.cal, fullDayEvent: false, startDate: String(at(x.s)), endDate: String(at(x.e)) }));
    for (let i = 0; i < extraDays; i++) all.push({ title: `Event ${i + 1}`, calendarName: "Family", fullDayEvent: false, startDate: String(at(540 + i * 60, 2)), endDate: String(at(580 + i * 60, 2)) });   // 2 days ahead: busy
    home.notificationReceived("CALENDAR_EVENTS", all, { identifier: "test_calendar" });
  }, { min, evs, extraDays });

  await page.setViewportSize({ width: 1080, height: 1920 }); await h.sleep(1500);
  await h.tap(".os-page-home"); await h.sleep(800);
  await page.evaluate(() => { const hm = MM.getModules().withClass("MMM-OpenSky-Home")[0]; hm.photoPending = 0; hm.nextPhoto(); }); await h.sleep(2500);   // a photo fetched for this shape
  await set(8 * 60, BUSY, 6); await h.sleep(900);   // 08:00, a busy day, one day with 6 events
  const g = await page.evaluate(() => {
    const r = (sel) => { const x = document.querySelector(sel); return x ? x.getBoundingClientRect() : null; };
    const root = document.documentElement, z = Number(getComputedStyle(root).getPropertyValue("--os-zoom"));
    const nav = r(".os-side-wrap"), tiles = [...document.querySelectorAll(".os-side-col > .os-tile")].map((t) => t.getBoundingClientRect());
    const rows = [...document.querySelectorAll(".hd-week > .hd-day")];
    const today = r(".hd-today-slot > .hd-day"), cal = r(".hd-calendar"), lists = r(".hd-lists"), nw = r(".hd-nw-slot > .hd-nextweek"), photo = r(".hd-photo"), hr = r(".hd-root");
    const overflow = [...document.querySelectorAll(".hd-day, .hd-card, .hd-photo")].filter((n) => n.scrollHeight > n.clientHeight + 2 && getComputedStyle(n).overflowY !== "auto").map((n) => `${n.className} ${n.scrollHeight}>${n.clientHeight} ${(n.querySelector(".hd-day-name") || {}).textContent || ""}`);
    return {
      layout: root.dataset.layout, orient: root.dataset.orient, zoom: z, W: innerWidth, H: innerHeight,
      nav: { top: nav.top, h: nav.height, w: nav.width, tileW: tiles.map((t) => Math.round(t.width)), n: tiles.length },
      todayIn: !!today, weekRows: rows.length, rowNames: rows.map((x) => x.querySelector(".hd-day-name").textContent), maxChips: Math.max(...rows.map((x) => x.querySelectorAll(".hd-day-events > .hd-event").length)),
      more: rows.some((x) => /^\+\d+ more$/.test((x.querySelector(".hd-day-events > .hd-more") || {}).textContent || "")),
      todayRows: document.querySelectorAll(".hd-today-slot .hd-day-events > .hd-event").length,
      todayTimeLeft: (() => { const t = document.querySelector(".hd-today-slot .hd-event .hd-event-time"), ev = document.querySelector(".hd-today-slot .hd-event"); return t && ev ? Math.round(t.getBoundingClientRect().left - ev.getBoundingClientRect().left) : null; })(),
      rel: (document.querySelector(".hd-today-slot .hd-event-rel") || {}).textContent || "",
      order: [today.bottom, cal.top, cal.bottom, lists.top, lists.bottom, photo.top, photo.bottom, nav.top].map((v) => Math.round(v)),
      listsNw: { listsTop: Math.round(lists.top), nwTop: Math.round(nw.top), listsW: Math.round(lists.width / z), sameBottom: Math.abs(lists.bottom - nw.bottom) < 2 },
      photoH: Math.round(photo.height / z), photoCells: document.querySelectorAll(".hd-photo .hd-ph-layer:last-of-type .hd-ph-cell").length,
      side: { left: Math.round(hr.left / z), right: Math.round((innerWidth - hr.right) / z) }, overflow
    };
  });
  ok("1080×1920 → portrait layout, scaled 1.00×", g.layout === "portrait" && g.orient === "portrait" && Math.abs(g.zoom - 1) < 0.01, { layout: g.layout, zoom: g.zoom });
  ok("2 the sidebar is a 112 px bar along the bottom, full width, items equally spaced", Math.abs(g.nav.top - (g.H - 112)) < 1 && g.nav.w >= g.W - 1 && g.nav.n >= 7 && Math.max(...g.nav.tileW) - Math.min(...g.nav.tileW) <= 1, g.nav);
  ok("3 Today has its own card; the week is one row per other day (6 rows)", g.todayIn && g.weekRows === 6 && g.rowNames[0] !== undefined, { rows: g.rowNames });
  ok("4 at most 3 chips per day, then '+N more'", g.maxChips <= 3 && g.more, { maxChips: g.maxChips, more: g.more });
  ok("5 Today: full-width rows with the time on the left; the next event has an 'in N min' badge", g.todayRows <= 3 && g.todayTimeLeft !== null && g.todayTimeLeft < 40 && /^in /.test(g.rel), { rows: g.todayRows, left: g.todayTimeLeft, rel: g.rel });
  ok("6 top to bottom: Today, week, lists + Next Week side by side (equal height), photo strip, nav — nothing overlaps or leaves the screen", g.order.every((v, i, a) => i === 0 || v >= a[i - 1] - 1) && g.listsNw.listsTop === g.listsNw.nwTop && g.listsNw.sameBottom && g.order[6] <= g.nav.top + 1, { order: g.order, listsNw: g.listsNw });
  ok("7 Lists are 560 px wide; 40 px at the sides", Math.abs(g.listsNw.listsW - 560) < 2 && g.side.left === 40 && g.side.right === 40, { w: g.listsNw.listsW, side: g.side });
  ok("8 the photo strip is 200 px tall while Today has upcoming events, two photos side by side", g.photoH === 200 && g.photoCells === 2, { h: g.photoH, cells: g.photoCells });
  ok("9 nothing is clipped inside the cards", g.overflow.length === 0, g.overflow);
  await h.shot("portrait-home-busy");

  await set(20 * 60 + 20, BASE, 0); await h.sleep(900);   // 20:20: everything is done, the last event ended 50 minutes ago
  const d = await page.evaluate(() => ({ photoH: Math.round(document.querySelector(".hd-photo").getBoundingClientRect().height), txt: document.querySelector(".hd-today-slot .hd-day-events").textContent.replace(/\s+/g, " ").trim(), chip: !!document.querySelector(".hd-today-slot .hd-done-chip") }));
  ok("10 all done: 'All done', the last event ('ended …'), a 'N done' pill, and the taller photo strip", /All done/.test(d.txt) && /ended/.test(d.txt) && d.chip && d.photoH === 250, d);
  await h.shot("portrait-home-done");

  for (const p of ["calendar", "lists", "timer", "wordgame"]) {
    await h.tap(`.os-page-${p}`); await h.sleep(1200);
    const f = await page.evaluate(() => { const els = [...document.querySelectorAll(".MMM-OpenSky-Calendar,.lp-root,.timer-wrapper,.wg-root,.CX3")].filter((n) => n.getBoundingClientRect().height); const nav = document.querySelector(".os-side-wrap").getBoundingClientRect().top; return { right: Math.max(...els.map((n) => n.getBoundingClientRect().right)), W: innerWidth, nav, keys: (() => { const k = document.querySelector(".wg-keys"); return k ? k.getBoundingClientRect().right : 0; })() }; });
    ok(`11 ${p}: fits the portrait screen`, f.right <= f.W + 1 && (!f.keys || f.keys <= f.W), f);
    await h.shot(`portrait-${p}`);
  }
  // other portrait screens (a 720×1280 monitor, a 3:4 tablet): the same layout, scaled to fit
  for (const [w, hh] of [[720, 1280], [768, 1024], [1200, 1920]]) {
    await page.setViewportSize({ width: w, height: hh }); await h.sleep(1500); await h.tap(".os-page-home"); await h.sleep(900);
    const q = await page.evaluate(() => { const r = (s) => document.querySelector(s).getBoundingClientRect(); const hr = r(".hd-root"), nav = r(".os-side-wrap"), photo = r(".hd-photo");
      return { layout: document.documentElement.dataset.layout, W: innerWidth, H: innerHeight, right: hr.right, photoBottom: photo.bottom, navTop: nav.top, navBottom: nav.bottom, top: hr.top, hb: document.querySelector(".hb-row").getBoundingClientRect().bottom }; });
    ok(`${w}×${hh}: portrait layout, Home fits above the bottom bar`, q.layout === "portrait" && q.right <= q.W + 1 && q.photoBottom <= q.navTop + 1 && q.navBottom <= q.H + 1 && q.top >= q.hb - 1, q);
    await h.shot(`portrait-${w}x${hh}`);
  }
  // back to landscape: the Today tile and Next Week are back in the grid
  await page.setViewportSize({ width: 1920, height: 1080 }); await h.sleep(1500); await h.tap(".os-page-home"); await h.sleep(800);
  const b = await page.evaluate(() => ({ layout: document.documentElement.dataset.layout, today: !!document.querySelector(".hd-week > .hd-is-today"), nw: !!document.querySelector(".hd-week > .hd-nextweek"), slots: document.querySelectorAll(".hd-today-slot > *, .hd-nw-slot > *").length }));
  const lc = await page.evaluate(() => { const c = document.querySelector(".hd-calendar").getBoundingClientRect(), r = document.querySelector(".hd-right").getBoundingClientRect(), l = document.querySelector(".hd-lists").getBoundingClientRect(); return { cal: [Math.round(c.left), Math.round(c.top), Math.round(c.width)], right: [Math.round(r.left), Math.round(r.top), Math.round(r.height)], listsH: Math.round(l.height) }; });
  ok("12 back to landscape: Today and Next Week are in the week grid again, calendar left, lists + photo right (the empty slots take no room)", b.layout === "full" && b.today && b.nw && b.slots === 0 && lc.cal[0] < lc.right[0] && lc.cal[1] === lc.right[1] && lc.right[2] > 800 && lc.listsH > 300, { b, lc });
  const f = Object.entries(R).filter(([, v]) => !v).map(([k]) => k);
  h.log(`SUMMARY: ${f.length ? "FAILED: " + f.join("; ") : "ALL CHECKS PASSED"} (${Object.keys(R).length} checks)`);
};
