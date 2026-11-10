// Unit test for lib/notes.js and lib/share.js (the family share page): notes, the private link, what a "share"
// phone can and can't do, rate limits. Run: node tools/test-share.js
const fs = require("fs"), os = require("os"), path = require("path"), http = require("http");
const REPO = path.join(__dirname, "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "os-share-"));
process.env.OPENSKY_SETTINGS = path.join(tmp, "opensky.json");
process.env.OPENSKY_SECRETS = path.join(tmp, "secrets.json");
process.env.OPENSKY_NOTES = path.join(tmp, "notes.json");
process.env.OPENSKY_FAMILY_COUNTDOWNS = path.join(tmp, "family-countdowns.json");
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

  // ---- the passcode ----
  const PASS = "family-pass-9";
  fs.writeFileSync(process.env.OPENSKY_SECRETS, JSON.stringify({ weather: { openweathermap: { apiKey: "keep-me" } }, share: { token: "old-link-token" } }));
  const sec = () => JSON.parse(fs.readFileSync(process.env.OPENSKY_SECRETS, "utf8"));
  ok("8a no passcode yet", share.hasPasscode() === false && share.checkPasscode("anything") === false);
  share.setPasscode(PASS);
  const raw = fs.readFileSync(process.env.OPENSKY_SECRETS, "utf8");
  ok("8 only a salted hash is kept (never the passcode), 0600, other secrets kept, the old link token dropped",
    !raw.includes(PASS) && /^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(sec().share.hash) && sec().weather.openweathermap.apiKey === "keep-me" && sec().share.token === undefined && (fs.statSync(process.env.OPENSKY_SECRETS).mode & 0o777) === 0o600);
  ok("9 the right passcode checks out (spaces around it ignored), wrong ones don't", share.checkPasscode(PASS) && share.checkPasscode(`  ${PASS} `) && !share.checkPasscode("family-pass-8") && !share.checkPasscode("") && !share.checkPasscode(undefined));
  ok("9b too short or too long → refused, nothing changed", bad(() => share.setPasscode("12345")) === 400 && bad(() => share.setPasscode("x".repeat(65))) === 400 && share.checkPasscode(PASS));
  const s1 = share.newSession(), oldSecret = sec().share.secret;
  ok("9c a session is valid until it expires, never after, and a tampered one is not", share.validSession(s1) && !share.validSession(s1, Date.now() + 91 * 86400000) && !share.validSession(s1.replace(/.$/, (c) => (c === "0" ? "1" : "0"))) && !share.validSession("") && !share.validSession("1.2"));
  share.setPasscode("a-new-passcode");
  ok("10 a new passcode signs every phone out (new signing secret)", sec().share.secret !== oldSecret && !share.validSession(s1) && share.checkPasscode("a-new-passcode") && !share.checkPasscode(PASS));
  const good = fs.readFileSync(process.env.OPENSKY_SECRETS, "utf8");
  fs.writeFileSync(process.env.OPENSKY_SECRETS, "{ broken");
  ok("10b a damaged secrets.json is never overwritten", bad(() => share.setPasscode("another-one")) === 409 && fs.readFileSync(process.env.OPENSKY_SECRETS, "utf8") === "{ broken");
  fs.writeFileSync(process.env.OPENSKY_SECRETS, good);

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
  ok("11 the page itself loads without signing in (it shows the passcode box)", r.status === 200 && /Share with the family screen/.test(r.text));
  r = await call("GET", "/api/state");
  ok("12 ...but the data needs signing in", r.status === 401 && r.body.login === true && r.body.passcodeSet === true);
  r = await call("POST", "/api/login", { passcode: "wrong-passcode" });
  ok("13a a wrong passcode is refused, no cookie", r.status === 401 && !r.headers["set-cookie"]);
  ok("13b a login needs the X-OpenSky header", (await call("POST", "/api/login", { passcode: "a-new-passcode" }, { "X-OpenSky": "0" })).status === 403);
  r = await call("POST", "/api/login", { passcode: "a-new-passcode" }, { "X-Forwarded-Proto": "https" });
  const cookie = String(r.headers["set-cookie"] || "").split(";")[0];
  ok("13 the right passcode sets a signed, long-lived, HttpOnly cookie (Secure behind https)", r.status === 200 && /^os_share=\d+\.[a-f0-9]{64}$/.test(cookie) && /Max-Age=\d{7,}/.test(r.headers["set-cookie"]) && /HttpOnly/.test(r.headers["set-cookie"]) && /Secure/.test(r.headers["set-cookie"]));
  ok("13c a forged or altered cookie gets nothing", (await call("GET", "/api/state", undefined, { Cookie: "os_share=9999999999." + "a".repeat(64) })).status === 401 && (await call("GET", "/api/state", undefined, { Cookie: cookie.replace(/\d\./, "9.") })).status === 401);
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
  r = await call("POST", "/api/countdowns", { title: "  Beach   trip ", date: "2031-07-04", yearly: false, from: "Mom" }, as);
  ok("20b a phone adds a countdown (kept in its own file, not in settings)", r.status === 200 && r.body.countdowns[0].title === "Beach trip" && r.body.countdowns[0].date === "2031-07-04" && fs.existsSync(process.env.OPENSKY_FAMILY_COUNTDOWNS), r.body);
  ok("20c ...a missing name or a bad date is refused", (await call("POST", "/api/countdowns", { title: " ", date: "2031-07-04" }, as)).status === 400 && (await call("POST", "/api/countdowns", { title: "x", date: "2031-02-31" }, as)).status === 400);
  ok("20d ...no cookie, no countdown", (await call("POST", "/api/countdowns", { title: "x", date: "2031-07-04" }, {})).status === 401);
  r = await call("GET", "/api/state", undefined, as);
  ok("20e the state lists the countdowns", r.body.countdowns.length === 1, r.body);
  r = await call("POST", "/api/countdowns/delete", { id: r.body.countdowns[0].id }, as);
  ok("20f ...and one can be removed (twice → 404)", r.status === 200 && r.body.countdowns.length === 0 && (await call("POST", "/api/countdowns/delete", { id: "nope" }, as)).status === 404);
  // everything setup can do is out of reach
  const reach = [["GET", "/api/backup"], ["POST", "/api/save"], ["POST", "/api/restore"], ["POST", "/api/done"], ["GET", "/api/share"], ["POST", "/api/share/passcode"],["GET", "/api/google"], ["GET", "/api/photos"]];
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
  r = await call("POST", "/api/logout", {}, as);
  ok("25a signing out clears the cookie", r.status === 200 && /Max-Age=0/.test(r.headers["set-cookie"]));
  // changing the passcode: old sessions stop working
  share.setPasscode("third-passcode");
  ok("25 after a new passcode the old cookie stops working, the new passcode signs in", (await call("GET", "/api/state", undefined, as)).status === 401 && (await call("POST", "/api/login", { passcode: "third-passcode" })).status === 200);
  // guessing: 5 wrong from one phone → pause (even the right passcode waits)
  let last;
  for (let i = 0; i < 6; i++) last = await call("POST", "/api/login", { passcode: `guess-${i}-xx` }, { "X-Forwarded-For": "10.0.0.7" });
  ok("26 guessing is rate limited per phone", last.status === 429);
  ok("27 ...even the right passcode waits for that phone, while another phone can still sign in", (await call("POST", "/api/login", { passcode: "third-passcode" }, { "X-Forwarded-For": "10.0.0.7" })).status === 429 && (await call("POST", "/api/login", { passcode: "third-passcode" }, { "X-Forwarded-For": "10.0.0.8" })).status === 200);
  for (let i = 0; i < 45; i++) await call("POST", "/api/login", { passcode: `bad-${i}-xxx` }, { "X-Forwarded-For": `10.1.0.${i}` });
  ok("27b many phones guessing (or forged addresses) → everyone waits a while", (await call("POST", "/api/login", { passcode: "third-passcode" }, { "X-Forwarded-For": "10.9.9.9" })).status === 429);
  ok("28 logs never include a note's text or any passcode", !logs.join(" ").includes("Dinner") && !/passcode/i.test(logs.join(" ").replace(/a phone signed in/g, "")) && !logs.join(" ").includes("third-passcode"));

  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`SUMMARY pass=${pass} fail=${fail}`);
})();
