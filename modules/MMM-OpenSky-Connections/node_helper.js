/* MMM-OpenSky-Connections node helper — NYT's daily Connections (find four groups of four).
 * - Today's puzzle is fetched here from NYT's public JSON (nytimes.com/svc/connections/v2/<date>.json); if that can't be
 *   reached the page says so and tries again every 10 minutes. The groups stay on the server until they are solved.
 * - Guesses are checked HERE: right group / "one away" / wrong (4 mistakes end the game and reveal the rest).
 * - One board + stats per person (see lib/game-state.js) in connections.json next to opensky.json (OPENSKY_CONNECTIONS).
 * Clues: OS_CN_HINT {date, player} reveals the name of the easiest unsolved group (never its words); at most until one group is left.
 * Socket: OS_CN_INIT {people} / OS_CN_SYNC {player} → OS_CN_STATE; OS_CN_GUESS {words, date, player} → OS_CN_STATE | OS_CN_ERROR {message}
 */
const NodeHelper = require("node_helper");
const path = require("path");
const gs = require(require("fs").existsSync(path.join(global.root_path || "", "modules", "opensky-lib", "game-state.js"))
  ? path.join(global.root_path, "modules", "opensky-lib", "game-state.js") : path.join(__dirname, "..", "..", "lib", "game-state.js"));

const FILE = gs.fileFor("OPENSKY_CONNECTIONS", "connections.json");
const MAX_MISTAKES = 4;
const freshStats = () => ({ played: 0, won: 0, streak: 0, maxStreak: 0, lastWonDate: null, perfect: 0, mistakes: [0, 0, 0, 0] });

module.exports = NodeHelper.create({
  start() {
    this.people = [];
    this.getPuzzle = gs.nytPuzzles("connections", (d) => {
      const cats = (d.categories || []).map((c) => ({ title: String(c.title || ""), words: (c.cards || []).slice().sort((a, b) => a.position - b.position).map((x) => String(x.content).toUpperCase()), positions: (c.cards || []).map((x) => x.position) }));
      if (cats.length !== 4 || cats.some((c) => c.words.length !== 4)) throw new Error("not a 4x4 puzzle");
      const cards = [];
      (d.categories || []).forEach((c) => c.cards.forEach((x) => { cards[x.position] = String(x.content).toUpperCase(); }));
      if (cards.length !== 16 || cards.some((x) => !x)) throw new Error("cards missing");
      return { id: d.id, cats: cats.map((c) => ({ title: c.title, words: c.words })), cards };
    });
  },

  // today's board for a player (a new one each day)
  async today(player) {
    const p = await this.getPuzzle();
    if (!p) return null;
    const file = gs.read(FILE), b = gs.bucket(file, player, freshStats);
    if (!b.today || b.today.date !== p.date) {
      b.today = { date: p.date, id: p.id, guesses: [], solved: [], mistakes: 0, status: "playing" };
      gs.write(FILE, file);
    }
    return { p, file, b };
  },

  view(p, b, player) {
    const t = b.today, solvedSet = new Set(t.solved);
    const lost = t.status === "lost";
    // a lost game shows every group (the unsolved ones after the solved ones, easiest first)
    const groups = t.solved.map((i) => ({ level: i, title: p.cats[i].title, words: p.cats[i].words }));
    if (lost) p.cats.forEach((c, i) => { if (!solvedSet.has(i)) groups.push({ level: i, title: c.title, words: c.words, missed: true }); });
    const left = new Set(groups.flatMap((g) => g.words));
    return {
      player, date: t.date, id: t.id, status: t.status, mistakes: t.mistakes, maxMistakes: MAX_MISTAKES,
      clues: (t.hints || []).filter((i) => !solvedSet.has(i)).map((i) => p.cats[i].title), cluesLeft: t.status === "playing" && t.solved.length < 3 ? 4 - t.solved.length - (t.hints || []).filter((i) => !solvedSet.has(i)).length : 0,
      groups, cards: p.cards.filter((w) => !left.has(w)), stats: { ...b.stats, streak: gs.liveStreak(b.stats) }
    };
  },

  // a clue: the name of the easiest group not solved yet (and not hinted yet); nothing else about the group is given away
  async hint(payload) {
    const player = gs.who(this.people, payload);
    if (player === null) return this.sendSocketNotification("OS_CN_ERROR", { message: "Pick who is playing first" });
    const t = await this.today(player);
    if (!t) return this.sendSocketNotification("OS_CN_STATE", { player, unavailable: true });
    const { p, file, b } = t, g = b.today;
    if (payload.date && payload.date !== g.date) return this.sendSocketNotification("OS_CN_ERROR", { message: "A new puzzle just started" });
    if (g.status !== "playing") return this.sendSocketNotification("OS_CN_STATE", this.view(p, b, player));
    g.hints = g.hints || [];
    const open = [0, 1, 2, 3].filter((i) => !g.solved.includes(i));
    if (open.length < 2) return this.sendSocketNotification("OS_CN_ERROR", { message: "Only one group left, no clue needed" });
    const next = open.find((i) => !g.hints.includes(i));
    if (next === undefined) return this.sendSocketNotification("OS_CN_ERROR", { message: "No more clues" });
    g.hints.push(next); b.stats.hints = (b.stats.hints || 0) + 1;
    gs.write(FILE, file);
    this.sendSocketNotification("OS_CN_STATE", this.view(p, b, player));
  },

  async socketNotificationReceived(n, payload) {
    if (n === "OS_CN_INIT" && payload && Array.isArray(payload.people)) this.people = payload.people.map((x) => String(x).trim()).filter(Boolean);
    if (n === "OS_CN_INIT" || n === "OS_CN_SYNC") {
      const player = gs.who(this.people, payload);
      if (player === null) return this.sendSocketNotification("OS_CN_STATE", { player: null });
      const t = await this.today(player);
      return this.sendSocketNotification("OS_CN_STATE", t ? this.view(t.p, t.b, player) : { player, unavailable: true });
    }
    if (n === "OS_CN_HINT") return this.hint(payload);
    if (n !== "OS_CN_GUESS") return;
    const player = gs.who(this.people, payload);
    if (player === null) return this.sendSocketNotification("OS_CN_ERROR", { message: "Pick who is playing first" });
    const t = await this.today(player);
    if (!t) return this.sendSocketNotification("OS_CN_STATE", { player, unavailable: true });
    const { p, file, b } = t, g = b.today;
    if (payload.date && payload.date !== g.date) {
      this.sendSocketNotification("OS_CN_STATE", this.view(p, b, player));
      return this.sendSocketNotification("OS_CN_ERROR", { message: "A new puzzle just started" });
    }
    if (g.status !== "playing") return this.sendSocketNotification("OS_CN_STATE", this.view(p, b, player));
    const words = [...new Set((Array.isArray(payload.words) ? payload.words : []).map((w) => String(w).toUpperCase()))];
    const solvedWords = new Set(g.solved.flatMap((i) => p.cats[i].words));
    if (words.length !== 4 || words.some((w) => !p.cards.includes(w) || solvedWords.has(w))) return this.sendSocketNotification("OS_CN_ERROR", { message: "Pick four words" });
    const key = words.slice().sort().join("|");
    if (g.guesses.includes(key)) return this.sendSocketNotification("OS_CN_ERROR", { message: "Already guessed!" });
    g.guesses.push(key);
    const hit = p.cats.findIndex((c) => words.every((w) => c.words.includes(w)));
    let message = null;
    if (hit >= 0) g.solved.push(hit);
    else {
      g.mistakes++;
      const close = p.cats.some((c) => words.filter((w) => c.words.includes(w)).length === 3);
      message = close ? "One away…" : "Not quite";
    }
    if (g.solved.length === 4 || g.mistakes >= MAX_MISTAKES) {
      const won = g.solved.length === 4, st = b.stats;
      g.status = won ? "won" : "lost";
      gs.finish(st, g.date, won);
      if (won) { st.mistakes[Math.min(g.mistakes, 3)]++; if (!g.mistakes) st.perfect++; }
      b.history[g.date] = { id: g.id, won, mistakes: g.mistakes };
    }
    gs.write(FILE, file);
    this.sendSocketNotification("OS_CN_STATE", { ...this.view(p, b, player), message, solvedNow: hit >= 0 });
  }
});
