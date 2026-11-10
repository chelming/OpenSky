/* MMM-OpenSky-Meals node helper — the meal plan and recipes from Mealie (lib/mealie.js). The page never sees the address or token.
 *   OS_MEALS_INIT {types, days}      → starts refreshing; answers OS_MEALS {entries, error?}
 *   OS_MEALS_REFRESH                  → fetch again now (throttled)
 *   OS_MEALS_RECIPE {slug}            → OS_MEALS_RECIPE_DATA {slug, recipe | error}
 *   OS_MEALS_ADD {id, listId, recipeId} → OS_MEALS_ADDED {id, ok, error?}
 *   GET /opensky-meal-image/<recipe id> → the recipe's picture (cached for an hour)
 */
const NodeHelper = require("node_helper");
const path = require("path");
const mealie = require(path.join(global.root_path, "modules", "opensky-lib", "mealie.js"));

const DAY = 86400e3;

module.exports = NodeHelper.create({
  start() {
    this.cfg = null;
    this.last = null;         // last good { entries }
    this.error = null;
    this.recipes = new Map(); // slug → { at, recipe }
    this.expressApp.get("/opensky-meal-image/:id", async (req, res) => {
      try {
        const img = await mealie.image(req.params.id);
        if (!img) return res.sendStatus(404);
        res.set("Content-Type", img.type);
        res.set("Cache-Control", "max-age=3600");
        res.send(img.body);
      } catch (e) {
        res.sendStatus(504);
      }
    });
  },

  socketNotificationReceived(n, p) {
    if (n === "OS_MEALS_INIT") {
      this.cfg = { types: (p && p.types) || ["dinner"] };
      clearInterval(this.timer);
      this.timer = setInterval(() => this.refresh(), 10 * 60 * 1000);
      if (this.last) this.send();   // a page reload: show what we have at once
      this.refresh();
    } else if (n === "OS_MEALS_REFRESH") {
      if (Date.now() - (this.lastRefresh || 0) > 30 * 1000) this.refresh();
    } else if (n === "OS_MEALS_RECIPE" && p && p.slug) {
      this.recipe(String(p.slug)).then(
        (recipe) => this.sendSocketNotification("OS_MEALS_RECIPE_DATA", { slug: p.slug, recipe }),
        (e) => { console.error(`[OpenSky] meals: couldn't open a recipe: ${e.message}`); this.sendSocketNotification("OS_MEALS_RECIPE_DATA", { slug: p.slug, error: e.message }); });
    } else if (n === "OS_MEALS_ADD" && p) {
      mealie.addRecipeToList(p.listId, p.recipeId).then(
        () => this.sendSocketNotification("OS_MEALS_ADDED", { id: p.id, ok: true }),
        (e) => { console.error(`[OpenSky] meals: couldn't add ingredients: ${e.message}`); this.sendSocketNotification("OS_MEALS_ADDED", { id: p.id, ok: false, error: e.message }); });
    }
  },

  async recipe(slug) {
    const hit = this.recipes.get(slug);
    if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.recipe;
    const recipe = await mealie.recipe(slug);
    this.recipes.set(slug, { at: Date.now(), recipe });
    if (this.recipes.size > 60) this.recipes.delete(this.recipes.keys().next().value);
    return recipe;
  },

  // a week back to five weeks ahead: the Meals page pages through it, Home shows today
  async refresh() {
    if (this.running || !this.cfg) return;
    this.running = true;
    this.lastRefresh = Date.now();
    try {
      const now = Date.now();
      this.last = { entries: await mealie.planEntries(now - 7 * DAY, now + 35 * DAY, this.cfg.types) };
      if (this.error) console.log("[OpenSky] meals: Mealie is answering again");
      this.error = null;
    } catch (e) {
      if (this.error !== e.message) console.error(`[OpenSky] meals: ${e.message}`);
      this.error = e.message;
    }
    this.running = false;
    this.send();
  },

  send() { this.sendSocketNotification("OS_MEALS", { entries: (this.last && this.last.entries) || [], loaded: !!this.last, error: this.error }); }
});
