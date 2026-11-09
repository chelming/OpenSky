/* OpenSky share page (server side) — lets family members add a photo or post a note from their own phone.
 *
 * A second, small web server (opensky.json → share: { enabled: true, port: 8091 }) that is on whenever OpenSky runs, unlike
 * phone setup. It has its own, much smaller power than setup — a "share" session can only
 *     GET /api/state · POST /api/notes {text, from, days} · POST /api/notes/delete {id} · POST /api/photos?name= (raw image)
 * and can never read or change settings, passwords, backups or calendars.
 *
 * Access: a long random link, https?://<pi>:8091/s/<token>. Opening it sets a year-long cookie; after that the bare
 * address works. The token is in secrets.json → share.token (made on first use) and rotating it (phone setup → Share)
 * signs every phone out. Wrong tokens are rate limited, uploads too.
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const notes = require("./notes.js");
const photos = require("./photos.js");

const STATIC = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/share.js": ["share.js", "text/javascript; charset=utf-8"],
  "/share.css": ["share.css", "text/css; charset=utf-8"],
  "/icon.png": [path.join("..", "client", "assets", "opensky-icon.png"), "image/png"],
  "/apple-touch-icon.png": [path.join("..", "client", "assets", "opensky-touch-icon.png"), "image/png"]
};
const COOKIE = "os_share";
const YEAR = 365 * 24 * 60 * 60;

/* ---------------- the token (secrets.json → share.token) ---------------- */
const secretsFile = () => process.env.OPENSKY_SECRETS || path.join(path.dirname(process.env.OPENSKY_SETTINGS || path.join(global.root_path || process.cwd(), "config", "opensky.json")), "secrets.json");

function readSecrets() {
  try { return JSON.parse(fs.readFileSync(secretsFile(), "utf8")); } catch (e) {
    if (e.code === "ENOENT") return {};
    // a damaged secrets.json is never replaced, or every other password in it would be lost
    throw Object.assign(new Error("secrets.json on the Pi has a mistake, so the share link wasn't changed — fix it first (opensky check shows where)"), { status: 409 });
  }
}

function currentToken() {
  try { const t = readSecrets().share; return t && /^[a-f0-9]{48}$/.test(t.token || "") ? t.token : null; } catch (e) { return null; }
}

/** The token, made (and saved) the first time it is wanted. `rotate` replaces it: every phone has to use the new link. */
function token(rotate = false) {
  const cur = currentToken();
  if (cur && !rotate) return cur;
  const s = readSecrets(), file = secretsFile();
  s.share = { ...(s.share && typeof s.share === "object" ? s.share : {}), token: crypto.randomBytes(24).toString("hex") };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(s, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(`${file}.tmp`, file);
  fs.chmodSync(file, 0o600);
  return s.share.token;
}

const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

/* ---------------- the server ---------------- */
/** create({ hostOk(req), settings() }) → an http.Server (not listening yet). `settings()` = opensky.json, for the photo folder. */
function create({ hostOk, settings, log = () => {} }) {
  const fails = [], uploads = [];
  const recent = (arr, ms) => { const cut = Date.now() - ms; while (arr.length && arr[0] < cut) arr.shift(); return arr.length; };

  const send = (res, status, body, headers = {}) => {
    const base = {
      "Cache-Control": "no-store", "X-Frame-Options": "DENY", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'"
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

  const authed = (req) => {
    const t = currentToken();
    const m = String(req.headers.cookie || "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]{48})`));
    return !!(t && m && same(m[1], t));
  };

  async function handle(req, res) {
    if (!hostOk(req)) return send(res, 421, { error: "Wrong address" });
    const url = new URL(req.url, "http://x");

    // the link: sets the cookie, then the bare address works
    const link = url.pathname.match(/^\/s\/([A-Za-z0-9]{1,100})$/);
    if (link && req.method === "GET") {
      if (recent(fails, 60 * 1000) >= 10) return send(res, 429, "Too many tries — wait a minute", { "Content-Type": "text/plain; charset=utf-8" });
      const t = currentToken();
      if (!t || !same(link[1], t)) {
        fails.push(Date.now());
        return send(res, 403, "That link doesn't work any more. Ask for a new one from the person who set up the screen.", { "Content-Type": "text/plain; charset=utf-8" });
      }
      return send(res, 302, "", { Location: "/", "Set-Cookie": `${COOKIE}=${t}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${YEAR}` });
    }

    if (req.method === "GET" && STATIC[url.pathname]) {
      const [file, type] = STATIC[url.pathname];
      return send(res, 200, fs.readFileSync(path.join(__dirname, "share", file)), { "Content-Type": type });
    }
    if (!url.pathname.startsWith("/api/")) return send(res, 404, { error: "Not found" });
    if (req.method === "POST" && req.headers["x-opensky"] !== "1") return send(res, 403, { error: "Refused" });

    if (recent(fails, 60 * 1000) >= 10) return send(res, 429, { error: "Too many tries — wait a minute" });
    if (!authed(req)) { fails.push(Date.now()); return send(res, 401, { error: "Open the link you were sent to use this page", link: true }); }

    if (url.pathname === "/api/state" && req.method === "GET") {
      const P = settings().photos || {};
      return send(res, 200, { notes: notes.list(), maxText: notes.MAX_TEXT, photos: P.enabled !== false && P.provider !== "immich" });
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

module.exports = { create, token, currentToken };
