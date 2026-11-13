// Sidebar groups / More, set through Settings (never by editing opensky.json): the phone page makes a group and says where each page
// goes; the Settings panel on the screen moves a page too. Checked in the saved opensky.json, and the saved settings build the rail.
// (How the saved nav becomes buttons on the rail: test-config.js 32 and sidebar-nav.js.)
// Uses writable copies of the settings (tools/out), never the fixtures.
const fs = require("fs"), path = require("path");
const OUT = path.join(__dirname, "..", "out");

module.exports = async (page, h, app) => {
  const R = {}; const ok = (k, v, i) => { R[k] = v; h.log(`${v ? "PASS" : "FAIL"}  ${k}${i !== undefined ? "  — " + JSON.stringify(i) : ""}`); };
  const until = async (fn, tries = 40) => { for (let i = 0; i < tries && !(await fn()); i++) await h.sleep(250); return fn(); };
  const S = () => JSON.parse(fs.readFileSync(path.join(OUT, "opensky.test.json"), "utf8"));
  ok("starts with no nav setting", S().nav === undefined, S().nav);

  // ---- the phone page ----
  await page.evaluate(() => MM.getModules().withClass("MMM-OpenSky-Sidebar")[0].sendNotification("OPENSKY_SETUP_OPEN"));
  await until(() => page.evaluate(() => document.querySelectorAll(".osu-code span").length === 6));
  const code = await page.evaluate(() => [...document.querySelectorAll(".osu-code span")].map((s) => s.textContent).join(""));
  await app.evaluate(({ BrowserWindow }) => { const w = new BrowserWindow({ width: 390, height: 844, show: true }); w.loadURL("http://localhost:8091/"); });
  const phone = await app.waitForEvent("window", { timeout: 20000 });
  await phone.waitForLoadState();
  await until(() => phone.evaluate(() => !!document.querySelector(".code-input")));
  await phone.fill(".code-input", code);
  await until(() => phone.evaluate(() => !!document.querySelector("#pages")));
  const tap = async (scope, selector, label) => {
    const done = await phone.evaluate(([sc, sel, t]) => {
      const b = [...document.querySelector(sc).querySelectorAll(sel)].find((x) => t == null || x.textContent.trim() === t || x.getAttribute("aria-label") === t);
      if (!b) return false; b.click(); return true;
    }, [scope, selector, label]);
    if (!done) throw new Error(`nothing to tap: ${scope} ${selector} "${label}"`);
    await h.sleep(250);
  };
  const where = async (key, value) => {   // a page's "where" menu
    const done = await phone.evaluate(([k, v]) => {
      const s = document.querySelector(`#pages .pagerow[data-page="${k}"] select.where`);
      if (!s || ![...s.options].some((o) => o.value === v)) return false;
      s.value = v; s.dispatchEvent(new Event("change", { bubbles: true })); return true;
    }, [key, value]);
    if (!done) throw new Error(`no "${value}" choice for ${key}`);
    await h.sleep(250);
  };
  const save = async () => { await tap(".bar", ".btn", "Save"); return until(() => phone.evaluate(() => /Saved ✓/.test(document.querySelector(".bar")?.textContent || ""))); };

  ok("phone: every turned-on page except Home has a 'where' menu", await phone.evaluate(() => {
    const rows = [...document.querySelectorAll("#pages .pagerow:not(.off)")];
    return rows.length > 3 && rows.every((r) => !!r.querySelector("select.where") === (r.dataset.page !== "home"));
  }));
  ok("phone: the menu offers the sidebar and More before any group exists", await phone.evaluate(() => [...document.querySelector('#pages .pagerow[data-page="timer"] select.where').options].map((o) => o.textContent).join("|") === "In the sidebar|In More"));

  await tap("#pages", ".add", "Add a group");
  await phone.fill(".sheet input.input", "House");
  await tap(".sheet", ".icon-pick", "smarthome");
  await tap(".sheet", ".sheet-foot .btn", "Done");
  ok("phone: a new group shows in the list", await phone.evaluate(() => /House/.test(document.querySelector("#pages .groups")?.textContent || "")));
  await where("smarthome", "g:0");
  await where("vault", "g:0");
  await where("timer", "more");
  await save();
  const nav = S().nav;
  ok("saved: House (with its icon and pages) and More", nav && nav.groups.length === 1 && nav.groups[0].label === "House" && nav.groups[0].icon === "smarthome" && nav.groups[0].pages.join() === "smarthome,vault" && nav.more.join() === "timer", nav);

  // a blank or repeated name is refused
  await tap("#pages", ".add", "Add a group");
  await phone.fill(".sheet input.input", " house ");
  await tap(".sheet", ".sheet-foot .btn", "Done");
  ok("phone: a repeated group name is refused", await phone.evaluate(() => /already used/.test(document.querySelector(".sheet .err")?.textContent || "")));
  await tap(".sheet", ".sheet-foot .btn", "Cancel");

  // removing the group puts its pages back in the sidebar
  await tap("#pages .groups", ".row", null);
  await tap(".sheet", ".sheet-foot .btn", "Remove");
  await save();
  ok("phone: removing the group frees its pages (More stays)", !!S().nav && S().nav.groups.length === 0 && S().nav.more.join() === "timer", S().nav);
  await where("timer", "");
  await save();
  ok("phone: nothing grouped = no nav setting at all", S().nav === undefined, S().nav);
  await phone.evaluate(() => window.close());

  // ---- the Settings panel on the screen ----
  // (a group has to exist: make one the way the phone does, then use the panel)
  const fixture = S(); fixture.nav = { groups: [{ label: "House", icon: "smarthome", pages: ["smarthome"] }], more: [] };
  fs.writeFileSync(path.join(OUT, "opensky.test.json"), JSON.stringify(fixture, null, 2));
  await page.reload(); await h.sleep(8000);
  await page.evaluate(() => MM.getModules().withClass("MMM-OpenSky-Sidebar")[0].sendNotification("OPENSKY_SETTINGS_OPEN"));
  await until(async () => page.evaluate(() => document.querySelectorAll(".ost-page").length > 3));
  ok("panel: every turned-on page except Home has a 'where' menu", await page.evaluate(() => [...document.querySelectorAll(".ost-page:not(.off)")].every((r) => !!r.querySelector("[data-where]") === (r.dataset.page !== "home"))));
  ok("panel: House is offered, and Smart Home shows it", await page.evaluate(() => { const s = document.querySelector('.ost-page[data-page="smarthome"] [data-where]'); return s.value === "g:0" && [...s.options].some((o) => o.textContent === "In House"); }));
  await page.evaluate(() => { const s = document.querySelector('.ost-page[data-page="lists"] [data-where]'); s.value = "g:0"; s.dispatchEvent(new Event("change", { bubbles: true })); });
  await until(async () => (S().nav.groups[0].pages || []).includes("lists"));
  ok("panel: putting Lists in House → saved, 'Restart now' offered", S().nav.groups[0].pages.join() === "smarthome,lists" && await until(async () => page.evaluate(() => !!document.querySelector(".ost-restart"))), S().nav);
  await page.evaluate(() => { const s = document.querySelector('.ost-page[data-page="timer"] [data-where]'); s.value = "more"; s.dispatchEvent(new Event("change", { bubbles: true })); });
  await until(async () => (S().nav.more || []).includes("timer"));
  ok("panel: putting Timer in More → saved", S().nav.more.join() === "timer", S().nav);
  await h.shot("nav-settings-panel");

  const f = Object.entries(R).filter(([, v]) => !v).map(([k]) => k);
  h.log(`SUMMARY: ${f.length ? "FAILED: " + f.join("; ") : "ALL CHECKS PASSED"} (${Object.keys(R).length} checks)`);
};
module.exports.writableSettings = true;
module.exports.env = { OPENSKY_MUSIC_INSTALLED: "" };
