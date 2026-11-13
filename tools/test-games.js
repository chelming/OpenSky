// Unit test for the Games page's NYT games (Connections, Strands) against a fake NYT: today's puzzle, answers kept on the
// server, one board + stats per person, NYT down → "unavailable" and retried after 10 minutes, hints, bad input refused.
const fs = require("fs"), os = require("os"), path = require("path"), Module = require("module");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "opensky-games-"));
process.env.OPENSKY_CONNECTIONS = path.join(tmp, "connections.json");
process.env.OPENSKY_STRANDS = path.join(tmp, "strands.json");
process.env.OPENSKY_QUARTILES = path.join(tmp, "quartiles.json");
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...a) { return req === "node_helper" ? path.join(tmp, "nh.js") : origResolve.call(this, req, ...a); };
fs.writeFileSync(path.join(tmp, "nh.js"), "module.exports = { create: (o) => Object.assign({ sendSocketNotification(n, p) { global.__sent.push([n, p]); } }, o) };");
global.__sent = [];
const sent = global.__sent;

let passed = 0, failed = 0;
const ok = (n, c, i) => { c ? passed++ : failed++; console.log(`${c ? "PASS" : "FAIL"}  ${n}${i !== undefined ? "  — " + JSON.stringify(i) : ""}`); };
const fake = require("./fixtures/fake-nyt-games.js");

(async () => {
  const nyt = await fake.create(0);
  process.env.OPENSKY_NYT_GAMES_URL = nyt.url;
  process.env.OPENSKY_QUARTILES_URL = nyt.url.replace(/\/svc$/, "");
  const last = (name) => sent.filter(([n]) => n === name).pop()[1];
  const err = (name) => (sent.filter(([n]) => n === name).pop() || [])[1];

  /* ---------------- Connections ---------------- */
  const cn = require("../modules/MMM-OpenSky-Connections/node_helper.js");
  cn.start();
  const C = (n, p) => cn.socketNotificationReceived(n, p);
  await C("OS_CN_INIT", { people: ["Mom", "Kid"] });
  ok("C1 nobody picked: no board", last("OS_CN_STATE").player === null);
  await C("OS_CN_SYNC", { player: "mom" });
  let s = last("OS_CN_STATE");
  ok("C2 Mom's board: 16 cards in NYT's order, no groups or titles sent", s.player === "Mom" && s.cards.length === 16 && s.groups.length === 0 && !JSON.stringify(s).includes("FRUITS"), s.cards);
  const order = []; fake.GROUPS.forEach(([, ws], g) => ws.forEach((w, i) => { order[fake.POSITIONS[g * 4 + i]] = w; }));
  ok("C3 cards are in the puzzle's starting order", JSON.stringify(s.cards) === JSON.stringify(order));
  const date = s.date;
  await C("OS_CN_GUESS", { words: ["APPLE", "PEAR", "PLUM", "MARS"], date, player: "Mom" });
  s = last("OS_CN_STATE");
  ok("C4 three of four → 'One away', a mistake counted, nothing revealed", /One away/.test(s.message) && s.mistakes === 1 && s.groups.length === 0, s.message);
  await C("OS_CN_GUESS", { words: ["APPLE", "PEAR", "PLUM", "MARS"], date, player: "Mom" });
  ok("C5 the same guess again is refused", /Already guessed/.test(err("OS_CN_ERROR").message));
  await C("OS_CN_GUESS", { words: ["APPLE", "PEAR", "PLUM", "FIG"], date, player: "Mom" });
  s = last("OS_CN_STATE");
  ok("C6 a right group is revealed with its title and removed from the board", s.solvedNow && s.groups.length === 1 && s.groups[0].title === "FRUITS" && s.groups[0].level === 0 && s.cards.length === 12);
  await C("OS_CN_GUESS", { words: ["APPLE", "MARS", "BEAR", "SUNDAY"], date, player: "Mom" });
  ok("C7 solved words can't be guessed again", /Pick four/.test(err("OS_CN_ERROR").message));
  await C("OS_CN_SYNC", { player: "Kid" });
  s = last("OS_CN_STATE");
  ok("C8 Kid has a fresh board", s.player === "Kid" && s.mistakes === 0 && s.groups.length === 0 && s.cards.length === 16 && s.stats.played === 0);
  // Mom finishes: 3 more mistakes would lose; solve the rest instead
  for (const g of [1, 2, 3]) await C("OS_CN_GUESS", { words: fake.GROUPS[g][1], date, player: "Mom" });
  s = last("OS_CN_STATE");
  ok("C9 Mom wins with 1 mistake; her stats count, Kid's don't", s.status === "won" && s.mistakes === 1 && s.stats.played === 1 && s.stats.won === 1 && s.stats.streak === 1 && s.stats.mistakes[1] === 1, s.stats);
  // lose
  await C("OS_CN_GUESS", { words: fake.GROUPS[0][1], date, player: "Kid" });   // 1 right
  for (const w of [["MARS", "BEAR", "BARE", "SUNDAY"], ["MARS", "BEAR", "BEER", "SUNDAY"], ["MARS", "BEAR", "BIER", "SUNDAY"], ["VENUS", "BEAR", "BIER", "SUNDAY"]]) await C("OS_CN_GUESS", { words: w, date, player: "Kid" });
  s = last("OS_CN_STATE");
  ok("C10 four mistakes lose the game and reveal every group", s.status === "lost" && s.groups.length === 4 && s.groups.slice(1).every((g) => g.missed) && s.stats.played === 1 && s.stats.won === 0 && s.stats.streak === 0, s.status);
  const saved = JSON.parse(fs.readFileSync(process.env.OPENSKY_CONNECTIONS, "utf8"));
  ok("C11 saved per person", saved.players.Mom.stats.won === 1 && saved.players.Kid.stats.won === 0);
  await C("OS_CN_GUESS", { words: ["APPLE"], date, player: "Stranger" });
  ok("C12 an unknown player is treated as nobody", /Pick who/.test(err("OS_CN_ERROR").message));

  /* ---------------- Strands ---------------- */
  const st = require("../modules/MMM-OpenSky-Strands/node_helper.js");
  st.start();
  const S = (n, p) => st.socketNotificationReceived(n, p);
  await S("OS_ST_INIT", { people: ["Mom", "Kid"] });
  ok("S1 nobody picked: no board", last("OS_ST_STATE").player === null);
  await S("OS_ST_SYNC", { player: "Mom" });
  let t = last("OS_ST_STATE");
  const board = t.rows;
  ok("S2 board, clue and counts are sent; theme words and places are not", t.rows.length === 8 && t.rows[0].length === 6 && t.clue === "Morning meal" && t.themeCount === 9 && t.found.length === 0 && !("themeWords" in t) && !("solutions" in t) && !("themeCoords" in t));
  // a path for a word, found by search (the test may know the board)
  const pathFor = (word) => {
    const go = (r, c, i, used) => {
      if (board[r][c] !== word[i] || used.includes(`${r},${c}`)) return null;
      if (i === word.length - 1) return [[r, c]];
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const nr = r + dr, nc = c + dc;
        if ((dr || dc) && nr >= 0 && nr < 8 && nc >= 0 && nc < 6) { const x = go(nr, nc, i + 1, [...used, `${r},${c}`]); if (x) return [[r, c], ...x]; }
      }
      return null;
    };
    for (let r = 0; r < 8; r++) for (let c = 0; c < 6; c++) { const x = go(r, c, 0, []); if (x) return x; }
    return null;
  };
  const dt = t.date, G = (cells) => S("OS_ST_GUESS", { cells, date: dt, player: "Mom" });
  await G([[0, 0], [1, 0]]);
  ok("S3 under 4 letters → 'Too short'", /Too short/.test(err("OS_ST_ERROR").message));
  await G([[0, 0], [2, 0], [3, 0], [4, 0]]);
  ok("S4 letters that aren't side by side are refused", /Not a word/.test(err("OS_ST_ERROR").message));
  await G([[0, 1], [0, 2], [0, 3], [0, 4], [0, 5]]);   // BACON
  t = last("OS_ST_STATE");
  ok("S5 a theme word is locked in with its cells", t.foundNow === "BACON" && t.found.length === 1 && t.found[0].cells.length === 5 && !t.found[0].spangram);
  await G([[0, 5], [0, 4], [0, 3], [0, 2], [0, 1]]);
  ok("S6 the same word again → 'Already found'", /Already found/.test(err("OS_ST_ERROR").message));
  await G([[0, 0], [0, 1], [0, 2], [0, 3]]);   // PBAC: not a word
  ok("S7 not a word → 'Not in word list'", /Not in word list/.test(err("OS_ST_ERROR").message));
  await S("OS_ST_HINT", { date: dt, player: "Mom" });
  ok("S8 no hint before 3 extra words", /3 more words/.test(err("OS_ST_ERROR").message));
  const extras = ["CAKE", "EAST", "ACRE"].map((w) => [w, pathFor(w)]);
  for (const [, p] of extras) await G(p);
  t = last("OS_ST_STATE");
  ok("S9 three real extra words earn a hint", extras.length === 3 && t.extras === 3 && t.hintsReady === 1, { extras: extras.map((e) => e[0]), got: t.extras });
  await S("OS_ST_HINT", { date: dt, player: "Mom" });
  t = last("OS_ST_STATE");
  ok("S10 a hint marks one unfound theme word's cells (not the spangram), and is used up", t.hint && t.hint.length === 5 && t.hintsReady === 0 && t.stats.hints === 1, t.hint);
  const hinted = t.hint;
  await G(hinted);
  t = last("OS_ST_STATE");
  ok("S11 finding the hinted word clears the hint", t.hint === null && t.found.length === 2);
  await G(fake.SPAN.split("").map((_, r) => [r, 0]));
  t = last("OS_ST_STATE");
  ok("S12 the spangram is found (flagged)", t.found.some((f) => f.spangram) && /Spangram/.test(t.message));
  for (let r = 0; r < 8; r++) { if (!last("OS_ST_STATE").found.some((f) => f.cells[0][0] === r && !f.spangram)) await G([1, 2, 3, 4, 5].map((c) => [r, c])); }
  t = last("OS_ST_STATE");
  ok("S13 all words found → solved, stats count for Mom", t.status === "won" && t.found.length === 9 && t.stats.won === 1 && t.stats.streak === 1);
  await S("OS_ST_SYNC", { player: "Kid" });
  t = last("OS_ST_STATE");
  ok("S14 Kid's board is fresh", t.player === "Kid" && t.found.length === 0 && t.stats.won === 0 && t.status === "playing");

  /* ---------------- Quartiles ---------------- */
  const qt = require("../modules/MMM-OpenSky-Quartiles/node_helper.js");
  qt.start();
  const Q = (n, p) => qt.socketNotificationReceived(n, p);
  await Q("OS_QT_INIT", { people: ["Mom", "Kid"] });
  ok("Q1 nobody picked: no board", last("OS_QT_STATE").player === null);
  await Q("OS_QT_SYNC", { player: "Mom" });
  let q = last("OS_QT_STATE");
  const dq = q.date;
  ok("Q2 20 tiles (shuffled, uppercase), counts only; no answers, theme or word lists sent", q.tiles.length === 20 && [...q.tiles].sort().join() === fake.QT_TILES.map((x) => x.toUpperCase()).sort().join() && q.tiles.join() !== fake.QT_TILES.map((x) => x.toUpperCase()).join()
    && q.quartileTotal === 5 && q.wordTotal === 13 && q.hints.theme === null && q.hints.counts === null && !JSON.stringify(q).includes("WATERMELON") && !("answers" in q) && !("words" in q));
  const tile = (t) => q.tiles.indexOf(t.toUpperCase());
  const QG = (...ts) => Q("OS_QT_GUESS", { tiles: ts.map(tile), date: dq, player: "Mom" });
  await QG("wa", "ter");
  q = last("OS_QT_STATE");
  ok("Q3 a real two-tile word scores 4", q.foundNow === "water" && q.points === 4 && q.score === 4 && q.found.length === 1, q.message);
  await QG("wa", "ter");
  ok("Q4 the same word again → 'Already found'", /Already found/.test(err("OS_QT_ERROR").message));
  await QG("ter", "wa");
  ok("Q5 tiles that don't make a word → 'Not in word list'", /Not in word list/.test(err("OS_QT_ERROR").message));
  await Q("OS_QT_GUESS", { tiles: [0, 0], date: dq, player: "Mom" });
  ok("Q6 the same tile twice is refused", /Pick up to four/.test(err("OS_QT_ERROR").message));
  await QG("wa", "ter", "me", "lon");
  q = last("OS_QT_STATE");
  ok("Q7 a hidden four-tile word is a quartile: 20 points, 1 of 5", /Quartile/.test(q.message) && q.points === 20 && q.quartilesFound === 1 && q.score === 24);
  await Q("OS_QT_HINT", { kind: "theme", date: dq, player: "Mom" });
  await Q("OS_QT_HINT", { kind: "counts", date: dq, player: "Mom" });
  await Q("OS_QT_HINT", { kind: "letters", date: dq, player: "Mom" });
  q = last("OS_QT_STATE");
  ok("Q8 hints reveal only what they say: theme, words left per tile count, first letters of what's left", q.hints.theme === "Fun" && JSON.stringify(q.hints.counts) === JSON.stringify([1, 5, 1, 4]) && q.hints.letters.join("") === "BCFMR" && q.stats.hints === 3, q.hints);
  await Q("OS_QT_HINT", { kind: "word", date: dq, player: "Mom" });
  q = last("OS_QT_STATE");
  ok("Q9 'show a word' gives the shortest word left (never a quartile)", q.hints.shown.length === 1 && q.hints.shown[0].tiles === 1 && q.hints.shown[0].word === "ball", q.hints.shown);
  await Q("OS_QT_SYNC", { player: "Kid" });
  q = last("OS_QT_STATE");
  ok("Q10 Kid has a fresh board with no hints used", q.player === "Kid" && q.found.length === 0 && q.score === 0 && q.hints.theme === null);
  const gk = (...ts) => Q("OS_QT_GUESS", { tiles: ts.map((t) => q.tiles.indexOf(t.toUpperCase())), date: dq, player: "Kid" });
  for (const ws of [["ba", "sk", "et", "ball"], ["cho", "co", "la", "tes"], ["fi", "re", "wo", "rks"], ["ra", "in", "bo", "ws"]]) await gk(...ws);
  q = last("OS_QT_STATE");
  ok("Q11 four of five quartiles: not won yet", q.status === "playing" && q.quartilesFound === 4);
  await Q("OS_QT_GUESS", { tiles: ["wa", "ter", "me", "lon"].map((t) => q.tiles.indexOf(t.toUpperCase())), date: dq, player: "Kid" });
  q = last("OS_QT_STATE");
  ok("Q12 all five → won; stats count for Kid (best score 100)", q.status === "won" && q.stats.won === 1 && q.stats.streak === 1 && q.stats.bestScore === 100, q.stats);
  const qsaved = JSON.parse(fs.readFileSync(process.env.OPENSKY_QUARTILES, "utf8"));
  ok("Q13 saved per person; Mom is still playing", qsaved.players.Kid.stats.won === 1 && qsaved.players.Mom.today.status === "playing");

  /* ---------------- NYT down ---------------- */
  nyt.state.up = false;
  const cn2 = Object.assign(Object.create(Object.getPrototypeOf(cn)), cn); cn2.start();
  await cn2.socketNotificationReceived("OS_CN_INIT", { people: [] });
  await cn2.socketNotificationReceived("OS_CN_SYNC", { player: "" });
  ok("D1 NYT down (nothing cached): the page is told it's unavailable", last("OS_CN_STATE").unavailable === true);
  const hits = nyt.state.hits;
  await cn2.socketNotificationReceived("OS_CN_SYNC", { player: "" });
  ok("D2 not asked again within 10 minutes", nyt.state.hits === hits);

  nyt.close(); fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`SUMMARY pass=${passed} fail=${failed}`);
})().catch((e) => { console.log(`SUMMARY pass=${passed} fail=${failed + 1} (crashed: ${e.stack})`); process.exit(1); });
