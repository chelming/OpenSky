// Home page, today's tile: "what's left" (live → upcoming, one just-ended row, the rest folded into "N done").
// The clock is pinned (home.nowMs) and the events are ours (the fixture calendar's are dropped), so the result
// doesn't depend on when the test runs. Ranking itself is unit-tested in tools/test-day-agenda.js; this checks the wiring.
module.exports = async (page, h) => {
  const R = {}; const ok = (k, v, i) => { R[k] = v; h.log(`${v ? "PASS" : "FAIL"}  ${k}${i !== undefined ? "  — " + JSON.stringify(i) : ""}`); };

  // minutes after midnight, like the design prototype
  const DAD = { title: "Dad - no school", cal: "Dad", allDay: true };
  const e = (title, cal, s, en) => ({ title, cal, s, e: en });
  const BASE = [DAD, e("OT", "Kids", 600, 660), e("PT", "Kids", 690, 750), e("Swim lessons", "Mom", 780, 840), e("Soccer practice", "Kids", 990, 1050), e("Family dinner", "Family", 1110, 1170)];
  const BUSY = [...BASE, e("Piano", "Kids", 930, 960), e("Call with Grandma", "Family", 1200, 1230), e("Book club", "Mom", 1230, 1320)];

  // pin the clock to <min> minutes after midnight and play a calendar with <evs>
  const set = (min, evs) => page.evaluate(({ min, evs }) => {
    const t = new Date(), at = (m) => new Date(t.getFullYear(), t.getMonth(), t.getDate(), 0, m).getTime();
    const home = MM.getModules().withClass("MMM-OpenSky-Home")[0];
    home.nowMs = () => at(min);
    home.doneOpen = false; home.weekOffset = 0;
    home.pools.clear();
    home.notificationReceived("CALENDAR_EVENTS", evs.map((x) => ({
      title: x.title, calendarName: x.cal, fullDayEvent: !!x.allDay,
      startDate: String(x.allDay ? at(0) : at(x.s)), endDate: String(x.allDay ? at(1440) : at(x.e))
    })), { identifier: "test_calendar" });
  }, { min, evs });

  const today = () => page.evaluate(() => {
    const tile = document.querySelector(".hd-week .hd-day.hd-is-today");
    const txt = (el, s) => { const x = el.querySelector(s); return x ? x.textContent.trim() : ""; };
    const kids = [...tile.querySelector(".hd-day-events").children];
    const inner = tile.getBoundingClientRect().bottom - parseFloat(getComputedStyle(tile).paddingBottom);
    const last = kids[kids.length - 1];
    return {
      counter: tile.querySelector(".hd-day-count > span").textContent,
      rows: kids.map((k) => ({
        cls: k.className.replace(/\bhd-event\b|\bmf-two\b/g, "").trim(), title: txt(k, ".hd-event-title"), rel: txt(k, ".hd-event-rel"), time: txt(k, ".hd-event-time"),
        now: !!k.querySelector(".hd-now"), bar: k.querySelector(".hd-progress > i") ? k.querySelector(".hd-progress > i").style.width : null, text: k.textContent.trim().replace(/\s+/g, " ")
      })),
      fits: !last || last.getBoundingClientRect().bottom <= inner + 0.5,
      scrolls: tile.classList.contains("hd-done-open")
    };
  });
  const fitsAll = () => page.evaluate(() => [...document.querySelectorAll(".hd-week .hd-day:not(.hd-nextweek)")].every((tile) => {
    const last = tile.querySelector(".hd-day-events").lastElementChild;
    return !last || last.getBoundingClientRect().bottom <= tile.getBoundingClientRect().bottom - parseFloat(getComputedStyle(tile).paddingBottom) + 0.5;
  }));
  const pills = (r, cls) => r.rows.filter((x) => x.cls.split(/\s+/).includes(cls));
  const titles = (r) => r.rows.map((x) => x.title);
  const dayClicks = () => page.evaluate(() => window.__dayClicks);

  await page.evaluate(() => {
    window.__dayClicks = 0;
    const home = MM.getModules().withClass("MMM-OpenSky-Home")[0], orig = home.sendNotification.bind(home);
    home.sendNotification = (n, p) => { if (n === "CALENDAR_DAY_CLICKED") window.__dayClicks++; return orig(n, p); };
  });

  // 1. 12:41 PM, ordinary day
  await set(761, BASE); await h.sleep(400);
  let r = await today();
  ok("12:41 PM: counter '3 left'", r.counter === "3 left", r.counter);
  // The real tile is short (a strip + 3 rows + chips fill it), so the recent row may have been dropped to fit: PT is then
  // folded into "2 done". Either is right; the unshrunk draw must have the recent row.
  ok("12:41 PM: PT is the recent row, or (tile too short) folded into the done chip", pills(r, "recent").length ? /1 done/.test(r.rows[r.rows.length - 1].text) : /2 done/.test(r.rows[r.rows.length - 1].text), r.rows.map((x) => x.cls + ":" + x.title));
  await page.evaluate(() => { const hm = MM.getModules().withClass("MMM-OpenSky-Home")[0]; hm.drawToday(hm.todayTile, hm.todayAgenda(hm.todayTile, 4)); });
  const full = await today();
  ok("12:41 PM (unshrunk): first row after the strip is the recent PT, 'ended 11 min ago', done chip '1 done'", pills(full, "recent").length === 1 && pills(full, "recent")[0].title === "PT" && /ended 11 min ago/.test(pills(full, "recent")[0].text) && /1 done/.test(full.rows[full.rows.length - 1].text), full.rows.map((x) => x.cls + ":" + x.text));
  await page.evaluate(() => { const hm = MM.getModules().withClass("MMM-OpenSky-Home")[0]; hm.renderToday(hm.todayTile); });
  ok("12:41 PM: Swim says 'in 19 min'", (r.rows.find((x) => x.title === "Swim lessons") || {}).rel === "in 19 min ·", r.rows.find((x) => x.title === "Swim lessons"));
  ok("12:41 PM: the done chip is last", r.rows[r.rows.length - 1].cls.includes("hd-done-chip"), r.rows[r.rows.length - 1]);
  ok("12:41 PM: the all-day event is a slim strip first", r.rows[0].cls.includes("hd-strip") && /Dad - no school/.test(r.rows[0].text), r.rows[0]);
  ok("12:41 PM: nothing is clipped, on any tile", r.fits && (await fitsAll()));
  await h.shot("home-today-1241");

  // 2. 1:45 PM, busy day
  await set(825, BUSY); await h.sleep(400);
  r = await today();
  const live = pills(r, "live");
  ok("1:45 PM: Swim is live with a NOW badge and a progress bar at 75 %", live.length === 1 && live[0].title === "Swim lessons" && live[0].now && live[0].bar === "75%" && /15 min left/.test(live[0].text), live);
  ok("1:45 PM: no recent row; the done chip says '2 done'", !pills(r, "recent").length && /2 done/.test(r.rows[r.rows.length - 1].text), r.rows.map((x) => x.cls));
  const more = r.rows.find((x) => x.cls.includes("hd-more") && !x.cls.includes("hd-done-chip"));
  const shown = r.rows.filter((x) => x.cls === "live" || x.cls === "" ).length;
  ok("1:45 PM: shown live/upcoming rows + '+N more' = the 6 that are left", r.counter === "6 left" && more && shown + Number(/\+(\d+)/.exec(more.text)[1]) === 6, [shown, more && more.text]);
  ok("1:45 PM: nothing is clipped", r.fits && (await fitsAll()));
  await h.shot("home-today-1345");

  // 3. the done chip expands and collapses without opening the day
  const clicks0 = await dayClicks();
  await h.tap(".hd-is-today .hd-done-chip"); await h.sleep(300);
  r = await today();
  ok("done chip: expanded (aria-expanded=true), OT and PT show as done rows",
    await page.evaluate(() => document.querySelector(".hd-is-today .hd-done-chip").getAttribute("aria-expanded") === "true") && same(pills(r, "done").map((x) => x.title), ["OT", "PT"]), pills(r, "done"));
  ok("done chip: the tile scrolls instead of clipping, and no day popup was asked for", r.scrolls && (await dayClicks()) === clicks0, [r.scrolls, await dayClicks(), clicks0]);
  await h.shot("home-today-done-open");
  await h.tap(".hd-is-today .hd-done-chip"); await h.sleep(300);
  r = await today();
  ok("done chip: tapping again collapses it", !pills(r, "done").length && (await dayClicks()) === clicks0, pills(r, "done"));
  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

  // an idle reset closes the list
  await h.tap(".hd-is-today .hd-done-chip"); await h.sleep(200);
  await page.evaluate(() => MM.getModules().withClass("MMM-OpenSky-Home")[0].notificationReceived("OPENSKY_IDLE_RESET"));
  await h.sleep(300);
  ok("idle reset: the done list closes again", !pills(await today(), "done").length);

  // the day popup (tap "+N more"): finished events faded, a "Now" line with the time between them and the rest
  await set(825, BUSY); await h.sleep(300);
  await page.evaluate(() => { const t = new Date(); MM.getModules().withClass("MMM-OpenSky-EventEditor")[0].nowMs = () => new Date(t.getFullYear(), t.getMonth(), t.getDate(), 13, 45).getTime(); });
  await h.tap(".hd-is-today .hd-more:not(.hd-done-chip)"); await h.sleep(500);
  const pop = await page.evaluate(() => [...document.querySelectorAll(".calendar-editor-modal .day-event-list > *")].map((el) => ({ now: el.classList.contains("day-now"), past: el.classList.contains("day-event-past"), text: el.textContent.trim().replace(/\s+/g, " ") })));
  const ni = pop.findIndex((x) => x.now);
  ok("day popup: 'Now 1:45 PM' sits after the finished OT and PT and before Swim", ni === 3 && /Now\s*1:45 PM/.test(pop[ni].text) && /Swim/.test(pop[ni + 1].text), pop);
  ok("day popup: only the finished events (OT, PT) are faded; the all-day, live and upcoming ones are not", pop.filter((x) => x.past).length === 2 && pop[1].past && pop[2].past && !pop[0].past && !pop.slice(ni).some((x) => x.past), pop.map((x) => x.past));
  await h.shot("home-today-popup");
  await page.evaluate(() => MM.getModules().withClass("MMM-OpenSky-EventEditor")[0].notificationReceived("OPENSKY_IDLE_RESET")); await h.sleep(300);

  // 4. 9 PM: everything is over
  await set(1260, BASE); await h.sleep(400);
  r = await today();
  ok("9 PM: counter 'All done', 'Nothing left today', and the done chip (5)", r.counter === "All done" && r.rows.some((x) => x.cls.includes("hd-empty") && /Nothing left today/.test(x.text)) && /5 done/.test(r.rows[r.rows.length - 1].text), r.rows.map((x) => x.cls + ":" + x.text));
  ok("9 PM: nothing is clipped", r.fits);
  await h.shot("home-today-2100");

  // 5. tomorrow's tile is unchanged: chronological pills, no live / recent / done, no "N left"
  await set(761, BASE.map((x) => x)); await h.sleep(200);
  await page.evaluate(() => {
    const t = new Date(), at = (dd, hh) => new Date(t.getFullYear(), t.getMonth(), t.getDate() + dd, hh).getTime();
    MM.getModules().withClass("MMM-OpenSky-Home")[0].notificationReceived("CALENDAR_EVENTS", [
      { title: "Later", calendarName: "Kids", startDate: String(at(1, 15)), endDate: String(at(1, 16)) },
      { title: "Earlier", calendarName: "Kids", startDate: String(at(1, 9)), endDate: String(at(1, 10)) }], { identifier: "test_calendar2" });
  });
  await h.sleep(300);
  const tom = await page.evaluate(() => { const t = document.querySelectorAll(".hd-week .hd-day:not(.hd-nextweek)")[1]; return { titles: [...t.querySelectorAll(".hd-event-title")].map((x) => x.textContent), odd: t.querySelectorAll(".live, .recent, .done, .hd-done-chip, .hd-now").length, counter: t.querySelector(".hd-day-count > span").textContent }; });
  ok("tomorrow: pills in start order, none of today's treatments", same(tom.titles, ["Earlier", "Later"]) && tom.odd === 0 && tom.counter === "2 events", tom);

  // 6. calendar identity without a border: dot color = the pill's --evc-bar, name = the calendar's, no left border
  const col = await page.evaluate(() => [...document.querySelectorAll(".hd-week .hd-day:not(.hd-nextweek) .hd-event")].map((p) => {
    const probe = document.createElement("i"); probe.style.background = p.style.getPropertyValue("--evc-bar"); document.body.appendChild(probe);
    const bar = getComputedStyle(probe).backgroundColor; probe.remove();
    const dot = p.querySelector(".hd-cal-dot"), name = p.querySelector(".hd-cal-name");
    return { bar, dot: dot && getComputedStyle(dot).backgroundColor, label: dot && dot.parentElement.getAttribute("aria-label"), name: name && name.textContent, border: getComputedStyle(p).borderLeftWidth };
  }));
  ok("pills: dot color is the --evc-bar color, aria-label = the name, no left border",
    col.length > 4 && col.every((c) => c.bar === c.dot && c.label && c.label === c.name && c.border === "0px"), col.filter((c) => !(c.bar === c.dot && c.label === c.name && c.border === "0px")));

  // 6b. events on several calendars: initial badges (not dot + name), the blended fill, the same letters everywhere
  const sh = await page.evaluate(() => {
    const hm = MM.getModules().withClass("MMM-OpenSky-Home")[0], EC = window.OpenSkyEventColors, t = new Date();
    hm.config.calendarPeople = ["Quinn", "Reese", "Ryan", "Sam", "Mom", "Dad"].map((name) => ({ name }));
    EC.calendars = { ...EC.calendars, Quinn: "blue", Reese: "pink", Ryan: "green", Sam: "purple", Mom: "orange", Dad: "teal" };
    const at = (hh) => new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1, hh).getTime();
    const probe = document.createElement("div");
    probe.style.cssText = "position:fixed;left:0;top:0;width:246px;z-index:99999;display:flex;flex-direction:column;gap:8px;background:#fff";
    document.body.appendChild(probe);
    const mk = (title, names, cls = "") => {
      const ev = hm.normalize({ title, calendarName: names[0], startDate: String(at(18)), endDate: String(at(19)) });
      ev.calendarNames = names; ev.colors = names.map((n) => EC.pair(EC.colorOf(EC.calendars[n]))[1]);
      const pill = hm.eventPill(ev, new Date(at(0)));
      if (cls) pill.classList.add(cls);
      probe.appendChild(pill);
      return pill;
    };
    const info = (pill) => {
      const b = [...pill.querySelectorAll(".hd-badge")], g = pill.querySelector(".hd-badges"), r = pill.getBoundingClientRect(), title = pill.querySelector(".hd-event-title").getBoundingClientRect();
      return {
        texts: b.map((x) => x.textContent), cal: !!pill.querySelector(".hd-cal"), role: g && g.getAttribute("role"), label: g && g.getAttribute("aria-label"),
        multi: /--evc-multi/.test(pill.getAttribute("style") || ""), bg: getComputedStyle(pill).backgroundImage.slice(0, 15),
        firstBorder: b[0] && getComputedStyle(b[0]).borderTopColor, inside: !!g && g.getBoundingClientRect().right <= r.right + 0.5 && g.getBoundingClientRect().left >= r.left,
        badgeTop: b[0] && b[0].getBoundingClientRect().top, titleTop: title.top, titleH: title.height, timeText: pill.querySelector(".hd-event-time").textContent
      };
    };
    const out = {
      two: info(mk("Roller derby", ["Reese", "Quinn"])),                            // given out of order: Quinn first on screen
      five: info(mk("Birthday party", ["Quinn", "Reese", "Sam", "Mom", "Ryan"])),
      pair: info(mk("Swim meet", ["Ryan", "Reese"])),
      long: info(mk("A very long title for the tournament that goes on and on and on forever", ["Quinn", "Reese"], "mf-two")),
      single: info(mk("Piano", ["Mom"]))
    };
    probe.remove();
    return out;
  });
  ok("shared event (Quinn + Reese): badges Q, Re, no dot + name, blended fill, settings order", sh.two.texts.join() === "Q,Re" && !sh.two.cal && sh.two.multi && /linear-gradient/.test(sh.two.bg), sh.two);
  ok("shared event: the first badge has its person's color (Quinn is blue)", sh.two.firstBorder === "rgb(46, 139, 214)", sh.two.firstBorder);
  ok("five people: 3 badges + '+2'", sh.five.texts.join() === "Q,Re,Ry,+2", sh.five.texts);
  ok("Reese / Ryan are told apart: Re, Ry (and in settings order)", sh.pair.texts.join() === "Re,Ry", sh.pair.texts);
  ok("badge group is role=img with the full names", sh.two.role === "img" && sh.two.label === "Quinn, Reese", [sh.two.role, sh.two.label]);
  ok("a long title wraps to two lines and the badges stay inside the pill, top right", sh.long.inside && sh.long.titleH > 30 && Math.abs(sh.long.badgeTop - sh.long.titleTop) <= 6, [sh.long.inside, sh.long.titleH, sh.long.badgeTop, sh.long.titleTop]);
  ok("one calendar: dot + name, no badges; the time line is only the time", sh.single.cal && !sh.single.texts.length && sh.single.timeText === "6 PM – 7 PM", sh.single);

  // 7. the clock ticks: a minute later Swim says 'in 18 min' and other tiles are not redrawn
  await set(761, BASE); await h.sleep(300);
  await page.evaluate(() => { document.querySelectorAll(".hd-week .hd-day").forEach((t, i) => { t.__mark = i; }); });
  await page.evaluate(() => { const home = MM.getModules().withClass("MMM-OpenSky-Home")[0], n = home.nowMs; home.nowMs = () => n() + 60000; home.tick(); });
  await h.sleep(200);
  const tk = await page.evaluate(() => ({ marks: [...document.querySelectorAll(".hd-week .hd-day")].map((t) => t.__mark), same: document.querySelector(".hd-is-today") && document.querySelector(".hd-is-today").__mark }));
  r = await today();
  ok("tick: Swim 'in 19 min' becomes 'in 18 min'", (r.rows.find((x) => x.title === "Swim lessons") || {}).rel === "in 18 min ·", r.rows.find((x) => x.title === "Swim lessons"));
  ok("tick: the tiles themselves were not rebuilt (only today's body)", tk.marks.every((m, i) => m === i), tk);
  // …and a tick with nothing new does not redraw anything
  const before = await page.evaluate(() => document.querySelector(".hd-is-today .hd-day-events").firstElementChild);
  await page.evaluate(() => { window.__first = document.querySelector(".hd-is-today .hd-day-events").firstElementChild; MM.getModules().withClass("MMM-OpenSky-Home")[0].tick(); });
  ok("tick: nothing changed → no redraw", await page.evaluate(() => window.__first === document.querySelector(".hd-is-today .hd-day-events").firstElementChild), before);

  const f = Object.entries(R).filter(([, v]) => !v).map(([k]) => k);
  h.log(`SUMMARY: ${f.length ? "FAILED: " + f.join("; ") : "ALL CHECKS PASSED"} (${Object.keys(R).length} checks)`);
};
