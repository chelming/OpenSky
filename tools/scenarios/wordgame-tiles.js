// Typing in the word game: a typed letter never makes its tile taller than the empty ones, so it can't touch or cover the row below.
module.exports = async (page, h) => {
  const R = {}; const ok = (k, v, i) => { R[k] = v; h.log(`${v ? "PASS" : "FAIL"}  ${k}${i !== undefined ? "  — " + JSON.stringify(i) : ""}`); };
  for (const [w, hh, size] of [[1920, 1080, "normal"], [1280, 720, "normal"], [1024, 600, "xlarge"], [800, 480, "xlarge"], [1080, 1920, "normal"]]) {
    await page.setViewportSize({ width: w, height: hh }); await h.sleep(500);
    await page.evaluate((s) => MM.getModules().withClass("MMM-OpenSky-Sidebar")[0].setTextSize(s), size);
    await h.tap(".os-page-wordgame"); await h.sleep(1200);
    await page.evaluate(() => { for (const c of "PIANO") [...document.querySelectorAll(".wg-key")].find((k) => k.textContent.trim().toUpperCase() === c).click(); });
    await h.sleep(500);
    const g = await page.evaluate(() => { const r0 = [...document.querySelectorAll('.wg-row[data-r="0"] .wg-tile')].map((t) => t.getBoundingClientRect()), r1 = [...document.querySelectorAll('.wg-row[data-r="1"] .wg-tile')].map((t) => t.getBoundingClientRect());
      return { typed: r0.length, filled: document.querySelectorAll('.wg-row[data-r="0"] .wg-tile.filled').length, hTyped: Math.round(r0[0].height * 10) / 10, hEmpty: Math.round(r1[0].height * 10) / 10, gap: Math.round((r1[0].top - r0[0].bottom) * 10) / 10 }; });
    ok(`${w}×${hh} ${size}: typed tiles are as tall as empty ones, with a gap below`, g.filled === 5 && Math.abs(g.hTyped - g.hEmpty) < 0.6 && g.gap > 1, g);
    await h.shot(`wordgame-tiles-${w}x${hh}-${size}`);
  }
  await page.evaluate(() => MM.getModules().withClass("MMM-OpenSky-Sidebar")[0].setTextSize("normal"));
  await page.setViewportSize({ width: 1920, height: 1080 });
  const f = Object.entries(R).filter(([, v]) => !v).map(([k]) => k);
  h.log(`SUMMARY: ${f.length ? "FAILED: " + f.join("; ") : "ALL CHECKS PASSED"} (${Object.keys(R).length} checks)`);
};
