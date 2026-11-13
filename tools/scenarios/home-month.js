// Home → "Month": the week card's header has a button that opens the Calendar (month) page, also when the Calendar's own sidebar
// button is tucked into More. The header still fits in a portrait screen.
module.exports = async (page, h) => {
  const R = {}; const ok = (k, v, i) => { R[k] = v; h.log(`${v ? "PASS" : "FAIL"}  ${k}${i !== undefined ? "  — " + JSON.stringify(i) : ""}`); };
  const here = () => page.evaluate(() => { const s = MM.getModules().withClass("MMM-OpenSky-Sidebar")[0]; return s.config.pages.find((p) => p.index === s.activeIndex).key; });
  const active = () => page.evaluate(() => { const a = document.querySelector(".os-side-col .os-tile.active"); return a ? a.dataset.key : null; });
  const box = (sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, vw: innerWidth }; }, sel);

  await h.sleep(1500);
  await h.tap(".os-page-home"); await h.sleep(600);
  const m = await box(".hd-month");
  ok("Home has a Month button in the calendar card's header", !!m && m.r <= m.vw && m.l >= 0, m);
  await h.shot("home-month");
  await h.tap(".hd-month"); await h.sleep(700);
  ok("tapping Month opens the Calendar page", (await here()) === "calendar", await here());
  ok("…and the Calendar's own sidebar button is the active one", (await active()) === "page-calendar", await active());

  // Calendar's button tucked into More: Month still gets there, and More lights up
  await page.evaluate(() => { const s = MM.getModules().withClass("MMM-OpenSky-Sidebar")[0]; s.config.nav = { groups: [], more: ["calendar"] }; s.updateDom(0); s.applyScale(); });
  await h.sleep(500);
  await h.tap(".os-page-home"); await h.sleep(600);
  await h.tap(".hd-month"); await h.sleep(700);
  ok("with Calendar in More, Month still opens it and More shows as active", (await here()) === "calendar" && (await active()) === "more", { here: await here(), active: await active() });

  // portrait: the header still fits
  await page.setViewportSize({ width: 1080, height: 1920 }); await h.sleep(1500);
  await h.tap(".os-page-home"); await h.sleep(800);
  const pm = await box(".hd-month"), card = await box(".hd-calendar");
  ok("portrait: the Month button stays inside the calendar card", !!pm && !!card && pm.l >= card.l && pm.r <= card.r + 1, { pm, card });
  await h.shot("home-month-portrait");

  const f = Object.entries(R).filter(([, v]) => !v).map(([k]) => k);
  h.log(`SUMMARY: ${f.length ? "FAILED: " + f.join("; ") : "ALL CHECKS PASSED"} (${Object.keys(R).length} checks)`);
};
