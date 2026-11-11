# Changelog

## 1.1.0 — 2026-11-10
- **Container image:** OpenSky is published as `ghcr.io/chelming/opensky` (amd64 and arm64) with every release, so Docker
  users can pull it instead of building ([docs/docker.md](docs/docker.md)).
- **Quick add:** type or say an event ("dentist Thursday at 3") and the New Event form is filled in for you to check;
  uses any OpenAI-compatible AI server on your network (optional). Family members can be invited on Google events.
- **Chores page** from Greenlight (unofficial): each child's chores for today, ticked off on the screen, with a count
  of chores left on their circle in the header.
- **Meals:** an on-device meal plan (Meals page, "Dinner tonight" on Home, meals on the calendar), or from Mealie with
  recipes, ingredients and steps; Mealie also works as a shopping-list provider.
- **Weather page:** right now, the next 24 hours, a rain radar and US weather alerts (a pill in the header); no keys.
- **Countdowns:** a trip, birthday or big day with days to go and a photo, on Home and an optional page; family members
  can add them from the share page.
- **Devices page:** Home Assistant lights, switches, locks and sensors as tappable tiles.
- **Family share page:** add photos and notes from a phone with a family passcode; no access to settings.
- **Dark mode:** Light, Dark, Auto (by sunset, optional light sensor) or System (follows the device), per screen.
- **Screensaver** (photos, clock, weather, Up next) and **event reminders** (chime and/or banner).
- **Several screens:** screen profiles (pages, person, text size, accent) and per-screen text size, accent and hidden
  pages; Home cards can be chosen and ordered; pages can be reordered by dragging.
- **Layouts:** a portrait layout for vertical monitors and a compact layout for small screens; busy days show as many
  events as fit and then "+N more"; Today's tile shows what's left; all-day events are a slim strip.
- **Calendars:** show an event shared by several calendars once; people in the top bar filter calendars and lists; a
  per-calendar title filter; a header pill with today's event of a calendar (e.g. the school's "Day 3").
- **Phone setup:** "Remember this device" skips the pairing code; photos can be added and removed from the phone.
- **Docker:** per-browser brightness, evening dim and sleep schedule; backups list mounted folders; the Music page
  offers only Home Assistant speakers.
- Docs are published as a GitHub Pages site, with refreshed screenshots.

## 1.0.4 — 2026-10-27
- **Phone setup: any color for a calendar or a list** — besides the palette chips, the phone's color picker or a
  typed color code (like #8cbfc4), the same as for the accent color.
- A list's Add / Edit popup uses the list's color code too (it stayed blue).

## 1.0.3 — 2026-10-27
- **Calendar and list colors can be color codes too**, like `"color": "#8cbfc4"` (or `#8cf`, any case) — for a
  calendar, a keyword rule or a list. Events get a solid bar in that color on a pale background of it, on Home and in
  the month view. Before, only palette names worked there and a code fell back to an automatic color. Reported by a user.

## 1.0.2 — 2026-10-25
- **Accent color: any color, not just the palette.** Type a color code (#rrggbb or #rgb) in Settings on the screen
  (with a live preview), or pick any color with the phone's color picker in phone setup. A color too light for the
  white button text gets a warning. Codes are checked when saved and when read back; `look.accent` in opensky.json
  accepts them too.
- American spelling throughout: "color".

## 1.0.1 — 2026-10-24
- **Touchscreens: a popup's Add / Save button works when tapped.** On touchscreens that act like a mouse, pressing it
  took the focus off the text box, so the on-screen keyboard closed and the popup slid down under the finger before it
  was lifted — the tap was lost and the popup closed (Return worked). Reported by a user.
- A popup only closes on a tap outside it when the press also started outside it.

## 1.0.0 — 2026-10-23
The first public version: a friendly family wall calendar for a Raspberry Pi touchscreen, built on MagicMirror².

**On the screen**
- **Home**: the week ahead with everyone's events in their colors, daily weather, trash/recycling/yard-waste icons,
  your lists (check off with Undo) and a photo slideshow.
- **Calendar**: month view; tap a day or event to see, add, edit or delete events.
- **Lists**: every list side by side. **Timer**: kitchen timers with a chime. **Word game**: a daily family puzzle
  (the New York Times' daily word by default, OpenSky's own words as backup or by choice).
- **Your own web pages as pages** (Home Assistant dashboards, cameras, school portals…): add them from Settings or
  the phone with a name, an address and an icon; optionally locked with a PIN.
- **Add-on — Music** (`opensky addon music`): the screen becomes an AirPlay and a Spotify Connect speaker, and a Music
  page shows what's playing (cover, song, progress) with previous / play-pause / next and the volume. The same page is
  a **remote for your other speakers** (Sonos, HomePod, Echo, Google…) through Home Assistant. See docs/music.md.
- Header: family name, clock, weather, countdown to the next holiday or birthday, your team's game day.
- **Settings on the screen**: brightness (backlight, monitor over HDMI or picture dimming), evening dim, sleep at
  night, how Sleep turns your screen off (with a Test button and wake on touch), volume, pages, accent color,
  backups, update / restart / shut down.
- On-screen keyboard; returns to Home after a few quiet minutes (touches inside web pages count, too).
- Fits any screen: the layout scales to 720p, 768p, 1080p or 4K screens (`look.scale` to adjust).
- A small notice on Home when a calendar keeps failing (wrong link, expired password), with where to fix it.

**Connects to**
- Calendars: on the screen (no account), any calendar link (Google, Outlook, iCloud, school…), iCloud / Fastmail /
  Nextcloud with editing (CalDAV), Google Calendar with editing, public holidays for about 200 countries.
- Lists: on the screen (no account), Todoist, Home Assistant to-do lists.
- Photos: a folder, a USB stick, or Immich. Weather: Open-Meteo (no key) or OpenWeatherMap.
- Trash days: your pickup day, city presets, or your city's pickup calendar link.

**Setting up and keeping it running**
- One-command installer for Raspberry Pi OS; starts by itself at power-on.
- **Set up from your phone**: scan a QR code, type the code from the screen, add calendars, lists and photos. The
  installer keeps the Pi's Wi-Fi awake so your phone can always reach it.
- Backups: download / restore from the phone, and automatic nightly backups to a USB stick or network folder.
- Updates install the newest **release** (testers can follow `main`); a version that doesn't start is rolled back by
  itself; `opensky rollback`, `opensky backup`.
- Passwords and keys stay in one private file on the Pi; they never reach the screen, the network or the logs.
