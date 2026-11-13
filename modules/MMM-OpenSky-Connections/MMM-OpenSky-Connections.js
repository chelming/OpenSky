/* MMM-OpenSky-Connections — NYT's daily Connections on the Games page: tap four words that belong together.
 * Groups are checked on the server (node_helper.js); the page only learns a group when it is solved.
 * Who is playing and whether this game is open come from the hub (MMM-OpenSky-Games, OS_GAMES_STATE). */
Module.register("MMM-OpenSky-Connections", {
  defaults: { people: [] },

  LEVELS: ["yellow", "green", "blue", "purple"],

  getStyles() { return ["MMM-OpenSky-Connections.css"]; },

  start() {
    this.state = null;
    this.order = [];            // the order of the remaining cards on the board (shuffle changes it)
    this.picked = [];
    this.busy = false;
    this.player = this.config.people.length ? null : "";
    this.game = "word";
    this.sendSocketNotification("OS_CN_INIT", { people: this.config.people.map((x) => x.name) });
    this.lastDate = this.ymd();
    setInterval(() => { if (this.ymd() !== this.lastDate) { this.lastDate = this.ymd(); this.sync(); } }, 30000);
  },

  ymd(d = new Date()) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; },
  esc(t) { return String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]); },
  active() { return this.player !== null && this.game === "connections"; },
  sync() { if (this.player !== null) this.sendSocketNotification("OS_CN_SYNC", { player: this.player }); },

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
    if (n === "OS_CN_STATE" || n === "OS_CN_ERROR") { clearTimeout(this._busyTimer); this.busy = false; }
    if (n === "OS_CN_ERROR") { this.toast(p.message); return; }
    if (n !== "OS_CN_STATE" || this.player === null || p.player !== this.player) return;
    const prev = this.state;
    this.state = p;
    // keep the player's own card order; drop solved cards, add any new ones
    const left = new Set(p.cards || []);
    this.order = this.order.filter((w) => left.has(w));
    (p.cards || []).forEach((w) => { if (!this.order.includes(w)) this.order.push(w); });
    this.picked = this.picked.filter((w) => left.has(w));
    if (p.solvedNow) this.picked = [];
    this.render();
    if (p.message) {
      this.toast(p.message);
      if (!p.solvedNow) this.shake();
    }
    if (prev && prev.date !== p.date) this.picked = [];
  },

  /* ======================= actions ======================= */
  toggle(w) {
    if (!this.state || this.state.status !== "playing" || this.busy) return;
    const i = this.picked.indexOf(w);
    if (i >= 0) this.picked.splice(i, 1);
    else if (this.picked.length < 4) this.picked.push(w);
    this.renderBoard();
  },

  submit() {
    if (this.picked.length !== 4 || this.busy || !this.state || this.state.status !== "playing") return;
    this.busy = true;
    this.sendSocketNotification("OS_CN_GUESS", { words: this.picked, date: this.state.date, player: this.player });
    clearTimeout(this._busyTimer);
    this._busyTimer = setTimeout(() => { if (this.busy) { this.busy = false; this.toast("Couldn't check that — try again"); this.sync(); } }, 8000);
  },

  shuffle() {
    for (let i = this.order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [this.order[i], this.order[j]] = [this.order[j], this.order[i]]; }
    this.renderBoard();
  },

  shake() {
    const b = this.root && this.root.querySelector(".cn-grid");
    if (b) { b.classList.remove("shake"); void b.offsetWidth; b.classList.add("shake"); }
  },

  /* ======================= rendering ======================= */
  getDom() {
    if (!this.root) { this.root = document.createElement("div"); this.root.className = "gm-root cn-root"; }
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
    if (s.unavailable) { r.innerHTML = `<div class="gm-loading">Today's Connections puzzle isn't available right now. It comes from the New York Times, so it can take a while to appear — OpenSky keeps trying.</div>`; return; }
    const day = new Date(s.date + "T12:00:00").toLocaleDateString(config.locale || "en-US", { weekday: "long", month: "long", day: "numeric" });
    r.innerHTML = `
      <div class="gm-sub">Connections #${s.id} · ${day}${this.player ? ` · ${this.esc(this.player)}'s puzzle` : ""}</div>
      <div class="gm-body">
        <div class="gm-play">
          <div class="gm-toast" hidden></div>
          <div class="cn-board"></div>
          <div class="cn-foot"></div>
        </div>
        <aside class="gm-side"></aside>
      </div>`;
    this.renderBoard();
    this.renderSide();
  },

  renderBoard() {
    const s = this.state, b = this.root && this.root.querySelector(".cn-board");
    if (!s || !b) return;
    const playing = s.status === "playing";
    const groups = s.groups.map((g) => `<div class="cn-group ${this.LEVELS[g.level]}${g.missed ? " missed" : ""}"><b>${this.esc(g.title)}</b><span>${g.words.map((w) => this.esc(w)).join(", ")}</span></div>`).join("");
    const cards = this.order.map((w) => `<button class="cn-card${this.picked.includes(w) ? " on" : ""}" data-w="${this.esc(w)}">${this.esc(w)}</button>`).join("");
    b.innerHTML = `${groups}${cards ? `<div class="cn-grid" style="--rows:${Math.ceil(this.order.length / 4)}">${cards}</div>` : ""}`;
    b.querySelectorAll(".cn-card").forEach((c) => { c.onclick = () => this.toggle(c.dataset.w); });
    const f = this.root.querySelector(".cn-foot");
    if (!f) return;
    f.innerHTML = playing ? `
      <div class="gm-dots">Mistakes left ${Array.from({ length: s.maxMistakes }, (_, i) => `<i class="${i < s.maxMistakes - s.mistakes ? "" : "gone"}"></i>`).join("")}</div>
      <div class="gm-actions"><button class="gm-btn cn-shuffle">Shuffle</button><button class="gm-btn cn-clear" ${this.picked.length ? "" : "disabled"}>Deselect all</button><button class="gm-btn solid cn-submit" ${this.picked.length === 4 ? "" : "disabled"}>Submit</button></div>` : "";
    const q = (sel) => f.querySelector(sel);
    if (q(".cn-shuffle")) q(".cn-shuffle").onclick = () => this.shuffle();
    if (q(".cn-clear")) q(".cn-clear").onclick = () => { this.picked = []; this.renderBoard(); };
    if (q(".cn-submit")) q(".cn-submit").onclick = () => this.submit();
  },

  renderSide() {
    const side = this.root && this.root.querySelector(".gm-side");
    if (!side || !this.state) return;
    const s = this.state, st = s.stats, done = s.status !== "playing";
    const winPct = st.played ? Math.round((st.won / st.played) * 100) : 0;
    const maxD = Math.max(1, ...st.mistakes);
    side.innerHTML = `
      <div class="gm-card">
        ${s.status === "won" ? `<div class="gm-big">${s.mistakes === 0 ? "Perfect!" : "Solved!"}</div><div class="gm-small">${s.mistakes === 0 ? "No mistakes" : `${s.mistakes} ${s.mistakes === 1 ? "mistake" : "mistakes"}`}</div>`
        : s.status === "lost" ? `<div class="gm-big">Next time!</div><div class="gm-small">The groups are shown on the board</div>`
        : `<div class="gm-big">Create four groups</div><div class="gm-small">Tap four words that go together, then Submit</div>`}
        ${done ? `<div class="gm-next">New puzzle at midnight</div>` : ""}
      </div>
      <div class="gm-card">
        <div class="gm-card-title">${this.player ? `${this.esc(this.player)}'s stats` : "Family stats"}</div>
        <div class="gm-nums">
          <div><b>${st.played}</b><span>Played</span></div><div><b>${winPct}</b><span>Win %</span></div>
          <div><b>${st.streak}</b><span>Streak</span></div><div><b>${st.maxStreak}</b><span>Best</span></div>
        </div>
        <div class="gm-card-title" style="margin-top:16px">Mistakes when solved</div>
        <div class="cn-dist">${st.mistakes.map((n, i) => `<div class="cn-drow"><span>${i}</span><div class="cn-bar" style="width:${Math.max(8, (n / maxD) * 100)}%">${n}</div></div>`).join("")}</div>
      </div>`;
  },

  toast(msg) {
    const t = this.root && this.root.querySelector(".gm-toast");
    if (!t || !msg) return;
    t.textContent = msg; t.hidden = false;
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { t.hidden = true; }, 1800);
  }
});
