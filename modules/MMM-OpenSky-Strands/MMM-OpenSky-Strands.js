/* MMM-OpenSky-Strands — NYT's daily Strands on the Games page: tap letters (side by side, diagonals too) to spell the theme words.
 * Tap the last letter again (or Submit) to check it; tap an earlier letter to go back to it. Words are checked on the server
 * (node_helper.js), which only reveals a theme word when it is found or when a hint is used.
 * Who is playing and whether this game is open come from the hub (MMM-OpenSky-Games, OS_GAMES_STATE). */
Module.register("MMM-OpenSky-Strands", {
  defaults: { people: [] },

  CELL: 62, GAP: 10,

  getStyles() { return ["MMM-OpenSky-Strands.css"]; },

  start() {
    this.state = null;
    this.path = [];             // the cells being picked, [[row, col], …]
    this.busy = false;
    this.player = this.config.people.length ? null : "";
    this.game = "word";
    this.sendSocketNotification("OS_ST_INIT", { people: this.config.people.map((x) => x.name) });
    this.lastDate = this.ymd();
    setInterval(() => { if (this.ymd() !== this.lastDate) { this.lastDate = this.ymd(); this.sync(); } }, 30000);
  },

  ymd(d = new Date()) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; },
  esc(t) { return String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]); },
  active() { return this.player !== null && this.game === "strands"; },
  sync() { if (this.player !== null) this.sendSocketNotification("OS_ST_SYNC", { player: this.player }); },

  resume() { this.sendNotification("OS_GAMES_HELLO"); this.sync(); },

  notificationReceived(n, p) {
    if (n !== "OS_GAMES_STATE") return;
    const changed = p.player !== this.player;
    this.player = p.player; this.game = p.game;
    if (changed) { this.state = null; this.path = []; this.busy = false; }
    this.render();
    if (this.active() && (changed || !this.state)) this.sync();
  },

  socketNotificationReceived(n, p) {
    if (n === "OS_ST_STATE" || n === "OS_ST_ERROR") { clearTimeout(this._busyTimer); this.busy = false; }
    if (n === "OS_ST_ERROR") { this.asked = false; this.toast(p.message); this.flash("bad"); return; }
    if (n !== "OS_ST_STATE" || this.player === null || p.player !== this.player) return;
    const prevDate = this.state && this.state.date;
    this.state = p;
    // a fresh pick after the player's own guess was answered (or on a new day); a background refresh keeps what they are tapping
    if (this.asked || (prevDate && prevDate !== p.date)) this.path = [];
    this.asked = false;
    this.render();
    if (p.message) this.toast(p.message);
  },

  /* ======================= actions ======================= */
  tap(r, c) {
    const s = this.state;
    if (!s || s.status !== "playing" || this.busy) return;
    if (s.found.some((f) => f.cells.some(([a, b]) => a === r && b === c))) return;      // already part of a found word
    const at = this.path.findIndex(([a, b]) => a === r && b === c);
    if (at >= 0 && at === this.path.length - 1) return this.submit();                              // the last letter again = check
    if (at >= 0) this.path = this.path.slice(0, at + 1);                                  // back up to an earlier letter
    else {
      const last = this.path[this.path.length - 1];
      if (last && Math.abs(last[0] - r) <= 1 && Math.abs(last[1] - c) <= 1) this.path.push([r, c]);
      else this.path = [[r, c]];                                                          // not next to it: start over here
    }
    this.renderBoard();
  },

  submit() {
    if (!this.state || this.busy || this.state.status !== "playing") return;
    if (this.path.length < 4) { this.toast(this.path.length ? "Too short" : "Tap letters to spell a word"); this.flash("bad"); return; }
    this.busy = true; this.asked = true;
    this.sendSocketNotification("OS_ST_GUESS", { cells: this.path, date: this.state.date, player: this.player });
    clearTimeout(this._busyTimer);
    this._busyTimer = setTimeout(() => { if (this.busy) { this.busy = false; this.toast("Couldn't check that — try again"); this.sync(); } }, 8000);
  },

  hint() {
    const s = this.state;
    if (!s || s.status !== "playing" || this.busy) return;
    if (s.hint) return;
    if (s.hintsReady < 1) { this.toast("Find 3 more words for a hint"); return; }
    this.busy = true;
    this.sendSocketNotification("OS_ST_HINT", { date: s.date, player: this.player });
  },

  flash(cls) {
    const w = this.root && this.root.querySelector(".st-word");
    if (w) { w.classList.remove("shake"); void w.offsetWidth; w.classList.add("shake"); }
  },

  /* ======================= rendering ======================= */
  getDom() {
    if (!this.root) { this.root = document.createElement("div"); this.root.className = "gm-root st-root"; }
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
    if (s.unavailable) { r.innerHTML = `<div class="gm-loading">Today's Strands puzzle isn't available right now. It comes from the New York Times, so it can take a while to appear — OpenSky keeps trying.</div>`; return; }
    const day = new Date(s.date + "T12:00:00").toLocaleDateString(config.locale || "en-US", { weekday: "long", month: "long", day: "numeric" });
    r.innerHTML = `
      <div class="gm-sub">Strands #${s.id} · ${day}${this.player ? ` · ${this.esc(this.player)}'s puzzle` : ""}</div>
      <div class="gm-body">
        <div class="gm-play">
          <div class="gm-toast" hidden></div>
          <div class="st-clue">${this.esc(s.clue)}</div>
          <div class="st-word"></div>
          <div class="st-board"></div>
          <div class="st-foot"></div>
        </div>
        <aside class="gm-side"></aside>
      </div>`;
    this.renderBoard();
    this.renderSide();
  },

  renderBoard() {
    const s = this.state, b = this.root && this.root.querySelector(".st-board");
    if (!s || !b) return;
    const G = this.GAP, play = this.root.querySelector(".gm-play");
    const S = Math.max(34, Math.min(this.CELL, Math.floor(((play ? play.clientHeight : 800) - 270 - 7 * G) / 8)));   // fit the screen's height
    const rows = s.rows.length, cols = s.rows[0].length;
    const foundAt = {}, hintAt = new Set((s.hint || []).map(([r, c]) => `${r},${c}`)), pickAt = new Set(this.path.map(([r, c]) => `${r},${c}`));
    s.found.forEach((f) => f.cells.forEach(([r, c]) => { foundAt[`${r},${c}`] = f.spangram ? "span" : "theme"; }));
    const ctr = ([r, c]) => `${c * (S + G) + S / 2},${r * (S + G) + S / 2}`;
    const lines = [...s.found.map((f) => [f.cells, f.spangram ? "span" : "theme"]), ...(this.path.length > 1 ? [[this.path, "pick"]] : [])]
      .map(([cells, k]) => cells.length > 1 ? `<polyline class="st-line ${k}" points="${cells.map(ctr).join(" ")}"/>` : "").join("");
    let html = `<svg class="st-lines" width="${cols * (S + G) - G}" height="${rows * (S + G) - G}">${lines}</svg>`;
    s.rows.forEach((row, r) => [...row].forEach((ch, c) => {
      const k = `${r},${c}`, cls = [foundAt[k] || "", !foundAt[k] && pickAt.has(k) ? "pick" : "", !foundAt[k] && hintAt.has(k) ? "hint" : ""].join(" ");
      html += `<button class="st-cell ${cls}" data-r="${r}" data-c="${c}" style="left:${c * (S + G)}px;top:${r * (S + G)}px;width:${S}px;height:${S}px">${ch}</button>`;
    }));
    b.style.width = `${cols * (S + G) - G}px`; b.style.height = `${rows * (S + G) - G}px`;
    b.innerHTML = html;
    b.querySelectorAll(".st-cell").forEach((c) => { c.onclick = () => this.tap(Number(c.dataset.r), Number(c.dataset.c)); });
    const word = this.root.querySelector(".st-word");
    if (word) {
      const cur = this.path.map(([r, c]) => s.rows[r][c]).join("");
      word.textContent = cur || (s.status === "won" ? "All found!" : "");
      word.classList.toggle("empty", !cur && s.status !== "won");
    }
    const f = this.root.querySelector(".st-foot");
    if (f) {
      f.innerHTML = s.status === "playing" ? `<div class="gm-actions"><button class="gm-btn st-del" ${this.path.length ? "" : "disabled"}>Clear</button><button class="gm-btn solid st-go" ${this.path.length >= 4 ? "" : "disabled"}>Submit</button></div>` : "";
      if (f.querySelector(".st-del")) f.querySelector(".st-del").onclick = () => { this.path = []; this.renderBoard(); };
      if (f.querySelector(".st-go")) f.querySelector(".st-go").onclick = () => this.submit();
    }
  },

  renderSide() {
    const side = this.root && this.root.querySelector(".gm-side");
    if (!side || !this.state) return;
    const s = this.state, st = s.stats, done = s.status === "won";
    const foundTheme = s.found.filter((f) => !f.spangram).length, themeTotal = s.themeCount - 1;
    const prog = s.extras % 3;
    side.innerHTML = `
      <div class="gm-card">
        ${done ? `<div class="gm-big">Solved!</div><div class="gm-small">${s.stats.hints ? "" : ""}All ${s.themeCount} theme words found</div><div class="gm-next">New puzzle at midnight</div>`
        : `<div class="gm-big">${foundTheme} of ${themeTotal} theme words found</div><div class="gm-small">${s.found.some((f) => f.spangram) ? "Spangram found" : "The spangram crosses the whole board"}</div>`}
      </div>
      ${done ? "" : `<div class="gm-card">
        <div class="gm-card-title">Hints</div>
        <div class="st-hint">
          <div class="st-pips">${[0, 1, 2].map((i) => `<i class="${s.hintsReady > 0 || i < prog ? "on" : ""}"></i>`).join("")}</div>
          <button class="gm-btn st-hintbtn" ${s.hintsReady > 0 && !s.hint ? "" : "disabled"}>${s.hint ? "Hint shown" : s.hintsReady > 0 ? "Show hint" : `${3 - prog} more word${3 - prog === 1 ? "" : "s"}`}</button>
        </div>
        <div class="gm-small">Other real words (4+ letters) earn a hint: every 3 words.</div>
      </div>`}
      <div class="gm-card">
        <div class="gm-card-title">${this.player ? `${this.esc(this.player)}'s stats` : "Family stats"}</div>
        <div class="gm-nums">
          <div><b>${st.won}</b><span>Solved</span></div><div><b>${st.streak}</b><span>Streak</span></div>
          <div><b>${st.maxStreak}</b><span>Best</span></div><div><b>${st.won ? (st.hints / st.won).toFixed(1) : "0"}</b><span>Hints/game</span></div>
        </div>
      </div>`;
    const hb = side.querySelector(".st-hintbtn");
    if (hb) hb.onclick = () => this.hint();
  },

  toast(msg) {
    const t = this.root && this.root.querySelector(".gm-toast");
    if (!t || !msg) return;
    t.textContent = msg; t.hidden = false;
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { t.hidden = true; }, 1800);
  }
});
