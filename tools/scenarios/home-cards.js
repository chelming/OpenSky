// Home cards (opensky.json → home.cards): which of the right-hand cards show on Home and in what order.
// Here the photo card is put ABOVE the lists and the notes card is turned off; checked in landscape, compact and portrait.
// Then Settings → Home cards: switching a card off and moving one saves home.cards (the order is what the file says).
const fs = require("fs");
const path = require("path");
const SETTINGS = path.join(__dirname, "..", "out", "opensky.test.json");

module.exports = async (page, h) => {
  const R = {}; const ok = (k, v, i) => { R[k] = v; h.log(`${v ? "PASS" : "FAIL"}  ${k}${i !== undefined ? "  — " + JSON.stringify(i) : ""}`); };
  const until = async (fn, tries = 40) => { for (let i = 0; i < tries && !(await fn()); i++) await h.sleep(250); return fn(); };
  const saved = () => { try { return JSON.parse(fs.readFileSync(SETTINGS, "utf8")).home; } catch (e) { return null; } };
  const geo = () => page.evaluate(() => {
    const r = (sel) => { const e = document.querySelector(sel); if (!e || e.hidden) return null; const b = e.getBoundingClientRect(); const cs = getComputedStyle(e); return b.width > 0 && b.height > 0 && cs.display !== "none" ? { top: b.top, bottom: b.bottom, left: b.left, right: b.right } : null; };
    const root = r(".hd-root");
    return { layout: document.documentElement.dataset.layout, W: innerWidth, H: innerHeight, root, lists: r(".hd-lists"), photo: r(".hd-photo"), notes: r(".hd-notes"), tonight: r(".hd-tonight") };
  });
  const inside = (g, b) => b && b.left >= -1 && b.right <= g.W + 1 && b.bottom <= g.H + 1;

  await h.tap(".os-page-home"); await h.sleep(800);
  // a note on the screen: the card is off, so it must stay hidden
  await page.evaluate(() => { const hm = MM.getModules().withClass("MMM-OpenSky-Home")[0]; hm.notes = [{ id: "n1", text: "Buy milk", name: "Mom" }]; hm._notesKey = null; hm.renderNotes(); });
  await page.evaluate(() => { const hm = MM.getModules().withClass("MMM-OpenSky-Home")[0]; hm.photoPending = 0; hm.nextPhoto(); });
  await h.sleep(2500);

  let g = await geo();
  ok("landscape: the photo card is above the lists (home.cards order)", g.photo && g.lists && g.photo.bottom <= g.lists.top + 1, g);
  ok("landscape: the notes card is off even with a note posted", g.notes === null, g.notes);
  ok("landscape: both cards inside the screen", inside(g, g.photo) && inside(g, g.lists));
  await h.shot("home-cards-landscape");

  await page.setViewportSize({ width: 1280, height: 720 }); await h.sleep(1500);
  g = await geo();
  ok("compact (" + g.layout + "): photo above lists, both inside the screen", g.photo && g.lists && g.photo.bottom <= g.lists.top + 1 && inside(g, g.photo) && inside(g, g.lists), g);
  await h.shot("home-cards-compact");

  await page.setViewportSize({ width: 1080, height: 1920 }); await h.sleep(1500);
  await page.evaluate(() => { const hm = MM.getModules().withClass("MMM-OpenSky-Home")[0]; hm.photoPending = 0; hm.nextPhoto(); });
  await h.sleep(2500);
  g = await geo();
  ok("portrait (" + g.layout + "): photo strip above the lists row, notes off", g.layout === "portrait" && g.photo && g.lists && g.photo.bottom <= g.lists.top + 1 && g.notes === null, g);
  ok("portrait: nothing runs off the screen", inside(g, g.photo) && inside(g, g.lists) && g.root && g.root.bottom <= g.H + 1, g);
  await h.shot("home-cards-portrait");
  await page.setViewportSize({ width: 1920, height: 1080 }); await h.sleep(1500);

  // Settings → Home cards
  await page.evaluate(() => MM.getModules().withClass("MMM-OpenSky-Sidebar")[0].sendNotification("OPENSKY_SETTINGS_OPEN"));
  await until(() => page.evaluate(() => !!document.querySelector(".ost-hc")));
  const rows = await page.evaluate(() => [...document.querySelectorAll(".ost-hc")].map((r) => ({ k: r.dataset.card, off: r.classList.contains("off") })));
  ok("Settings lists the cards: photos then lists on, notes off", rows.length >= 3 && rows[0].k === "photos" && rows[1].k === "lists" && !rows[0].off && !rows[1].off && rows.find((r) => r.k === "notes").off, rows);

  await page.evaluate(() => document.querySelector('.ost-hc[data-card="photos"] [data-move="1"]').click());   // photos down: lists, photos
  await until(() => (saved() || {}).cards && saved().cards[0] === "lists");
  ok("moving a card down saves the new order", JSON.stringify((saved() || {}).cards) === '["lists","photos"]', saved());

  await until(() => page.evaluate(() => !!document.querySelector('.ost-hc[data-card="notes"]')));
  await page.evaluate(() => document.querySelector('.ost-hc[data-card="notes"] .ost-toggle').click());
  await until(() => (saved() || {}).cards && saved().cards.includes("notes"));
  ok("turning a card on adds it at the end", JSON.stringify((saved() || {}).cards) === '["lists","photos","notes"]', saved());

  await page.evaluate(() => document.querySelector('.ost-hc[data-card="lists"] .ost-toggle').click());
  await until(() => (saved() || {}).cards && !saved().cards.includes("lists"));
  ok("turning a card off removes it", JSON.stringify((saved() || {}).cards) === '["photos","notes"]', saved());

  const f = Object.entries(R).filter(([, v]) => !v).map(([k]) => k);
  h.log(`SUMMARY: ${f.length ? "FAILED: " + f.join("; ") : "ALL CHECKS PASSED"} (${Object.keys(R).length} checks)`);
};
module.exports.patchSettings = (s) => { s.home = { cards: ["photos", "lists"] }; };
