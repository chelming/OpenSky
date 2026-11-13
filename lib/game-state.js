/* Shared by the Games page's node helpers (Connections, Strands): who is playing, and a per-person board + stats file.
 * A file looks like { players: { "<name>": { today, stats, history } } }; with no family profiles ("" = everyone) the
 * same fields sit at the top level. Written atomically; a damaged file is copied aside, never silently wiped. */
const fs = require("fs");
const path = require("path");

const SETTINGS_DIR = path.dirname(process.env.OPENSKY_SETTINGS || path.join(global.root_path || process.cwd(), "config", "opensky.json"));
const fileFor = (envName, name) => process.env[envName] || path.join(SETTINGS_DIR, name);

const ymd = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const yesterday = () => { const y = new Date(); y.setDate(y.getDate() - 1); return ymd(y); };

function read(file) {
  let raw;
  try { raw = fs.readFileSync(file, "utf8"); } catch (e) { return {}; }   // first game: no file yet
  try { const s = JSON.parse(raw); return s && typeof s === "object" ? s : {}; } catch (e) {
    try { fs.copyFileSync(file, `${file}.damaged-${Date.now()}`); } catch (x) { /* ignore */ }
    console.error(`[OpenSky] ${path.basename(file)} unreadable (${e.message}); a copy was kept`);
    return {};
  }
}

function write(file, s) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(s, null, 1));
  fs.renameSync(`${file}.tmp`, file);
}

// One player's { today, stats, history } inside the file ("" = the shared top level); missing parts are filled in
function bucket(file, player, freshStats) {
  const holder = player ? ((file.players = file.players || {})[player] = file.players[player] || {}) : file;
  holder.stats = { ...freshStats(), ...(holder.stats || {}) };
  holder.history = holder.history || {};
  return holder;
}

// The player a message is for: a configured name (any case), "" when there are no profiles, null when none is picked
function who(people, payload) {
  if (!people.length) return "";
  const n = String((payload && payload.player) || "").trim().toLowerCase();
  return people.find((x) => x.toLowerCase() === n) || null;
}

// A streak only counts if the last win was today or yesterday
const liveStreak = (st) => (st.lastWonDate === ymd() || st.lastWonDate === yesterday() ? st.streak : 0);

// Record a finished game in the stats (won: played+won+streak; lost: played, streak resets)
function finish(st, date, won) {
  st.played++;
  if (!won) { st.streak = 0; return; }
  st.won++;
  const y = new Date(`${date}T12:00:00`); y.setDate(y.getDate() - 1);
  st.streak = st.lastWonDate === ymd(y) ? st.streak + 1 : 1;
  st.maxStreak = Math.max(st.maxStreak, st.streak);
  st.lastWonDate = date;
}

// Today's puzzle from NYT's public JSON, kept for the day; a failure is remembered for 10 minutes so every tap doesn't retry
function nytPuzzles(game, parse) {
  const base = process.env.OPENSKY_NYT_GAMES_URL || "https://www.nytimes.com/svc";
  let cached = null, failedAt = 0, loading = null;
  return async (date = ymd()) => {
    if (cached && cached.date === date) return cached;
    if (Date.now() - failedAt < 10 * 60 * 1000) return null;
    if (loading) return loading;
    loading = (async () => {
      try {
        const r = await fetch(`${base}/${game}/v2/${date}.json`, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(15000) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        cached = { date, ...parse(await r.json()) };
        failedAt = 0;
      } catch (e) {
        failedAt = Date.now();
        cached = null;
        console.log(`[OpenSky] ${game} game: NYT's puzzle unavailable (${e.message})`);
      }
      loading = null;
      return cached;
    })();
    return loading;
  };
}

module.exports = { fileFor, ymd, read, write, bucket, who, liveStreak, finish, nytPuzzles };
