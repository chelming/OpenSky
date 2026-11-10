// Unit test for lib/client/weather-copy.js: the hero sentence, clothing chips, the rain strip, the "Plan around it" periods,
// the curve and the week's shared bar scale - all computed from the forecast.
let passed = 0, failed = 0;
const ok = (n, c, i) => { c ? passed++ : failed++; console.log(`${c ? "PASS" : "FAIL"}  ${n}${i !== undefined ? "  — " + JSON.stringify(i) : ""}`); };
const W = require("../lib/client/weather-copy.js");

// 11 AM, the mockup's day: warming to 62 at 2 PM, then falling to 41 at 3 AM, no rain
const temps = [57, 59, 61, 62, 61, 59, 56, 54, 52, 50, 48, 47, 46, 45, 44, 42, 41, 42, 41, 41, 42, 43, 44, 45];
const mk = (t, start = 11, rain = () => 0) => t.map((temp, i) => ({ day: "2026-11-10", hour: (start + i) % 24, temp, id: i < 14 ? 800 : 803, rain: rain(i) }));
const dry = mk(temps);

const e = W.extremes(dry);
ok("1 extremes: high 62 at 2 PM, low 41 at 3 AM", e.high === 62 && e.highHour === 14 && e.low === 41 && e.lowHour === 3, e);
const s = W.sentence(dry, { units: "imperial", hour12: true });
ok("2 sentence: the peak and its hour, when it drops fast, a jacket (low 46 in the next 12 hours)", /^Warming to 62° around 2 PM\. Then dropping fast after 3 PM\. Bring a jacket/.test(s), s);
ok("3 sentence: under 40 in the next 12 hours says warm coat", /warm coat/.test(W.sentence(mk(temps.map((t) => t - 10)), { units: "imperial" })));
ok("4 sentence: 40%+ rain is mentioned instead of the jacket", /Rain is likely around 6 PM, so take an umbrella/.test(W.sentence(mk(temps, 11, (i) => (i >= 7 ? 55 : 0)), { units: "imperial", hour12: true })) && !/jacket/.test(W.sentence(mk(temps, 11, (i) => (i >= 7 ? 55 : 0)), { units: "imperial" })));
ok("5 sentence: 24-hour clock and metric (thresholds converted: 10 C is a jacket)", /around 14:00/.test(W.sentence(mk(temps.map((t) => Math.round((t - 32) * 5 / 9))), { units: "metric", hour12: false })) && /jacket/.test(W.sentence(mk([12, 12, 12, 12]), { units: "metric" })) === false);
ok("6 sentence: already at the peak", /^It's at its warmest now, 62°/.test(W.sentence(mk([62, 60, 58, 55, 52, 50]), { units: "imperial" })));
ok("7 sentence: empty forecast is empty", W.sentence([], {}) === "");

ok("8 chips by the low: 62+ light, 50-61 jacket, below 50 coat, rain 40%+ wins", W.chipFor(62, 0).key === "light" && W.chipFor(61, 0).key === "jacket" && W.chipFor(50, 0).key === "jacket" && W.chipFor(49, 0).key === "coat" && W.chipFor(70, 40).key === "rain" && W.chipFor(70, 39).key === "light" && W.chipFor(9, 0, "metric").key === "coat" && W.chipFor(17, 0, "metric").key === "light");

ok("9 rain strip: dry all day under 20%", W.rainStrip(dry, {}).text === "Dry all day" && W.rainStrip(dry, {}).max === 0);
const wet = mk(temps, 11, (i) => (i === 7 ? 30 : i === 8 ? 70 : i === 9 ? 65 : 5));
ok("10 rain strip: Rain around the hour of the highest chance; no data at all = null", W.rainStrip(wet, { hour12: true }).text === "Rain around 7 PM" && W.rainStrip(wet, {}).max === 70 && W.rainStrip(dry.map((h) => ({ ...h, rain: null })), {}) === null, W.rainStrip(wet, { hour12: true }));

const p = W.plans(dry, { high: 55, low: 44, id: 500, rain: 70 }, { units: "imperial", hour12: true });
ok("11 plans: four periods, Tomorrow last", p.map((x) => x.when).join("|") === "Now to 5 PM|5 PM to 9 PM|9 PM to 5 AM|Tomorrow", p.map((x) => x.when));
ok("12 plans: ranges from the hours; tomorrow from the daily forecast", p[0].range === "56–62°" && p[1].range === "48–56°" && p[2].range === "41–48°" && p[3].range === "44–55°", p.map((x) => x.range));
ok("13 plans: chips (light only from a low of 62; rain wins for tomorrow)", p[0].chip.key === "jacket" && p[1].chip.key === "coat" && p[2].chip.key === "coat" && p[3].chip.label === "Rain jacket", p.map((x) => x.chip.key));
ok("14 plans: sentences say what changes", /Falls about \d° an hour/.test(p[1].text) && /Pack umbrellas/.test(p[3].text) && /Sunny/.test(p[0].text), p.map((x) => x.text));
const late = W.plans(mk(temps, 18), null, { units: "imperial", hour12: true });
ok("15 plans: at 6 PM the first period is already over, the next starts at Now", late[0].when === "Now to 9 PM" && late[1].when === "9 PM to 5 AM" && late.length === 2, late.map((x) => x.when));
ok("16 plans: a 24-hour clock", W.plans(dry, null, { hour12: false })[0].when === "Now to 17:00");

const c = W.curve(dry);
ok("17 curve: starts at x 0, ends at x 1000, closed area, points in percent, the high is the highest point", /^M0 /.test(c.line) && / 1000 /.test(c.line) && /Z$/.test(c.area) && c.pts.length === 24 && c.pts[0].x === 0 && c.pts[23].x === 100 && c.pts[3].y === Math.min(...c.pts.map((q) => q.y)), c.pts.slice(0, 4));
ok("18 curve: a flat day does not divide by zero", W.curve(mk([50, 50, 50])).pts.every((q) => Number.isFinite(q.y)));

const bars = W.weekBars([{ low: 44, high: 55 }, { low: 33, high: 41 }, { low: 36, high: 43 }]);
ok("19 week bars share one scale: the coldest low starts near 0, the warmest high ends near 100", bars[1].left < 10 && bars[0].left + bars[0].span > 90 && bars[0].span > bars[1].span, bars);

ok("20 hero label and sky", W.condLabel(800, 57, true, "imperial") === "Sunny and mild" && W.condLabel(800, 57, false) === "Clear and mild" && W.condLabel(804, 40, true) === "Cloudy and cold" && W.condLabel(500, 40, true) === "Rain" && W.skyKind(800, true) === "clear-day" && W.skyKind(800, false) === "night" && W.skyKind(804, true) === "cloudy" && W.skyKind(501, true) === "rain" && W.skyKind(601, false) === "snow");
const r1 = W.radarStatus(dry, 800), r2 = W.radarStatus(wet, 800), r3 = W.radarStatus(dry, 500);
ok("21 radar status: dry for the whole day, rain soon, raining now", r1.text === "No rain nearby" && r1.dry && r1.hours === 24 && r2.hours === 8 && r2.text === "No rain nearby" && r3.text === "Rain nearby" && !r3.dry, [r1, r2, r3]);
console.log(`SUMMARY pass=${passed} fail=${failed}`);
process.exit(failed ? 1 : 0);
