// Settings tabs: no tab's content is wider than its pane (nothing scrolls sideways, nothing is cut off).
module.exports = async (page, h) => {
  const R = {}; const ok = (k, v, i) => { R[k] = v; h.log(`${v ? "PASS" : "FAIL"}  ${k}${i !== undefined ? "  — " + JSON.stringify(i) : ""}`); };
  const until = async (fn, tries = 20) => { for (let i = 0; i < tries && !(await fn()); i++) await h.sleep(250); return fn(); };
  await page.evaluate(() => MM.getModules().withClass("MMM-OpenSky-Sidebar")[0].sendNotification("OPENSKY_SETTINGS_OPEN"));
  await until(async () => page.evaluate(() => !!document.querySelector(".ost-prefs .ost-section")));
  for (const tab of ["screen", "pages", "home", "reminders", "backups", "system"]) {
    await page.evaluate((t) => MM.getModules().withClass("MMM-OpenSky-Settings")[0].showTab(t), tab);
    await h.sleep(300);
    const m = await page.evaluate(() => {
      const b = document.querySelector(".ost-body"), r = b.getBoundingClientRect();
      // anything visible in the pane that pokes out past its right edge
      const out = [...b.querySelectorAll("*")].filter((e) => e.offsetParent && e.getBoundingClientRect().width && e.getBoundingClientRect().right > r.right + 1).map((e) => e.className || e.tagName).slice(0, 4);
      return { scroll: b.scrollWidth - b.clientWidth, out };
    });
    ok(`${tab}: fits the pane`, m.scroll <= 1 && !m.out.length, m);
    await h.shot("settings-fit-" + tab);
  }
  const f = Object.entries(R).filter(([, v]) => !v).map(([k]) => k);
  h.log(`SUMMARY: ${f.length ? "FAILED: " + f.join("; ") : "ALL CHECKS PASSED"} (${Object.keys(R).length} checks)`);
};
