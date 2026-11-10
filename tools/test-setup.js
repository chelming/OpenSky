// Unit test for the phone setup server (modules/MMM-OpenSky-Setup/node_helper.js): pairing limits hold even when
// many guesses arrive at once, and only a paired phone keeps setup open. Fictional "Testers" family, fake secrets.
const fs = require("fs"), os = require("os"), path = require("path"), http = require("http"), net = require("net"), Module = require("module");
const REPO = path.join(__dirname, "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "opensky-setup-"));
// a stand-in for the MagicMirror folder (node helpers require the shared library from <MagicMirror>/modules/opensky-lib)
fs.mkdirSync(path.join(tmp, "mm", "modules"), { recursive: true });
fs.symlinkSync(path.join(REPO, "lib"), path.join(tmp, "mm", "modules", "opensky-lib"));
global.root_path = path.join(tmp, "mm");
process.env.OPENSKY_DRY_RUN = "1";
process.env.OPENSKY_SETTINGS = path.join(tmp, "opensky.json");
process.env.OPENSKY_SECRETS = path.join(tmp, "secrets.json");
process.env.OPENSKY_SETUP_DEVICES = path.join(tmp, "setup-devices.json");
process.env.OPENSKY_WELCOME_FILE = path.join(tmp, ".welcomed");
// a stand-in for MagicMirror's node_helper
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...a) { return req === "node_helper" ? path.join(tmp, "nh.js") : origResolve.call(this, req, ...a); };
fs.writeFileSync(path.join(tmp, "nh.js"), "module.exports = { create: (o) => Object.assign({ sendSocketNotification() {} }, o) };");

let passed = 0, failed = 0;
const ok = (n, c, i) => { c ? passed++ : failed++; console.log(`${c ? "PASS" : "FAIL"}  ${n}${i !== undefined ? "  — " + JSON.stringify(i) : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let port;
// one request; resolves { status, body, cookie }
function call(method, url, body, headers = {}) {
  return new Promise((resolve) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const r = http.request({ host: "127.0.0.1", port, path: url, method, headers: { Host: "localhost", ...(method === "POST" ? { "X-OpenSky": "1" } : {}), ...(data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {}), ...headers } }, (res) => {
      let d = ""; res.on("data", (c) => { d += c; });
      res.on("end", () => { let j = null; try { j = JSON.parse(d); } catch (e) { /* not JSON */ } resolve({ status: res.statusCode, body: j, cookies: res.headers["set-cookie"] || [], cookie: (res.headers["set-cookie"] || [""])[0].split(";")[0] }); });
    });
    r.on("error", () => resolve({ status: 0 }));
    if (data) r.write(data);
    r.end();
  });
}

// Many pairing guesses at once: every request's headers arrive first, the codes a moment later (what an attacker on
// the Wi-Fi would do). Returns how many guesses were really compared with the code (answered 401).
function burst(n) {
  return new Promise((resolve) => {
    const socks = []; let up = 0, closed = 0, checked = 0;
    for (let i = 0; i < n; i++) {
      const body = JSON.stringify({ code: String(100000 + i) });
      const s = net.connect(port, "127.0.0.1", () => {
        s.write(`POST /api/pair HTTP/1.1\r\nHost: localhost\r\nX-OpenSky: 1\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n`);
        if (++up === n) setTimeout(() => socks.forEach(([x, b]) => x.end(b)), 100);
      });
      let d = ""; s.on("data", (c) => { d += c; }); s.on("error", () => {});
      s.on("close", () => { if (/^HTTP\/1\.1 401/.test(d)) checked++; if (++closed === n) resolve(checked); });
      socks.push([s, body]);
    }
  });
}

(async () => {
  fs.writeFileSync(process.env.OPENSKY_SETTINGS, JSON.stringify({ family: { name: "The Testers" }, setup: { port: 0 } }));
  fs.writeFileSync(process.env.OPENSKY_SECRETS, JSON.stringify({ lists: { todoist: { token: "tok-testers-123" } } }));
  const h = require(path.join(REPO, "modules", "MMM-OpenSky-Setup", "node_helper.js"));
  h.start();
  // listen on a free port
  process.env.OPENSKY_SETUP_PORT = String(await new Promise((r) => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); }));
  port = Number(process.env.OPENSKY_SETUP_PORT);
  h.socketNotificationReceived("OS_SETUP_START");
  await sleep(200);

  // 1-3 pairing limits
  const checked = await burst(200);
  ok("1 200 guesses at once: only 5 are compared before the pause", checked === 5, checked);
  h.lockedUntil = 0;   // (skip the minute's wait)
  h.wrong = 14;
  const real = h.code;
  await call("POST", "/api/pair", { code: real === "000000" ? "000001" : "000000" });
  const after = await call("POST", "/api/pair", { code: h.code });
  ok("2 15 wrong codes → a new code AND the pause still holds", h.code !== real && after.status === 429, after.status);
  const idle = h.idleTimer;
  await call("GET", "/");
  await call("GET", "/api/state");
  ok("3 requests from a phone that isn't paired don't keep setup open", h.idleTimer === idle);

  // a paired phone
  h.lockedUntil = 0; h.codeUntil = Date.now() + 60000;
  const cookie = (await call("POST", "/api/pair", { code: h.code })).cookie;
  const as = { Cookie: cookie };
  ok("4 the right code pairs the phone", /^os_setup=[a-f0-9]{64}$/.test(cookie), cookie.slice(0, 12));

  // 4b-4e "remember this device": a 30-day cookie skips the code; only its hash is kept; Forget ends it
  ok("4b without the box ticked no device cookie is set", !(await call("POST", "/api/pair", { code: h.code })).cookies.some((c) => c.startsWith("os_device=")) && !fs.existsSync(process.env.OPENSKY_SETUP_DEVICES));
  h.lockedUntil = 0; h.codeUntil = Date.now() + 60000;
  const rem = await call("POST", "/api/pair", { code: h.code, remember: true });
  const dev = (rem.cookies.find((c) => c.startsWith("os_device=")) || "").split(";")[0];
  ok("4c ticking it sets a 30-day HttpOnly cookie", /^os_device=[a-f0-9]{64}$/.test(dev) && rem.cookies.some((c) => /os_device=.*HttpOnly.*Max-Age=2592000/.test(c)), rem.cookies);
  const stored = fs.readFileSync(process.env.OPENSKY_SETUP_DEVICES, "utf8");
  ok("4d the token itself is not stored, the file is private", !stored.includes(dev.split("=")[1]) && (fs.statSync(process.env.OPENSKY_SETUP_DEVICES).mode & 0o077) === 0);
  h.sessions = new Set();   // (as after a restart)
  ok("4e a remembered device needs no code", (await call("GET", "/api/state", undefined, { Cookie: dev })).status === 200);
  ok("4f a made-up device cookie doesn't", (await call("GET", "/api/state", undefined, { Cookie: "os_device=" + "a".repeat(64) })).status === 401);
  await call("POST", "/api/devices/forget", {}, { Cookie: dev });
  ok("4g Forget ends it", (await call("GET", "/api/state", undefined, { Cookie: dev })).status === 401);
  h.lockedUntil = 0; h.codeUntil = Date.now() + 60000;
  const again = (await call("POST", "/api/pair", { code: h.code })).cookie;
  ok("4h pairing with the code still works", again.startsWith("os_setup="));
  as.Cookie = again;

  // 5-7 a damaged secrets.json (a typo from editing it by hand) is never replaced by just the new value
  const damaged = '{ "lists": { "todoist": { "token": "tok-testers-123" } }, }';
  fs.writeFileSync(process.env.OPENSKY_SECRETS, damaged);
  const settings = { family: { name: "The Testers" }, pages: ["home"] };
  let r = await call("POST", "/api/save", { settings, secrets: { "weather.openweathermap.apiKey": "owm-testers" } }, as);
  ok("5 damaged secrets.json + a new password → refused, nothing lost", r.status === 409 && fs.readFileSync(process.env.OPENSKY_SECRETS, "utf8") === damaged, r.body);
  r = await call("POST", "/api/save", { settings: { ...settings, pages: ["home", "timer"] }, secrets: {} }, as);
  ok("6 damaged secrets.json + only settings changed → settings saved, secrets.json untouched",
    r.status === 200 && JSON.parse(fs.readFileSync(process.env.OPENSKY_SETTINGS, "utf8")).pages.length === 2 && fs.readFileSync(process.env.OPENSKY_SECRETS, "utf8") === damaged, r.status);
  r = await call("POST", "/api/google/start", { clientId: "123-testers.apps.googleusercontent.com", clientSecret: "cs-testers" }, as);
  ok("7 Google sign-in with a damaged secrets.json → refused, nothing lost", r.status === 409 && fs.readFileSync(process.env.OPENSKY_SECRETS, "utf8") === damaged, r.status);
  fs.writeFileSync(process.env.OPENSKY_SECRETS, JSON.stringify({ lists: { todoist: { token: "tok-testers-123" } } }));
  r = await call("POST", "/api/save", { settings, secrets: { "weather.openweathermap.apiKey": "owm-testers" } }, as);
  const sec = JSON.parse(fs.readFileSync(process.env.OPENSKY_SECRETS, "utf8"));
  ok("8 a good secrets.json: the new key is added, the others kept, the phone only learns names",
    r.status === 200 && sec.lists.todoist.token === "tok-testers-123" && sec.weather.openweathermap.apiKey === "owm-testers" && !JSON.stringify(r.body).includes("tok-testers"), r.body);

  // 9 a secret's name can't reach into JavaScript itself ("embeds.__proto__.x" passed the allowed-names check)
  r = await call("POST", "/api/save", { settings, secrets: { "embeds.__proto__.pin": "1234", "calendar.sources.constructor.prototype.url": "http://x" } }, as);
  ok("9 secret names like embeds.__proto__.pin are ignored (no change to every object on the Pi)", r.status === 200 && ({}).pin === undefined && ({}).url === undefined, ({}).pin);
  delete Object.prototype.pin;

  // 10 a damaged opensky.json: the phone is told, not shown the example settings (which Save would then write)
  fs.writeFileSync(process.env.OPENSKY_SETTINGS, '{ "family": { "name": "The Testers" }, }');
  r = await call("GET", "/api/state", undefined, as);
  ok("10 damaged opensky.json → the phone says so instead of offering the example settings", r.status === 409 && /mistake/.test(r.body.error), r.status);

  // 11 behind Docker or a reverse proxy: OPENSKY_SETUP_URL is what the QR code shows and the only extra Host accepted
  const sent = [];
  h.sendSocketNotification = (n, p) => sent.push([n, p]);
  process.env.OPENSKY_SETUP_URL = "http://nas.testers.lan:8090/, not a url, https://setup.testers.lan";
  h.ready();
  ok("11 OPENSKY_SETUP_URL → the QR code shows those addresses (bad entries dropped)",
    JSON.stringify(sent[0][1].urls) === JSON.stringify(["http://nas.testers.lan:8090", "https://setup.testers.lan"]), sent[0][1].urls);
  ok("12 ...and the Host of an address that isn't set is still refused", (await call("GET", "/", undefined, { Host: "evil.example" })).status === 421);
  ok("13 ...while the Host of the set address works", (await call("GET", "/", undefined, { Host: "nas.testers.lan:8090" })).status === 200);
  delete process.env.OPENSKY_SETUP_URL;

  // 14-19 photos: add and delete from the phone
  const pics = path.join(tmp, "pics");
  fs.writeFileSync(process.env.OPENSKY_SETTINGS, JSON.stringify({ photos: { folder: pics } }));
  const jpeg = fs.readFileSync(path.join(REPO, "tools", "fixtures", "photos", fs.readdirSync(path.join(REPO, "tools", "fixtures", "photos")).find((f) => /\.jpe?g$/i.test(f))));
  const upload = (name, buf, hdr = as) => new Promise((resolve) => {
    const q = http.request({ host: "127.0.0.1", port, path: `/api/photos?name=${encodeURIComponent(name)}`, method: "POST", headers: { Host: "localhost", "X-OpenSky": "1", "Content-Length": buf.length, ...hdr } }, (res) => {
      let d = ""; res.on("data", (c) => { d += c; }); res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(d || "{}") }));
    });
    q.end(buf);
  });
  r = await upload("Lake.jpg", jpeg);
  ok("14 a phone adds a photo to the folder", r.status === 200 && fs.existsSync(path.join(pics, "Lake.jpg")), r.body);
  r = await upload("notes.jpg", Buffer.from("this is just text, not a picture"));
  ok("15 something that isn't a photo is refused", r.status === 400 && /JPEG, PNG and WebP/.test(r.body.error), r.body);
  ok("16 an unpaired phone can't add photos", (await upload("x.jpg", jpeg, {})).status === 401 && fs.readdirSync(pics).length === 1);
  r = await call("GET", "/api/photos", undefined, as);
  const first = r.body.photos[0];
  ok("17 the list shows the photo, without file paths", r.status === 200 && r.body.photos.length === 1 && first.name === "Lake.jpg" && !JSON.stringify(r.body.photos).includes(tmp), r.body);
  ok("18 the photo itself can be shown", (await call("GET", `/api/photos/${first.id}`, undefined, as)).status === 200 && (await call("GET", "/api/photos/..%2F..%2Fetc%2Fpasswd", undefined, as)).status === 404);
  r = await call("POST", "/api/photos/delete", { id: first.id }, as);
  ok("19 deleting removes the file", r.status === 200 && fs.readdirSync(pics).length === 0, r.body);

  // 20 Mealie: the phone checks an address + token; they are kept only when they work, and never sent back
  fs.writeFileSync(process.env.OPENSKY_SETTINGS, JSON.stringify({ family: { name: "The Testers" } }));
  const fake = http.createServer((q, s) => {
    const good = q.headers.authorization === "Bearer mealie-testers-token";
    s.writeHead(good ? 200 : 401, { "Content-Type": "application/json" });
    s.end(JSON.stringify(q.url.startsWith("/api/users/self") ? { id: "u" } : { items: [{ id: "L1", name: "Groceries" }] }));
  });
  await new Promise((r) => fake.listen(0, "127.0.0.1", r));
  const addr = `http://127.0.0.1:${fake.address().port}`;
  r = await call("GET", "/api/mealie", undefined, as);
  ok("20 Mealie not set up yet", r.status === 200 && r.body.set === false, r.body);
  r = await call("POST", "/api/mealie/connect", { url: addr, token: "wrong" }, as);
  ok("21 a wrong Mealie token → a message (not 401, which means 'pair again'), nothing saved",
    r.status === 400 && /refused/.test(r.body.error) && !(JSON.parse(fs.readFileSync(process.env.OPENSKY_SECRETS, "utf8")).mealie), r);
  r = await call("POST", "/api/mealie/connect", { url: `${addr}/`, token: "mealie-testers-token" }, as);
  const mm = JSON.parse(fs.readFileSync(process.env.OPENSKY_SECRETS, "utf8"));
  ok("22 a working address + token → its shopping lists, and they are kept (token file only readable by the owner)",
    r.status === 200 && r.body.shoppingLists[0].name === "Groceries" && mm.mealie.url === addr && mm.mealie.token === "mealie-testers-token" && mm.lists.todoist.token === "tok-testers-123" &&
    (fs.statSync(process.env.OPENSKY_SECRETS).mode & 0o077) === 0, r.body);
  r = await call("GET", "/api/mealie", undefined, as);
  ok("23 the phone learns that it is set (and where), never the token", r.body.set === true && r.body.url === addr && !JSON.stringify(r.body).includes("mealie-testers-token"), r.body);
  r = await call("POST", "/api/mealie/connect", {}, as);
  ok("24 Connect with nothing typed uses the saved ones", r.status === 200 && r.body.shoppingLists.length === 1, r.body);
  r = await call("POST", "/api/save", { settings: { pages: ["home"] }, secrets: { "mealie.token": "mealie-new-token" } }, as);
  ok("25 mealie.* is a secret the phone may set", JSON.parse(fs.readFileSync(process.env.OPENSKY_SECRETS, "utf8")).mealie.token === "mealie-new-token" && r.body.secretsSet.includes("mealie.url"), r.body);
  fake.close();

  h.stopServer("test over");
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`SUMMARY pass=${passed} fail=${failed}`);
  process.exit(failed ? 1 : 0);
})();
