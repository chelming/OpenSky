// Unit test for lib/client/shared-badges.js — initial badges for events on more than one calendar.
// Run: node tools/test-shared-badges.js   (last line must be "pass=N fail=0": tools/test-all.sh reads it)
const B = require("../lib/client/shared-badges.js");
let pass = 0, fail = 0;
const ok = (k, v, info = "") => { v ? pass++ : fail++; console.log(`${v ? "PASS" : "FAIL"}  ${k} ${v ? "" : info}`); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// 1. labels
ok("1 unique first letters → one letter", same(B.labels(["Quinn", "Reese", "Sam", "Mom"]), { Quinn: "Q", Reese: "R", Sam: "S", Mom: "M" }));
ok("1 a shared first letter → both get the shortest unique start (Re / Ry)", same(B.labels(["Quinn", "Reese", "Ryan", "Sam"]), { Quinn: "Q", Reese: "Re", Ryan: "Ry", Sam: "S" }));
ok("1 a longer shared start → longer labels (Sam / Samantha → Sam, Sama)", (() => { const l = B.labels(["Sam", "Samantha"]); return l.Sam === "Sam" && l.Samantha === "Sama"; })(), JSON.stringify(B.labels(["Sam", "Samantha"])));
ok("1 case-insensitive (mom / Mom)", (() => { const l = B.labels(["mom", "Mark"]); return l.mom === "mo" && l.Mark === "Ma"; })(), JSON.stringify(B.labels(["mom", "Mark"])));
ok("1 three on one letter (Ann, Amy, Abe)", same(B.labels(["Ann", "Amy", "Abe"]), { Ann: "An", Amy: "Am", Abe: "Ab" }));
ok("1 the same name listed twice is one person ('A')", same(B.labels(["Alex", "Alex"]), { Alex: "A" }));
ok("1 a one-letter name is just that letter", B.labels(["A", "Al"]).A === "A");
ok("1 an accented letter is a different letter (É vs E) and is never cut in half", (() => { const l = B.labels(["Élise", "Eva"]); return l.Élise === "É" && l.Eva === "E"; })(), JSON.stringify(B.labels(["Élise", "Eva"])));
ok("1 emoji count as one character (🐶 Rex / Rex → 🐶 / R)", (() => { const l = B.labels(["🐶 Rex", "Rex"]); return l["🐶 Rex"] === "🐶" && l.Rex === "R"; })());
ok("1 two calendars that both start with an emoji: told apart by the whole emoji, not half of it", (() => { const l = B.labels(["🐶 Rex", "🐱 Tom"]); return l["🐶 Rex"] === "🐶" && l["🐱 Tom"] === "🐱"; })(), JSON.stringify(B.labels(["🐶 Rex", "🐱 Tom"])));
ok("1 empty / missing input", same(B.labels([]), {}) && same(B.labels(undefined), {}));
ok("1 the same set always gives the same labels (order of names doesn't matter)", same(B.labels(["Ryan", "Reese"]), { Ryan: "Ry", Reese: "Re" }) && B.labels(["Reese", "Ryan"]).Ryan === "Ry");

// 2. badges
const P = (...n) => n.map((name) => ({ name, color: name.toLowerCase() }));
const L = B.labels(["Quinn", "Reese", "Ryan", "Sam", "Mom"]);
let b = B.badges(P("Quinn", "Reese"), L);
ok("2 two people → two badges, no extra, labels from the map", b.shown.length === 2 && b.extra === 0 && b.shown[1].label === "Re", JSON.stringify(b));
ok("2 the person's other fields come along (color)", b.shown[0].color === "quinn");
b = B.badges(P("Quinn", "Reese", "Sam", "Mom"), L);
ok("2 four people → four badges (the default max)", b.shown.length === 4 && b.extra === 0);
b = B.badges(P("Quinn", "Reese", "Sam", "Mom", "Ryan"), L);
ok("2 five people → three badges + '+2'", b.shown.length === 3 && b.extra === 2 && same(b.shown.map((p) => p.name), ["Quinn", "Reese", "Sam"]), JSON.stringify(b));
b = B.badges(P("A", "B", "C", "D", "E", "F", "G"), B.labels(["A", "B", "C", "D", "E", "F", "G"]));
ok("2 seven people → three badges + '+4'", b.shown.length === 3 && b.extra === 4);
b = B.badges(P("Quinn", "Reese", "Sam"), L, 2);
ok("2 a smaller max: 3 people at max 2 → one badge + '+2'", b.shown.length === 1 && b.extra === 2);
b = B.badges(P("Quinn"), L);
ok("2 one person → one badge (the caller shows a dot + name instead)", b.shown.length === 1 && b.extra === 0);
ok("2 order is kept as given (settings order, never sorted here)", same(B.badges(P("Sam", "Quinn"), L).shown.map((p) => p.name), ["Sam", "Quinn"]));
ok("2 no people → nothing", same(B.badges([], L), { shown: [], extra: 0 }) && same(B.badges(undefined, L), { shown: [], extra: 0 }));
ok("2 a name missing from the map falls back to its first letter, upper-cased", B.badges([{ name: "zed" }], {}).shown[0].label === "Z");
ok("2 the input isn't changed", (() => { const people = P("Quinn", "Reese"); B.badges(people, L); return !("label" in people[0]); })());

console.log(`pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
