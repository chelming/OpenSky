/* OpenSky share page (server side) — lets family members add a photo or post a note from their own phone.
 *
 * A second, small web server (opensky.json → share: { enabled: true, port: 8091 }) that is on whenever OpenSky runs, unlike
 * phone setup. It has its own, much smaller power than setup — a signed-in "share" phone can only
 *     GET /api/state · POST /api/notes {text, from, days} · POST /api/notes/delete {id} · POST /api/photos?name= (raw image)
 *     · POST /api/countdowns {title, date, yearly, from} · POST /api/countdowns/delete {id}  (kept in family-countdowns.json, never in settings)
 *     · POST /api/meals {date, type, title} · POST /api/meals/delete {id}  (only when meals.provider is "local" or "both": the on-device plan, meals.json)
 * and can never read or change settings, passwords, backups or calendars.
 *
 * Automation (Home Assistant's voice pipeline, shortcuts): the same endpoints accept `Authorization: Bearer <token>`. The token is
 * made in phone setup (Share with the family), shown once, and only its SHA-256 is kept (secrets.json → share.apiToken). A bearer
 * request needs no cookie and no X-OpenSky header (a browser never adds an Authorization header by itself, so another site
 * can't forge one), has exactly the same reach as a signed-in phone, and wrong tokens count towards the same rate limits.
 *
 * Access: a family passcode, chosen in phone setup (Share with the family). Only a scrypt hash of it is kept
 * (secrets.json → share.hash); signing in with POST /api/login {passcode} gives a signed cookie (HMAC with
 * secrets.json → share.secret) good for 90 days. Changing the passcode makes a new secret, which signs every phone out.
 * Wrong passcodes are rate limited (per client, and overall), uploads too.
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const notes = require("./notes.js");
const photos = require("./photos.js");
const countdowns = require("./family-countdowns.js");
const meals = require("./local-meals.js");

const STATIC = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/share.js": ["share.js", "text/javascript; charset=utf-8"],
  "/share.css": ["share.css", "text/css; charset=utf-8"],
  "/icon.png": [path.join("..", "client", "assets", "opensky-icon.png"), "image/png"],
  "/apple-touch-icon.png": [path.join("..", "client", "assets", "opensky-touch-icon.png"), "image/png"]
};
const COOKIE = "os_share";
const SESSION_DAYS = 90;
const MIN_PASSCODE = 6, MAX_PASSCODE = 64;

/* ---------------- the passcode (secrets.json → share.hash + share.secret) ---------------- */
const secretsFile = () => process.env.OPENSKY_SECRETS || path.join(path.dirname(process.env.OPENSKY_SETTINGS || path.join(global.root_path || process.cwd(), "config", "opensky.json")), "secrets.json");

function readSecrets() {
  try { return JSON.parse(fs.readFileSync(secretsFile(), "utf8")); } catch (e) {
    if (e.code === "ENOENT") return {};
    // a damaged secrets.json is never replaced, or every other password in it would be lost
    throw Object.assign(new Error("secrets.json on the Pi has a mistake, so the passcode wasn't changed — fix it first (opensky check shows where)"), { status: 409 });
  }
}
const shareSecrets = () => { try { const s = readSecrets().share; return s && typeof s === "object" ? s : {}; } catch (e) { return {}; } };
const hasPasscode = () => { const s = shareSecrets(); return /^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(s.hash || "") && /^[a-f0-9]{64}$/.test(s.secret || ""); };
const hashOf = (pass, salt) => crypto.scryptSync(String(pass), Buffer.from(salt, "hex"), 64).toString("hex");

/** Choose (or change) the passcode. A new signing secret goes with it: every phone has to sign in again. */
function setPasscode(pass) {
  const p = String(pass == null ? "" : pass).trim();
  if (p.length < MIN_PASSCODE) throw Object.assign(new Error(`Use at least ${MIN_PASSCODE} characters`), { status: 400 });
  if (p.length > MAX_PASSCODE) throw Object.assign(new Error(`Keep it under ${MAX_PASSCODE} characters`), { status: 400 });
  const s = readSecrets(), file = secretsFile(), salt = crypto.randomBytes(16).toString("hex");
  s.share = { ...(s.share && typeof s.share === "object" ? s.share : {}), hash: `scrypt$${salt}$${hashOf(p, salt)}`, secret: crypto.randomBytes(32).toString("hex") };
  delete s.share.token;   // (the first version of the share page used a link)
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(s, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(`${file}.tmp`, file);
  fs.chmodSync(file, 0o600);
}

/* ---------------- the API token (secrets.json → share.apiToken = "sha256$<hex>") ---------------- */
const tokenHash = (t) => `sha256$${crypto.createHash("sha256").update(String(t)).digest("hex")}`;
const hasApiToken = () => /^sha256\$[a-f0-9]{64}$/.test(shareSecrets().apiToken || "");

function writeShare(change) {
  const s = readSecrets(), file = secretsFile();
  s.share = { ...(s.share && typeof s.share === "object" ? s.share : {}) };
  change(s.share);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(s, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(`${file}.tmp`, file);
  fs.chmodSync(file, 0o600);
}
/** Make (or replace) the API token. Returned once; only a hash is kept. The family passcode is not needed and not touched. */
function createApiToken() {
  const token = `osk_${crypto.randomBytes(24).toString("hex")}`;
  writeShare((sh) => { sh.apiToken = tokenHash(token); });
  return token;
}
function revokeApiToken() { writeShare((sh) => { delete sh.apiToken; }); }
function checkApiToken(token) {
  const t = String(token || "");
  return hasApiToken() && /^osk_[a-f0-9]{48}$/.test(t) && same(tokenHash(t), shareSecrets().apiToken);
}

const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
function checkPasscode(pass) {
  const s = shareSecrets();
  if (!hasPasscode()) return false;
  const [, salt, hash] = s.hash.split("$");
  return same(hashOf(String(pass == null ? "" : pass).trim(), salt), hash);
}

/* ---------------- signed sessions ---------------- */
const sign = (secret, exp) => crypto.createHmac("sha256", secret).update(`share|${exp}`).digest("hex");
function newSession(now = Date.now()) {
  const exp = Math.floor(now / 1000) + SESSION_DAYS * 86400;
  return `${exp}.${sign(shareSecrets().secret, exp)}`;
}
function validSession(value, now = Date.now()) {
  const m = String(value || "").match(/^(\d{1,12})\.([a-f0-9]{64})$/);
  const secret = shareSecrets().secret;
  return !!(m && secret && Number(m[1]) * 1000 > now && same(m[2], sign(secret, m[1])));
}

/* ---------------- the server ---------------- */
/** create({ hostOk(req), settings() }) → an http.Server (not listening yet). `settings()` = opensky.json, for the photo folder. */
function create({ hostOk, settings, log = () => {} }) {
  const fails = [], uploads = [], perClient = new Map();
  const recent = (arr, ms) => { const cut = Date.now() - ms; while (arr.length && arr[0] < cut) arr.shift(); return arr.length; };
  // behind a reverse proxy every request comes from the proxy: its X-Forwarded-For names the phone (it can be forged, so
  // the overall limit below holds whatever it says)
  const clientOf = (req) => String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim().slice(0, 64);
  const clientFails = (c) => { const a = perClient.get(c) || []; perClient.set(c, a); if (perClient.size > 500) perClient.clear(); return a; };

  const send = (res, status, body, headers = {}) => {
    const base = {
      "Cache-Control": "no-store", "X-Frame-Options": "DENY", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'"
    };
    if (Buffer.isBuffer(body) || typeof body === "string") { res.writeHead(status, { ...base, ...headers }); return res.end(body); }
    res.writeHead(status, { ...base, "Content-Type": "application/json", ...headers });
    res.end(JSON.stringify(body));
  };

  const readBody = (req, limit, json) => new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", (c) => { size += c.length; if (size > limit) { reject(Object.assign(new Error(json ? "That's too big" : "That photo is too big (40 MB at most)"), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on("end", () => {
      const buf = Buffer.concat(chunks);
      if (!json) return resolve(buf);
      try { resolve(buf.length ? JSON.parse(buf.toString("utf8")) : {}); } catch (e) { reject(Object.assign(new Error("bad JSON"), { status: 400 })); }
    });
    req.on("error", reject);
  });

  // → "ok" | "bad" (a wrong token) | "limited" (too many wrong ones) | "none" (no bearer header)
  const bearer = (req) => {
    const m = String(req.headers.authorization || "").match(/^Bearer\s+(\S{1,200})\s*$/i);
    if (!m) return "none";
    const mine = clientFails(clientOf(req));
    if (recent(mine, 60 * 1000) >= 5 || recent(fails, 10 * 60 * 1000) >= 40) return "limited";
    if (checkApiToken(m[1])) return "ok";
    mine.push(Date.now()); fails.push(Date.now());
    return "bad";
  };
  const authed = (req) => {
    const m = String(req.headers.cookie || "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([0-9.a-f]+)`));
    return !!(m && validSession(m[1]));
  };
  const cookie = (req, value, maxAge) => `${COOKIE}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https" ? "; Secure" : ""}`;

  // the on-device meal plan, when it is the one in use (Mealie-only setups have nothing to add to)
  const mealsOn = () => { const p = (settings().meals || {}).provider; return p === "local" || p === "both"; };
  const mealList = () => {
    const d = new Date(), from = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1).getTime(), to = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 42).getTime();
    return meals.planEntries(from, to, meals.MEAL_TYPES).map((e) => ({ id: e.id, date: e.date, type: e.type, title: e.title }));
  };

  async function handle(req, res) {
    if (!hostOk(req)) return send(res, 421, { error: "Wrong address" });
    const url = new URL(req.url, "http://x");

    if ((req.method === "GET" || req.method === "HEAD") && STATIC[url.pathname]) {
      const [file, type] = STATIC[url.pathname];
      return send(res, 200, fs.readFileSync(path.join(__dirname, "share", file)), { "Content-Type": type });
    }
    if (!url.pathname.startsWith("/api/")) return send(res, 404, { error: "Not found" });
    // a bearer token is checked first: it needs no cookie and no X-OpenSky header
    const viaToken = bearer(req);
    if (viaToken === "limited") return send(res, 429, { error: "Too many wrong tokens — wait a minute and try again" });
    if (viaToken === "bad") return send(res, 401, { error: "That token isn't valid" });
    if (viaToken !== "ok" && req.method === "POST" && req.headers["x-opensky"] !== "1") return send(res, 403, { error: "Refused" });

    if (url.pathname === "/api/login" && req.method === "POST") {
      const { passcode } = await readBody(req, 2 * 1024, true);
      const mine = clientFails(clientOf(req));
      // 5 wrong tries from one phone → a minute's pause; 40 wrong tries from anywhere in 10 minutes → everyone waits
      if (recent(mine, 60 * 1000) >= 5 || recent(fails, 10 * 60 * 1000) >= 40) return send(res, 429, { error: "Too many wrong passcodes — wait a minute and try again" });
      if (!hasPasscode()) return send(res, 409, { error: "No passcode has been set yet — set one in OpenSky's phone setup (Share with the family)" });
      if (!checkPasscode(passcode)) {
        mine.push(Date.now()); fails.push(Date.now());
        return send(res, 401, { error: "That's not the passcode" });
      }
      log("a phone signed in");
      return send(res, 200, { ok: true }, { "Set-Cookie": cookie(req, newSession(), SESSION_DAYS * 86400) });
    }
    if (url.pathname === "/api/logout" && req.method === "POST") return send(res, 200, { ok: true }, { "Set-Cookie": cookie(req, "", 0) });

    if (viaToken !== "ok" && !authed(req)) return send(res, 401, { error: "Sign in with the family passcode", login: true, passcodeSet: hasPasscode() });

    if (url.pathname === "/api/state" && req.method === "GET") {
      const P = settings().photos || {};
      return send(res, 200, { notes: notes.list(), maxText: notes.MAX_TEXT, countdowns: countdowns.list(), maxTitle: countdowns.MAX_TITLE, meals: mealsOn() ? { types: meals.MEAL_TYPES, entries: mealList() } : null, photos: P.enabled !== false && P.provider !== "immich" });
    }

    if (url.pathname === "/api/notes" && req.method === "POST") {
      const { text, from, days } = await readBody(req, 8 * 1024, true);
      try {
        const n = notes.add(text, from, days);
        log("a note was posted");
        return send(res, 200, { ok: true, note: n, notes: notes.list() });
      } catch (e) { return send(res, e.status || 500, { error: e.status ? e.message : "Couldn't save that note on the Pi" }); }
    }
    if (url.pathname === "/api/notes/delete" && req.method === "POST") {
      const { id } = await readBody(req, 1024, true);
      try { notes.remove(String(id || "")); } catch (e) { return send(res, e.status || 500, { error: e.status ? e.message : "Couldn't remove that note" }); }
      log("a note was removed");
      return send(res, 200, { ok: true, notes: notes.list() });
    }

    if (url.pathname === "/api/countdowns" && req.method === "POST") {
      const { title, date, yearly, from } = await readBody(req, 2 * 1024, true);
      try {
        countdowns.add(title, date, yearly === true, from);
        log("a countdown was added");
        return send(res, 200, { ok: true, countdowns: countdowns.list() });
      } catch (e) { return send(res, e.status || 500, { error: e.status ? e.message : "Couldn't save that countdown on the Pi" }); }
    }
    if (url.pathname === "/api/countdowns/delete" && req.method === "POST") {
      const { id } = await readBody(req, 1024, true);
      try { countdowns.remove(String(id || "")); } catch (e) { return send(res, e.status || 500, { error: e.status ? e.message : "Couldn't remove that countdown" }); }
      log("a countdown was removed");
      return send(res, 200, { ok: true, countdowns: countdowns.list() });
    }

    if (url.pathname === "/api/meals" && req.method === "POST") {
      if (!mealsOn()) return send(res, 409, { error: "This screen's meal plan isn't kept on the Pi — plan meals in Mealie" });
      const { date, type, title } = await readBody(req, 2 * 1024, true);
      try {
        meals.add({ date, type, title });
        log("a meal was added");
        return send(res, 200, { ok: true, entries: mealList() });
      } catch (e) { return send(res, e.status || 400, { error: e.message || "Couldn't save that meal on the Pi" }); }
    }
    if (url.pathname === "/api/meals/delete" && req.method === "POST") {
      if (!mealsOn()) return send(res, 409, { error: "This screen's meal plan isn't kept on the Pi" });
      const { id } = await readBody(req, 1024, true);
      try { meals.remove(String(id || "")); } catch (e) { return send(res, 404, { error: e.message }); }
      log("a meal was removed");
      return send(res, 200, { ok: true, entries: mealList() });
    }

    if (url.pathname === "/api/photos" && req.method === "POST") {
      const P = settings().photos || {};
      if (P.enabled === false) return send(res, 409, { error: "The photo card is switched off on this screen" });
      if (P.provider === "immich") return send(res, 409, { error: "This screen shows photos from Immich — add them there" });
      if (recent(uploads, 10 * 60 * 1000) >= 20) return send(res, 429, { error: "That's a lot of photos — try again in a few minutes" });
      uploads.push(Date.now());
      try {
        const saved = photos.savePhoto(P, url.searchParams.get("name"), await readBody(req, photos.MAX_UPLOAD, false));
        log("a photo was added");
        return send(res, 200, { ok: true, photo: { name: saved.name } });
      } catch (e) { return send(res, e.status || 500, { error: e.status ? e.message : "Couldn't save that photo on the Pi" }); }
    }
    return send(res, 404, { error: "Not found" });
  }

  return http.createServer((req, res) => handle(req, res).catch((e) => {
    console.error(`[OpenSky] share: ${e.message}`);
    send(res, e.status || 500, { error: e.status ? e.message : "Something went wrong on the Pi" });
  }));
}

module.exports = { create, setPasscode, hasPasscode, checkPasscode, newSession, validSession, createApiToken, revokeApiToken, hasApiToken, checkApiToken, MIN_PASSCODE };
