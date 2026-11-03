// Unit test for lib/client/day-agenda.js — the "what's left today" ranking for Home's day tile.
// Run: node tools/test-day-agenda.js   (last line must be "pass=N fail=0": tools/test-all.sh reads it)
const A = require("../lib/client/day-agenda.js");
let pass = 0, fail = 0;
const ok = (k, v, info = "") => { v ? pass++ : fail++; console.log(`${v ? "PASS" : "FAIL"}  ${k} ${v ? "" : info}`); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// A fixed local day (Fri 2026-10-30). Times are minutes after midnight, like the design prototype.
const D = (m) => new Date(2026, 9, 30, 0, m).getTime();
const ev = (title, cal, s, e, extra = {}) => ({ title, calendarName: cal, startDate: D(s), endDate: D(e), allDay: false, ...extra });
const DAD = { title: "Dad - no school", calendarName: "Dad", startDate: D(0), endDate: D(24 * 60), allDay: true };

// The ordinary day: OT 10–11, PT 11:30–12:30, Swim 1–2 PM, Soccer 4:30–6, Dinner 6:30–7:30
const BASE = [DAD, ev("OT", "Kids", 600, 660), ev("PT", "Kids", 690, 750), ev("Swim lessons", "Mom", 780, 840),
  ev("Soccer practice", "Kids", 990, 1050), ev("Family dinner", "Family", 1110, 1170)];
// The busy day (design board "1:45 PM · busy day"): + Piano 3:30–4, Call with Grandma 8–8:30, Book club 8:30–10
const BUSY = [...BASE, ev("Piano", "Kids", 930, 960), ev("Call with Grandma", "Family", 1200, 1230), ev("Book club", "Mom", 1230, 1320)];
const titles = (a) => a.rows.map((r) => r.ev.title);
const kinds = (a) => a.rows.map((r) => r.kind);

// 1. 12:41 PM, ordinary day: PT ended 11 min ago → the one "recent" row; OT is the only "done"
let a = A.rank(BASE, D(761));
ok("1 12:41 PM: 3 left", a.left === 3 && a.counter === "3 left", a.counter);
ok("1 rows = recent PT, then Swim, Soccer, Dinner", same(titles(a), ["PT", "Swim lessons", "Soccer practice", "Family dinner"]) && same(kinds(a), ["recent", "next", "next", "next"]), titles(a));
ok("1 PT 'ended 11 min ago'", a.rows[0].agoText === "11 min ago", a.rows[0].agoText);
ok("1 Swim 'in 19 min'; Soccer (3 h 49 min away) has no relative label", a.rows[1].relText === "in 19 min" && a.rows[2].relText === "", [a.rows[1].relText, a.rows[2].relText]);
ok("1 one all-day strip; OT is the only 'done'", a.strips.length === 1 && a.doneCount === 1 && a.done[0].title === "OT" && a.more === 0);

// 2. 1:45 PM, busy day: Swim live, 2 done (PT ended 75 min ago: outside the hour), +2 more — the design's "A · busy day" board
a = A.rank(BUSY, D(825));
ok("2 1:45 PM busy: 6 left", a.left === 6 && a.counter === "6 left", a.counter);
ok("2 rows = live Swim, then Piano, Soccer, Dinner (no recent row)", same(titles(a), ["Swim lessons", "Piano", "Soccer practice", "Family dinner"]) && same(kinds(a), ["live", "next", "next", "next"]), titles(a));
ok("2 '+2 more' and '2 done'", a.more === 2 && a.doneCount === 2 && same(a.done.map((e) => e.title), ["OT", "PT"]), [a.more, a.doneCount]);
ok("2 Swim: 15 min left, 25% … 75% through (progress 0.75)", a.rows[0].minutesLeft === 15 && Math.abs(a.rows[0].progress - 0.75) < 1e-9, a.rows[0]);
ok("2 Piano 'in 1 hr 45 min', Soccer 'in 2 hr 45 min', Dinner no label", same(a.rows.slice(1).map((r) => r.relText), ["in 1 hr 45 min", "in 2 hr 45 min", ""]), a.rows.map((r) => r.relText));

// 3. Before the day starts, and when it is over
a = A.rank(BASE, D(450));
ok("3 7:30 AM: nothing done, no recent row, OT 'in 2 hr 30 min'", a.doneCount === 0 && !kinds(a).includes("recent") && a.rows[0].relText === "in 2 hr 30 min" && a.counter === "5 left" && a.moreCount === 1, [a.counter, a.moreCount]);
a = A.rank(BASE, D(1260));
ok("3 9:00 PM: all done — counter 'All done', no rows, 5 done", a.state === "allDone" && a.counter === "All done" && a.rows.length === 0 && a.doneCount === 5 && a.more === 0, a.state);
a = A.rank([DAD], D(600));
ok("3 an all-day-only day: state 'empty', counter '' (the tile keeps its '1 event' text), strip kept", a.state === "empty" && a.counter === "" && a.strips.length === 1 && a.rows.length === 0);
a = A.rank([], D(600));
ok("3 no events at all: state 'empty'", a.state === "empty" && a.counter === "" && !a.strips.length);

// 4. The just-ended window
a = A.rank(BASE, D(750 + 60));        // PT ended exactly 60 min ago
ok("4 exactly 60 min after the end: still shown ('1 hr ago')", kinds(a)[0] === "recent" && a.rows[0].agoText === "1 hr ago", a.rows[0] && a.rows[0].agoText);
a = A.rank(BASE, D(750 + 61));
ok("4 61 min after the end: gone, folded into 'done' (2)", !kinds(a).includes("recent") && a.doneCount === 2, kinds(a));
a = A.rank(BASE, D(750));
ok("4 the minute it ends: 'just now'", a.rows[0].kind === "recent" && a.rows[0].agoText === "just now", a.rows[0].agoText);
a = A.rank(BUSY, D(1020), { cap: 4 });   // 5 PM: Soccer live; Piano ended exactly 60 min ago; upcoming Dinner, Call, Book club → 4 main rows
ok("4 no free slot (4 live/upcoming rows at cap 4) → no recent row even though Piano is fresh; OT, PT, Swim, Piano are 'done' (4)", !kinds(a).includes("recent") && a.rows.length === 4 && a.doneCount === 4, [kinds(a), a.doneCount]);
a = A.rank(BUSY, D(1020), { cap: 5 });
ok("4 …with cap 5 there is room, so Piano shows as recent and 'done' drops to 3", kinds(a)[0] === "recent" && a.rows[0].ev.title === "Piano" && a.doneCount === 3, [kinds(a), a.doneCount]);

// 5. Edge cases
const rows5 = (events, m) => A.rank(events, D(m));
ok("5 a multi-day event in the middle of its run counts as all-day", rows5([{ title: "Camping", calendarName: "Family", startDate: D(-2 * 1440), endDate: D(3 * 1440), allDay: false }], 600).strips.length === 1);
ok("5 an event that started yesterday and ends 9 AM: live at 8 AM, done at 9 AM", rows5([ev("Sleepover", "Kids", -120, 540)], 480).rows[0].kind === "live" && rows5([ev("Sleepover", "Kids", -120, 540)], 540).doneCount + rows5([ev("Sleepover", "Kids", -120, 540)], 540).rows.length === 1);
ok("5 an event that runs past midnight stays live/upcoming all evening", rows5([ev("Party", "Kids", 1380, 1500)], 1400).rows[0].kind === "live" && rows5([ev("Party", "Kids", 1380, 1500)], 1300).rows[0].kind === "next");
const pt = rows5([{ title: "Reminder", calendarName: "Mom", startDate: D(900), endDate: D(900), allDay: false }], 901);
ok("5 an event with no end is a point in time: done a minute later ('1 min ago')", pt.left === 0 && pt.rows[0].kind === "recent" && pt.rows[0].agoText === "1 min ago", pt.rows);
ok("5 three all-day events: 2 strips + 1 in '+N more'", (() => { const x = A.rank([DAD, { ...DAD, title: "Holiday" }, { ...DAD, title: "Birthday" }], D(600)); return x.strips.length === 2 && x.stripOverflow === 1 && x.more === 1; })());
ok("5 two events live at once: both live, in start order", (() => { const x = A.rank([ev("A", "Kids", 600, 700), ev("B", "Mom", 630, 660)], D(640)); return same(titles(x), ["A", "B"]) && same(kinds(x), ["live", "live"]); })());
ok("5 sorted ties are stable (same start → title order)", same(titles(A.rank([ev("B", "x", 900, 960), ev("A", "x", 900, 960)], D(600))), ["A", "B"]));

// 6. shrink(): the renderer's overflow fallback
a = A.rank(BASE, D(761));                 // recent PT, Swim, Soccer, Dinner
let s1 = A.shrink(a);
ok("6 shrink drops the recent row first (it joins 'done')", same(titles(s1), ["Swim lessons", "Soccer practice", "Family dinner"]) && s1.doneCount === 2 && s1.counter === "3 left", titles(s1));
let s2 = A.shrink(s1), s3 = A.shrink(s2), s4 = A.shrink(s3);
ok("6 then the last upcoming rows, one at a time (+N more grows)", same(titles(s2), ["Swim lessons", "Soccer practice"]) && s2.more === 1 && same(titles(s3), ["Swim lessons"]) && s3.more === 2, [titles(s2), s2.more, titles(s3), s3.more]);
ok("6 the first row is never dropped (null when nothing can go)", s4 === null);
a = A.shrink(A.rank(BUSY, D(825), { cap: 4 }));
ok("6 a live row is never dropped", a.rows[0].kind === "live" && a.rows.length === 3 && a.more === 3, [titles(a), a.more]);
ok("6 shrink doesn't change the original", A.rank(BASE, D(761)).rows.length === 4);

// 7. Formatting and re-render detection
ok("7 dur", A.dur(0) === "0 min" && A.dur(5) === "5 min" && A.dur(60) === "1 hr" && A.dur(105) === "1 hr 45 min" && A.dur(120) === "2 hr");
ok("7 agoText", A.agoText(0) === "just now" && A.agoText(1) === "1 min ago" && A.agoText(59) === "59 min ago" && A.agoText(60) === "1 hr ago");
const g1 = A.signature(A.rank(BUSY, D(825))), g2 = A.signature(A.rank(BUSY, D(825) + 20000)), g3 = A.signature(A.rank(BUSY, D(826)));
ok("7 signature: same minute → same; next minute → different", g1 === g2 && g1 !== g3);
ok("7 signature changes when an event is added", A.signature(A.rank(BASE, D(761))) !== A.signature(A.rank(BUSY, D(761))));

// 8. DST: the "day" is the local calendar day (US fall back, Sun 2026-11-01: a 25-hour day)
const dst = (h, m) => new Date(2026, 10, 1, h, m).getTime();
const dstEv = { title: "Brunch", calendarName: "Family", startDate: dst(10, 0), endDate: dst(11, 0), allDay: false };
ok("8 on a 25-hour day, a 10–11 AM event is 'next' at 9:30 AM and 'live' at 10:15", A.rank([dstEv], dst(9, 30)).rows[0].kind === "next" && A.rank([dstEv], dst(10, 15)).rows[0].kind === "live");

console.log(`pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
