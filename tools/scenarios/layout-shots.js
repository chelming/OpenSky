// Screenshots of every page at several screen sizes (for looking at; checks are in screen-sizes.js)
module.exports = async (page, h) => {
  const sizes = (process.env.SIZES || "1024x600,1280x720,1920x1080").split(",").map((s) => s.split("x").map(Number));
  const pages = (process.env.PAGES || "home,calendar,lists,timer,wordgame").split(",");
  for (const [w, hh] of sizes) {
    await page.setViewportSize({ width: w, height: hh }); await h.sleep(1000);
    for (const p of pages) {
      await h.tap(`.os-page-${p}`); await h.sleep(1200);
      await h.shot(`lay-${p}-${w}x${hh}`);
    }
  }
};
