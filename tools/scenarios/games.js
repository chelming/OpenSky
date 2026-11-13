// Games page: one "Who's playing?" for every game, tabs (Word Game · Connections · Strands · Quartiles), and NYT's Connections and
// Strands played against a fake NYT (tools/fixtures/fake-nyt-games.js): answers stay on the server, per-person boards.
const PORT = 8096;
let fake = null;
require("../fixtures/fake-nyt-games.js").create(PORT).then((f) => { fake = f; });
const { GROUPS } = require("../fixtures/fake-nyt-games.js");

module.exports = async (page, h) => {
  const R = {}; const ok = (k, v, i) => { R[k] = v; h.log(`${v ? "PASS" : "FAIL"}  ${k}${i !== undefined ? "  — " + JSON.stringify(i) : ""}`); };
  const until = async (fn, tries = 40) => { for (let i = 0; i < tries && !(await fn()); i++) await h.sleep(250); return fn(); };
  const mod = (name) => page.evaluate((n) => { const m = MM.getModules().withClass(n)[0]; return m.state ? JSON.parse(JSON.stringify(m.state)) : null; }, name);
  const shown = (sel) => page.evaluate((s) => { const e = document.querySelector(s); return !!e && e.offsetParent !== null && getComputedStyle(e).display !== "none"; }, sel);
  const click = (sel) => page.evaluate((s) => document.querySelector(s).click(), sel);
  const tab = async (g) => { await click(`.gh-tab[data-g="${g}"]`); await h.sleep(300); };

  await h.tap(".os-page-wordgame");
  await until(async () => shown(".gh-person"));
  ok("nobody selected: only 'Who's playing?' (no tabs, no game visible)", await shown(".gh-person") && !(await shown(".gh-tab")) && !(await shown(".wg-root")) && !(await shown(".cn-root")) && !(await shown(".st-root")));
  await page.evaluate(() => document.querySelectorAll(".gh-person")[0].click());   // Mom
  await until(async () => shown(".gh-tab"));
  ok("after picking Mom: three tabs, Word Game open, the player shown with Switch",
    await page.evaluate(() => [...document.querySelectorAll(".gh-tab")].map((t) => t.textContent.trim().slice(1)).join("|") === "Word Game|Connections|Strands|Quartiles" && /Mom/.test(document.querySelector(".gh-switch").textContent) && document.querySelector(".gh-tab.on").dataset.g === "word"));

  /* ---------- Connections ---------- */
  await tab("connections");
  await until(async () => !!(await mod("MMM-OpenSky-Connections")));
  await until(async () => shown(".cn-card"));
  ok("Connections: 16 cards on the board, Word Game hidden", await page.evaluate(() => document.querySelectorAll(".cn-card").length === 16) && !(await shown(".wg-root")));
  const st0 = JSON.stringify(await mod("MMM-OpenSky-Connections"));
  ok("the page doesn't know the groups (no titles in what it was sent)", !/FRUITS|PLANETS|SOUND-ALIKES/.test(st0));
  const pick = async (ws) => { for (const w of ws) await page.evaluate((w) => document.querySelector(`.cn-card[data-w="${w}"]`).click(), w); };
  await pick(["APPLE", "PEAR"]);
  ok("Submit is off until four words are picked", await page.evaluate(() => document.querySelector(".cn-submit").disabled));
  await pick(["PLUM", "MARS"]);
  ok("four picked: Submit is on", await page.evaluate(() => !document.querySelector(".cn-submit").disabled && document.querySelectorAll(".cn-card.on").length === 4));
  await click(".cn-submit");
  await until(async () => ((await mod("MMM-OpenSky-Connections")) || {}).mistakes === 1);
  ok("three of four → 'One away…', a mistake used (3 dots left)", await page.evaluate(() => /One away/.test(document.querySelector(".gm-toast").textContent) && document.querySelectorAll(".gm-dots i:not(.gone)").length === 3));
  await click(".cn-clear");
  await pick(["APPLE", "PEAR", "PLUM", "FIG"]); await click(".cn-submit");
  await until(async () => (await shown(".cn-group.yellow")));
  ok("right group → a yellow banner with its title; 12 cards left", await page.evaluate(() => /FRUITS/.test(document.querySelector(".cn-group.yellow").textContent) && document.querySelectorAll(".cn-card").length === 12));
  await h.shot("games-connections");
  for (const g of [1, 2, 3]) { await pick(GROUPS[g][1]); await click(".cn-submit"); await until(async () => ((await mod("MMM-OpenSky-Connections")) || {}).groups.length === g + 1); }
  await until(async () => /Solved|Perfect/.test(await page.evaluate(() => document.querySelector(".gm-side").textContent)));
  ok("all four groups → solved, stats (1 played), no more buttons", await page.evaluate(() => /Solved!/.test(document.querySelector(".gm-side").textContent) && /1Played/.test(document.querySelector(".gm-side").textContent.replace(/\s+/g, "")) && !document.querySelector(".cn-submit")));

  /* ---------- Strands ---------- */
  await tab("strands");
  await until(async () => shown(".st-cell"));
  ok("Strands: 6x8 letters and the clue; Connections hidden", await page.evaluate(() => document.querySelectorAll(".st-cell").length === 48 && /Morning meal/.test(document.querySelector(".st-clue").textContent)) && !(await shown(".cn-root")));
  const tap = async (cells) => { for (const [r, c] of cells) await page.evaluate(([r, c]) => document.querySelector(`.st-cell[data-r="${r}"][data-c="${c}"]`).click(), [r, c]); };
  await tap([[0, 1], [0, 2], [0, 3], [0, 4], [0, 5]]);
  ok("tapped letters show the word being spelled", await page.evaluate(() => document.querySelector(".st-word").textContent === "BACON" && document.querySelectorAll(".st-cell.pick").length === 5));
  await tap([[0, 5]]);   // the last letter again = check
  await until(async () => ((await mod("MMM-OpenSky-Strands")) || {}).found.length === 1);
  ok("tap the last letter again → BACON is a theme word: the letters stay blue", await page.evaluate(() => document.querySelectorAll(".st-cell.theme").length === 5 && document.querySelectorAll(".st-cell.pick").length === 0));
  await tap([[1, 1], [1, 2]]); await click(".st-go").catch(() => {});
  ok("short picks aren't checked", await page.evaluate(() => document.querySelector(".st-go").disabled));
  await click(".st-del");
  // three extra real words (4+ letters) earn a hint
  await tap([[3, 0], [4, 0], [5, 0], [6, 0], [6, 0]]);   // CAKE, checked by tapping the last letter again
  await until(async () => ((await mod("MMM-OpenSky-Strands")) || {}).extras === 1);
  ok("another real word counts toward a hint (not a theme word)", ((await mod("MMM-OpenSky-Strands")) || {}).extras === 1 && ((await mod("MMM-OpenSky-Strands")) || {}).found.length === 1);
  await h.shot("games-strands");

  /* ---------- Quartiles ---------- */
  await tab("quartiles");
  await until(async () => shown(".qt-tile"));
  ok("Quartiles: 20 tiles; Strands hidden; the page doesn't know the hidden words or the theme", await page.evaluate(() => document.querySelectorAll(".qt-tile").length === 20) && !(await shown(".st-root"))
    && !/WATERMELON|Fun/.test(JSON.stringify(await mod("MMM-OpenSky-Quartiles"))));
  const qtap = async (...ts) => { for (const t of ts) await page.evaluate((t) => [...document.querySelectorAll(".qt-tile:not(.on)")].find((b) => b.firstChild.textContent === t.toUpperCase()).click(), t); };
  await qtap("wa", "ter");
  ok("tapped tiles show the word being spelled, numbered in order", await page.evaluate(() => document.querySelector(".qt-word").textContent === "WATER" && document.querySelectorAll(".qt-tile.on i").length === 2));
  await click(".qt-go");
  await until(async () => ((await mod("MMM-OpenSky-Quartiles")) || {}).found.length === 1);
  ok("Submit: a real word scores (+4), the tiles are free again, the word shows in the list", await page.evaluate(() => document.querySelectorAll(".qt-tile.on").length === 0 && /water/i.test(document.querySelector(".qt-found").textContent) && /4 points/.test(document.querySelector(".qt-root .gm-side").textContent)));
  await qtap("ter", "wa"); await click(".qt-go");
  await until(async () => /Not in word list/.test(await page.evaluate(() => document.querySelector(".qt-root .gm-toast").textContent)));
  ok("not a word → 'Not in word list'", true);
  await click(".qt-clear");
  await qtap("wa", "ter", "me", "lon"); await click(".qt-go");
  await until(async () => ((await mod("MMM-OpenSky-Quartiles")) || {}).quartilesFound === 1);
  ok("a four-tile hidden word is a quartile: 1 of 5, gold chip", await page.evaluate(() => /1 of 5 quartiles/.test(document.querySelector(".qt-root .gm-side").textContent) && !!document.querySelector(".qt-chip.t4")));
  await page.evaluate(() => document.querySelector('.qt-hint[data-k="theme"]').click());
  await until(async () => /Theme:\s*Fun/.test(await page.evaluate(() => document.querySelector(".qt-root .gm-side").textContent)));
  ok("hint 'Show the theme' reveals the theme (and the button is used up)", await page.evaluate(() => document.querySelector('.qt-hint[data-k="theme"]').disabled));
  await h.shot("games-quartiles");
  await tab("strands");

  /* ---------- leaving and coming back ---------- */
  await h.tap(".os-page-home");
  await h.sleep(500);
  await h.tap(".os-page-wordgame");
  await until(async () => shown(".gh-person"));
  ok("opening the Games page again asks 'Who's playing?' again (no game visible, no tabs)", !(await shown(".gh-tab")) && !(await shown(".st-root")) && !(await shown(".cn-root")) && !(await shown(".wg-root")));
  await page.evaluate(() => document.querySelectorAll(".gh-person")[0].click());
  await until(async () => shown(".gh-tab"));
  ok("and it starts on the Word Game tab", await page.evaluate(() => document.querySelector(".gh-tab.on").dataset.g === "word"));

  /* ---------- switch player ---------- */
  await click(".gh-switch");
  await until(async () => shown(".gh-person"));
  ok("Switch → 'Who's playing?' again, no game visible", !(await shown(".st-root")) && !(await shown(".gh-tab")));
  await page.evaluate(() => document.querySelectorAll(".gh-person")[1].click());   // Kid
  await until(async () => ((await mod("MMM-OpenSky-Strands")) || {}).player === "Kid");
  await tab("connections");
  await until(async () => ((await mod("MMM-OpenSky-Connections")) || {}).player === "Kid");
  const kid = await mod("MMM-OpenSky-Connections");
  ok("Kid starts with their own fresh boards (Connections: 16 cards, no stats)", kid.player === "Kid" && kid.cards.length === 16 && kid.stats.played === 0 && kid.groups.length === 0);
  const fs = require("fs"), path = require("path");
  const saved = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "out", "connections.test.json"), "utf8"));
  ok("boards are saved per person on the server", saved.players.Mom.stats.won === 1 && !saved.players.Kid.stats.played);

  const f = Object.entries(R).filter(([, v]) => !v).map(([k]) => k);
  h.log(`SUMMARY: ${f.length ? "FAILED: " + f.join("; ") : "ALL CHECKS PASSED"} (${Object.keys(R).length} checks)`);
  if (fake) fake.close();
};
module.exports.env = { OPENSKY_NYT_GAMES_URL: `http://127.0.0.1:${PORT}/svc`, OPENSKY_QUARTILES_URL: `http://127.0.0.1:${PORT}` };
