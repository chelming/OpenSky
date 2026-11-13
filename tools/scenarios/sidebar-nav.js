// Sidebar grouping (opensky.json → nav): a group is one rail button with a flyout, "More" is a compact grid (with Sleep and Settings).
// The fixture has no nav, so the scenario sets it on the Sidebar module and redraws (the config → module part is in test-config.js).
module.exports = async (page, h) => {
  const R = {}; const ok = (k, v, i) => { R[k] = v; h.log(`${v ? "PASS" : "FAIL"}  ${k}${i !== undefined ? "  — " + JSON.stringify(i) : ""}`); };
  const until = async (fn, tries = 30) => { for (let i = 0; i < tries && !(await fn()); i++) await h.sleep(200); return fn(); };
  const sb = (fn, arg) => page.evaluate(`(() => { const sb = MM.getModules().withClass("MMM-OpenSky-Sidebar")[0]; return (${fn})(sb, ${JSON.stringify(arg === undefined ? null : arg)}); })()`);
  const rail = () => page.evaluate(() => [...document.querySelectorAll(".os-side-col .os-tile")].map((t) => t.dataset.key));
  const rect = (sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e || e.hidden || !e.offsetParent && getComputedStyle(e).position !== "fixed") return null; const r = e.getBoundingClientRect(), z = Number(getComputedStyle(document.documentElement).getPropertyValue("--os-zoom")) || 1; return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height, vw: innerWidth, vh: innerHeight, z }; }, sel);
  const activeKey = () => page.evaluate(() => { const a = document.querySelector(".os-side-col .os-tile.active"); return a ? a.dataset.key : null; });
  const here = () => sb((s) => s.config.pages.find((p) => p.index === s.activeIndex).key);

  await h.sleep(1500);
  const plain = await rail();
  ok("no nav = the plain rail (a button per page, then Sleep and Settings)", plain.includes("sleep") && plain.includes("settings") && !plain.includes("more") && !plain.some((k) => k.startsWith("group-")), plain);

  await sb((s) => { s.config.nav = { groups: [{ key: "house", label: "House", icon: "smarthome", pages: ["smarthome", "vault"] }], more: ["wordgame", "timer"] }; s.updateDom(0); s.applyScale(); });
  await h.sleep(500);
  const k = await rail();
  ok("rail: Home, Lists, House (where Smart Home was), More — Games and Timer, Sleep, Settings are in More", JSON.stringify(k) === JSON.stringify(["page-home", "page-lists", "group-house", "more"]), k);

  const mb = await rect(".os-tile[data-key='more']"), rl = await rect(".os-side-wrap");
  ok("the More button sits at the bottom of the rail (inside it, not floating elsewhere)", !!mb && mb.l >= 0 && mb.r <= rl.r && mb.t > rl.vh * 0.6, { mb, rail: rl.r });

  // flyout
  await h.tap(".os-tile[data-key='group-house']"); await h.sleep(300);
  const fly = await rect(".os-slot.open .os-flyout");
  ok("House opens a flyout beside its button, on screen", !!fly && fly.l >= 0 && fly.r <= fly.vw && fly.b <= fly.vh && fly.t >= 0, fly);
  const items = await page.evaluate(() => [...document.querySelectorAll(".os-slot.open .os-fly-item")].map((b) => b.textContent.trim()));
  ok("the flyout lists its pages", items.length === 2, items);
  await h.shot("nav-flyout");
  await h.tap(".os-slot.open .os-fly-item"); await h.sleep(500);
  ok("picking one opens that page and closes the flyout", (await here()) === "smarthome" && !(await rect(".os-slot.open .os-flyout")), await here());
  ok("the House button shows as the active one while on a page inside it", (await activeKey()) === "group-house", await activeKey());

  // tap outside closes
  await h.tap(".os-tile[data-key='group-house']"); await h.sleep(250);
  ok("(reopened)", !!(await rect(".os-slot.open .os-flyout")));
  await page.mouse.click(900, 500); await h.sleep(300);
  ok("a tap anywhere else closes the flyout", !(await rect(".os-slot.open .os-flyout")));

  // More
  await h.tap(".os-tile[data-key='more']"); await h.sleep(400);
  const panel = await rect(".os-moremenu:not([hidden]) .os-more-panel");
  const mi = await page.evaluate(() => [...document.querySelectorAll(".os-more-item")].map((b) => ({ t: b.textContent.trim(), w: b.getBoundingClientRect().width, h: b.getBoundingClientRect().height })));
  ok("More opens a card with Games, Timer, Settings, Sleep", JSON.stringify(mi.map((x) => x.t)) === JSON.stringify(["Games", "Timer", "Settings", "Sleep"]), mi);
  ok("the card is compact and on screen (not giant boxes)", !!panel && panel.r <= panel.vw && panel.b <= panel.vh && panel.w < 600 && mi.every((x) => x.w <= 112 && x.h <= 110), { panel, mi: mi[0] });
  await h.shot("nav-more");
  await page.evaluate(() => [...document.querySelectorAll(".os-more-item")].find((b) => /Timer/.test(b.textContent)).click()); await h.sleep(500);
  ok("picking Timer opens it and closes More", (await here()) === "timer" && !(await rect(".os-moremenu:not([hidden]) .os-more-panel")), await here());
  ok("More shows as the active button while on one of its pages", (await activeKey()) === "more", await activeKey());
  await h.tap(".os-tile[data-key='more']"); await h.sleep(300);
  await page.evaluate(() => document.querySelector(".os-more-x").click()); await h.sleep(250);
  ok("× closes More", !(await rect(".os-moremenu:not([hidden]) .os-more-panel")));

  // a group left with one visible page is just that page's button
  await sb((s) => s.setHiddenPages(["vault"])); await h.sleep(400);
  const one = await rail();
  ok("hide one page of a two-page group on this screen → the group becomes that page's own button", one.includes("page-smarthome") && !one.includes("group-house"), one);
  await sb((s) => s.setHiddenPages([])); await h.sleep(300);

  // portrait: the rail is a bar along the bottom; flyouts open upward
  await page.setViewportSize({ width: 1080, height: 1920 }); await h.sleep(1200);
  await h.tap(".os-tile[data-key='group-house']"); await h.sleep(300);
  const pf = await rect(".os-slot.open .os-flyout");
  ok("portrait: the flyout opens above the bar and stays on screen", !!pf && pf.t >= 0 && pf.l >= 0 && pf.r <= pf.vw, pf);
  await h.shot("nav-flyout-portrait");
  await page.mouse.click(500, 600); await h.sleep(250);
  await h.tap(".os-tile[data-key='more']"); await h.sleep(300);
  const pp = await rect(".os-moremenu:not([hidden]) .os-more-panel"), bar = await rect(".os-side-wrap");
  ok("portrait: More sits above the bar", !!pp && pp.b <= bar.t + 1 && pp.l >= 0 && pp.r <= pp.vw, { pp, barTop: bar.t });
  await h.shot("nav-more-portrait");

  const f = Object.entries(R).filter(([, v]) => !v).map(([k]) => k);
  h.log(`SUMMARY: ${f.length ? "FAILED: " + f.join("; ") : "ALL CHECKS PASSED"} (${Object.keys(R).length} checks)`);
};
