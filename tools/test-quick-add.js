// Unit test for lib/quick-add.js: words → a draft event (checked in code), which calendar + who is invited. Fake AI server.
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "opensky-qa-"));
process.env.OPENSKY_SECRETS = path.join(tmp, "secrets.json");
process.env.OPENSKY_SETTINGS = path.join(tmp, "opensky.json");
const qa = require(path.join(__dirname, "..", "lib", "quick-add.js"));

let passed = 0, failed = 0;
const ok = (name, cond, info) => { cond ? passed++ : failed++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${info !== undefined ? "  — " + JSON.stringify(info) : ""}`); };
const fails = async (fn) => { try { await fn(); return null; } catch (e) { return e.message; } };

const NOW = new Date(2026, 10, 10, 9, 30);      // Tue 10 Nov 2026
const cals = ["Family", "Mia"], people = ["Mia", "Dad", "Mom"];
const base = { title: "Dentist", date: "2026-11-10", allDay: false, start: "15:00", end: "", calendar: "", people: [], repeats: false };
const draft = (o) => qa.toDraft({ ...base, ...o }, NOW, cals, people);

let reply = base, asr = "language English<asr_text>dentist Tuesday at three", sent = null;
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    const send = (o) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
    if (req.url === "/v1/chat/completions") { sent = JSON.parse(body); return send({ choices: [{ message: { content: JSON.stringify(reply) } }] }); }
    if (req.url === "/v1/audio/transcriptions") return send({ text: asr });
    res.writeHead(404); res.end();
  });
});

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}`;
  fs.writeFileSync(process.env.OPENSKY_SETTINGS, JSON.stringify({ ai: { url, transcribeUrl: url } }));

  let d = draft({});
  ok("1 timed event: local start, one hour by default, readable label", new Date(d.startDate).getHours() === 15 && new Date(d.endDate) - new Date(d.startDate) === 3600e3 && d.label === "Tue, Nov 10, 3:00 PM – 4:00 PM" && !d.allDay, d);
  d = draft({ start: "17:00", end: "18:30" });
  ok("2 given end time is kept", new Date(d.endDate) - new Date(d.startDate) === 5400e3);
  d = draft({ start: "17:00", end: "16:00" });
  ok("3 an end before the start is fixed and said", new Date(d.endDate) - new Date(d.startDate) === 3600e3 && d.notes.length === 1, d.notes);
  d = draft({ allDay: true, start: "", date: "2026-11-14", title: "Grandma's birthday" });
  ok("4 all day: plain dates, label says so", d.allDay && d.startDate === "2026-11-14" && d.endDate === "2026-11-14" && d.label === "Sat, Nov 14, all day", d);
  d = draft({ start: "" });
  ok("5 no time of day → all day", d.allDay === true);
  ok("6 no day / nonsense day → asks again", /which day/.test(await fails(() => draft({ date: "" }))) && /which day/.test(await fails(() => draft({ date: "2026-02-31" }))));
  ok("7 a date far away or long past is refused", /looks off/.test(await fails(() => draft({ date: "2020-01-01" }))) && /looks off/.test(await fails(() => draft({ date: "2031-01-01" }))));
  ok("8 yesterday is still allowed (said after midnight)", draft({ date: "2026-11-09" }).allDay === false);
  ok("9 no title → asks again; control characters and length are cleaned", /what the event is/.test(await fails(() => draft({ title: "  " }))) && draft({ title: "A\u0000B" + "x".repeat(200) }).title.length === 120 && !/\u0000/.test(draft({ title: "A\u0000B" }).title));
  d = draft({ calendar: "Mia", people: ["Mia", "Zed", "mia", "Dad"] });
  ok("10 the calendar must exist; people must exist, each once, in the list's order", d.calendar === "Mia" && JSON.stringify(d.people) === '["Mia","Dad"]' && draft({ calendar: "Nope" }).calendar === "", d.people);
  ok("11 'every Thursday' → adds the first one and says repeats aren't supported yet", /Repeating/.test(draft({ repeats: true }).notes[0]));
  ok("12 impossible times (25:99) fall back to all day", draft({ start: "25:99" }).allDay === true);

  // through the (fake) AI server
  reply = { ...base, title: "Soccer practice for Mia", date: "2026-11-12", start: "17:00", end: "18:30", people: ["Mia"], calendar: "Mia" };
  let r = await qa.parseText("  soccer practice for Mia next Thursday 5 to 6:30 ", { now: NOW, calendars: cals, people });
  ok("13 typed sentence → draft (spaces tidied, the model got today's date + the next 21 days + the names)", r.title === "Soccer practice for Mia" && r.calendar === "Mia" && sent.messages[0].content.includes("Tue 2026-11-10 (today)") && sent.messages[0].content.includes("Mia, Dad, Mom") && sent.chat_template_kwargs.enable_thinking === false && r.text === "soccer practice for Mia next Thursday 5 to 6:30", r.label);
  ok("14 the schema only allows the real calendar and people names", JSON.stringify(sent.response_format.json_schema.schema.properties.calendar.enum) === '["Family","Mia",""]' && JSON.stringify(sent.response_format.json_schema.schema.properties.people.items.enum) === '["Mia","Dad","Mom"]');
  ok("15 empty or huge text is refused before asking the AI", /Say or type/.test(await fails(() => qa.parseText("  ", {}))) && /to a sentence/.test(await fails(() => qa.parseText("x".repeat(401), {}))));
  const r2 = await qa.parseAudio(Buffer.from("RIFFxxxx"), "audio/wav", { now: NOW, calendars: cals, people });
  ok("16 spoken → transcribed (prefix removed) → draft", r2.text === "dentist Tuesday at three" && r2.title === "Soccer practice for Mia", r2.text);
  asr = "language None<asr_text>";
  ok("17 silence → says so, no event", /didn't catch/.test(await fails(() => qa.parseAudio(Buffer.from("x"), "audio/wav", {}))));
  ok("18 injected instructions in the sentence can't do more than make a draft (the prompt says to treat it as untrusted)", /untrusted/.test(sent.messages[0].content) && sent.messages[1].content === "dentist Tuesday at three");   // the last request was the spoken one

  // calendar + invitations
  const sources = [
    { name: "Family", type: "google", calendarId: "fam123@group.calendar.google.com", role: "shared", profiles: [] },
    { name: "Mia", type: "google", calendarId: "mia@example.com", profiles: ["Mia"] },
    { name: "Dad", type: "google", calendarId: "dad.work@group.calendar.google.com", profiles: ["Dad"] },
    { name: "Mom", type: "local", profiles: ["Mom"] }
  ];
  const profiles = [{ name: "Mia" }, { name: "Dad", email: "dad@example.com" }, { name: "Mom" }];
  let p = qa.plan({ people: ["Mia"], calendar: "" }, { sources, profiles });
  ok("19 one person → their own calendar, nobody invited", p.calendar === "Mia" && !p.invite.length && !p.skipped.length, p);
  p = qa.plan({ people: ["Mia", "Dad"], calendar: "Mia" }, { sources, profiles });
  ok("20 several people → the family calendar; emails from the profile, or from their own Google calendar's id", p.calendar === "Family" && JSON.stringify(p.invite) === '[{"name":"Mia","email":"mia@example.com"},{"name":"Dad","email":"dad@example.com"}]', p.invite);
  p = qa.plan({ people: ["Mia", "Mom"] }, { sources, profiles });
  ok("21 someone with no usable email is left out and said", JSON.stringify(p.invite.map((i) => i.name)) === '["Mia"]' && p.skipped[0] === "Mom" && /Mom has no email/.test(p.notes.join(" ")), p);
  p = qa.plan({ people: ["Mia", "Dad"] }, { sources: sources.filter((c) => c.role !== "shared"), profiles });
  ok("22 no family calendar set up → no guess, the form asks which calendar", p.calendar === "" && /Pick the calendar/.test(p.notes.join(" ")) && !p.invite.length, p);
  p = qa.plan({ people: ["Mia", "Dad"] }, { sources: sources.map((c) => c.role === "shared" ? { ...c, type: "local" } : c), profiles });
  ok("23 a calendar that can't send invitations → the names go in the description", p.calendar === "Family" && !p.invite.length && p.description === "With: Mia, Dad" && /Invitations only work on Google/.test(p.notes.join(" ")), p);
  p = qa.plan({ people: ["Dad", "Mia"] }, { sources: sources.map((c) => c.role === "shared" ? { ...c, calendarId: "dad@example.com" } : c), profiles });
  ok("24 the account that owns the calendar isn't invited to its own event", p.invite.length === 1 && p.invite[0].name === "Mia", p.invite);
  p = qa.plan({ people: [], calendar: "Family" }, { sources, profiles });
  ok("25 nobody named → the calendar the sentence meant (or none)", p.calendar === "Family" && qa.plan({ people: [], calendar: "" }, { sources, profiles }).calendar === "");
  p = qa.plan({ people: ["Mia", "Dad"] }, { sources, profiles: [{ name: "Mia", email: "not-an-email" }, { name: "Dad", email: "dad@example.com" }] });
  ok("26 a malformed stored email is treated as missing (falls back to the calendar id)", p.invite.find((i) => i.name === "Mia").email === "mia@example.com");

  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`passed=${passed} fail=${failed}`);
  process.exit(failed ? 1 : 0);
})();
