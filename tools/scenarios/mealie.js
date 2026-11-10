// Mealie on the screen (fake Mealie server): a shopping list shows its items and Add / check-off reach Mealie;
// the meal plan shows on the calendar, as "Dinner tonight" on Home, and on the Meals page; a tapped dish opens its
// recipe (ingredients, steps) and "Add ingredients" reaches Mealie.
const http = require("http");
const PORT = 8097;
const GROCERIES = "33333333-cccc-4000-8000-000000000003";   // the list a recipe's ingredients go to
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const t = new Date(), today = new Date(t.getFullYear(), t.getMonth(), t.getDate()), tomorrow = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1);
const items = [{ id: "i1", shoppingListId: "L1", note: "Flour", display: "Flour", checked: false, position: 1 }];
const added = [];
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const fake = http.createServer((req, res) => {
  let raw = ""; req.on("data", (c) => { raw += c; });
  req.on("end", () => {
    const u = new URL(req.url, "http://x"), send = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(obj === undefined ? "" : JSON.stringify(obj)); };
    if (req.headers.authorization !== "Bearer fake-mealie-token") return send(401, {});
    const p = u.pathname;
    if (p === "/api/households/shopping/lists") return send(200, { items: [{ id: "L1", name: "Groceries" }] });
    if (p === "/api/households/shopping/lists/L1") return send(200, { id: "L1", listItems: items });
    if (p === "/api/households/shopping/items" && req.method === "POST") { const b = JSON.parse(raw); items.push({ id: `i${items.length + 1}`, shoppingListId: b.shoppingListId, note: b.note, display: b.note, checked: false, position: 9 }); return send(201, {}); }
    let m = p.match(/^\/api\/households\/shopping\/items\/([^/]+)$/); const it = m && items.find((x) => x.id === m[1]);
    if (m && it && req.method === "GET") return send(200, it);
    if (m && it && req.method === "PUT") { Object.assign(it, JSON.parse(raw)); return send(200, it); }
    if (p === "/api/households/mealplans") return send(200, { items: [
      { id: "m0", date: ymd(today), entryType: "dinner", title: "", recipeId: "aaaaaaaa-0001", recipe: { id: "aaaaaaaa-0001", name: "Tonight Stew", slug: "tonight-stew", image: "x", totalTime: "45 Minutes" } },
      { id: "m1", date: ymd(tomorrow), entryType: "dinner", title: "", recipe: { name: "Test Lasagna" } },
      { id: "m2", date: ymd(tomorrow), entryType: "lunch", title: "Not Shown Lunch" }] });
    if (p === "/api/recipes/tonight-stew") return send(200, { id: "aaaaaaaa-0001", name: "Tonight Stew", slug: "tonight-stew", image: "x", recipeYield: "4 servings", prepTime: "15 Minutes", totalTime: "45 Minutes",
      recipeIngredient: [{ display: "2 carrots" }, { display: "1 onion <b>x</b>" }], recipeInstructions: [{ title: "", text: "Chop everything." }, { title: "Simmer", text: "Cook for 30 minutes." }] });
    m = p.match(/^\/api\/media\/recipes\/([^/]+)\/images\//);
    if (m) { res.writeHead(200, { "Content-Type": "image/png" }); return res.end(PNG); }
    m = p.match(/^\/api\/households\/shopping\/lists\/([^/]+)\/recipe\/([^/]+)$/);
    if (m && req.method === "POST") { added.push([m[1], m[2]]); return send(200, {}); }
    send(404, {});
  });
});
fake.listen(PORT, "127.0.0.1"); fake.unref();

module.exports = async (page, h) => {
  const R = {}; const ok = (k, v, i) => { R[k] = v; h.log(`${v ? "PASS" : "FAIL"}  ${k}${i !== undefined ? "  — " + JSON.stringify(i) : ""}`); };
  const until = async (fn, tries = 60) => { for (let i = 0; i < tries && !(await fn()); i++) await h.sleep(250); return fn(); };
  const col = () => page.evaluate(() => { const c = [...document.querySelectorAll(".hd-lists .lc-list")].find((x) => x.querySelector(".lc-list-title").textContent === "Groceries"); return c ? [...c.querySelectorAll(".lc-item-text")].map((x) => x.textContent) : null; });
  await until(async () => ((await col()) || []).length);
  ok("the Mealie shopping list shows its items", JSON.stringify(await col()) === '["Flour"]', await col());
  await page.evaluate(() => [...document.querySelectorAll(".hd-lists .lc-list")].find((x) => x.querySelector(".lc-list-title").textContent === "Groceries").querySelector(".lc-add-item").click());
  await h.sleep(300);
  await page.evaluate(() => { document.querySelector(".osl-input").value = "Butter"; [...document.querySelectorAll(".osl-btn")].find((b) => b.textContent === "Add").click(); });
  await until(async () => ((await col()) || []).includes("Butter"));
  ok("Add item reaches Mealie", items.some((x) => x.note === "Butter" && x.shoppingListId === "L1"));
  await page.evaluate(() => [...document.querySelectorAll(".hd-lists .lc-item")].find((r) => r.textContent === "Flour").querySelector(".lc-check").click());
  await until(() => items[0].checked === true, 60);
  ok("check-off reaches Mealie after the Undo time", items[0].checked === true);

  // the meal plan on the calendar (meals.calendar)
  const title = () => page.evaluate(() => [...document.querySelectorAll(".hd-week .hd-event-title, .hd-today .hd-event-title")].map((e) => e.textContent));
  await until(async () => (await title()).includes("Test Lasagna"));
  const seen = await title();
  ok("tomorrow's dinner from the meal plan shows on the week", seen.includes("Test Lasagna"), seen);
  ok("meals that weren't chosen (lunch) don't", !seen.includes("Not Shown Lunch"));

  // "Dinner tonight" on Home
  const tonight = () => page.evaluate(() => { const c = document.querySelector(".hd-tonight"); return c && !c.hidden ? { text: c.textContent.replace(/\s+/g, " ").trim(), img: !!c.querySelector("img.hd-tn-img") && c.querySelector("img.hd-tn-img").naturalWidth > 0 } : null; });
  await until(async () => !!(await tonight()));
  const tn = await tonight();
  ok("Home shows 'Dinner tonight' with the dish, its time and its picture", !!tn && /Dinner tonight/.test(tn.text) && /Tonight Stew/.test(tn.text) && /45 Minutes/.test(tn.text) && tn.img, tn);
  ok("…and only dinner, only today", !/Test Lasagna|Lunch/.test(tn.text));
  await h.shot("mealie-home");

  // tap it → the recipe
  await page.evaluate(() => document.querySelector(".hd-tn-row").click());
  await until(() => page.evaluate(() => !!document.querySelector(".osm-ingredients")));
  const rec = await page.evaluate(() => ({
    title: document.querySelector(".osm-title").textContent, ings: [...document.querySelectorAll(".osm-ingredients li")].map((l) => l.textContent),
    steps: [...document.querySelectorAll(".osm-steps li")].map((l) => l.textContent), facts: [...document.querySelectorAll(".osm-fact")].map((f) => f.textContent),
    add: document.querySelector(".osm-add")?.textContent, bold: !!document.querySelector(".osm-ingredients b")
  }));
  ok("the recipe opens: name, ingredients, steps, servings and times", rec.title === "Tonight Stew" && rec.ings.length === 2 && rec.steps.length === 2 && rec.steps[1].startsWith("Simmer") && rec.facts.some((f) => /4 servings/.test(f)) && rec.facts.some((f) => /15 Minutes/.test(f)), rec);
  ok("recipe text is shown as text, never as page markup", rec.ings[1] === "1 onion <b>x</b>" && !rec.bold, rec.ings);
  ok("the Add button names the shopping list", rec.add === "Add ingredients to Groceries", rec.add);
  await h.shot("mealie-recipe");
  await page.evaluate(() => document.querySelector(".osm-add").click());
  await until(() => added.length > 0);
  ok("Add ingredients reaches Mealie (that list, that recipe)", added.length === 1 && added[0][0] === GROCERIES && added[0][1] === "aaaaaaaa-0001", added);
  await page.evaluate(() => document.querySelector(".osm-x").click());
  ok("the popup closes", await page.evaluate(() => !document.querySelector(".osm-overlay")));

  // "See week" → the Meals page
  await page.evaluate(() => document.querySelector(".hd-tonight .hd-see-all").click());
  await until(() => page.evaluate(() => !!document.querySelector(".mp-root") && document.querySelector(".mp-root").getBoundingClientRect().width > 0 && document.querySelectorAll(".mp-meal").length > 0));
  const wk = await page.evaluate(() => ({ days: document.querySelectorAll(".mp-day").length, todayCol: document.querySelector(".mp-today-col")?.textContent.replace(/\s+/g, " "), meals: [...document.querySelectorAll(".mp-meal b")].map((b) => b.textContent), lunch: [...document.querySelectorAll(".mp-meal")].some((m) => /Not Shown/.test(m.textContent)) }));
  ok("the Meals page: seven days, today marked and holding tonight's dish; only the chosen meals", wk.days === 7 && /Tonight Stew/.test(wk.todayCol || "") && wk.meals.includes("Tonight Stew") && !wk.lunch, wk);
  await h.shot("mealie-meals-page");
  await page.evaluate(() => [...document.querySelectorAll(".mp-meal")].find((m) => /Tonight Stew/.test(m.textContent)).click());
  await until(() => page.evaluate(() => !!document.querySelector(".osm-ingredients")));
  ok("a dish on the Meals page opens its recipe too", await page.evaluate(() => document.querySelector(".osm-title").textContent === "Tonight Stew"));
  await page.evaluate(() => document.querySelector(".osm-x").click());
  await page.evaluate(() => document.querySelector(".mp-next").click());
  await h.sleep(300);
  ok("next week works (empty days show a dash)", await page.evaluate(() => document.querySelectorAll(".mp-day").length === 7 && !document.querySelector(".mp-today-col")));
  // other screen shapes: the card and the page fit (portrait 1080×1920, compact 1280×720)
  const fits = () => page.evaluate(() => {
    const r = (sel) => { const x = document.querySelector(sel); return x ? x.getBoundingClientRect() : null; };
    const vis = (b) => !!b && b.width > 0 && b.height > 0;
    const tn = r(".hd-tonight"), lists = r(".hd-lists"), root = document.querySelector(".hd-root"), mp = r(".mp-root");
    return {
      layout: document.documentElement.dataset.layout, W: innerWidth, H: innerHeight,
      tonight: vis(tn), tonightAboveLists: vis(tn) && vis(lists) && tn.bottom <= lists.top + 1, inside: vis(tn) && tn.left >= 0 && tn.right <= innerWidth + 1 && tn.bottom <= innerHeight + 1,
      rootOverflow: root ? root.scrollHeight - root.clientHeight : null, mealsInside: vis(mp) && mp.bottom <= innerHeight + 1 && mp.right <= innerWidth + 1,
      mealsScroll: document.querySelector(".mp-root") ? document.querySelector(".mp-root").scrollHeight - document.querySelector(".mp-root").clientHeight : null
    };
  });
  for (const [w, hh, name] of [[1080, 1920, "portrait"], [1280, 720, "compact"]]) {
    await page.setViewportSize({ width: w, height: hh }); await h.sleep(1500);
    await h.tap(".os-page-home"); await h.sleep(1000);
    const home = await fits();
    ok(`${name}: Dinner tonight shows, inside the screen, and nothing on Home overflows`, home.tonight && home.inside && home.rootOverflow <= 2, home);
    if (name === "portrait") ok("portrait: it sits between the week and the lists", home.tonightAboveLists, home);
    await h.shot(`mealie-home-${name}`);
    await h.tap(".os-page-meals"); await h.sleep(1000);
    const wk = await fits();
    ok(`${name}: the Meals page fits the screen`, wk.mealsInside && wk.mealsScroll <= 2 && (await page.evaluate(() => document.querySelectorAll(".mp-day").length === 7)), wk);
    await h.shot(`mealie-meals-${name}`);
  }
  await page.setViewportSize({ width: 1920, height: 1080 }); await h.sleep(1000);
  const f = Object.entries(R).filter(([, v]) => !v).map(([k]) => k);
  h.log(`SUMMARY: ${f.length ? "FAILED: " + f.join("; ") : "ALL CHECKS PASSED"} (${Object.keys(R).length} checks)`);
};
module.exports.patchSettings = (s) => {
  s.lists = { lists: [{ name: "Groceries", provider: "mealie", shoppingList: "Groceries", shoppingListId: "L1", color: "green" }] };
  s.meals = { provider: "mealie", types: ["dinner"], home: true, calendar: true, calendarColor: "orange", addToList: { id: GROCERIES, name: "Groceries" } };
  if (!s.pages.includes("meals")) s.pages.splice(Math.min(2, s.pages.length), 0, "meals");
};
module.exports.patchSecrets = (s) => { s.mealie = { url: `http://127.0.0.1:${PORT}`, token: "fake-mealie-token" }; };
