// Mat board (look.mat): off by default (nothing changes); on, the board is drawn and the whole UI shrinks into its opening
// (sidebar, header and pages all inside it, nothing cut off, taps still work), a popup stays inside the opening, the opening
// follows the size, the shadow option floats the board, and turning it off puts everything back.
module.exports = async (page, h) => {
  const R = {}; const ok = (k, v, i) => { R[k] = v; h.log(`${v ? "PASS" : "FAIL"}  ${k}${i !== undefined ? "  — " + JSON.stringify(i) : ""}`); };
  const sb = (fn, ...a) => page.evaluate(([f, a]) => { const m = MM.getModules().withClass("MMM-OpenSky-Sidebar")[0]; return m[f](...a); }, [fn, a]);
  const rect = (sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom) }; }, sel);
  await page.setViewportSize({ width: 1920, height: 1080 }); await h.sleep(1500);

  const none = await page.evaluate(() => ({ mat: !!document.querySelector(".os-mat"), pos: document.body.style.position }));
  ok("off by default: no mat, the page is as before", !none.mat && none.pos === "", none);
  const full = await rect(".os-side-wrap");

  await sb("setDefaultMat", { enabled: true, color: "#1f2f4a", size: "medium", shadow: true }); await h.sleep(1500);
  const g = await page.evaluate(() => { const m = MM.getModules().withClass("MMM-OpenSky-Sidebar")[0].matGeometry(); const b = document.body.getBoundingClientRect(); return { m, body: [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)], mat: !!document.querySelector(".os-mat"), lip: !!document.querySelector(".os-mat-lip"), shadow: document.querySelector(".os-mat").classList.contains("shadow") }; });
  ok("on: the board is drawn and the page sits exactly in the opening", g.mat && g.lip && g.shadow && g.body[0] === g.m.l && g.body[1] === g.m.t && g.body[2] === 1920 - g.m.r && g.body[3] === 1080 - g.m.b, g);
  const inside = await page.evaluate((m) => {
    const bad = [];
    for (const s of [".os-side-wrap", ".hb-root", ".hd-root"]) { const e = document.querySelector(s); if (!e) continue; const r = e.getBoundingClientRect(); if (r.width && (r.left < m.l - 1 || r.top < m.t - 1 || r.right > 1920 - m.r + 1 || r.bottom > 1080 - m.b + 1)) bad.push(s); }
    return bad;
  }, g.m);
  ok("sidebar, header and Home stay inside the opening", inside.length === 0, inside);
  const shrunk = await rect(".os-side-wrap");
  ok("the layout really shrank (the rail moved in)", !!full && !!shrunk && shrunk.l > full.l + 20, { full, shrunk });
  await h.shot("mat-on");

  // a tap in the opening still reaches the page
  await h.tap(".os-page-timer"); await h.sleep(700);
  ok("taps still work (the Timer page opens)", await page.evaluate(() => document.querySelector(".os-page-timer").classList.contains("active") && !!document.querySelector(".timer-setup-screen").getBoundingClientRect().width));

  // size and shadow
  await sb("setDefaultMat", { size: "large", shadow: false }); await h.sleep(1200);
  const big = await page.evaluate(() => MM.getModules().withClass("MMM-OpenSky-Sidebar")[0].matGeometry());
  ok("larger mat → smaller opening; no shadow → the board fills the screen", big.w < g.m.w && big.h < g.m.h && big.edge === 0 && !(await page.evaluate(() => document.querySelector(".os-mat").classList.contains("shadow"))), big);
  await h.shot("mat-large");

  // portrait
  await page.setViewportSize({ width: 1080, height: 1920 }); await h.sleep(1200);
  const pg = await page.evaluate(() => { const m = MM.getModules().withClass("MMM-OpenSky-Sidebar")[0].matGeometry(), b = document.body.getBoundingClientRect(); return { m, w: Math.round(b.width), h: Math.round(b.height), layout: document.documentElement.dataset.layout }; });
  ok("portrait: still fits the opening", pg.layout === "portrait" && pg.w === pg.m.w && pg.h === pg.m.h, pg);
  await h.shot("mat-portrait");
  await page.setViewportSize({ width: 1920, height: 1080 }); await h.sleep(800);

  // sleeping hides the board (black screen)
  await page.evaluate(() => MM.getModules().withClass("MMM-OpenSky-Sidebar")[0].softSleep(true)); await h.sleep(500);
  ok("asleep: the board is hidden", await page.evaluate(() => getComputedStyle(document.querySelector(".os-mat")).visibility === "hidden"));
  await page.mouse.click(960, 540); await h.sleep(900);

  await sb("setDefaultMat", { enabled: false }); await h.sleep(1200);
  const off = await page.evaluate(() => ({ mat: !!document.querySelector(".os-mat, .os-mat-lip"), pos: document.body.style.position, w: document.body.getBoundingClientRect().width }));
  ok("turned off: board gone, page back to full size", !off.mat && off.pos === "" && off.w === 1920, off);

  const f = Object.entries(R).filter(([, v]) => !v).map(([k]) => k);
  h.log(`SUMMARY: ${f.length ? "FAILED: " + f.join("; ") : "ALL CHECKS PASSED"} (${Object.keys(R).length} checks)`);
};
