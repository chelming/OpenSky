// The "happening now" pill (dark ring, NOW badge, progress bar) in a narrow tile / big text: it stays off the date above it,
// its NOW row and progress bar stay inside the pill, and the pill stays inside its tile. The clock is pinned (like home-today.js).
module.exports = async (page, h) => {
  const R = {}; const ok = (k, v, i) => { R[k] = v; h.log(`${v ? "PASS" : "FAIL"}  ${k}${i !== undefined ? "  — " + JSON.stringify(i) : ""}`); };
  for (const [w, hh, size] of [[1024, 600, "xlarge"], [1280, 720, "xlarge"], [800, 480, "xlarge"], [1280, 720, "normal"], [1920, 1080, "normal"], [1920, 1080, "xlarge"], [1080, 1920, "normal"], [1080, 1920, "xlarge"]]) {
    await page.setViewportSize({ width: w, height: hh }); await h.sleep(600);
    await page.evaluate((s) => MM.getModules().withClass("MMM-OpenSky-Sidebar")[0].setTextSize(s), size);
    await h.tap(".os-page-home"); await h.sleep(800);
    await page.evaluate(() => {
      const t = new Date(), at = (m) => new Date(t.getFullYear(), t.getMonth(), t.getDate(), 0, m).getTime();
      const home = MM.getModules().withClass("MMM-OpenSky-Home")[0];
      home.nowMs = () => at(17 * 60 + 30); home.pools.clear();
      home.notificationReceived("CALENDAR_EVENTS", [{ title: "Soccer practice with a long name", calendarName: "Kids", fullDayEvent: false, startDate: String(at(16 * 60 + 30)), endDate: String(at(18 * 60)) }], { identifier: "t" });
    });
    await h.sleep(1000);
    const g = await page.evaluate(() => {
      const z = Number(getComputedStyle(document.documentElement).getPropertyValue("--os-zoom")) || 1;
      const R = (e) => { const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
      const tile = document.querySelector(".hd-is-today"), pill = tile.querySelector(".hd-event.live"), head = tile.querySelector(".hd-day-head");
      const P = R(pill), T = R(tile), Hd = R(head), Pr = R(pill.querySelector(".hd-progress")), Rw = R(pill.querySelector(".hd-live-row"));
      const side = document.documentElement.dataset.layout === "portrait";   // portrait: the date is to the left of the pill, not above it
      return { z, gap: side ? (P.l - Hd.r) / z : (P.t - Hd.b) / z, inTile: P.l >= T.l - 1 && P.r <= T.r + 1 && P.b <= T.b + 1, progressIn: Pr.l >= P.l - 1 && Pr.r <= P.r + 1 && Pr.b <= P.b + 1, rowIn: Rw.l >= P.l - 1 && Rw.r <= P.r + 1 };
    });
    ok(`${w}×${hh} ${size}: live pill clear of the date (≥ 4 px), progress bar and NOW row inside the pill, pill inside its tile`, g.gap >= 4 && g.inTile && g.progressIn && g.rowIn, g);
    await h.shot(`live-pill-${w}x${hh}-${size}`);
  }
  await page.evaluate(() => MM.getModules().withClass("MMM-OpenSky-Sidebar")[0].setTextSize("normal"));
  await page.setViewportSize({ width: 1920, height: 1080 });
  const f = Object.entries(R).filter(([, v]) => !v).map(([k]) => k);
  h.log(`SUMMARY: ${f.length ? "FAILED: " + f.join("; ") : "ALL CHECKS PASSED"} (${Object.keys(R).length} checks)`);
};
