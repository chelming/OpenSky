// On-device meal plan (meals.provider "local"): add a meal on the Meals page with "+", see it on the page, on Home as
// "Dinner tonight" and on the calendar, change it, remove it. Nothing leaves the Pi (no Mealie, no secrets).
const fs = require("fs");
const path = require("path");
const FILE = path.join(__dirname, "..", "out", "meals.test.json");
const stored = () => { try { return JSON.parse(fs.readFileSync(FILE, "utf8")).entries || []; } catch (e) { return []; } };

module.exports = async (page, h) => {
  const R = {}; const ok = (k, v, i) => { R[k] = v; h.log(`${v ? "PASS" : "FAIL"}  ${k}${i !== undefined ? "  — " + JSON.stringify(i) : ""}`); };
  const until = async (fn, tries = 60) => { for (let i = 0; i < tries && !(await fn()); i++) await h.sleep(250); return fn(); };
  const meals = () => page.evaluate(() => [...document.querySelectorAll(".mp-today-col .mp-meal b")].map((b) => b.textContent));

  await h.tap(".os-page-meals"); await h.sleep(1000);
  ok("the Meals page shows seven days, each with a + button", await page.evaluate(() => document.querySelectorAll(".mp-day").length === 7 && document.querySelectorAll(".mp-add").length === 7));
  ok("empty plan: it says how to add a meal", await page.evaluate(() => /Tap \+ on a day/.test(document.querySelector(".mp-msg").textContent)));
  await h.shot("local-meals-empty");

  // add tonight's dinner
  await page.evaluate(() => document.querySelector(".mp-today-col .mp-add").click());
  await until(() => page.evaluate(() => !!document.querySelector(".osm-input")));
  ok("+ opens the add popup (no Remove button yet)", await page.evaluate(() => !!document.querySelector(".osm-edit") && !document.querySelector(".osm-danger")));
  await page.evaluate(() => { document.querySelector(".osm-main").click(); });
  ok("an empty meal isn't added, and says why", await page.evaluate(() => !document.querySelector(".osm-err").hidden && !!document.querySelector(".osm-edit")) && stored().length === 0);
  await page.evaluate(() => { document.querySelector(".osm-input").value = "Tacos <b>x</b>"; document.querySelector(".osm-main").click(); });
  await until(async () => (await meals()).length > 0);
  ok("the meal shows in today's column, as text", JSON.stringify(await meals()) === '["Tacos <b>x</b>"]' && await page.evaluate(() => !document.querySelector(".mp-meal b b")), await meals());
  ok("…and is kept on the Pi", stored().length === 1 && stored()[0].title === "Tacos <b>x</b>" && stored()[0].type === "dinner", stored());
  ok("the popup closed", await page.evaluate(() => !document.querySelector(".osm-overlay")));
  await h.shot("local-meals-page");

  // Home + calendar follow
  await h.tap(".os-page-home"); await h.sleep(1000);
  const tonight = () => page.evaluate(() => { const c = document.querySelector(".hd-tonight"); return c && !c.hidden ? c.textContent.replace(/\s+/g, " ").trim() : null; });
  await until(async () => /Tacos/.test((await tonight()) || ""));
  ok("Home shows it under 'Dinner tonight'", /Dinner tonight/.test((await tonight()) || "") && /Tacos/.test((await tonight()) || ""), await tonight());
  const titles = () => page.evaluate(() => [...document.querySelectorAll(".hd-week .hd-event-title, .hd-today .hd-event-title")].map((e) => e.textContent));
  await until(async () => (await titles()).some((t) => /Tacos/.test(t)));
  ok("…and on the calendar (meals.calendar)", (await titles()).some((t) => /Tacos/.test(t)), await titles());
  await h.shot("local-meals-home");

  // tapping it on Home changes it (no recipe to open)
  await page.evaluate(() => document.querySelector(".hd-tn-row").click());
  await until(() => page.evaluate(() => !!document.querySelector(".osm-edit")));
  ok("tapping tonight's dinner on Home opens the editor with it filled in and a Remove button", await page.evaluate(() => document.querySelector(".osm-input").value === "Tacos <b>x</b>" && !!document.querySelector(".osm-danger")));
  await page.evaluate(() => { document.querySelector(".osm-input").value = "Spaghetti"; document.querySelector(".osm-main").click(); });
  await until(() => stored()[0] && stored()[0].title === "Spaghetti");
  ok("Save changes it (same entry, not a new one)", stored().length === 1 && stored()[0].title === "Spaghetti", stored());
  await until(async () => /Spaghetti/.test((await tonight()) || ""));
  ok("Home follows the change", /Spaghetti/.test((await tonight()) || ""), await tonight());

  // remove it
  await h.tap(".os-page-meals"); await h.sleep(800);
  await page.evaluate(() => document.querySelector(".mp-today-col .mp-meal").click());
  await until(() => page.evaluate(() => !!document.querySelector(".osm-danger")));
  await page.evaluate(() => document.querySelector(".osm-danger").click());
  await until(async () => (await meals()).length === 0);
  ok("Remove takes it off the page and out of the file", (await meals()).length === 0 && stored().length === 0);

  // portrait / compact: the + and the popup fit
  for (const [w, hh, name] of [[1080, 1920, "portrait"], [1280, 720, "compact"]]) {
    await page.setViewportSize({ width: w, height: hh }); await h.sleep(1500);
    await h.tap(".os-page-meals"); await h.sleep(800);
    await page.evaluate(() => document.querySelector(".mp-today-col .mp-add").click());
    await until(() => page.evaluate(() => !!document.querySelector(".osm-edit")));
    const fit = await page.evaluate(() => {
      const m = document.querySelector(".osm-modal").getBoundingClientRect(), a = document.querySelector(".mp-today-col .mp-add").getBoundingClientRect();
      return { modalInside: m.left >= 0 && m.right <= innerWidth + 1 && m.top >= 0 && m.bottom <= innerHeight + 1, addSize: Math.round(a.width) };
    });
    ok(`${name}: the add popup fits the screen and the + is a finger-sized button`, fit.modalInside && fit.addSize >= 36, fit);
    await h.shot(`local-meals-${name}`);
    await page.evaluate(() => document.querySelector(".osm-x").click());
  }
  await page.setViewportSize({ width: 1920, height: 1080 }); await h.sleep(1000);
  const f = Object.entries(R).filter(([, v]) => !v).map(([k]) => k);
  h.log(`SUMMARY: ${f.length ? "FAILED: " + f.join("; ") : "ALL CHECKS PASSED"} (${Object.keys(R).length} checks)`);
};
module.exports.patchSettings = (s) => {
  s.meals = { provider: "local", types: ["dinner"], home: true, calendar: true, calendarColor: "orange" };
  if (!s.pages.includes("meals")) s.pages.splice(Math.min(2, s.pages.length), 0, "meals");
};
