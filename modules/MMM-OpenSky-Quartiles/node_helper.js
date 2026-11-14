/* MMM-OpenSky-Quartiles node helper — a daily word-building game in the style of Quartiles (Apple's game).
 * - The puzzle is the day's puzzle from quartileswordgame.com (an independent site; /api/daily?date=YYYY-MM-DD, asked for once a day):
 *   20 tiles of 2-4 letters, five hidden words made of four tiles each ("quartiles"), a theme, and every word the tiles can make.
 *   If the site can't be reached the page says so and tries again every 10 minutes (there is no built-in puzzle).
 * - A player taps tiles in order to build a word of 1-4 tiles. Points: 1 tile 2, 2 tiles 4, 3 tiles 6, 4 tiles (a quartile) 20.
 *   The game is won when all five hidden quartiles are found. The hidden words are never sent to the page; guesses are checked here.
 * - Hints (made from the puzzle's own data; the site's written crossword-style clues are not used): the theme, how many words
 *   are left for each tile count, the first letters of the words not found yet, or one word shown.
 * - The tiles are shuffled with the puzzle number as the seed, so every screen shows them in the same order.
 * - One board + stats per person (lib/game-state.js) in quartiles.json next to opensky.json (OPENSKY_QUARTILES).
 * Socket: OS_QT_INIT {people} / OS_QT_SYNC {player} → OS_QT_STATE; OS_QT_GUESS {tiles:[index…], date, player} /
 *         OS_QT_HINT {kind: "theme"|"counts"|"letters"|"word", date, player} → OS_QT_STATE | OS_QT_ERROR {message}
 */
const NodeHelper = require("node_helper");
const fs = require("fs");
const path = require("path");
const gs = require(fs.existsSync(path.join(global.root_path || "", "modules", "opensky-lib", "game-state.js"))
  ? path.join(global.root_path, "modules", "opensky-lib", "game-state.js") : path.join(__dirname, "..", "..", "lib", "game-state.js"));

const FILE = gs.fileFor("OPENSKY_QUARTILES", "quartiles.json");
const POINTS = [0, 2, 4, 6, 20];
const freshStats = () => ({ played: 0, won: 0, streak: 0, maxStreak: 0, lastWonDate: null, bestScore: 0, hints: 0 });

// small seeded random numbers (the same puzzle always gives the same tile order)
function rng(seedText) {
  let h = 1779033703 ^ seedText.length;
  for (let i = 0; i < seedText.length; i++) { h = Math.imul(h ^ seedText.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const words = (v) => (Array.isArray(v) ? v : []).map((w) => String(w).trim().toLowerCase()).filter((w) => /^[a-z]+$/.test(w));

module.exports = NodeHelper.create({
  start() {
    this.people = [];
    const base = () => process.env.OPENSKY_QUARTILES_URL || "https://quartileswordgame.com";
    this.getPuzzle = gs.dailyPuzzle("quartiles game (quartileswordgame.com)", (date) => `${base()}/api/daily?date=${date}`, (d) => {
      const tiles = (d.wordSegments || []).map((t) => String(t).trim().toLowerCase());
      const answers = words(d.targetWords);
      if (tiles.length !== 20 || tiles.some((t) => !/^[a-z]{1,4}$/.test(t)) || answers.length !== 5) throw new Error("not a 20-tile puzzle");
      // every word the tiles make, with the number of tiles it takes
      const made = new Map();
      [["oneSegmentWords", 1], ["twoSegmentWords", 2], ["threeSegmentWords", 3], ["fourSegmentWords", 4]].forEach(([k, n]) => words(d[k]).forEach((w) => { if (!made.has(w)) made.set(w, n); }));
      answers.forEach((w) => made.set(w, 4));
      const rand = rng(`quartiles:${d.puzzleNumber || d.id}`), order = tiles.slice();
      for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
      return { id: d.puzzleNumber || null, theme: String(d.themeDisplay || d.theme || ""), tiles: order, answers, words: made };
    }, "OpenSky (family wall calendar)");
  },

  // is this a real word? asks the puzzle site's dictionary (cached; unreachable = no)
  async inDictionary(word) {
    this.dict = this.dict || new Map();
    if (this.dict.has(word)) return this.dict.get(word);
    try {
      const base = process.env.OPENSKY_QUARTILES_URL || "https://quartileswordgame.com";
      const r = await fetch(`${base}/api/dictionary`, { method: "POST", headers: { "Content-Type": "application/json", "User-Agent": "OpenSky (family wall calendar)" }, body: JSON.stringify({ words: [word] }), signal: AbortSignal.timeout(8000) });
      if (!r.ok) return false;
      const d = await r.json(), ok = !!(d.results && d.results[0] && d.results[0].isValid);
      this.dict.set(word, ok);
      return ok;
    } catch (e) { return false; }
  },

  async today(player) {
    const p = await this.getPuzzle();
    if (!p) return null;
    const file = gs.read(FILE), b = gs.bucket(file, player, freshStats);
    if (!b.today || b.today.date !== p.date) { b.today = { date: p.date, found: [], score: 0, status: "playing", hints: { theme: false, counts: false, letters: false, shown: [] } }; gs.write(FILE, file); }
    if (!b.today.hints) b.today.hints = { theme: false, counts: false, letters: false, shown: [] };
    return { p, file, b };
  },

  view(p, b, player) {
    const t = b.today, h = t.hints, left = [...p.words.keys()].filter((w) => !t.found.includes(w));
    return {
      player, date: t.date, id: p.id, tiles: p.tiles.map((x) => x.toUpperCase()), status: t.status, score: t.score,
      found: t.found.map((w) => { const n = p.words.get(w) || (t.extra || {})[w] || 1; return { word: w, tiles: n, points: POINTS[n] }; }),
      quartilesFound: p.answers.filter((w) => t.found.includes(w)).length, quartileTotal: p.answers.length,
      wordTotal: p.words.size, quartileTiles: t.quartileTiles || [],
      // only what a hint has revealed
      hints: {
        theme: h.theme ? p.theme : null,
        counts: h.counts ? [1, 2, 3, 4].map((n) => left.filter((w) => p.words.get(w) === n).length) : null,
        letters: h.letters ? [...new Set(left.map((w) => w[0].toUpperCase()))].sort() : null,
        shown: h.shown.filter((w) => !t.found.includes(w)).map((w) => ({ word: w, tiles: p.words.get(w) }))
      },
      stats: { ...b.stats, streak: gs.liveStreak(b.stats) }
    };
  },

  async socketNotificationReceived(n, payload) {
    if (n === "OS_QT_INIT" && payload && Array.isArray(payload.people)) this.people = payload.people.map((x) => String(x).trim()).filter(Boolean);
    if (n === "OS_QT_INIT" || n === "OS_QT_SYNC") {
      const player = gs.who(this.people, payload);
      if (player === null) return this.sendSocketNotification("OS_QT_STATE", { player: null });
      const t = await this.today(player);
      return this.sendSocketNotification("OS_QT_STATE", t ? this.view(t.p, t.b, player) : { player, unavailable: true });
    }
    if (n !== "OS_QT_GUESS" && n !== "OS_QT_HINT") return;
    const player = gs.who(this.people, payload);
    if (player === null) return this.sendSocketNotification("OS_QT_ERROR", { message: "Pick who is playing first" });
    const t0 = await this.today(player);
    if (!t0) return this.sendSocketNotification("OS_QT_STATE", { player, unavailable: true });
    const { p, file, b } = t0, t = b.today, send = (extra) => this.sendSocketNotification("OS_QT_STATE", { ...this.view(p, b, player), ...extra });
    if (payload.date && payload.date !== t.date) { send(); return this.sendSocketNotification("OS_QT_ERROR", { message: "A new puzzle just started" }); }
    if (t.status !== "playing") return send();

    if (n === "OS_QT_HINT") {
      const kind = payload.kind, h = t.hints, left = [...p.words.keys()].filter((w) => !t.found.includes(w));
      if (kind === "theme" || kind === "counts" || kind === "letters") {
        if (!h[kind]) { h[kind] = true; b.stats.hints++; }
      } else if (kind === "word") {
        // a quartile is never given away; the shortest word not found yet and not already shown
        const open = left.filter((w) => p.words.get(w) < 4 && !h.shown.includes(w)).sort((a, c) => p.words.get(a) - p.words.get(c) || a.localeCompare(c));
        if (!open.length) return this.sendSocketNotification("OS_QT_ERROR", { message: "No more words to show" });
        h.shown.push(open[0]); b.stats.hints++;
      } else return this.sendSocketNotification("OS_QT_ERROR", { message: "Unknown hint" });
      gs.write(FILE, file);
      return send();
    }

    const idx = Array.isArray(payload.tiles) ? payload.tiles : [];
    if (!idx.length || idx.length > 4 || new Set(idx).size !== idx.length || idx.some((i) => !Number.isInteger(i) || i < 0 || i >= p.tiles.length)) return this.sendSocketNotification("OS_QT_ERROR", { message: "Pick up to four tiles" });
    const word = idx.map((i) => p.tiles[i]).join("");
    if (t.found.includes(word)) return this.sendSocketNotification("OS_QT_ERROR", { message: "Already found" });
    // the puzzle's list is only the words its author knew; any other real word counts too (the site's own dictionary decides)
    if (!p.words.has(word) && !(await this.inDictionary(word))) return this.sendSocketNotification("OS_QT_ERROR", { message: word.length < 3 ? "Too short" : "Not in word list" });
    if (t.found.includes(word)) return this.sendSocketNotification("OS_QT_ERROR", { message: "Already found" });
    const size = p.words.get(word) || idx.length, points = POINTS[size];
    if (!p.words.has(word)) (t.extra = t.extra || {})[word] = size;
    t.found.push(word); t.score += points;
    if (idx.length === 4 && p.answers.includes(word)) (t.quartileTiles = t.quartileTiles || []).push(...idx);   // the tiles that made a quartile turn green
    if (p.answers.every((w) => t.found.includes(w))) {
      t.status = "won";
      const st = b.stats;
      gs.finish(st, t.date, true);
      st.bestScore = Math.max(st.bestScore, t.score);
      b.history[t.date] = { score: t.score, words: t.found.length };
    }
    gs.write(FILE, file);
    send({ foundNow: word, points, message: size === 4 ? `Quartile! +${points}` : `+${points}` });
  }
});
