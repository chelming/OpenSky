// Event reminders: a chime and a banner shortly before an event starts. Due events only (not too early, not past),
// each once (also after a reload), only the chosen calendars, all-day events only when asked, nothing while the screen
// sleeps (it comes when it wakes), and the lead time set from the on-screen Settings.
module.exports = async (page, h) => {
  const R = {}; const ok = (k, v, i) => { R[k] = v; h.log(`${v ? "PASS" : "FAIL"}  ${k}${i !== undefined ? "  — " + JSON.stringify(i) : ""}`); };
  const fs = require("fs"), path = require("path");
  const S = () => JSON.parse(fs.readFileSync(path.join(__dirname, "..", "out", "opensky.test.json"), "utf8"));
  const until = async (fn, tries = 20) => { for (let i = 0; i < tries && !(await fn()); i++) await h.sleep(250); return fn(); };
  const banner = () => page.evaluate(() => { const b = document.querySelector(".rem-banner"); return b && !b.hidden ? { title: b.querySelector(".rem-title").textContent, sub: b.querySelector(".rem-sub").textContent } : null; });
  await h.sleep(1500);

  const cfg = await page.evaluate(() => { const r = MM.getModules().withClass("MMM-OpenSky-Reminders")[0]; return r && { minutes: r.config.minutes, chime: r.config.chime, banner: r.config.banner, allDay: r.config.allDay, calendars: r.config.calendars }; });
  ok("the reminders module is on, with the settings from opensky.json (people -> their calendars)", cfg && cfg.minutes === 10 && cfg.chime === true && cfg.allDay === true && Array.isArray(cfg.calendars) && cfg.calendars.includes("Testers") && cfg.calendars.includes("Family"), cfg);

  // a pinned clock (today 10:00) and our own events; the chime is counted, not played
  await page.evaluate(() => {
    const r = MM.getModules().withClass("MMM-OpenSky-Reminders")[0], t = new Date();
    const at = (hh, mm = 0) => new Date(t.getFullYear(), t.getMonth(), t.getDate(), hh, mm).getTime();
    window.__chimes = 0; r.chime = () => { window.__chimes++; };
    r.nowMs = () => at(10, 0);
    r.reminded = {}; localStorage.removeItem(r.STORAGE_KEY);
    r.pools.clear();
    const ev = (title, s, e, cal, extra = {}) => ({ title, calendarName: cal, fullDayEvent: false, startDate: String(s), endDate: String(e), ...extra });
    r.notificationReceived("CALENDAR_EVENTS", [
      ev("Dentist", at(10, 8), at(10, 45), "Testers"),
      ev("Piano", at(10, 40), at(11, 0), "Testers"),          // too far ahead
      ev("Already started", at(9, 55), at(10, 30), "Testers"),
      ev("Other person's thing", at(10, 5), at(10, 30), "Elsewhere"),   // not one of the chosen calendars
      ev("Picnic", at(0, 0), at(23, 59) + 1, "Testers", { fullDayEvent: true })
    ], { identifier: "rem-test" });
  });
  await h.sleep(300);
  const b1 = await banner();
  ok("banner for the event about to start (and the all-day one: 2 events), one chime", b1 && /^Dentist and 1 more$/.test(b1.title) && (await page.evaluate(() => window.__chimes)) === 1, b1);
  ok("…saying when it starts", b1 && /^\d{1,2}(:\d\d)?[ap]m · in 8 minutes$/.test(b1.sub), b1);
  await h.shot("reminders");
  ok("not the far-off, the already started or the other calendar's event", await page.evaluate(() => { const r = MM.getModules().withClass("MMM-OpenSky-Reminders")[0]; return !Object.keys(r.reminded).some((k) => /Piano|Already|Other/.test(k)) && Object.keys(r.reminded).length === 2; }));

  // OK hides it; asking again (every 15 s) or a reload (state kept in localStorage) doesn't repeat it
  await page.evaluate(() => document.querySelector(".rem-ok").click()); await h.sleep(200);
  ok("OK hides the banner", !(await banner()));
  const again = await page.evaluate(() => { const r = MM.getModules().withClass("MMM-OpenSky-Reminders")[0]; r.check(); r.reminded = r.loadReminded(); r.check(); return window.__chimes; });
  ok("not repeated, also after a reload", again === 1 && !(await banner()), again);

  // later the next event comes into range
  await page.evaluate(() => { const r = MM.getModules().withClass("MMM-OpenSky-Reminders")[0], t = new Date(); r.nowMs = () => new Date(t.getFullYear(), t.getMonth(), t.getDate(), 10, 31).getTime(); r.check(); });
  const b2 = await banner();
  ok("ten minutes before Piano: a second reminder", b2 && b2.title === "Piano" && (await page.evaluate(() => window.__chimes)) === 2, b2);
  await page.evaluate(() => document.querySelector(".rem-ok").click());

  // a sleeping screen is left alone; the reminder comes when it wakes (event not started yet)
  await page.evaluate(() => {
    const r = MM.getModules().withClass("MMM-OpenSky-Reminders")[0], t = new Date(), at = (hh, mm = 0) => new Date(t.getFullYear(), t.getMonth(), t.getDate(), hh, mm).getTime();
    r.nowMs = () => at(12, 0);
    r.notificationReceived("CALENDAR_EVENTS", [{ title: "Soccer", calendarName: "Family", fullDayEvent: false, startDate: String(at(12, 6)), endDate: String(at(13, 0)) }], { identifier: "rem-test" });
  });
  await h.sleep(200);
  await page.evaluate(() => { const r = MM.getModules().withClass("MMM-OpenSky-Reminders")[0]; r.sidebar().softSleep(true); r.check(); });
  await h.sleep(300);
  ok("asleep: no banner, no chime", !(await banner()) && (await page.evaluate(() => window.__chimes)) === 2);
  await page.evaluate(() => { const r = MM.getModules().withClass("MMM-OpenSky-Reminders")[0]; r.sidebar().softSleep(false); r.check(); });
  await h.sleep(300);
  const b3 = await banner();
  ok("after waking: the reminder", b3 && b3.title === "Soccer" && (await page.evaluate(() => window.__chimes)) === 3, b3);
  await page.evaluate(() => document.querySelector(".rem-ok").click());

  // chime off / banner off
  await page.evaluate(() => {
    const r = MM.getModules().withClass("MMM-OpenSky-Reminders")[0], t = new Date(), at = (hh, mm = 0) => new Date(t.getFullYear(), t.getMonth(), t.getDate(), hh, mm).getTime();
    r.config.chime = false; r.nowMs = () => at(14, 0);
    r.notificationReceived("CALENDAR_EVENTS", [{ title: "Quiet one", calendarName: "Family", fullDayEvent: false, startDate: String(at(14, 5)), endDate: String(at(15, 0)) }], { identifier: "rem-test" });
  });
  await h.sleep(200);
  ok("chime off: banner only", !!(await banner()) && (await page.evaluate(() => window.__chimes)) === 3);
  await page.evaluate(() => document.querySelector(".rem-ok").click());
  await page.evaluate(() => {
    const r = MM.getModules().withClass("MMM-OpenSky-Reminders")[0], t = new Date(), at = (hh, mm = 0) => new Date(t.getFullYear(), t.getMonth(), t.getDate(), hh, mm).getTime();
    r.config.chime = true; r.config.banner = false; r.nowMs = () => at(16, 0);
    r.notificationReceived("CALENDAR_EVENTS", [{ title: "Silent one", calendarName: "Family", fullDayEvent: false, startDate: String(at(16, 5)), endDate: String(at(17, 0)) }], { identifier: "rem-test" });
  });
  await h.sleep(200);
  ok("banner off: chime only", !(await banner()) && (await page.evaluate(() => window.__chimes)) === 4);

  // all-day events are left out when that is off
  const noAllDay = await page.evaluate(() => {
    const r = MM.getModules().withClass("MMM-OpenSky-Reminders")[0], t = new Date();
    r.config.allDay = false; r.reminded = {}; r.nowMs = () => new Date(t.getFullYear(), t.getMonth(), t.getDate(), 10, 0).getTime();
    r.pools.clear();
    r.notificationReceived("CALENDAR_EVENTS", [{ title: "Picnic", calendarName: "Testers", fullDayEvent: true, startDate: String(new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime()), endDate: String(new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1).getTime()) }], { identifier: "rem-test" });
    return r.due(r.nowMs()).length;
  });
  ok("all-day events are left out unless asked for", noAllDay === 0, noAllDay);

  // the on-screen Settings: the lead time (saved to opensky.json), and a Test that shows the banner
  await page.evaluate(() => { MM.getModules().withClass("MMM-OpenSky-Reminders")[0].config.banner = true; MM.getModules().withClass("MMM-OpenSky-Sidebar")[0].sendNotification("OPENSKY_SETTINGS_OPEN"); });
  await until(async () => page.evaluate(() => !!document.querySelector('[data-pref="reminders"]')));
  ok("Settings shows the lead time", await page.evaluate(() => document.querySelector('[data-pref="reminders"]').value) === "10");
  await page.evaluate(() => { const s = document.querySelector('[data-pref="reminders"]'); s.value = "30"; s.dispatchEvent(new Event("change", { bubbles: true })); });
  await until(async () => S().reminders && S().reminders.minutes === 30);
  ok("changing it on the screen saves it (and keeps the other reminder choices)", S().reminders.minutes === 30 && S().reminders.allDay === true && JSON.stringify(S().reminders.people) === '["Mom"]', S().reminders);
  await page.evaluate(() => { const s = document.querySelector('[data-pref="reminders"]'); s.value = "0"; s.dispatchEvent(new Event("change", { bubbles: true })); });
  await until(async () => S().reminders && S().reminders.minutes === undefined);
  ok("Off removes the lead time only", S().reminders.minutes === undefined && S().reminders.allDay === true, S().reminders);

  const f = Object.entries(R).filter(([, v]) => !v).map(([k]) => k);
  h.log(`SUMMARY: ${f.length ? "FAILED: " + f.join("; ") : "ALL CHECKS PASSED"} (${Object.keys(R).length} checks)`);
};
module.exports.patchSettings = (s) => { s.reminders = { minutes: 10, allDay: true, people: ["Mom"] }; };
