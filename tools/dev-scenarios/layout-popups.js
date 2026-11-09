// (not run by test-all.sh: a tool for looking, see docs/development/architecture.md)
module.exports = async (page, h) => {
  const [w, hh] = (process.env.SIZE || "1024x600").split("x").map(Number);
  await page.setViewportSize({ width: w, height: hh }); await h.sleep(1000);
  await page.evaluate(() => MM.getModules().withClass("MMM-OpenSky-Home")[0].sendNotification("CALENDAR_ADD_EVENT", { date: new Date() }));
  await h.sleep(700); await h.shot("lay-editor");
  await page.evaluate(() => document.getElementById("event-title").focus()); await h.sleep(700); await h.shot("lay-editor-kb");
  await page.evaluate(() => { document.querySelector(".event-close-btn")?.click(); document.activeElement && document.activeElement.blur(); }); await h.sleep(500);
  await page.evaluate(() => MM.getModules().withClass("MMM-OpenSky-Sidebar")[0].sendNotification("OPENSKY_SETTINGS_OPEN")); await h.sleep(1200);
  await h.shot("lay-settings");
};
