// Quick add on the screen (fake AI helper + fake Google): type "dentist Tuesday 3pm" in New Event → the form fills itself in and nothing is
// saved until Add Event is tapped; several people → the family (Google) calendar with an Invite row (people without an email are said, not invited);
// the invitations go out only for the ticked people and only as addresses OpenSky already knows; an AI error leaves the form alone.
const http = require("http");
const GOOGLE = 8102, AI = 8103;
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const inDays = (n) => { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate() + n); };

// ---- fake Google: records what is created and how ----
const store = { "family@group.calendar.google.com": [] };
const created = [];
const google = http.createServer((req, res) => {
  let raw = ""; req.on("data", (c) => { raw += c; });
  req.on("end", () => {
    const u = new URL(req.url, "http://x"), send = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(obj === undefined ? "" : JSON.stringify(obj)); };
    if (u.pathname === "/token") return send(200, { access_token: "fa", expires_in: 3600 });
    const m = u.pathname.match(/^\/cal\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/);
    const list = m && store[decodeURIComponent(m[1])];
    if (!list) return send(404, { error: { message: "nf" } });
    if (req.method === "GET") return send(200, { items: list });
    if (req.method === "POST") { const b = JSON.parse(raw); created.push({ calendar: decodeURIComponent(m[1]), sendUpdates: u.searchParams.get("sendUpdates"), body: b }); list.push({ id: `n${created.length}`, ...b }); return send(200, b); }
    send(405, {});
  });
});
google.listen(GOOGLE, "127.0.0.1"); google.unref();

// ---- fake AI helper: answers by what the sentence says ----
let aiCalls = 0, failNext = false;
const ai = http.createServer((req, res) => {
  const chunks = []; req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const send = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
    if (req.url === "/v1/chat/completions") {
      aiCalls++;
      if (failNext) { failNext = false; return send(500, { error: { message: "boom" } }); }
      const body = JSON.parse(Buffer.concat(chunks).toString()), said = String(body.messages[1].content).toLowerCase();
      const answer = /dinner/.test(said)
        ? { title: "Family dinner", date: ymd(inDays(3)), allDay: false, start: "18:00", end: "", calendar: "", people: ["Mia", "Dad", "Mom"], repeats: false }
        : { title: "Dentist", date: ymd(inDays(1)), allDay: false, start: "15:00", end: "", calendar: "", people: [], repeats: false };
      return send(200, { choices: [{ message: { content: JSON.stringify(answer) } }] });
    }
    send(404, {});
  });
});
ai.listen(AI, "127.0.0.1"); ai.unref();

module.exports = async (page, h) => {
  const R = {}; const ok = (k, v, i) => { R[k] = v; h.log(`${v ? "PASS" : "FAIL"}  ${k}${i !== undefined ? "  — " + JSON.stringify(i) : ""}`); };
  const until = async (fn, tries = 40) => { for (let i = 0; i < tries && !(await fn()); i++) await h.sleep(250); return fn(); };
  const val = (id) => page.evaluate((id) => (document.getElementById(id) || {}).value, id);
  const status = () => page.evaluate(() => { const e = document.getElementById("qa-status"); return e ? { text: e.textContent, error: e.classList.contains("qa-error") } : null; });
  const say = async (text) => { await page.evaluate((t) => { document.getElementById("qa-text").value = t; document.querySelector(".qa-go").click(); }, text); };
  const addBtn = () => page.evaluate(() => [...document.querySelectorAll(".event-btn-primary")].pop().click());

  await h.tap(".hd-add"); await h.sleep(500);
  ok("New Event has the quick add bar (the AI helper is set up)", await page.evaluate(() => !!document.getElementById("qa-text") && !!document.querySelector(".qa-go")));
  ok("a calendar picker shows (a local and a Google calendar can be added to)", await page.evaluate(() => document.getElementById("event-calendar").options.length >= 2));
  await h.shot("quick-add-bar");

  // 1. one sentence, nobody named
  await say("dentist Tuesday 3pm");
  await until(async () => (await val("event-title")) === "Dentist");
  const tomorrow = ymd(inDays(1));
  ok("the form is filled in: title, day, 3 PM, an hour long", (await val("event-title")) === "Dentist" && (await val("event-start-date")) === tomorrow && (await val("event-start-time")) === "15:00" && (await val("event-end-time")) === "16:00", [await val("event-title"), await val("event-start-date"), await val("event-start-time")]);
  ok("the bar says what it understood and to check it", /check it, then tap Add Event/.test((await status() || {}).text || ""), await status());
  ok("nobody named → no Invite row", await page.evaluate(() => !document.querySelector(".qa-invites")));
  ok("nothing was saved yet", created.length === 0);
  await h.shot("quick-add-filled");

  // 2. several people → the family calendar, with invitations
  await say("family dinner Saturday 6pm with Mia, Dad and Mom");
  await until(async () => (await val("event-title")) === "Family dinner");
  ok("several people → the family (Google) calendar is chosen", (await val("event-calendar")) === "Family", await val("event-calendar"));
  const boxes = await page.evaluate(() => [...document.querySelectorAll(".qa-invite-box")].map((b) => ({ name: b.value, on: b.checked })));
  ok("Invite row: Mia and Dad (ticked); Mom has no email so she is said, not listed", JSON.stringify(boxes) === '[{"name":"Mia","on":true},{"name":"Dad","on":true}]' && await page.evaluate(() => /Mom has no email/.test(document.querySelector(".qa-notes").textContent)), boxes);
  ok("the page never gets an email address", await page.evaluate(() => !document.documentElement.innerHTML.includes("@example.com") && !JSON.stringify(window.config || {}).includes("@example.com")));
  await h.shot("quick-add-invites");

  // 3. untick Dad, save → one invitation, emailed by Google
  await page.evaluate(() => { const b = [...document.querySelectorAll(".qa-invite-box")].find((x) => x.value === "Dad"); b.checked = false; });
  await addBtn();
  await until(async () => created.length === 1);
  const c = created[0] || {};
  ok("saved on the Google family calendar with only the ticked person invited, and Google told to email her", c.calendar === "family@group.calendar.google.com" && c.body && c.body.summary === "Family dinner" && JSON.stringify((c.body.attendees || []).map((a) => a.email)) === '["mia@example.com"]' && c.sendUpdates === "all", c);
  ok("the form closed with a success note", await until(async () => page.evaluate(() => !document.querySelector(".calendar-editor-modal"))));

  // 4. the AI helper fails → friendly message, nothing changes, the form still works by hand
  await h.tap(".hd-add"); await h.sleep(500);
  failNext = true;
  await say("anything");
  await until(async () => (await status() || {}).error);
  const st = await status();
  ok("an AI error is shown in plain words and the form is untouched", st && st.error && /^The AI helper had a problem/.test(st.text) && (await val("event-title")) === "", st);
  await page.evaluate(() => document.querySelector(".event-btn-secondary").click()); await h.sleep(300);

  const f = Object.entries(R).filter(([, v]) => !v).map(([k]) => k);
  h.log(`SUMMARY: ${f.length ? "FAILED: " + f.join("; ") : "ALL CHECKS PASSED"} (${Object.keys(R).length} checks)`);
};
module.exports.patchSettings = (s) => {
  s.profiles = [{ name: "Mia", color: "pink", email: "mia@example.com" }, { name: "Dad", color: "blue", email: "dad@example.com" }, { name: "Mom", color: "green" }];
  s.calendar.mergeShared = true;
  s.calendar.sources.push({ name: "Family", type: "google", calendarId: "family@group.calendar.google.com", role: "shared", color: "orange", fetchMinutes: 5 });
  s.ai = { url: `http://127.0.0.1:${AI}`, transcribeUrl: `http://127.0.0.1:${AI}` };
};
module.exports.patchSecrets = (s) => { s.google = { clientId: "9-x.apps.googleusercontent.com", clientSecret: "fake-secret-value", refreshToken: "fake-refresh-token" }; };
module.exports.env = { OPENSKY_GOOGLE_TOKEN_URL: `http://127.0.0.1:${GOOGLE}/token`, OPENSKY_GOOGLE_API_URL: `http://127.0.0.1:${GOOGLE}/cal` };
