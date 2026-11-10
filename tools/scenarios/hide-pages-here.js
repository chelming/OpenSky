// Settings → Pages → "Hide here": a page's button is hidden on THIS screen only (localStorage "opensky.hiddenPages");
// opensky.json's page list is untouched; one page always stays; a reload keeps it.
module.exports = async (page, h, app) => {
  const R = {}; const ok = (k, v, i) => { R[k] = v; h.log(`${v ? "PASS" : "FAIL"}  ${k}${i !== undefined ? "  — " + JSON.stringify(i) : ""}`); };
  const until = async (fn, tries = 40) => { for (let i = 0; i < tries && !(await fn()); i++) await h.sleep(250); return fn(); };
  const tiles = () => page.evaluate(() => [...document.querySelectorAll(".os-side-col .os-tile:not(.os-utility)")].map((t) => t.dataset.key));
  const open = async () => {
    await page.evaluate(() => MM.getModules().withClass("MMM-OpenSky-Sidebar")[0].sendNotification("OPENSKY_SETTINGS_OPEN"));
    await until(async () => page.evaluate(() => !!document.querySelector("[data-here]")));
  };
  const hide = (key) => page.evaluate((k) => document.querySelector(`[data-here="${k}"]`).click(), key);

  const before = await tiles();
  ok("starts with several page buttons", before.length >= 2, before);
  await open();
  const victim = before[before.length - 1].replace(/^page-/, "");
  await hide(victim); await h.sleep(600);
  const after = await tiles();
  ok("Hide here removes that button on this screen", after.length === before.length - 1 && !after.includes(`page-${victim}`), after);
  ok("the button now says 'Hidden here'", await page.evaluate((k) => /Hidden here/.test(document.querySelector(`[data-here="${k}"]`).textContent), victim));
  ok("kept in this browser", await page.evaluate(() => JSON.parse(localStorage.getItem("opensky.hiddenPages") || "[]")).then((l) => l.includes(victim)));

  // the last page can't be hidden
  for (const k of before.slice(0, -1).map((t) => t.replace(/^page-/, ""))) { await hide(k); await h.sleep(300); }
  const left = await tiles();
  ok("at least one page always stays", left.length === 1, left);

  await page.evaluate(() => document.querySelector(".ost-x").click());
  await page.reload(); await h.sleep(8000);
  ok("a reload keeps it", (await tiles()).length === 1, await tiles());

  // show them again
  await open();
  await page.evaluate(() => document.querySelectorAll("[data-here]").forEach((b) => { if (/Hidden here/.test(b.textContent)) b.click(); }));
  await h.sleep(800);
  ok("Hidden here → shown again", (await tiles()).length === before.length, await tiles());

  const f = Object.entries(R).filter(([, v]) => !v).map(([k]) => k);
  h.log(`SUMMARY: ${f.length ? "FAILED: " + f.join("; ") : "ALL CHECKS PASSED"} (${Object.keys(R).length} checks)`);
};
