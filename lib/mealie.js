/* OpenSky Mealie (server side) — shopping lists and the meal plan from a Mealie recipe server (https://mealie.io).
 * Used by lib/lists.js (provider "mealie"), MMM-OpenSky-Calendars (source type "mealie") and phone setup.
 *
 * secrets.json → mealie: { url: "http://mealie.local:9925", token: "<API token>" }
 *   (the token: Mealie → your profile → API Tokens → Create). Set from phone setup; nobody edits the file.
 * A list (opensky.json → lists.lists):   { name, provider: "mealie", shoppingList: "<Mealie list name>", shoppingListId?: "<id>" }
 * A calendar source:                     { name, type: "mealie", meals: ["dinner"] }   (breakfast, lunch, dinner, side)
 *
 * Mealie 1.x keeps these under /api/groups/…, 2.x and later under /api/households/…; both are tried.
 */
const path = require("path");
const { secret } = require(path.join(__dirname, "secrets.js"));

const MEAL_TYPES = ["breakfast", "lunch", "dinner", "side"];

class MealieError extends Error { constructor(m, status) { super(m); this.status = status; } }

function login(creds) {
  const url = String((creds && creds.url) || secret("mealie.url") || "").trim().replace(/\/+$/, "");
  const token = String((creds && creds.token) || secret("mealie.token") || "").trim();
  if (!url || !token) throw new MealieError("Mealie isn't set up — add its address and API token in phone setup", 400);
  if (!/^https?:\/\/[^/\s]+/i.test(url)) throw new MealieError("The Mealie address should look like http://mealie.local:9925", 400);
  return { url, token };
}

async function call(method, route, body, creds) {
  const { url, token } = login(creds);
  let res;
  try {
    res = await fetch(`${url}${route}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000)
    });
  } catch (e) {
    throw new MealieError("Can't reach Mealie. Is it on, and is the address right?", 502);
  }
  if (res.status === 401 || res.status === 403) throw new MealieError("Mealie refused the API token — make a new one (Mealie → your profile → API Tokens)", 401);
  if (res.status === 404) throw new MealieError("Not found in Mealie (it may have just been changed)", 404);
  if (res.status === 422) throw new MealieError("Mealie didn't accept that", 422);
  if (!res.ok) throw new MealieError(`Mealie error (HTTP ${res.status})`, 502);
  if (res.status === 204) return null;
  try { return await res.json(); } catch (e) { throw new MealieError("That address didn't answer like Mealie — is it the right one?", 502); }
}

// 2.x+ first, 1.x if the server doesn't know the new path
async function scoped(method, tail, body, creds) {
  try { return await call(method, `/api/households${tail}`, body, creds); }
  catch (e) { if (e.status !== 404) throw e; }
  return call(method, `/api/groups${tail}`, body, creds);
}
const rows = (d) => (Array.isArray(d) ? d : (d && Array.isArray(d.items)) ? d.items : []);

/** Check the address + token (optionally ones not saved yet). Returns { shoppingLists: [{id, name}] }. */
async function connect(creds) {
  await call("GET", "/api/users/self", null, creds);
  return { shoppingLists: await shoppingLists(creds) };
}

async function shoppingLists(creds) {
  return rows(await scoped("GET", "/shopping/lists?perPage=-1", null, creds)).map((l) => ({ id: String(l.id), name: String(l.name || "Shopping list") }));
}

/* ---------------- shopping lists (list provider) ---------------- */
async function listId(list) {
  if (list.shoppingListId) return String(list.shoppingListId);
  const want = String(list.shoppingList || list.name).toLowerCase();
  const all = await shoppingLists();
  const hit = all.find((l) => l.name.toLowerCase() === want);
  if (!hit) throw new MealieError(`No Mealie shopping list called "${list.shoppingList || list.name}" — pick it again in phone setup`, 404);
  return hit.id;
}

const itemText = (it) => String(it.display || it.note || (it.food && it.food.name) || "").trim();

function cleanText(text) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) throw new Error("Please type something first");
  if (t.length > 500) throw new Error("That's a bit long — keep it under 500 characters");
  return t;
}

const itemRoute = (item) => `/shopping/items/${encodeURIComponent(item.id)}`;

const provider = {
  async items(list) {
    const d = await scoped("GET", `/shopping/lists/${encodeURIComponent(await listId(list))}`);
    return ((d && d.listItems) || []).filter((it) => !it.checked)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((it) => ({ id: String(it.id), text: itemText(it) })).filter((it) => it.text);
  },
  async add(list, text) {
    await scoped("POST", "/shopping/items", { shoppingListId: await listId(list), note: cleanText(text), quantity: 0, checked: false });
  },
  async check(list, item) {
    const cur = await scoped("GET", itemRoute(item));
    await scoped("PUT", itemRoute(item), { ...cur, checked: true });
  },
  async edit(list, item, text) {
    const cur = await scoped("GET", itemRoute(item));
    // a typed note replaces the whole line (a recipe-made item has a food and unit that would keep showing)
    await scoped("PUT", itemRoute(item), { ...cur, note: cleanText(text), food: null, foodId: null, unit: null, unitId: null, quantity: 0 });
  },
  async remove(list, item) { await scoped("DELETE", itemRoute(item)); }
};

/* ---------------- meal plan (calendar source) ---------------- */
const ymd = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const chosenTypes = (meals) => { const w = (Array.isArray(meals) ? meals : []).map((m) => String(m).toLowerCase()).filter((m) => MEAL_TYPES.includes(m)); return w.length ? w : ["dinner"]; };

/** Meal plan entries between two times (local dates), the chosen meal types only:
 *  [{ id, date: "YYYY-MM-DD", type, title, recipeId, slug, hasImage, time }]  (entries with no recipe and no title are left out) */
async function planEntries(fromMs, toMs, meals) {
  const types = chosenTypes(meals);
  const entries = rows(await scoped("GET", `/mealplans?start_date=${ymd(fromMs)}&end_date=${ymd(toMs)}&perPage=-1`));
  return entries.filter((e) => e && /^\d{4}-\d\d-\d\d/.test(e.date) && types.includes(String(e.entryType || "dinner").toLowerCase()))
    .map((e) => {
      const r = e.recipe || null;
      const title = String(e.title || (r && r.name) || e.text || "").trim();
      if (!title) return null;
      const rid = e.recipeId || (r && r.id);
      return { id: String(e.id), date: e.date.slice(0, 10), type: String(e.entryType || "dinner").toLowerCase(), title,
        recipeId: rid ? String(rid) : null, slug: r && r.slug ? String(r.slug) : null,
        hasImage: !!(r && r.image), time: r ? String(r.totalTime || "") : "" };
    }).filter(Boolean)
    .sort((a, b) => a.date.localeCompare(b.date) || MEAL_TYPES.indexOf(a.type) - MEAL_TYPES.indexOf(b.type));
}

/** The same entries as all-day calendar events: "Dinner: Lasagna" (just "Lasagna" for a single meal type). */
async function mealEvents(fromMs, toMs, meals) {
  const many = chosenTypes(meals).length > 1;
  return (await planEntries(fromMs, toMs, meals)).map((e) => {
    const [y, m, d] = e.date.split("-").map(Number);
    return { title: many ? `${cap(e.type)}: ${e.title}` : e.title, startDate: String(new Date(y, m - 1, d).getTime()), endDate: String(new Date(y, m - 1, d + 1).getTime()),
      fullDayEvent: true, recurringEvent: false, class: "PUBLIC", location: false, geo: false, description: false, uid: `mealie-${e.id}` };
  });
}

/* ---------------- recipes ---------------- */
const SLUG = /^[A-Za-z0-9][A-Za-z0-9_-]{0,200}$/;
const ID = /^[0-9a-f-]{8,64}$/i;
const plain = (v) => String(v == null ? "" : v).replace(/\s+/g, " ").trim();

/** One recipe, ready to show: { id, name, slug, description, servings, times: [[label, text]], ingredients: [{text, heading}], steps: [{title, text}], hasImage } */
async function recipe(slug) {
  if (!SLUG.test(String(slug || ""))) throw new MealieError("Which recipe?", 400);
  const r = await call("GET", `/api/recipes/${encodeURIComponent(slug)}`);
  const times = [["Prep", r.prepTime], ["Cook", r.performTime || r.cookTime], ["Total", r.totalTime]].map(([k, v]) => [k, plain(v)]).filter(([, v]) => v);
  return {
    id: String(r.id), name: plain(r.name), slug: String(r.slug || slug), description: plain(r.description).slice(0, 600),
    servings: plain(r.recipeYield || (r.recipeServings ? `${r.recipeServings} servings` : "")), times,
    ingredients: (r.recipeIngredient || []).map((i) => ({ text: plain(i.display || i.note || i.originalText), heading: plain(i.title) })).filter((i) => i.text || i.heading),
    steps: (r.recipeInstructions || []).map((st) => ({ title: plain(st.title), text: String(st.text || "").replace(/[ \t]+/g, " ").trim() })).filter((st) => st.text || st.title),
    hasImage: !!r.image
  };
}

/** A recipe's picture as { type, body }, or null. (The page asks the Pi for it; the token never leaves the Pi.) */
async function image(recipeId) {
  if (!ID.test(String(recipeId || ""))) return null;
  const { url, token } = login();
  for (const file of ["min-original.webp", "original.webp"]) {
    let res;
    try { res = await fetch(`${url}/api/media/recipes/${recipeId}/images/${file}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) }); }
    catch (e) { throw new MealieError("Can't reach Mealie. Is it on, and is the address right?", 502); }
    if (res.ok) return { type: res.headers.get("content-type") || "image/webp", body: Buffer.from(await res.arrayBuffer()) };
  }
  return null;
}

/** Put a recipe's ingredients on a shopping list (Mealie merges what is already there). */
async function addRecipeToList(listId, recipeId) {
  if (!ID.test(String(listId || "")) || !ID.test(String(recipeId || ""))) throw new MealieError("Which list and recipe?", 400);
  await scoped("POST", `/shopping/lists/${encodeURIComponent(listId)}/recipe/${encodeURIComponent(recipeId)}`, { recipeIncrementQuantity: 1 });
}

module.exports = { MEAL_TYPES, MealieError, connect, shoppingLists, provider, planEntries, mealEvents, recipe, image, addRecipeToList };
