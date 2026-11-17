/* MMM-OpenSky-Quartiles — a daily word-building game on the Games page: 20 tiles of letters; tap one to four tiles in order to
 * spell a word. Five hidden words are made of four tiles each (the "quartiles"); find them all to win.
 * Words are checked on the server (node_helper.js), which only reveals a word when it is found or a hint shows it.
 * Who is playing and whether this game is open come from the hub (MMM-OpenSky-Games, OS_GAMES_STATE). */
Module.register("MMM-OpenSky-Quartiles", {
  defaults: { people: [] },

  HINTS: [["theme", "Show the theme"], ["counts", "Word counts"], ["letters", "First letters"], ["word", "Show a word"], ["clue", "Crossword clue"]],

  getStyles() { return ["MMM-OpenSky-Quartiles.css"]; },

  start() {
    this.state = null;
    this.order = [];            // tile indexes in the order shown (Shuffle changes it)
    this.picked = [];           // tile indexes being spelled, in order
    this.busy = false;
    this.asked = false;
    this.player = this.config.people.length ? null : "";
    this.game = "word";
    this.sendSocketNotification("OS_QT_INIT", { people: this.config.people.map((x) => x.name) });
    this.lastDate = this.ymd();
    setInterval(() => { if (this.ymd() !== this.lastDate) { this.lastDate = this.ymd(); this.sync(); } }, 30000);
  },

  ymd(d = new Date()) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; },
  esc(t) { return String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]); },
  active() { return this.player !== null && this.game === "quartiles"; },
  sync() { if (this.player !== null) this.sendSocketNotification("OS_QT_SYNC", { player: this.player }); },

  resume() { this.sendNotification("OS_GAMES_HELLO"); this.sync(); },

  notificationReceived(n, p) {
    if (n !== "OS_GAMES_STATE") return;
    const changed = p.player !== this.player;
    this.player = p.player; this.game = p.game;
    if (changed) { this.state = null; this.picked = []; this.order = []; this.busy = false; }
    this.render();
    if (this.active() && (changed || !this.state)) this.sync();
  },

  socketNotificationReceived(n, p) {
    if (n === "OS_QT_STATE" || n === "OS_QT_ERROR") { clearTimeout(this._busyTimer); this.busy = false; }
    if (n === "OS_QT_ERROR") { this.asked = false; this.toast(p.message); this.shakeWord(); return; }
    if (n !== "OS_QT_STATE" || this.player === null || p.player !== this.player) return;
    const prevDate = this.state && this.state.date;
    this.state = p;
    if (p.tiles && this.order.length !== p.tiles.length) this.order = p.tiles.map((_, i) => i);
    // a fresh pick after the player's own word was answered (or on a new day); a background refresh keeps what they are tapping
    if (this.asked || (prevDate && prevDate !== p.date)) this.picked = [];
    this.asked = false;
    this.render();
    if (p.message) this.toast(p.message);
  },

  /* ======================= actions ======================= */
  tap(i) {
    const s = this.state;
    if (!s || s.status !== "playing" || this.busy) return;
    const at = this.picked.indexOf(i);
    if (at >= 0) this.picked = this.picked.slice(0, at);        // tap a picked tile: it and everything after it comes off
    else if (this.picked.length < 4) this.picked.push(i);
    this.renderBoard();
  },

  submit() {
    const s = this.state;
    if (!s || this.busy || s.status !== "playing" || !this.picked.length) return;
    this.busy = true; this.asked = true;
    this.sendSocketNotification("OS_QT_GUESS", { tiles: this.picked, date: s.date, player: this.player });
    clearTimeout(this._busyTimer);
    this._busyTimer = setTimeout(() => { if (this.busy) { this.busy = false; this.asked = false; this.toast("Couldn't check that — try again"); this.sync(); } }, 8000);
  },

  shuffle() {
    for (let i = this.order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [this.order[i], this.order[j]] = [this.order[j], this.order[i]]; }
    this.renderBoard();
  },

  // the tiles of the quartiles found so far go first, in the order they were found (a row each), the rest are shuffled
  shuffleRest() {
    const s = this.state;
    if (!s || !(s.quartileTiles || []).length) return;
    const done = s.quartileTiles, rest = this.order.filter((i) => !done.includes(i));
    for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
    this.order = [...done, ...rest];
    this.renderBoard();
  },

  hint(kind) {
    const s = this.state;
    if (!s || s.status !== "playing" || this.busy) return;
    this.sendSocketNotification("OS_QT_HINT", { kind, date: s.date, player: this.player });
  },

  shakeWord() {
    const w = this.root && this.root.querySelector(".qt-word");
    if (w) { w.classList.remove("shake"); void w.offsetWidth; w.classList.add("shake"); }
  },

  /* ======================= rendering ======================= */
  getDom() {
    if (!this.root) { this.root = document.createElement("div"); this.root.className = "gm-root qt-root"; }
    setTimeout(() => this.render(), 0);
    return this.root;
  },

  render() {
    const r = this.root;
    if (!r) return;
    r.style.display = this.active() ? "" : "none";
    if (!this.active()) return;
    const s = this.state;
    if (!s) { r.innerHTML = `<div class="gm-loading">Loading today's puzzle…</div>`; return; }
    if (s.unavailable) { r.innerHTML = `<div class="gm-loading">Today's Quartiles puzzle isn't available right now. It comes from quartileswordgame.com, so it can take a while to appear — OpenSky keeps trying.</div>`; return; }
    const day = new Date(s.date + "T12:00:00").toLocaleDateString(config.locale || "en-US", { weekday: "long", month: "long", day: "numeric" });
    r.innerHTML = `
      <div class="gm-sub">Quartiles${s.id ? ` #${s.id}` : ""} · ${day}${this.player ? ` · ${this.esc(this.player)}'s puzzle` : ""}</div>
      <div class="gm-body">
        <div class="gm-play">
          <div class="gm-toast" hidden></div>
          <div class="qt-word"></div>
          <div class="qt-board"></div>
          <div class="qt-foot"></div>
        </div>
        <aside class="gm-side"></aside>
      </div>`;
    this.renderBoard();
    this.renderSide();
  },

  renderBoard() {
    const s = this.state, b = this.root && this.root.querySelector(".qt-board");
    if (!s || !b) return;
    b.innerHTML = this.order.map((i) => {
      const at = this.picked.indexOf(i);
      const done = (s.quartileTiles || []).includes(i);
      return `<button class="qt-tile${at >= 0 ? " on" : ""}${done ? " done" : ""}" data-i="${i}">${this.esc(s.tiles[i])}${at >= 0 ? `<i>${at + 1}</i>` : ""}</button>`;
    }).join("");
    b.querySelectorAll(".qt-tile").forEach((t) => { t.onclick = () => this.tap(Number(t.dataset.i)); });
    const w = this.root.querySelector(".qt-word");
    if (w) w.textContent = this.picked.map((i) => s.tiles[i]).join("") || (s.status === "won" ? "All quartiles found!" : "");
    const f = this.root.querySelector(".qt-foot");
    if (!f) return;
    f.innerHTML = s.status === "playing" ? `<div class="gm-actions"><button class="gm-btn qt-shuffle">Shuffle</button><button class="gm-btn qt-rest" ${(s.quartileTiles || []).length ? "" : "disabled"}>Shuffle rest</button><button class="gm-btn qt-clear" ${this.picked.length ? "" : "disabled"}>Clear</button><button class="gm-btn solid qt-go" ${this.picked.length ? "" : "disabled"}>Submit</button></div>` : "";
    const q = (sel) => f.querySelector(sel);
    if (q(".qt-shuffle")) q(".qt-shuffle").onclick = () => this.shuffle();
    if (q(".qt-rest")) q(".qt-rest").onclick = () => this.shuffleRest();
    if (q(".qt-clear")) q(".qt-clear").onclick = () => { this.picked = []; this.renderBoard(); };
    if (q(".qt-go")) q(".qt-go").onclick = () => this.submit();
  },

  renderSide() {
    const side = this.root && this.root.querySelector(".gm-side");
    if (!side || !this.state) return;
    const s = this.state, st = s.stats, h = s.hints, done = s.status === "won";
    const found = s.found.slice().sort((a, c) => c.tiles - a.tiles || a.word.localeCompare(c.word));
    side.innerHTML = `
      <div class="gm-card">
        <div class="gm-big">${done ? "Solved!" : `${s.quartilesFound} of ${s.quartileTotal} quartiles`}</div>
        <div class="gm-small">${s.score} points · ${s.found.length} of ${s.wordTotal} words</div>
        ${done ? `<div class="gm-next">New puzzle at midnight</div>` : ""}
        <div class="qt-found">${found.map((f) => `<span class="qt-chip t${f.tiles}">${this.esc(f.word)}</span>`).join("") || `<span class="gm-small">Tap tiles to spell words of 1 to 4 tiles</span>`}</div>
      </div>
      ${done ? "" : `<div class="gm-card">
        <div class="gm-card-title">Hints</div>
        <div class="qt-hints">${this.HINTS.map(([k, label]) => `<button class="gm-btn qt-hint" data-k="${k}" ${(k === "theme" && h.theme) || (k === "counts" && h.counts) || (k === "letters" && h.letters) ? "disabled" : ""}>${label}</button>`).join("")}</div>
        ${h.theme ? `<div class="qt-reveal"><b>Theme:</b> ${this.esc(h.theme)}</div>` : ""}
        ${h.counts ? `<div class="qt-reveal"><b>Words left:</b> ${h.counts.map((n, i) => `${n} of ${i + 1} tile${i ? "s" : ""}`).join(" · ")}</div>` : ""}
        ${h.letters ? `<div class="qt-reveal"><b>First letters:</b> ${h.letters.join(" ")}</div>` : ""}
        ${(h.clues || []).map((x) => `<div class="qt-reveal"><b>Clue:</b> ${this.esc(x.clue)} <span class="gm-small">(${x.tiles} tile${x.tiles > 1 ? "s" : ""}, ${x.letters} letters)</span></div>`).join("")}
        ${h.shown.length ? `<div class="qt-reveal"><b>Try:</b> ${h.shown.map((x) => `${this.esc(x.word)} (${x.tiles} tile${x.tiles > 1 ? "s" : ""})`).join(", ")}</div>` : ""}
      </div>`}
      <div class="gm-card">
        <div class="gm-card-title">${this.player ? `${this.esc(this.player)}'s stats` : "Family stats"}</div>
        <div class="gm-nums">
          <div><b>${st.won}</b><span>Solved</span></div><div><b>${st.streak}</b><span>Streak</span></div>
          <div><b>${st.maxStreak}</b><span>Best</span></div><div><b>${st.bestScore}</b><span>Top score</span></div>
        </div>
      </div>`;
    side.querySelectorAll(".qt-hint").forEach((b) => { b.onclick = () => this.hint(b.dataset.k); });
  },

  toast(msg) {
    const t = this.root && this.root.querySelector(".gm-toast");
    if (!t || !msg) return;
    t.textContent = msg; t.hidden = false;
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { t.hidden = true; }, 1800);
  }
});
