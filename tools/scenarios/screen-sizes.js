// Other screen sizes: the "full" layout (1920×1080) on big screens and the "compact" one (1280×720) on small screens, each
// scaled to fit (look.scale "auto") — nothing cut off, nothing tiny, and screen-relative parts (keyboard, popups, the month
// grid) keep their proportions. look.textSize multiplies the zoom; a narrow page switches to the compact layout.
const expectZoom = (w, hh) => { const f = Math.min(w / 1920, hh / 1080); return f < 0.8 ? Math.min(w / 1280, hh / 720) : f; };
module.exports = async (page, h) => {
  const R = {}; const ok = (k, v, i) => { R[k] = v; h.log(`${v ? "PASS" : "FAIL"}  ${k}${i !== undefined ? "  — " + JSON.stringify(i) : ""}`); };
  for (const [w, hh] of [[800, 480], [1024, 600], [1280, 720], [1366, 768], [1440, 900], [1600, 900], [1920, 1080], [2560, 1440]]) {
    await page.setViewportSize({ width: w, height: hh });
    await h.sleep(1200);
    const g = await page.evaluate(() => {
      const r = (sel) => { const e = document.querySelector(sel); return e ? e.getBoundingClientRect() : null; };
      const tiles = [...document.querySelectorAll(".os-side-col > *")].filter((t) => t.getBoundingClientRect().height).map((t) => t.getBoundingClientRect().bottom);
      return { layout: document.documentElement.dataset.layout, zoom: Number(getComputedStyle(document.documentElement).getPropertyValue("--os-zoom")), lastTile: Math.max(...tiles), home: r(".hd-root").bottom, right: r(".hd-root").right, W: innerWidth, H: innerHeight,
        eventPx: parseFloat(getComputedStyle(document.querySelector(".hd-event-title")).fontSize) * Number(getComputedStyle(document.documentElement).getPropertyValue("--os-zoom")) };
    });
    ok(`${w}×${hh}: ${g.layout} layout, scaled ${g.zoom.toFixed(2)}×, every sidebar tile and the whole Home page on screen`, g.layout === (w / g.zoom < 1600 || hh / g.zoom < 880 ? "compact" : "full") && Math.abs(g.zoom - expectZoom(w, hh)) < 0.01 && g.lastTile <= g.H + 1 && g.home <= g.H + 1 && g.right <= g.W + 1 && (w < 1024 || g.eventPx >= 10), g);   // (event names stay readable: 10 real px from 1024 wide up)
  }
  // Text size (Settings → Look & extras): bigger text on top of the fitted scale; every sidebar tile and the Home page still fit
  for (const [w, hh, size, mult] of [[1920, 1080, "large", 1.15], [1920, 1080, "xlarge", 1.3], [1920, 1080, "small", 0.9], [1280, 720, "xlarge", 1.3], [1024, 600, "large", 1.15], [800, 480, "xlarge", 1.3]]) {
    await page.setViewportSize({ width: w, height: hh });
    await page.evaluate((s) => MM.getModules().withClass("MMM-OpenSky-Sidebar")[0].setTextSize(s), size);
    await h.sleep(1000);
    const g = await page.evaluate(() => {
      const r = (sel) => { const e = document.querySelector(sel); return e ? e.getBoundingClientRect() : null; };
      const tiles = [...document.querySelectorAll(".os-side-col > *")].filter((t) => t.getBoundingClientRect().height).map((t) => t.getBoundingClientRect().bottom);
      return { layout: document.documentElement.dataset.layout, zoom: Number(getComputedStyle(document.documentElement).getPropertyValue("--os-zoom")), lastTile: Math.max(...tiles), home: r(".hd-root").bottom, right: r(".hd-root").right, W: innerWidth, H: innerHeight };
    });
    ok(`${w}×${hh} text ${size}: ${g.zoom.toFixed(2)}×, sidebar and Home still on screen`, Math.abs(g.zoom - expectZoom(w, hh) * mult) < 0.01 && g.lastTile <= g.H + 1 && g.home <= g.H + 1 && g.right <= g.W + 1, g);
    await h.shot(`text-${size}-${w}`);
  }
  await page.evaluate(() => MM.getModules().withClass("MMM-OpenSky-Sidebar")[0].setTextSize("normal"));
  await page.setViewportSize({ width: 1280, height: 720 }); await h.sleep(800);
  await page.evaluate(() => MM.getModules().withClass("MMM-OpenSky-Home")[0].sendNotification("CALENDAR_ADD_EVENT", { date: new Date() }));
  await h.sleep(500);
  await page.evaluate(() => document.getElementById("event-title").focus()); await h.sleep(500);
  const kb = await page.evaluate(() => ({ kbTop: document.querySelector(".okb").getBoundingClientRect().top, modalBottom: document.querySelector(".calendar-editor-modal").getBoundingClientRect().bottom, H: innerHeight }));
  ok("keyboard keeps 40% of the screen; the form sits above it", Math.abs(kb.kbTop - kb.H * 0.6) < 4 && kb.modalBottom <= kb.kbTop, kb);
  await page.evaluate(() => { document.querySelector(".event-close-btn")?.click(); document.activeElement && document.activeElement.blur(); });
  await h.sleep(400);
  await h.tap(".os-page-calendar"); await h.sleep(1500);
  const cal = await page.evaluate(() => { const b = document.querySelector(".CX3 .bodice") || document.querySelector(".CX3"); const r = b.getBoundingClientRect(); return { bottom: Math.round(r.bottom), height: Math.round(r.height), H: innerHeight }; });
  ok("the month grid fills the page and ends on screen", cal.bottom <= cal.H + 1 && cal.height > cal.H * 0.6, cal);
  await h.shot("screen-1280");
  await page.setViewportSize({ width: 1920, height: 1080 }); await h.tap(".os-page-home"); await h.sleep(500);
  const f = Object.entries(R).filter(([, v]) => !v).map(([k]) => k);
  h.log(`SUMMARY: ${f.length ? "FAILED: " + f.join("; ") : "ALL CHECKS PASSED"} (${Object.keys(R).length} checks)`);
};
