/* MMM-OpenSky-Strands node helper — NYT's daily Strands (find the theme words in a 6×8 letter grid).
 * - Today's puzzle comes from NYT's public JSON (nytimes.com/svc/strands/v2/<date>.json), tried again every 10 minutes if
 *   it can't be reached. The theme words, spangram and their places stay on the server until they are found.
 * - A guess is a path of cells; it is checked HERE: a theme word / the spangram (locked in), any other real word of
 *   4+ letters (counts toward a hint: every 3 earns one), or not a word. A hint marks the letters of one unfound word.
 * - One board + stats per person (lib/game-state.js) in strands.json next to opensky.json (OPENSKY_STRANDS).
 * Socket: OS_ST_INIT {people} / OS_ST_SYNC {player} → OS_ST_STATE; OS_ST_GUESS {cells, date, player} / OS_ST_HINT {date, player}
 *         → OS_ST_STATE | OS_ST_ERROR {message}
 */
const NodeHelper = require("node_helper");
const path = require("path");
const gs = require(require("fs").existsSync(path.join(global.root_path || "", "modules", "opensky-lib", "game-state.js"))
  ? path.join(global.root_path, "modules", "opensky-lib", "game-state.js") : path.join(__dirname, "..", "..", "lib", "game-state.js"));

const FILE = gs.fileFor("OPENSKY_STRANDS", "strands.json");
const ROWS = 8, COLS = 6;
const freshStats = () => ({ played: 0, won: 0, streak: 0, maxStreak: 0, lastWonDate: null, hints: 0 });
const cellKey = (cells) => cells.map(([r, c]) => `${r},${c}`).sort().join("|");

module.exports = NodeHelper.create({
  start() {
    this.people = [];
    this.getPuzzle = gs.nytPuzzles("strands", (d) => {
      const board = d.startingBoard;
      if (!Array.isArray(board) || board.length !== ROWS || board.some((r) => String(r).length !== COLS)) throw new Error("not a 6x8 board");
      const words = Object.entries(d.themeCoords || {}).map(([w, cells]) => ({ word: w, cells, spangram: false }));
      if (!words.length || !Array.isArray(d.spangramCoords)) throw new Error("no theme words");
      words.push({ word: String(d.spangram), cells: d.spangramCoords, spangram: true });
      return { id: d.id, clue: String(d.clue || ""), board: board.map((r) => String(r).toUpperCase()), words,
        dictionary: new Set((d.solutions || []).map((w) => String(w).toLowerCase())) };
    });
  },

  async today(player) {
    const p = await this.getPuzzle();
    if (!p) return null;
    const file = gs.read(FILE), b = gs.bucket(file, player, freshStats);
    if (!b.today || b.today.date !== p.date) {
      b.today = { date: p.date, id: p.id, found: [], extras: [], hintsUsed: 0, hint: null, status: "playing" };
      gs.write(FILE, file);
    }
    return { p, file, b };
  },

  view(p, b, player) {
    const t = b.today;
    return {
      player, date: t.date, id: t.id, clue: p.clue, rows: p.board, status: t.status,
      themeCount: p.words.length,
      found: t.found.map((f) => { const w = p.words.find((x) => x.word === f); return { word: w.word, cells: w.cells, spangram: w.spangram }; }),
      extras: t.extras.length, hintsReady: Math.floor(t.extras.length / 3) - t.hintsUsed, hint: t.hint,
      stats: { ...b.stats, streak: gs.liveStreak(b.stats) }
    };
  },

  async socketNotificationReceived(n, payload) {
    if (n === "OS_ST_INIT" && payload && Array.isArray(payload.people)) this.people = payload.people.map((x) => String(x).trim()).filter(Boolean);
    if (n === "OS_ST_INIT" || n === "OS_ST_SYNC") {
      const player = gs.who(this.people, payload);
      if (player === null) return this.sendSocketNotification("OS_ST_STATE", { player: null });
      const t = await this.today(player);
      return this.sendSocketNotification("OS_ST_STATE", t ? this.view(t.p, t.b, player) : { player, unavailable: true });
    }
    if (n !== "OS_ST_GUESS" && n !== "OS_ST_HINT") return;
    const player = gs.who(this.people, payload);
    if (player === null) return this.sendSocketNotification("OS_ST_ERROR", { message: "Pick who is playing first" });
    const t = await this.today(player);
    if (!t) return this.sendSocketNotification("OS_ST_STATE", { player, unavailable: true });
    const { p, file, b } = t, g = b.today, send = (extra) => this.sendSocketNotification("OS_ST_STATE", { ...this.view(p, b, player), ...extra });
    if (payload.date && payload.date !== g.date) { send(); return this.sendSocketNotification("OS_ST_ERROR", { message: "A new puzzle just started" }); }
    if (g.status !== "playing") return send();

    if (n === "OS_ST_HINT") {
      if (g.hint) return send();
      if (Math.floor(g.extras.length / 3) - g.hintsUsed < 1) return this.sendSocketNotification("OS_ST_ERROR", { message: "Find 3 more words for a hint" });
      // a theme word first; the spangram only when it's all that's left
      const open = p.words.filter((w) => !g.found.includes(w.word));
      const pick = open.find((w) => !w.spangram) || open[0];
      g.hintsUsed++; b.stats.hints++;
      g.hint = pick.cells;
      gs.write(FILE, file);
      return send();
    }

    // a guess: a path of adjacent, distinct cells inside the grid
    const cells = Array.isArray(payload.cells) ? payload.cells : [];
    const ok = cells.length >= 1 && cells.length <= ROWS * COLS && cells.every((c) => Array.isArray(c) && Number.isInteger(c[0]) && Number.isInteger(c[1]) && c[0] >= 0 && c[0] < ROWS && c[1] >= 0 && c[1] < COLS)
      && new Set(cells.map((c) => c.join(","))).size === cells.length
      && cells.every((c, i) => i === 0 || (Math.abs(c[0] - cells[i - 1][0]) <= 1 && Math.abs(c[1] - cells[i - 1][1]) <= 1));
    if (!ok) return this.sendSocketNotification("OS_ST_ERROR", { message: "Not a word" });
    if (cells.length < 4) return this.sendSocketNotification("OS_ST_ERROR", { message: "Too short" });
    const word = cells.map(([r, c]) => p.board[r][c]).join("");
    const key = cellKey(cells);
    // the path has to spell the word: the right cells picked in another order are not it
    const hit = p.words.find((w) => w.cells.length === cells.length && w.cells.every((c, i) => c[0] === cells[i][0] && c[1] === cells[i][1]));
    if (hit) {
      if (g.found.includes(hit.word)) return this.sendSocketNotification("OS_ST_ERROR", { message: "Already found" });
      g.found.push(hit.word);
      if (g.hint && cellKey(g.hint) === key) g.hint = null;
      if (g.found.length === p.words.length) {
        g.status = "won"; g.hint = null;
        gs.finish(b.stats, g.date, true);
        b.history[g.date] = { id: g.id, hints: g.hintsUsed };
      }
      gs.write(FILE, file);
      return send({ message: hit.spangram ? "Spangram!" : null, foundNow: hit.word });
    }
    if (p.words.some((w) => g.found.includes(w.word) && cellKey(w.cells) === key)) return this.sendSocketNotification("OS_ST_ERROR", { message: "Already found" });
    if (p.words.some((w) => w.word === word || (cellKey(w.cells) === key && !p.dictionary.has(word.toLowerCase())))) return this.sendSocketNotification("OS_ST_ERROR", { message: "Not quite — try the letters in another order" });
    if (!p.dictionary.has(word.toLowerCase())) return this.sendSocketNotification("OS_ST_ERROR", { message: "Not in word list" });
    if (g.extras.includes(word)) return this.sendSocketNotification("OS_ST_ERROR", { message: "Already found" });
    g.extras.push(word);
    gs.write(FILE, file);
    send({ message: Math.floor(g.extras.length / 3) - g.hintsUsed > 0 && g.extras.length % 3 === 0 ? "Hint ready!" : null });
  }
});
