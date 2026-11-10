// Unit test for lib/mealie.js against a fake Mealie server: connect, shopping lists (list provider), meal plan events.
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "opensky-mealie-"));
const SECRETS = path.join(tmp, "secrets.json");
process.env.OPENSKY_SECRETS = SECRETS;

let passed = 0, failed = 0;
const ok = (name, cond, info) => { cond ? passed++ : failed++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${info !== undefined ? "  — " + JSON.stringify(info) : ""}`); };
const fails = async (fn) => { try { await fn(); return null; } catch (e) { return e.message; } };

// fake Mealie 2.x (/api/households/…); OLD=1 makes it a 1.x server that only knows /api/groups/…
let OLD = false;
const items = [
  { id: "i1", shoppingListId: "L1", note: "Milk", display: "Milk", checked: false, position: 2 },
  { id: "i2", shoppingListId: "L1", note: "", display: "2 cups Flour", food: { name: "Flour" }, unit: { name: "cup" }, quantity: 2, checked: false, position: 1 },
  { id: "i3", shoppingListId: "L1", note: "Already bought", display: "Already bought", checked: true, position: 3 },
  { id: "i4", shoppingListId: "L2", note: "Screws", display: "Screws", checked: false, position: 1 }
];
const plan = [
  { id: "m1", date: "2026-11-10", entryType: "dinner", title: "", recipeId: "aaaaaaaa-1111", recipe: { id: "aaaaaaaa-1111", name: "Lasagna", slug: "lasagna", image: "abc", totalTime: "1 hour" } },
  { id: "m2", date: "2026-11-10", entryType: "lunch", title: "Leftovers" },
  { id: "m3", date: "2026-11-11", entryType: "dinner", title: "Takeout" },
  { id: "m4", date: "2026-11-12", entryType: "dinner", title: "", text: "" }
];
const seen = [];
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => { body += c; });
  req.on("end", () => {
    const url = new URL(req.url, "http://x");
    const send = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(obj === undefined ? "" : JSON.stringify(obj)); };
    if (req.headers.authorization !== "Bearer good-token") return send(401, { detail: "Unauthorized" });
    let p = url.pathname;
    if (p === "/api/users/self") return send(200, { id: "u1" });
    if (OLD) { if (p.startsWith("/api/households/")) return send(404, {}); p = p.replace("/api/groups/", "/api/households/"); }
    seen.push(`${req.method} ${p}`);
    if (req.method === "GET" && p === "/api/households/shopping/lists") return send(200, { items: [{ id: "L1", name: "Groceries" }, { id: "L2", name: "Hardware" }] });
    let m = p.match(/^\/api\/households\/shopping\/lists\/([^/]+)$/);
    if (m && req.method === "GET") return m[1] === "L1" || m[1] === "L2" ? send(200, { id: m[1], listItems: items.filter((i) => i.shoppingListId === m[1]) }) : send(404, {});
    if (req.method === "POST" && p === "/api/households/shopping/items") {
      const b = JSON.parse(body); items.push({ id: `i${items.length + 1}`, shoppingListId: b.shoppingListId, note: b.note, display: b.note, checked: false, position: 9 });
      return send(201, {});
    }
    m = p.match(/^\/api\/households\/shopping\/items\/([^/]+)$/);
    const i = m ? items.findIndex((x) => x.id === m[1]) : -1;
    if (m && i < 0) return send(404, {});
    if (m && req.method === "GET") return send(200, items[i]);
    if (m && req.method === "PUT") { const b = JSON.parse(body); Object.assign(items[i], b); if (b.note !== undefined && !b.food) items[i].display = b.note; return send(200, items[i]); }
    if (m && req.method === "DELETE") { items.splice(i, 1); return send(200, {}); }
    if (req.method === "GET" && p === "/api/households/mealplans") {
      const a = url.searchParams.get("start_date"), z = url.searchParams.get("end_date");
      seen.push(`range ${a}..${z}`);
      return send(200, { items: plan });
    }
    if (req.method === "GET" && p === "/api/recipes/lasagna") return send(200, {
      id: "aaaaaaaa-1111", name: "Lasagna", slug: "lasagna", image: "abc", description: "  Cheesy\n and good ", recipeYield: "6 servings", prepTime: "20 Minutes", performTime: "", totalTime: "1 hour",
      recipeIngredient: [{ title: "Sauce", display: "" }, { display: "1 lb ground beef" }, { display: "", note: "Salt" }, { display: "" }],
      recipeInstructions: [{ title: "", text: "Brown   the beef." }, { title: "Bake", text: "45 min at 375." }] });
    if (req.method === "GET" && p === "/api/recipes/missing") return send(404, {});
    m = p.match(/^\/api\/media\/recipes\/([^/]+)\/images\/([^/]+)$/);
    if (m) { seen.push(`image ${m[2]}`); return m[2] === "original.webp" ? (res.writeHead(200, { "Content-Type": "image/webp" }), res.end("WEBP")) : send(404, {}); }
    m = p.match(/^\/api\/households\/shopping\/lists\/([^/]+)\/recipe\/([^/]+)$/);
    if (m && req.method === "POST") { seen.push(`addrecipe ${m[1]} ${m[2]} ${body}`); return send(200, {}); }
    send(404, {});
  });
});

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const mealie = require(path.join(__dirname, "..", "lib", "mealie.js"));
  const lists = require(path.join(__dirname, "..", "lib", "lists.js"));

  ok("1 not set up → says where", /phone setup/.test(await fails(() => mealie.shoppingLists())));
  ok("2 a wrong token → says what to do (checked before anything is saved)", /refused the API token/.test(await fails(() => mealie.connect({ url: base, token: "nope" }))));
  ok("3 nothing listening → friendly message", /Can't reach Mealie/.test(await fails(() => mealie.connect({ url: "http://127.0.0.1:1", token: "x" }))));
  ok("4 a bad address is explained", /look like http/.test(await fails(() => mealie.connect({ url: "mealie", token: "x" }))));
  const c = await mealie.connect({ url: `${base}/`, token: "good-token" });
  ok("5 connect (given values, trailing slash ok) → the shopping lists", JSON.stringify(c.shoppingLists) === JSON.stringify([{ id: "L1", name: "Groceries" }, { id: "L2", name: "Hardware" }]), c);

  fs.writeFileSync(SECRETS, JSON.stringify({ mealie: { url: base, token: "good-token" } }));
  const groceries = { name: "Food", provider: "mealie", shoppingList: "groceries" }, p = lists.provider(groceries);
  ok("6 'mealie' is a list provider", lists.PROVIDERS.includes("mealie"));
  let got = await p.items(groceries);
  ok("7 open items only, in Mealie's order, recipe-made lines by their display text", got.map((x) => x.text).join("|") === "2 cups Flour|Milk", got);
  ok("8 a list can be found by id too", (await p.items({ name: "x", shoppingListId: "L2" })).map((x) => x.text).join() === "Screws");
  ok("9 an unknown list name → says to pick it again", /No Mealie shopping list called "Nope"/.test(await fails(() => p.items({ name: "Nope", provider: "mealie" }))));

  await p.add(groceries, "  Eggs ");
  got = await p.items(groceries);
  ok("10 add (in the right list, spaces tidied)", got.some((x) => x.text === "Eggs") && !(await p.items({ name: "h", shoppingListId: "L2" })).some((x) => x.text === "Eggs"), got);
  ok("11 empty text is refused kindly", /type something/i.test(await fails(() => p.add(groceries, "  "))));

  await p.edit(groceries, got.find((x) => x.text === "2 cups Flour"), "Bread flour");
  const flour = items.find((x) => x.id === "i2");
  ok("12 edit replaces the whole line (food and unit dropped)", flour.note === "Bread flour" && flour.food === null && flour.unit === null && flour.display === "Bread flour", flour);
  await p.check(groceries, { id: "i1" });
  ok("13 check off keeps the item's other fields", items.find((x) => x.id === "i1").checked === true && items.find((x) => x.id === "i1").note === "Milk");
  await p.remove(groceries, { id: "i4" });
  ok("14 remove", !items.some((x) => x.id === "i4"));
  ok("15 an item that's gone → clear message", /may have just been changed/.test(await fails(() => p.check(groceries, { id: "zzz" }))));

  const from = new Date(2026, 10, 9).getTime(), to = new Date(2026, 11, 9).getTime();
  let ev = await mealie.mealEvents(from, to, ["dinner"]);
  ok("16 meal plan → all-day events: dinners only, recipe name used, empty entries skipped", ev.map((e) => e.title).join("|") === "Lasagna|Takeout" && ev.every((e) => e.fullDayEvent), ev.map((e) => e.title));
  ok("17 dates are local midnight to midnight", ev[0].startDate === String(new Date(2026, 10, 10).getTime()) && ev[0].endDate === String(new Date(2026, 10, 11).getTime()));
  ok("18 the range asked for is a plain date range", seen.includes("range 2026-11-09..2026-12-09"), seen.filter((s) => s.startsWith("range")));
  ev = await mealie.mealEvents(from, to, ["lunch", "dinner"]);
  ok("19 several meal types → titles say which", ev.map((e) => e.title).join("|") === "Lunch: Leftovers|Dinner: Lasagna|Dinner: Takeout", ev.map((e) => e.title));
  ok("20 no meal types chosen → dinner", (await mealie.mealEvents(from, to, [])).length === 2);

  let pe = await mealie.planEntries(from, to, ["dinner"]);
  ok("22 plan entries: recipe link, slug, image flag, time; newest day last", pe[0].title === "Lasagna" && pe[0].slug === "lasagna" && pe[0].recipeId === "aaaaaaaa-1111" && pe[0].hasImage === true && pe[0].time === "1 hour" && pe[1].recipeId === null && pe[1].hasImage === false, pe);
  const rc = await mealie.recipe("lasagna");
  ok("23 a recipe: tidy text, section heading, note-only ingredient, empty ones dropped, steps", rc.name === "Lasagna" && rc.description === "Cheesy and good" && rc.servings === "6 servings" &&
    JSON.stringify(rc.times) === '[["Prep","20 Minutes"],["Total","1 hour"]]' &&
    JSON.stringify(rc.ingredients) === '[{"text":"","heading":"Sauce"},{"text":"1 lb ground beef","heading":""},{"text":"Salt","heading":""}]' &&
    rc.steps.length === 2 && rc.steps[0].text === "Brown the beef." && rc.steps[1].title === "Bake" && rc.hasImage, rc);
  ok("24 a recipe that's gone → clear message; a bad slug is refused before asking Mealie", /may have just been changed/.test(await fails(() => mealie.recipe("missing"))) && /Which recipe/.test(await fails(() => mealie.recipe("../../etc"))));
  const img = await mealie.image("aaaaaaaa-1111");
  ok("25 the picture (falls back to the original when there is no small one); odd ids are refused", img.body.toString() === "WEBP" && /webp/.test(img.type) && seen.includes("image min-original.webp") && (await mealie.image("../x")) === null);
  await mealie.addRecipeToList("bbbbbbbb-2222", "aaaaaaaa-1111");
  ok("26 add a recipe's ingredients to a list", seen.some((x) => x === 'addrecipe bbbbbbbb-2222 aaaaaaaa-1111 {"recipeIncrementQuantity":1}'), seen.filter((x) => x.startsWith("addrecipe")));
  ok("27 …with bad ids refused", /Which list and recipe/.test(await fails(() => mealie.addRecipeToList("x", "aaaaaaaa-1111"))));

  OLD = true;
  ok("21 Mealie 1.x (/api/groups/…) works too", (await mealie.shoppingLists()).length === 2 && (await mealie.mealEvents(from, to, ["dinner"])).length === 2);
  OLD = false;

  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`passed=${passed} fail=${failed}`);
  process.exit(failed ? 1 : 0);
})();
