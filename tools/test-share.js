// Unit test for lib/notes.js and lib/share.js (the family share page): notes, the private link, what a "share"
// phone can and can't do, rate limits. Run: node tools/test-share.js
const fs = require("fs"), os = require("os"), path = require("path"), http = require("http");
const REPO = path.join(__dirname, "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "os-share-"));
process.env.OPENSKY_SETTINGS = path.join(tmp, "opensky.json");
process.env.OPENSKY_SECRETS = path.join(tmp, "secrets.json");
process.env.OPENSKY_NOTES = path.join(tmp, "notes.json");
const notes = require("../lib/notes.js"), share = require("../lib/share.js");
let pass = 0, fail = 0; const ok = (k, v, i = "") => { v ? pass++ : fail++; console.log(`${v ? "PASS" : "FAIL"}  ${k} ${i}`); };

(async () => {
  // ---- notes ----
  const t0 = 1_000_000_000_000;
  const a = notes.add("  Pick up   milk ", " Mom ", 1, t0), b = notes.add("Soccer is cancelled", "", 0, t0 + 1000);
  ok("1 a note is trimmed, kept with who posted it; newest first", a.text === "Pick up milk" && a.from === "Mom" && notes.list(t0 + 2000)[0].id === b.id);
  ok("2 a one-day note expires, 'until removed' stays", notes.list(t0 + 2 * 86400000).length === 1 && notes.list(t0 + 2 * 86400000)[0].id === b.id);
  ok("3 expired notes are dropped from the file too", JSON.parse(fs.readFileSync(process.env.OPENSKY_NOTES, "utf8")).notes.length === 1);
  const bad = (f) => { try { f(); } catch (e) { return e.status; } };
  ok("4 empty or very long notes are refused", bad(() => notes.add("   ", "", 1)) === 400 && bad(() => notes.add("x".repeat(500), "", 1)) === 400);
  for (let i = 0; i < 25; i++) bad(() => notes.add(`n${i}`, "", 0));
  ok("5 at most 20 notes at once", notes.list().length === notes.MAX_NOTES);
  notes.remove(notes.list()[0].id);
  ok("6 removing a note, and removing it twice (404)", notes.list().length === 19 && bad(() => notes.remove("nope")) === 404);
  fs.writeFileSync(process.env.OPENSKY_NOTES, "{ broken");
  ok("7 a damaged notes.json → empty list, a copy is kept", notes.list().length === 0 && fs.readdirSync(tmp).some((f) => f.startsWith("notes.json.damaged-")));
  fs.rmSync(process.env.OPENSKY_NOTES, { force: true });

  // ---- the token ----
  fs.writeFileSync(process.env.OPENSKY_SECRETS, JSON.stringify({ weather: { openweathermap: { apiKey: "keep-me" } } }));
  const t1 = share.token();
  const sec = () => JSON.parse(fs.readFileSync(process.env.OPENSKY_SECRETS, "utf8"));
  ok("8 the link token is made once, saved in secrets.json (0600), other secrets kept", /^[a-f0-9]{48}$/.test(t1) && share.token() === t1 && sec().share.token === t1 && sec().weather.openweathermap.apiKey === "keep-me" && (fs.statSync(process.env.OPENSKY_SECRETS).mode & 0o777) === 0o600);
  const t2 = share.token(true);
  ok("9 rotating makes a different token", t2 !== t1 && share.currentToken() === t2);
  fs.writeFileSync(process.env.OPENSKY_SECRETS, "{ broken");
  ok("10 a damaged secrets.json is never overwritten", bad(() => share.token(true)) === 409 && fs.readFileSync(process.env.OPENSKY_SECRETS, "utf8") === "{ broken");
  fs.writeFileSync(process.env.OPENSKY_SECRETS, JSON.stringify({ share: { token: t2 } }));

  // ---- the server ----
  const pics = path.join(tmp, "pics");
  let settings = { photos: { folder: pics } };
  const logs = [];
  const server = share.create({ hostOk: (req) => /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host || ""), settings: () => settings, log: (m) => logs.push(m) });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const call = (method, p, body, headers = {}, raw) => new Promise((resolve) => {
    const data = raw || (body === undefined ? null : Buffer.from(JSON.stringify(body)));
    const q = http.request({ host: "127.0.0.1", port, path: p, method, headers: { Host: "localhost", ...(method === "POST" ? { "X-OpenSky": "1" } : {}), ...(data ? { "Content-Length": data.length } : {}), ...headers } }, (res) => {
      let d = ""; res.on("data", (c) => { d += c; }); res.on("end", () => { let j = null; try { j = JSON.parse(d); } catch (e) { /* not JSON */ } resolve({ status: res.statusCode, body: j, text: d, headers: res.headers }); });
    });
    q.end(data);
  });
  let r = await call("GET", "/");
  ok("11 the page itself loads without the link (it explains what to do)", r.status === 200 && /Share with the family screen/.test(r.text));
  r = await call("GET", "/api/state");
  ok("12 ...but the data needs the link", r.status === 401 && r.body.link === true);
  r = await call("GET", `/s/${t2}`);
  const cookie = String(r.headers["set-cookie"] || "").split(";")[0];
  ok("13 the right link sets a long-lived cookie and goes to the page", r.status === 302 && r.headers.location === "/" && /^os_share=[a-f0-9]{48}$/.test(cookie) && /Max-Age=\d{7,}/.test(r.headers["set-cookie"]) && /HttpOnly/.test(r.headers["set-cookie"]));
  const as = { Cookie: cookie };
  r = await call("GET", "/api/state", undefined, as);
  ok("14 with the cookie: notes and whether photos can be added", r.status === 200 && Array.isArray(r.body.notes) && r.body.photos === true, r.body);
  r = await call("POST", "/api/notes", { text: "Dinner at 6", from: "Dad", days: 1 }, as);
  ok("15 a phone posts a note", r.status === 200 && r.body.notes[0].text === "Dinner at 6" && notes.list()[0].from === "Dad", r.body);
  ok("16 ...a note needs the X-OpenSky header (no cross-site posts)", (await call("POST", "/api/notes", { text: "x" }, { ...as, "X-OpenSky": "0" })).status === 403);
  r = await call("POST", "/api/notes/delete", { id: notes.list()[0].id }, as);
  ok("17 ...and takes one off again", r.status === 200 && r.body.notes.length === 0);
  const jpeg = fs.readFileSync(path.join(REPO, "tools", "fixtures", "photos", fs.readdirSync(path.join(REPO, "tools", "fixtures", "photos")).find((f) => /\.jpe?g$/i.test(f))));
  r = await call("POST", "/api/photos?name=Lake.jpg", undefined, as, jpeg);
  ok("18 a phone adds a photo to the folder", r.status === 200 && fs.existsSync(path.join(pics, "Lake.jpg")), r.body);
  r = await call("POST", "/api/photos?name=x.jpg", undefined, as, Buffer.from("just some text, not a picture"));
  ok("19 something that isn't a photo is refused", r.status === 400 && /JPEG, PNG and WebP/.test(r.body.error), r.body);
  ok("20 no cookie → no photo", (await call("POST", "/api/photos?name=y.jpg", undefined, {}, jpeg)).status === 401 && fs.readdirSync(pics).length === 1);
  // everything setup can do is out of reach
  const reach = [["GET", "/api/backup"], ["POST", "/api/save"], ["POST", "/api/restore"], ["POST", "/api/done"], ["GET", "/api/share"], ["POST", "/api/share/rotate"], ["GET", "/api/google"], ["GET", "/api/photos"]];
  const codes = [];
  for (const [m, p] of reach) { const x = await call(m, p, m === "POST" ? {} : undefined, as); codes.push(x.status); }
  ok("21 a share phone can't reach settings, secrets, backups, restore or the link itself", codes.every((c) => c === 404) && !/opensky-backup|settings/.test((await call("GET", "/api/backup", undefined, as)).text), codes.join(","));
  settings = { photos: { provider: "immich", url: "http://x" } };
  r = await call("GET", "/api/state", undefined, as);
  const up = await call("POST", "/api/photos?name=z.jpg", undefined, as, jpeg);
  ok("22 with Immich the page offers no photo upload, and the server says why", r.body.photos === false && up.status === 409 && /Immich/.test(up.body.error));
  settings = { photos: { enabled: false } };
  ok("23 photos switched off → refused", (await call("POST", "/api/photos?name=z.jpg", undefined, as, jpeg)).status === 409);
  ok("24 a wrong Host is refused", (await call("GET", "/", undefined, { Host: "evil.example" })).status === 421);
  // rotate: old cookie stops working
  const t3 = share.token(true);
  ok("25 after a new link, the old cookie stops working", (await call("GET", "/api/state", undefined, as)).status === 401 && (await call("GET", `/s/${t3}`)).status === 302);
  // wrong links are rate limited
  let last;
  for (let i = 0; i < 12; i++) last = await call("GET", `/s/${"a".repeat(20)}`);
  ok("26 guessing links is rate limited", last.status === 429);
  ok("27 ...and even the right link waits", (await call("GET", `/s/${t3}`)).status === 429);
  ok("28 logs never include a note's text or the token", !logs.join(" ").includes("Dinner") && !logs.join(" ").includes(t2));

  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`SUMMARY pass=${pass} fail=${fail}`);
})();
