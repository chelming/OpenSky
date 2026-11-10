/* MMM-OpenSky-Home node helper: the photo card.
 * - PHOTO_INIT {provider, folder, usb, url} → sets up the photo source (folder/USB by default, or Immich)
 * - PHOTO_NEXT → PHOTO {photos: [{id, date, place, portrait}]} | PHOTO_ERROR {message}
 * - GET /opensky-photo/<id> → the image (ids are opaque; file paths and Immich keys never reach the screen)
 */
const NodeHelper = require("node_helper");
const path = require("path");
const lib = (f) => require(path.join(global.root_path, "modules", "opensky-lib", f));
const { createPhotoSource } = lib("photos.js");
const { secret } = lib("secrets.js");
const notes = lib("notes.js");
const familyCountdowns = lib("family-countdowns.js");
const countdownPhotos = lib("countdowns.js");

module.exports = NodeHelper.create({
  start() {
    this.source = null;
    // a countdown's picture (Home's card and the Countdowns page): GET /opensky-countdown/<id>
    this.expressApp.get("/opensky-countdown/:id", (req, res) => {
      const img = countdownPhotos.read(req.params.id);
      if (!img) return res.sendStatus(404);
      res.set("Content-Type", img.type);
      res.set("Cache-Control", "max-age=300");
      res.send(img.body);
    });
    this.expressApp.get("/opensky-photo/:id", async (req, res) => {
      if (!this.source || !/^[A-Za-z0-9-]{8,64}$/.test(req.params.id)) return res.sendStatus(404);
      try {
        const img = await this.source.image(req.params.id);
        if (!img) return res.sendStatus(404);
        res.set("Content-Type", img.type);
        res.set("Cache-Control", "max-age=3600");
        res.send(img.body);
      } catch (e) {
        res.sendStatus(504);
      }
    });
  },

  async socketNotificationReceived(n, p) {
    if (n === "NOTES_GET") {
      this.sendSocketNotification("NOTES", { notes: notes.list(), countdowns: familyCountdowns.list() });
    } else if (n === "NOTES_DISMISS") {
      try { notes.remove(String((p && p.id) || "")); } catch (e) { /* already gone */ }
      this.sendSocketNotification("NOTES", { notes: notes.list(), countdowns: familyCountdowns.list() });
    } else if (n === "PHOTO_INIT") {
      this.settings = p || {};
      this.source = createPhotoSource(this.settings, secret);
    } else if (n === "PHOTO_NEXT") {
      if (!this.source) return this.sendSocketNotification("PHOTO_ERROR", { message: "Photos aren't set up" });
      try {
        this.sendSocketNotification("PHOTO", await this.source.next(p || {}));
      } catch (e) {
        const folder = this.settings.provider === "immich" ? null : (this.settings.folder || "~/Pictures");
        const docker = process.env.OPENSKY_DOCKER === "1";   // no Pi folder or USB stick to point at
        const message = /no photos/.test(e.message) && folder
          ? `Add photos from your phone\nSettings → Set up from your phone → Photos${docker ? "" : `\nor put them in ${folder} on the Pi${this.settings.usb !== false ? ", or a folder named OpenSky on a USB stick" : ""}`}`
          : e.message;
        this.sendSocketNotification("PHOTO_ERROR", { message });
      }
    }
  }
});
