/* MMM-OpenSky-Screensaver node helper: the slideshow's photos.
 * - PHOTO_INIT {provider, folder, usb, url} → sets up the photo source (the same one the Home photo card uses)
 * - PHOTO_NEXT → PHOTO {photos: [one photo]} | PHOTO_ERROR {message}
 * - GET /opensky-saver-photo/<id> → the image (ids are opaque; file paths and Immich keys never reach the screen)
 */
const NodeHelper = require("node_helper");
const path = require("path");
const lib = (f) => require(path.join(global.root_path, "modules", "opensky-lib", f));
const { createPhotoSource } = lib("photos.js");
const { secret } = lib("secrets.js");

module.exports = NodeHelper.create({
  start() {
    this.source = null;
    this.expressApp.get("/opensky-saver-photo/:id", async (req, res) => {
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
    if (n === "PHOTO_INIT") {
      this.source = createPhotoSource(p || {}, secret);
    } else if (n === "PHOTO_NEXT") {
      if (!this.source) return this.sendSocketNotification("PHOTO_ERROR", { message: "Photos aren't set up" });
      try {
        this.sendSocketNotification("PHOTO", await this.source.next({ single: true }));
      } catch (e) {
        this.sendSocketNotification("PHOTO_ERROR", { message: e.message });
      }
    }
  }
});
