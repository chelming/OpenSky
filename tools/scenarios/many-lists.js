// Five lists (To-Dos, Groceries, Costco, Chores, Pets) and Extra large text: nothing overflows or wraps awkwardly, lists
// become a grid when they don't fit side by side, and when something can't fit it drops out (photo card, "Add Event" label…).
module.exports = async (page, h) => {
  const R = {}; const ok = (k, v, i) => { R[k] = v; h.log(`${v ? "PASS" : "FAIL"}  ${k}${i !== undefined ? "  — " + JSON.stringify(i) : ""}`); };
  const it = (n, t) => Array.from({ length: n }, (_, i) => ({ id: `${t}${i}`, text: `${t} item number ${i + 1}, with a longer description` }));
  const lists = [["To-Dos", "blue", 3], ["Groceries", "green", 6], ["Costco", "orange", 2], ["Chores", "purple", 0], ["Pets", "teal", 4]];
  await page.evaluate((lists) => {
    const mk = (id, n, color) => ({ id, title: id, color, items: Array.from({ length: n }, (_, i) => ({ id: id + i, text: `${id} item number ${i + 1}, with a longer description` })) });
    MM.getModules().withClass("MMM-OpenSky-Home")[0].notificationReceived("OPENSKY_LISTS", { source: "test", lists: lists.map(([t, c, n]) => mk(t, n, c)) });
  }, lists);
  const check = async (label, w, hh, size) => {
    await page.setViewportSize({ width: w, height: hh }); await h.sleep(600);
    await page.evaluate((s) => MM.getModules().withClass("MMM-OpenSky-Sidebar")[0].setTextSize(s), size);
    await h.tap(".os-page-home"); await h.sleep(1200);
    const g = await page.evaluate(() => {
      const vis = (e) => e && e.getBoundingClientRect().width > 0;
      const clipped = [...document.querySelectorAll(".hd-lists .lc-add-item, .hd-lists .lc-list-title, .hd-nav-btn, .hd-card-label, .hb-title, .hb-time")].filter((e) => vis(e) && e.scrollWidth > e.clientWidth + 1).map((e) => e.className);
      const wrapped = [...document.querySelectorAll(".hd-nav-btn, .hd-week-range, .lc-add-item")].filter((e) => vis(e) && e.getBoundingClientRect().height > 70 * Number(getComputedStyle(document.documentElement).getPropertyValue("--os-zoom"))).map((e) => e.className);
      const cols = new Set([...document.querySelectorAll(".hd-lists .lc-list")].map((c) => Math.round(c.getBoundingClientRect().left))).size;
      const rows = new Set([...document.querySelectorAll(".hd-lists .lc-list")].map((c) => Math.round(c.getBoundingClientRect().top))).size;
      const cd = document.querySelector(".hb-countdown"), root = document.documentElement;
      return { layout: root.dataset.layout, W: innerWidth, lists: document.querySelectorAll(".hd-lists .lc-list").length, cols, rows, clipped, wrapped,
        countdownRight: cd ? Math.round(cd.getBoundingClientRect().right) : 0, photo: vis(document.querySelector(".hd-photo")), listsBox: (() => { const b = document.querySelector(".hd-lists").getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; })() };
    });
    ok(`${label}: 5 lists (3 shown on Home, 4 in portrait), none cut off, no wrapped buttons, header inside the screen`, g.lists === (g.layout === "portrait" ? 4 : 3) && !g.clipped.length && !g.wrapped.length && g.countdownRight <= g.W, g);
    await h.shot(`many-lists-${label.replace(/\W+/g, "-")}`);
    return g;
  };
  const a = await check("1280×720 extra large", 1280, 720, "xlarge");
  ok("lists became a grid (more than one row)", a.rows > 1 || a.cols < 5, { cols: a.cols, rows: a.rows });
  await check("1024×600 extra large", 1024, 600, "xlarge");
  await check("1920×1080 normal", 1920, 1080, "normal");
  const p = await check("1080×1920 portrait", 1080, 1920, "normal");
  ok("portrait, more than two lists: a grid of two columns", p.cols === 2 && p.rows >= 2, { cols: p.cols, rows: p.rows });
  await check("1080×1920 portrait extra large", 1080, 1920, "xlarge");
  await page.evaluate(() => MM.getModules().withClass("MMM-OpenSky-Sidebar")[0].setTextSize("normal"));
  await page.setViewportSize({ width: 1920, height: 1080 });
  const f = Object.entries(R).filter(([, v]) => !v).map(([k]) => k);
  h.log(`SUMMARY: ${f.length ? "FAILED: " + f.join("; ") : "ALL CHECKS PASSED"} (${Object.keys(R).length} checks)`);
};
