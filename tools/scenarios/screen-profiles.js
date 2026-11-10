// Screen profiles: opensky.json -> screens are named presets (pages, person, text size, accent). A screen picks one in Settings
// (Look & extras -> Screen profile); the pick is this browser's localStorage only. The page list in opensky.json stays shared.
// Order of precedence: this screen's own choice (Settings) > its screen profile > the default. Fixture people: Mom, Kid.
const fs = require("fs"), path = require("path");
module.exports = async (page, h) => {
  const R = {}; const ok = (k, v, i) => { R[k] = v; h.log(`${v ? "PASS" : "FAIL"}  ${k}${i !== undefined ? "  — " + JSON.stringify(i) : ""}`); };
  const until = async (fn, tries = 40) => { for (let i = 0; i < tries && !(await fn()); i++) await h.sleep(250); return fn(); };
  const SETTINGS = path.join(__dirname, "..", "out", "opensky.test.json");
  const tiles = () => page.evaluate(() => [...document.querySelectorAll(".os-side-col .os-tile:not(.os-utility)")].map((t) => t.dataset.key.replace(/^page-/, "")));
  const zoom = () => page.evaluate(() => Number(getComputedStyle(document.documentElement).getPropertyValue("--os-zoom")));
  const accent = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--os-accent").trim());
  const picked = () => page.evaluate(() => [...document.querySelectorAll(".hb-profile-on")].map((b) => b.getAttribute("aria-label")));
  const active = () => page.evaluate(() => (document.querySelector(".os-side-col .os-tile.active") || {}).dataset?.key);
  const reload = async () => { await page.reload(); await page.waitForFunction(() => window.MM && MM.getModules && MM.getModules().length > 5, null, { timeout: 30000 }); await h.sleep(4500); };
  const open = async () => {
    await page.evaluate(() => MM.getModules().withClass("MMM-OpenSky-Sidebar")[0].sendNotification("OPENSKY_SETTINGS_OPEN"));
    await until(async () => page.evaluate(() => !!document.querySelector('[data-seg="screenProfile"]')));
  };
  const close = async () => { await page.evaluate(() => document.querySelector(".ost-x")?.click()); await h.sleep(300); };
  const choose = async (name) => { await open(); await page.evaluate((n) => [...document.querySelectorAll('[data-seg="screenProfile"] button')].find((b) => b.dataset.v === n).click(), name); await h.sleep(900); };
  const pagesBefore = JSON.parse(fs.readFileSync(SETTINGS, "utf8")).pages;
  await page.setViewportSize({ width: 1920, height: 1080 }); await h.sleep(800);

  const all = await tiles();
  ok("no screen profile: every page, normal size, nobody picked", all.join() === pagesBefore.join() && Math.abs(await zoom() - 1) < 0.01 && (await picked()).length === 0, all);
  await open();
  const names = await page.evaluate(() => [...document.querySelectorAll('[data-seg="screenProfile"] button')].map((b) => b.textContent));
  ok("Settings lists None + the profiles from opensky.json", names.join() === "None,Kitchen,Hall", names);
  await close();

  // Kitchen: home + calendar, Kid's calendars, Large text, teal
  await choose("Kitchen");
  ok("Kitchen: only its pages are shown", (await tiles()).join() === "home,calendar", await tiles());
  ok("Kitchen: Large text (1.15x) and its accent (teal)", Math.abs(await zoom() - 1.15) < 0.01 && (await accent()) === "#11998e", { z: await zoom(), a: await accent() });
  ok("Kitchen: Kid's circle is on", (await picked()).join() === "Kid", await picked());
  ok("remembered by this browser only", await page.evaluate(() => localStorage.getItem("opensky.screenProfile")) === "Kitchen");
  ok("the shared page list in opensky.json is untouched", JSON.parse(fs.readFileSync(SETTINGS, "utf8")).pages.join() === pagesBefore.join());
  await h.shot("screen-profile-kitchen");
  await page.evaluate(() => document.querySelector('[data-seg="screenProfile"]').scrollIntoView({ block: "center" })); await h.sleep(200);
  ok("Settings marks Kitchen as chosen", await page.evaluate(() => document.querySelector('[data-seg="screenProfile"] button.on').dataset.v) === "Kitchen");
  await close();

  await reload();
  ok("after a refresh the profile still applies (pages, size, accent, person)",
    (await tiles()).join() === "home,calendar" && Math.abs(await zoom() - 1.15) < 0.01 && (await accent()) === "#11998e" && (await picked()).join() === "Kid", { t: await tiles(), p: await picked() });

  // this screen's own choice beats the profile
  await open();
  await page.evaluate(() => document.querySelector('[data-seg="textSize"] button[data-v="xlarge"]').click()); await h.sleep(600);
  ok("an own text size (Extra large) beats the profile's", Math.abs(await zoom() - 1.3) < 0.01, await zoom());
  await page.evaluate(() => document.querySelector('[data-here="calendar"]').click()); await h.sleep(500);
  ok("Hide here on a profile page: that screen's own list wins (only Home is left)", (await tiles()).join() === "home", await tiles());
  await close();

  // Hall: lists + timer, nobody, #3b82f6; choosing it drops the own choices; standing on a page it hides moves to its first
  await choose("Hall");
  ok("Hall: its pages, the own choices are dropped (text back to normal), its accent", (await tiles()).join() === "lists,timer" && Math.abs(await zoom() - 1) < 0.01 && (await accent()) === "#3b82f6", { t: await tiles(), z: await zoom(), a: await accent() });
  ok("Hall: nobody picked (Kitchen's person is cleared)", (await picked()).length === 0, await picked());
  ok("Hall: the screen is on a page it shows", (await active()) === "page-lists", await active());
  await close();

  await choose("");
  ok("None: everything back to the defaults", (await tiles()).join() === pagesBefore.join() && Math.abs(await zoom() - 1) < 0.01 && (await accent()) !== "#3b82f6" && (await picked()).length === 0);
  ok("None: nothing about the profile is left in the browser", await page.evaluate(() => ["opensky.screenProfile", "opensky.hiddenPages", "opensky.textSize", "opensky.accent"].every((k) => localStorage.getItem(k) === null)));
  await close();

  const f = Object.entries(R).filter(([, v]) => !v).map(([k]) => k);
  h.log(`SUMMARY: ${f.length ? "FAILED: " + f.join("; ") : "ALL CHECKS PASSED"} (${Object.keys(R).length} checks)`);
};
module.exports.patchSettings = (st) => {
  st.screens = [
    { name: "Kitchen", pages: ["home", "calendar"], person: "Kid", textSize: "large", accent: "teal" },
    { name: "Hall", pages: ["lists", "timer"], accent: "#3b82f6" }
  ];
};
