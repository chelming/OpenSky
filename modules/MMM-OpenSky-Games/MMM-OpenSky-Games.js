/* MMM-OpenSky-Games — the hub of the Games page (page key "wordgame"): asks who is playing (once, for every game), shows the
 * game tabs (Word Game · Connections · Strands) and the player with "Switch player". The games themselves are
 * MMM-OpenSky-WordGame / -Connections / -Strands; they listen for OS_GAMES_STATE { player, game } from here.
 * player: null = nobody picked yet, "" = no family profiles (one shared board), else a profile name.
 * Nothing is remembered: the idle reset (and "Switch player") goes back to "Who's playing?". */
Module.register("MMM-OpenSky-Games", {
  defaults: { people: [] },   // family profiles [{ name, color, photo }]

  GAMES: [["word", "Word Game", "W"], ["connections", "Connections", "C"], ["strands", "Strands", "S"], ["quartiles", "Quartiles", "Q"]],

  getStyles() { return ["MMM-OpenSky-Games.css"]; },

  start() {
    this.player = this.config.people.length ? null : "";
    this.game = "word";
  },

  esc(t) { return String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]); },

  getDom() {
    if (!this.root) { this.root = document.createElement("div"); this.root.className = "gh-root"; }
    setTimeout(() => { this.render(); this.announce(); }, 0);
    return this.root;
  },

  announce() { this.sendNotification("OS_GAMES_STATE", { player: this.player, game: this.game }); },

  // every time the Games page is opened: back to "Who's playing?" (and the Word Game tab)
  resume() {
    this.player = this.config.people.length ? null : "";
    this.game = "word";
    this.render(); this.announce();
  },

  notificationReceived(n) {
    if (n === "OS_GAMES_HELLO") this.announce();
    if (n === "OPENSKY_IDLE_RESET") this.setPlayer(this.config.people.length ? null : "");
  },

  setPlayer(name) {
    if (name === this.player) return;
    this.player = name;
    this.render(); this.announce();
  },

  render() {
    const r = this.root;
    if (!r) return;
    document.documentElement.style.setProperty("--gh-bar", this.player === null ? "0px" : "64px");
    if (this.player === null) {
      r.className = "gh-root gh-pick";
      r.innerHTML = `
        <div class="gh-who"><div class="gh-who-q">Who's playing?</div>
          <div class="gh-who-row">${this.config.people.map((x, i) => `<button class="gh-person" data-i="${i}">
            <span class="gh-av" style="background:${x.color || "#9ca3af"}">${x.photo ? `<img src="${x.photo}" alt="">` : this.esc(x.name.charAt(0).toUpperCase())}</span>${this.esc(x.name)}</button>`).join("")}</div></div>`;
      r.querySelectorAll(".gh-person").forEach((b) => { b.onclick = () => this.setPlayer(this.config.people[Number(b.dataset.i)].name); });
      return;
    }
    r.className = "gh-root";
    const who = this.player ? this.config.people.find((x) => x.name === this.player) : null;
    r.innerHTML = `
      <div class="gh-tabs">${this.GAMES.map(([k, label, ch]) => `<button class="gh-tab${k === this.game ? " on" : ""}" data-g="${k}"><i>${ch}</i>${label}</button>`).join("")}</div>
      ${this.player ? `<button class="gh-switch"><span class="gh-av sm" style="background:${(who && who.color) || "#9ca3af"}">${who && who.photo ? `<img src="${who.photo}" alt="">` : this.esc(this.player.charAt(0).toUpperCase())}</span>${this.esc(this.player)}<span class="gh-sw">Switch</span></button>` : ""}`;
    r.querySelectorAll(".gh-tab").forEach((b) => { b.onclick = () => { this.game = b.dataset.g; this.render(); this.announce(); }; });
    const sw = r.querySelector(".gh-switch");
    if (sw) sw.onclick = () => this.setPlayer(null);
  }
});
