# AGENTS.md — guide for AI coding assistants working on OpenSky

You are helping someone run, fix or extend **OpenSky**, a family wall calendar / home dashboard built on
MagicMirror². This file is the entry point; read it first, then the docs it points to.

> Status: early development. This file grows with the project — keep it current when you change things.

## Read in this order
1. `PLAN.md` — goals, principles, the options matrix (which providers exist or are planned) and the roadmap.
2. `docs/` — user documentation: `install.md`, `configure.md` (every setting in `opensky.json` / `secrets.json`),
   `troubleshooting.md`. Point people there rather than re-explaining.
   `docs/` is also published as a static site by GitHub Pages (`docs/_config.yml`, Jekyll): keep links relative and
   inside `docs/`.
3. `docs/development/architecture.md` — how OpenSky is put together (distribution on upstream MagicMirror²,
   settings vs secrets, module names, services, lessons learned). Testing guide: `docs/development/testing.md`.

## Ground rules for agents
- **Never put secrets in `config.js`.** MagicMirror serves it to the whole network. Keys, tokens and PINs go in the
  server-only secrets file (documented in `docs/`), read by node helpers.
- **Don't break the screen.** Test changes off-screen (headless compositor + Playwright, see
  `docs/development/testing.md`) before restarting the real display.
- **Prefer configuration over code edits** for a user's personal setup; if you add a provider, follow the provider
  pattern so it shows up in settings for everyone.
- **Keep docs in step with code** — a feature isn't done until `docs/` and this file say how to use it.

## Where things are on an installed Pi
| What | Where |
|---|---|
| The user's settings + data (back this up) | `~/OpenSky/config/`: `opensky.json`, `secrets.json` (chmod 600), `device.json` (Settings panel), `local-calendar.json`, `lists.json`, `meals.json`, `calendar-cache/` |
| Runtime (re-creatable by `./install.sh`) | `~/.local/share/opensky/`: `MagicMirror/` (pinned tag, OpenSky linked in by `tools/link-mm.sh`), `node/` (only if the system Node is too old), `venv/` |
| Services | systemd **user** units `opensky.service` (Electron) + `opensky-calendar.service` (CalDAV helper); started by `~/.config/autostart/opensky.desktop` |
| Family share page | `lib/share.js` (server, started by the Setup helper when `share.enabled`), `lib/share/` (the phone page), `lib/notes.js` (`notes.json`); family passcode: scrypt hash in `secrets.json → share.hash`, cookie signing key `share.secret`; port 8091 (`OPENSKY_SHARE_PORT`, `OPENSKY_SHARE_URL` for Docker) |
| Commands | `opensky status · logs · check · restart · edit · secrets · update` (`tools/opensky`) |

The settings files are found through environment variables set by the services (`OPENSKY_SETTINGS`, `OPENSKY_SECRETS`,
`OPENSKY_LOCAL_CALENDAR`, `OPENSKY_LOCAL_LISTS`, `OPENSKY_LOCAL_MEALS`, `OPENSKY_CALENDAR_CACHE`), so nothing personal lives in the runtime.

**In Docker** (`docs/docker.md`): one container runs MagicMirror in server-only mode plus the CalDAV helper, as `PUID:PGID`.
Everything above lives in the `/config` volume (`./docker-config/` on the host) and the same `OPENSKY_*` variables point at it
(set in the `Dockerfile`). There is no systemd, display or hardware, so `OPENSKY_DOCKER=1` is set: Settings hides Restart Pi / Shut down, and
"Restart OpenSky" (and finishing phone setup) exits the process so the compose restart policy starts it again
(`docker restart opensky` does the same from outside). `OPENSKY_SETUP_URL` is the address phone setup shows in its QR code and accepts as its Host.

**Countdowns** (a trip, birthday or big day; separate from the header's holiday/birthday pill): `opensky.json → countdowns: { items: [{ id, title, date: "YYYY-MM-DD", yearly?, photo?, color?, home? }], keepDays }`, set from phone setup → Countdowns (`countdownsCard` / `editCountdown` in `phone/app.js`; users never edit it by hand). `config/config.js` cleans the items and gives Home `config.countdowns` (only `home` ones + the page index) and the optional page `countdowns` (`MMM-OpenSky-CountdownsPage`). Which are visible and the days to go: `lib/client/countdowns.js` (`OpenSkyCountdowns.visible/label`; a passed date hides after `keepDays`, `yearly` ones count to the next). The photo is a file `countdown-photos/<id>.jpg|png|webp` beside `opensky.json` (`lib/countdowns.js`, `OPENSKY_COUNTDOWN_PHOTOS`; ids are `[a-z0-9]{4,24}`, never a path), uploaded (shrunk on the phone) or copied from the photo library through `/api/countdowns/photo`, shown at `/opensky-countdown/<id>` (route in Home's node helper). Home renders `.hd-countdowns` (card; a banner above Today in portrait, grid area `cd`). Not in backups (photos only). Tests: `tools/test-countdowns.js`, `tools/test-config.js` (23-25), `tools/scenarios/countdowns.js`.

**On-device meals** (`lib/local-meals.js`): `meals.provider: "local"` keeps the plan in `meals.json`; the Meals page (`editable`) adds/changes/removes entries through `MMM-OpenSky-Meals` (`OS_MEALS_SAVE`/`OS_MEALS_DELETE`, popup with `osm-edit`), the calendar source type is `localmeals`. Same entry shape as Mealie's (no recipe: `slug` null). Tests: `tools/test-local-meals.js`, `tools/scenarios/local-meals.js`.

**Weather page** (`modules/MMM-OpenSky-WeatherPage`, page key `weather`, `lib/weather-extras.js`): the next 24 hours (Open-Meteo, keyless), weather alerts (NWS api.weather.gov, keyless, US only; elsewhere the page says alerts are US-only) and a rain radar (RainViewer frame list fetched by the node helper; map pictures + Esri light-gray basemap tiles are loaded by the page itself, 256 px tiles drawn without a map library; when none load it shows a friendly message). Settings `opensky.json → weather: { hourly, radar, alerts }` (each on unless `false`), set from phone setup → Weather (the card also adds/removes the page). No keys anywhere. Test stand-ins: `OPENSKY_WEATHER_URL`, `OPENSKY_NWS_URL`, `OPENSKY_RADAR_URL`, `OPENSKY_RADAR_BASE`. Tests: `tools/test-weather-extras.js`, `tools/scenarios/weather-extras.js` (fake services in `tools/fixtures/fake-weather.js`), `tools/test-config.js` 23-24.

**Mealie** (`lib/mealie.js`): list provider `mealie` (shopping lists), calendar source type `mealie` (derived from `meals.calendar`), and the Meals feature: `MMM-OpenSky-Meals` (data, recipe popup, image route), `MMM-OpenSky-MealsPage` (the week), Home's "Dinner tonight" card; settings `meals` in `opensky.json`. Address and token are `secrets.json → mealie.url/.token`, set from phone setup (Meals card or Lists → Mealie → *Connect*, `POST /api/mealie/connect`, which saves them once they work). Recipe text is always put in the page as text. Tests: `tools/test-mealie.js`, `tools/scenarios/mealie.js`.

**Greenlight chores** (`lib/greenlight.js`, unofficial/private service): list provider `greenlight` (`kid` = Greenlight user id): items = today's open chores, check = mark done, `uncheck` exists but isn't used by the page yet; add/edit/remove refuse and never call Greenlight's DELETE. Parent phone + password are `secrets.json → greenlight.phone/.password` (phone setup: `/api/greenlight/connect`, `/code`); OpenSky's own generated device id, rotating tokens and the kids live in `greenlight-state.json` beside secrets.json (chmod 600, `OPENSKY_GREENLIGHT_STATE`; `OPENSKY_GREENLIGHT_URL` for tests). Sign-in may answer SUCCESS or ask for a text-message code. The **Chores page** (`modules/MMM-OpenSky-Chores`, page key `chores`, `opensky.json → chores: { kids: [{ id, name, profile?, color? }], badges?, refreshMinutes? }`, set from phone setup → Chores) uses `choresOf` / `setDone`; with `badges` it broadcasts `OPENSKY_CHORE_COUNTS { counts: { <profile>: left } }`, which the header shows on each person's circle. Pages can be reordered by dragging the grip (phone page and on-screen Settings). Tests: `tools/test-greenlight.js`, `tools/scenarios/greenlight.js` (as a list), `tools/scenarios/chores.js`.

**Home cards:** `opensky.json → home.cards` (ordered list of `notes`, `tonight`, `lists`, `photos`; absent = all four as before, a card left out is hidden). `config/config.js` validates it and passes `cards` to `MMM-OpenSky-Home` (also folded into `tonight` and `photos.enabled`); Home's `applyOrder()` sets flex `order` (landscape/compact) and rebuilds the grid areas inline in portrait. Edited in phone setup ("Home cards", drag grip, shared `dragRows`) and in Settings (`homeCardsHtml`/`bindHomeCards`, `savePrefs({ homeCards })`). Tests: `tools/test-config.js` (23), `tools/scenarios/home-cards.js`.

**Docker screen settings:** with `OPENSKY_DOCKER=1` the Settings panel keeps brightness, evening dim and the sleep schedule per browser (`localStorage["opensky.screen"]`, applied by `MMM-OpenSky-Settings.js`); the node helper doesn't broadcast soft dim, and Sound / "Sleep turns off by" are hidden. On a Pi they stay in `device.json`. Pages can be hidden per screen too (`localStorage["opensky.hiddenPages"]`, `Sidebar.visiblePages()`; Settings → Pages → *Hide here*); the page list in `opensky.json` stays shared. Text size and accent are per browser as well (`opensky.textSize`, `opensky.accent`; `look.textSize`/`look.accent` are the defaults). **Screen profiles** (`opensky.json → screens: [{ name, pages?, person?, textSize?, accent? }]`, made in phone setup → Screens, picked per screen in Settings → Look & extras, `localStorage["opensky.screenProfile"]`, `Sidebar.screenPreset()`) layer between a screen's own choice and the default; no server-side device registry. Scenario `tools/scenarios/screen-profiles.js`.

**Devices page** (`modules/MMM-OpenSky-Devices`, `lib/ha-tiles.js`, page key `devices`, `opensky.json → devices.tiles: [{ entity, name? }]`, set from phone setup → Extras → Devices via `GET /api/devices/entities`): Home Assistant lights/switches (tap toggles), locks (second tap to confirm), sensors (read-only). Address + token are the shared `secrets.json → homeassistant.url/.token`, used only by the node helper, which acts only on configured tiles. Tests: `tools/test-ha-tiles.js`, `tools/scenarios/devices.js`, `tools/scenarios/devices-setup.js`, line 6e in `tools/test-config.js`.

**Two kinds of phone access, never mixed:** phone *setup* (pairing code, short-lived, can change everything) and the *share* page
(a family passcode, always on when enabled, can only add photos and notes). Keep it that way: a new share endpoint must never read or write
settings, secrets, backups or calendars, and `tools/test-share.js` checks what a share phone can't reach.

**Dark mode** (`look.theme` light|dark|auto, `look.lightSensor`; phone setup → Extras, Settings → Look & extras per screen via `localStorage["opensky.theme"]`): `Sidebar.applyTheme()` sets `<html data-os-theme="dark">`, sun times are computed on the screen (`OpenSkyTheme.sunTimes`, location from `opensky.json`), and the whole look is one inversion rule at the end of `css/opensky.css` (photos, embeds, the screensaver and `.ost-dim` are exceptions). Default is light, so existing installs look as before; in Docker the sensor is never used. New CSS `background-image` photos must be added to the exception rule. Tests: `tools/test-config.js` (23-28), `tools/scenarios/dark-mode.js`.

The **screensaver** (`modules/MMM-OpenSky-Screensaver`, `screensaver` in `opensky.json`, set from phone setup → Extras) works with page touches only, so it also runs in Docker with the screen shown in a browser. Keep its cards in the dashboard's event-pill styling (`--evc-*`), no new card looks.

**Event reminders** (`modules/MMM-OpenSky-Reminders`, `opensky.json → reminders: { minutes, chime?, banner?, allDay?, people? }`, set from phone setup → Extras and on-screen Settings → Look & extras): chime (the Timer's `playChime`) and/or a banner `minutes` before an event, once per event (`localStorage["opensky.reminded"]`), never while the screen sleeps, so also in Docker (browser audio + banner). Tests: `tools/test-config.js` (23, 24), `tools/scenarios/reminders.js`, `tools/scenarios/phone-settings.js`.

## Helping a user (checklist)
1. `opensky status`, `opensky check`, `opensky logs` — most problems are a JSON typo or a wrong link/password.
2. Most people set things up with the **phone page** (Settings → Set up from your phone); by hand works too.
   Change **settings**, not code: `config/opensky.json` / `config/secrets.json`, then `opensky restart`.
3. Never print, paste or commit the contents of `secrets.json`, private calendar links or tokens.
4. Don't edit files in `~/.local/share/opensky/MagicMirror` — they are replaced on update.

## Conventions for code changes
- Module fields/methods must not reuse MagicMirror's `Module` names (`data`, `show`, `hide`, `config`, `name`…).
- No emoji in the UI (Raspberry Pi OS has no color-emoji font) — use inline SVG.
- Errors people see are plain and say what to do ("check the app-specific password in secrets.json").
- Private values never reach a log or the page: node helpers read `secrets.json`; the test harness fails a run if
  any `secrets.json` value appears in MagicMirror's output.
- Anything that touches hardware or the system (backlight, ddcutil, volume, restart, update, power) must honour
  `OPENSKY_DRY_RUN=1` — the test harness sets it so tests never touch the real screen.
- `tools/test-all.sh` must pass before a commit (see `docs/development/testing.md`).
  No Pi at hand? `tools/docker-test.sh` runs the same tests in a container (Docker only; see the same doc).
- The maintainer also edits on GitHub: `git pull --rebase` before pushing; never force-push.
- Every provider (calendar, list, photo…) gets an on-screen scenario, not only a unit test: wiring between modules is where bugs hide (see tools/scenarios/google.js, holidays.js), plus a line in tools/test-config.js.


**Calendar title filter** (`opensky.json → calendar.sources[].only`, a case-insensitive regular expression, set from phone setup → Calendars → tap a calendar → *Only show events titled…*, `editCalendar` in `phone/app.js`): `config/config.js` (`titlePattern`) drops invalid patterns; `MMM-OpenSky-Calendars.broadcast()` keeps only matching titles for that source. Docs: `configure.md` → "Showing only some events". **Header pill** (`calendar.sources[].header`, toggle *Show today's event in the header* in the same sheet): `config.js` gives Header `todayPills` (calendar names); `MMM-OpenSky-Calendars` sends `OPENSKY_HEADER_EVENTS` (after the title filter, before the person filter); `MMM-OpenSky-Header._todayPill()` shows today's titles (up to two) as `.hb-school`. Tests: `tools/test-config.js` (5b, 5c), `tools/scenarios/calendars.js`.
