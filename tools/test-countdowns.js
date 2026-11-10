// Unit test for countdowns: lib/client/countdowns.js (days to go, hiding after the date, yearly ones) and lib/countdowns.js (photo files).
const fs = require("fs"), os = require("os"), path = require("path");
let passed = 0, failed = 0;
const ok = (n, c, i) => { c ? passed++ : failed++; console.log(`${c ? "PASS" : "FAIL"}  ${n}${i !== undefined ? "  — " + JSON.stringify(i) : ""}`); };

const C = require("../lib/client/countdowns.js");
const at = (y, m, d, h = 15) => new Date(y, m - 1, d, h);
const names = (items, now, keep) => C.visible(items, now, keep).map((x) => `${x.title}:${x.days}`).join(",");
const now = at(2026, 11, 10);

ok("1 days to go: calendar days, any time of day", C.daysTo({ date: "2026-11-12" }, at(2026, 11, 10, 23)) === 2 && C.daysTo({ date: "2026-11-10" }, at(2026, 11, 10, 0)) === 0);
ok("2 across a daylight-saving change it is still whole days", C.daysTo({ date: "2026-03-30" }, at(2026, 3, 1)) === 29 && C.daysTo({ date: "2026-11-02" }, at(2026, 10, 30)) === 3);
ok("3 labels", C.label(0) === "Today!" && C.label(1) === "Tomorrow" && C.label(12) === "in 12 days" && C.label(-1) === "Yesterday" && C.label(-3) === "3 days ago");
const items = [{ title: "Trip", date: "2026-12-01" }, { title: "Today", date: "2026-11-10" }, { title: "Yday", date: "2026-11-09" }, { title: "Old", date: "2026-10-01" }];
ok("4 soonest first; a passed date is hidden from the day after (keepDays 0)", names(items, now, 0) === "Today:0,Trip:21", names(items, now, 0));
ok("5 keepDays keeps it a while, after the coming ones", names(items, now, 1) === "Today:0,Trip:21,Yday:-1" && names(items, now, 40) === "Today:0,Trip:21,Yday:-1,Old:-40", names(items, now, 40));
ok("6 yearly: counts to the next one, never hides", names([{ title: "B", date: "2019-11-11", yearly: true }, { title: "C", date: "2019-11-09", yearly: true }, { title: "D", date: "2019-11-10", yearly: true }], now, 0) === "D:0,B:1,C:364");
ok("7 yearly 29 February: 28 February in a common year, the 29th in a leap year", C.daysTo({ date: "2020-02-29", yearly: true }, at(2027, 2, 1)) === 27 && C.daysTo({ date: "2020-02-29", yearly: true }, at(2028, 2, 1)) === 28);
ok("8 nonsense is skipped, not a crash", names([{ title: "x", date: "soon" }, { title: "y" }], now, 0) === "" && names("nope", now, 0) === "" && names(items, now, "x") === "Today:0,Trip:21");

// photo files
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opensky-cdp-"));
process.env.OPENSKY_COUNTDOWN_PHOTOS = path.join(dir, "photos");
const P = require("../lib/countdowns.js");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)]);
const throws = (fn) => { try { fn(); return null; } catch (e) { return e.status || "error"; } };
P.save("cabc1234", PNG);
ok("9 a photo is saved and read back with its type", P.read("cabc1234").type === "image/png" && P.read("cabc1234").body.equals(PNG));
P.save("cabc1234", JPG);
ok("10 a new photo replaces the old (one file per countdown)", fs.readdirSync(process.env.OPENSKY_COUNTDOWN_PHOTOS).join() === "cabc1234.jpg" && P.read("cabc1234").type === "image/jpeg");
ok("11 not a picture → refused; empty → refused; too big → 413", throws(() => P.save("cabc1234", Buffer.from("<html>"))) === 400 && throws(() => P.save("cabc1234", Buffer.alloc(0))) === 400 && throws(() => P.save("cabc1234", Buffer.concat([JPG, Buffer.alloc(P.MAX_BYTES)]))) === 413);
ok("12 an id that could leave the folder is refused / reads nothing", throws(() => P.save("../x", PNG)) === 400 && P.read("../../etc/passwd") === null && P.read("A") === null && fs.readdirSync(dir).join() === "photos");
const lib = path.join(dir, "library.png"); fs.writeFileSync(lib, PNG);
P.copyFrom("clib0001", lib);
ok("13 a photo from the library is copied", P.read("clib0001").type === "image/png" && fs.existsSync(lib));
P.remove("cabc1234"); P.remove("nothere1"); P.remove("../x");
ok("14 remove deletes it (and a missing one is no problem)", P.read("cabc1234") === null && P.read("clib0001") !== null);

fs.rmSync(dir, { recursive: true, force: true });
console.log(`SUMMARY pass=${passed} fail=${failed}`);
