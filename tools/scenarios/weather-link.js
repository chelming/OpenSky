// The header's weather (.hb-weather-link) opens the Weather page from anywhere, whether or not the page has a button
// on this screen (hidden here, or tucked into More / a group).
const PORT = 8098;
let fake = null;
require("../fixtures/fake-weather.js").create(PORT).then((f) => { fake = f; });

module.exports = async (page, h) => {
  const R = {}; const ok = (k, v, i) => { R[k] = v; h.log(`${v ? "PASS" : "FAIL"}  ${k}${i !== undefined ? "  — " + JSON.stringify(i) : ""}`); };
  const until = async (fn, tries = 40) => { for (let i = 0; i < tries && !(await fn()); i++) await h.sleep(250); return fn(); };
  const sb = (fn, arg) => page.evaluate(`(() => { const m = MM.getModules().withClass("MMM-OpenSky-Sidebar")[0]; return (${fn.toString()})(m, ${JSON.stringify(arg === undefined ? null : arg)}); })()`);
  // the page that is showing (MMM-pages' index, kept by the sidebar) is the Weather page
  const onWeather = () => page.evaluate(() => { const sb = MM.getModules().withClass("MMM-OpenSky-Sidebar")[0], w = sb.config.pages.find((p) => p.key === "weather"); return !!w && sb.activeIndex === w.index; });
  const home = async () => { await sb((m) => m.goPage(0)); await until(async () => !(await onWeather())); };
  const tapWeather = async () => { await h.tap(".hb-weather-link"); await h.sleep(500); };

  await h.sleep(1500);
  ok("the header's weather is a link", !!(await page.$(".hb-weather.hb-weather-link")));
  ok("(the Weather page is in More: no button of its own on the rail)", !(await page.$(".os-tile[data-key='page-weather']")) && !!(await page.$(".os-tile.os-more, .os-tile[data-key='more']")));
  await home();
  await tapWeather();
  ok("in More: tapping it opens the Weather page", await until(onWeather));

  // the page has no button on this screen (hidden here)
  await home();
  await sb((m) => m.setHiddenPages(["weather"]));
  await h.sleep(300);
  ok("(weather's button is hidden on this screen)", !(await page.$(".os-tile[data-key='page-weather']")));
  await tapWeather();
  ok("hidden here: the header's weather still opens the Weather page", await until(onWeather));
  await sb((m) => m.setHiddenPages([]));

  const f = Object.entries(R).filter(([, v]) => !v).map(([k]) => k);
  h.log(`SUMMARY: ${f.length ? "FAILED: " + f.join("; ") : "ALL CHECKS PASSED"} (${Object.keys(R).length} checks)`);
};
module.exports.env = {
  OPENSKY_WEATHER_URL: `http://127.0.0.1:${PORT}`, OPENSKY_NWS_URL: `http://127.0.0.1:${PORT}`, OPENSKY_RADAR_URL: `http://127.0.0.1:${PORT}`,
  OPENSKY_RADAR_BASE: `http://127.0.0.1:${PORT}/base/{z}/{x}/{y}.png`
};
// a household like the real one: groups, More, web pages, several people; Weather lives in More
module.exports.patchSettings = (s) => {
  s.weather = { provider: "open-meteo" };
  s.pages = ["home", "chores", "weather", "lists", "meals", "wordgame", "timer", "home-assistant", "cams", "jukebox", "countdowns", "music"];
  const dummy = `http://127.0.0.1:${PORT}/`;
  s.embeds = { "home-assistant": { title: "Home Assistant", icon: "smarthome", url: dummy }, cams: { title: "Cams", icon: "video", url: dummy }, jukebox: { title: "Jukebox", icon: "music", url: dummy } };
  s.profiles = [{ name: "Reese", color: "green" }, { name: "Hari", color: "blue" }, { name: "Quinn", color: "purple" }];
  s.chores = { badges: true, kids: [{ id: "1", name: "Reese", profile: "Reese" }] };
  s.nav = { groups: [{ label: "Home", icon: "smarthome", pages: ["home-assistant", "cams"] }, { label: "Music", icon: "music", pages: ["music", "jukebox"] }], more: ["timer", "meals", "lists", "weather"] };
};
