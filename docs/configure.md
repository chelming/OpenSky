# Setting up OpenSky

**The easy way: set it up from your phone.** On the screen tap **Settings → Set up from your phone** (the very first
start offers it by itself). Scan the QR code with your phone's camera — or open the address it shows — and type the
6-digit code. You can add calendars (Google, Outlook, iCloud…), lists, photos, pages, web pages, trash day, your team,
then tap **Save** and **Finish**; the screen restarts with your settings. Your phone must be on the same Wi-Fi.
Passwords and links you type there go straight into `secrets.json`; the phone can replace them but never read them back.
The setup page only exists while the code is on the screen (it closes by itself after 30 quiet minutes).
On your own phone or computer you can tick **Remember this device** when you enter the code; that device then
opens setup without a code, until you forget it (the setup page still has to be open on the screen). **Backup → Forget remembered devices**
ends this for every device.

Everything below can also be edited by hand — the phone page writes these same files.

**Day-to-day things are on the screen itself:** tap **Settings** at the bottom left for brightness, evening dimming,
the night-time sleep schedule, volume, restart / update / shut down. Those choices are saved in `config/device.json`.

Everything else is in two files in `~/OpenSky/config/`:

| File | What's in it | Open it with |
|---|---|---|
| `opensky.json` | your **settings**: family name, town, calendars, lists, photos, pages… | `opensky edit` |
| `secrets.json` | **passwords and keys**: private calendar links, iCloud password, Todoist token, Immich key | `opensky secrets` |

`secrets.json` is read only by the Pi itself. It is never sent to the screen or to other devices on your network, so private things belong there and nowhere else.

After changing either file, run **`opensky restart`**. If the screen doesn't come back, run **`opensky check`**. It tells you about a missing comma or quote.

> **The file format (JSON), in 20 seconds:**
> - Text goes in "double quotes".
> - Items in a list are separated by commas, with **no comma after the last one**.
> - `{ }` holds named settings; `[ ]` holds a list.
> - Keys starting with `_` are notes and are ignored.

---

## Family and place
```json
"family":   { "name": "The Smiths" },
"location": { "name": "Boston, MA", "latitude": 42.3601, "longitude": -71.0589 },
"locale":   { "language": "en", "locale": "en-US", "timeFormat": 12, "units": "imperial", "firstDayOfWeek": 0 }
```
- `family.name`: shown at the top left. Its first letter (ignoring "The") is the Home button's badge.
- `location`: used for the weather. The installer fills it in. To find the numbers yourself, search for your town on
  <https://open-meteo.com/en/docs> and copy the latitude and longitude.
- `locale.timeFormat`: `12` (3:00 PM) or `24` (15:00).
- `locale.units`: `"imperial"` (°F) or `"metric"` (°C).
- `locale.firstDayOfWeek`: `0` = Sunday, `1` = Monday (month view).
- `locale.locale`: how dates are written (`"en-US"`, `"en-GB"`…) — on the screen and in date boxes.
- The **time zone** comes from the Pi itself. To change it: `sudo raspi-config nonint do_change_timezone America/Chicago` (use your zone).

## Accent color and size
```json
"look": { "accent": "teal", "scale": "auto", "textSize": "large" }
```
`scale`: OpenSky has two layouts and scales the right one to fit your screen (`"auto"`): the **full** layout, designed
for 1920×1080, on screens of about 1536×864 and up (a 4K screen shows it at double size), and a denser **compact**
layout, designed for 1280×720, on smaller screens (1024×600, 1280×720, 1366×768, the Pi touch display), so text stays
readable instead of shrinking to half size. Want everything bigger or smaller? Use a number, e.g. `1.2`, or better, the
text size below. The compact layout also switches on by itself when big text leaves too little room.

**Portrait screens** (a monitor turned upright, e.g. 1080×1920) get a third layout automatically: the sidebar becomes a bar
along the bottom, and Home becomes one column: the clock and weather at the top, the next holiday or birthday as a banner,
a Today card (what's left today, with "in 30 min" on the next event and "N done" for the rest), one row per other day of the
week (up to three events, then "+N more"), Lists beside Next Week, and a strip of two photos. Nothing to set: turn the
screen (the Pi's display settings) and restart OpenSky. With **Extra large** text on a portrait screen there is less room, so Today shows two events (instead of three) and the photo strip is shorter, which lets the week rows show their events instead of only "+N more".

`textSize`: `"small"`, `"normal"` (the default), `"large"` or `"xlarge"`: makes everything on the screen smaller or bigger
(0.9×, 1.15×, 1.3×) on top of the fitted size, e.g. for a screen you read from across the kitchen. Larger sizes show less
at once, like a smaller screen. This setting is the **default for every screen** (set it on the phone: Extras → Text size).
Each screen can pick its **own** size in Settings → Look & extras → Text size (applied at once; "Default" follows the setting
above). That choice is remembered by that screen's browser only, so a kitchen screen and a hallway tablet can differ, and it
isn't saved in `opensky.json`.

`theme`: `"light"` (the default: the look you have today), `"dark"`, `"auto"` or `"system"`. **System** follows the light/dark setting of the device showing the screen (a tablet's or computer's dark mode, including its own schedule) and changes the moment that does; it needs nothing else. **Auto** switches to dark from sunset to
sunrise at your `location` (the place from the phone page's "Your family" card; sunrise and sunset are worked out on the
screen itself, no internet needed) and back to light in the morning; without a location it is dark from 19:00 to 07:00.
Dark mode darkens every page, popup and the on-screen keyboard; the screensaver stays as it is (it is dark
already). Photos, and web pages you added (Smart Home, Vault...), are shown as they are, so a light website stays light.
This is the **default for every screen** (phone: Extras → Dark mode); each screen can pick its **own** (Default / Light /
Dark / Auto / System) in Settings → Look & extras → Dark mode, remembered by that screen's browser only (like the text size) and not
saved in `opensky.json`. It works with "Dim in the evening": dark mode changes the colors, the dim lowers the brightness; use
both if you like. `lightSensor`: `true` lets an ambient light sensor overrule the sun in Auto (a dark room turns it dark, a bright
one light), but only on a screen whose browser exposes one; where there is none it is ignored and Auto follows the sun. It is
never used in Docker (time and sun only).

```json
"look": { "theme": "auto", "lightSensor": false }
```

`accent`: the color of buttons, highlights and the active page: any palette color name (see Calendars) or any
color as a code, `"#rrggbb"` (or the short `"#rgb"`), e.g. `"#3b82f6"` or your team's color. Leave it out for the
default peach. This setting is the **default for every screen** (set it on the phone: Extras: a chip, the color picker, or
a code). Each screen can pick its **own** in Settings → Look & extras (a chip, or type a code under "Or a color code";
"Default" follows the setting above). That choice is remembered by that screen's browser only and isn't saved in
`opensky.json`. A very light color gets a warning: the text on buttons is white.

## Pages
```json
"pages": ["home", "calendar", "lists", "timer"]
```
These are the buttons on the left, in this order. The first one is where the screen returns after a few idle minutes.

| Page | What it is |
|---|---|
| `home` | the week ahead, your lists and a photo. Today's tile shows what is left: what is happening now, what is next (with "in 20 min"), and finished events folded into "N done" (tap to see them) |
| `calendar` | month view (two weeks / one week from its toolbar), tap a day or event to see or edit it |
| `weather` | the next 24 hours, weather alerts (US) and a rain radar — see [Weather page](#weather-page-hourly-radar-alerts) |
| `lists` | every list side by side, each one scrolls (Home shows the first three) |
| `countdowns` | every [countdown](#countdowns-a-trip-a-birthday-a-big-day) as a large card with its photo (turn it on in phone setup → Countdowns) |
| `wordgame` | a daily five-letter word puzzle for the whole family (one shared board a day, family stats) |
| `timer` | kitchen timers with a chime |
| `devices` | Home Assistant **lights, switches, locks and sensors** as tappable tiles — see [Devices](#devices-home-assistant-tiles) |
| `music` | **add-on**: what's playing on the screen's speakers, with play / pause / skip and the volume — see [Music add-on](music.md) |

You can also add your own **web pages** as pages (next section).

**Word game:** a new puzzle every day at midnight — by default the same word as the New York Times' daily Wordle
(fetched by the Pi). If NYT can't be reached, OpenSky's own word for the day is used (the page says so) and NYT is
tried again until someone guesses. For OpenSky's own words only: `"wordgame": { "source": "opensky" }`.
A word you know is real but isn't accepted? Add it: `"wordgame": { "extraWords": ["emoji"] }`.

### Home cards
```json
"home": { "cards": ["notes", "tonight", "lists", "photos"] }
```
The cards on the right of the Home page, top to bottom (the week on the left always stays). Leave a card out to hide it:
`notes` (notes posted from the family's phones), `tonight` ("Dinner tonight", needs Meals), `lists`, `photos`. Not set means
all four in this order, so nothing changes until you choose. Set it from the phone page (**Home cards**: switch a card on or
off, drag it by the grip or use the arrows) or from the screen's Settings panel (**Home cards**); a restart applies it.
Works in the landscape, compact and portrait layouts. Photos also need `photos.enabled` (turning the card on from the
phone or Settings switches that on too).
## Several screens (screen profiles)
A kitchen display, a tablet in a kid's room, a few browsers in Docker: the settings in this file are the same for all of them, but
each screen can have its own look. **Per screen** (remembered by that screen's browser, never in `opensky.json`): text size,
accent color, pages hidden with **Hide here** (Settings on the screen) and, in Docker, brightness and the sleep schedule.

A **screen profile** is a named set of these, so you don't repeat the choices on every screen:
```json
"screens": [
  { "name": "Kitchen", "pages": ["home", "calendar", "lists", "timer"], "person": "Mom", "textSize": "large", "accent": "teal" },
  { "name": "Kids' room", "pages": ["home", "chores"], "person": "Zoe" }
]
```
- `name`: shown in Settings on the screen. Up to 12 profiles.
- `pages` (optional): the pages this screen shows; the rest are hidden **on that screen**. Left out = all pages. The page list
  (`pages` above) stays the same for everyone; this only hides buttons. The first shown page is where the screen starts and returns to when idle.
- `person` (optional): a person from `profiles`; their circle is on when the screen starts, so it shows only their calendars and lists (tap it to change).
- `textSize`, `accent` (optional): as under Accent color and size.

Make them on the phone: Set up from your phone, **Screens**. Then on each screen: Settings, Look & extras, **Screen profile**,
and pick one (it is remembered by that screen only). Order of precedence for every setting: what you pick on that screen
(Text size, Accent color, Hide here) beats its screen profile, which beats the default for every screen. Choosing a screen
profile drops that screen's own page, text size and color choices so the profile applies as it is; **None** goes back to the defaults.

## Web pages on the screen (Smart Home, cameras…)
Any web page can be a page of its own — a Home Assistant dashboard, a camera, a school portal, a recipe site.
**Easiest:** Settings → Pages → **+ Add a web page** (or the phone page → Web pages): type a name and the address,
pick an icon, optionally lock it with a PIN, then **Restart now**. Edit or remove it the same way. By hand:
```json
"pages": ["home", "calendar", "lists", "smarthome", "timer"],
"embeds": {
  "smarthome": { "title": "Smart Home", "url": "http://homeassistant.local:8123/lovelace/0?kiosk", "zoom": 1 }
}
```
- The key (`smarthome` here) is what you put in `pages`. Lower-case letters, digits and `-`.
- `title` is the sidebar label; `icon` is picked from the icon grid in phone setup or Settings (about 75 icons: cameras,
  lights, servers, music, home, pets, weather, health… many from [Tabler Icons](https://tabler.io/icons)); `zoom` (e.g. `0.8`) fits more of a busy page.
- Log in once on the screen (the keyboard appears); the page remembers it like a browser does.
- **Back** and **Reload** buttons sit in the bottom-right corner. In an ordinary browser (Docker, a laptop or tablet) the page is
  shown in a frame instead: there is no Back button (use the page's own links), and an **Open in a new tab** button sits beside Reload.
  If the page stays blank, see [Web page is blank](troubleshooting.md#a-web-page-stays-blank-home-assistant-frigate).
- **Private address or a PIN:** put them in `secrets.json`, not here (opensky.json can be read by devices on your Wi-Fi):
  ```json
  "embeds": { "money": { "url": "http://192.168.1.50:8080/", "pin": "4826" } }
  ```
  With a PIN, the page asks for it **every time** it's opened; leaving the page, the screen going to sleep or the
  auto-return to Home lock it again. Five wrong PINs in a row → a 30-second pause.

## Weather
```json
"weather": { "provider": "open-meteo" }
```
- `"open-meteo"` (default) is free and needs no account or key.
- `"openweathermap"` needs a free API key from <https://openweathermap.org/>, put in `secrets.json → weather.openweathermap.apiKey`.

### Weather page (hourly, radar, alerts)
Add `"weather"` to `pages` (or phone setup → **Weather** → *Weather page*) for a page you can read from across the room: **Right now**
(a sky-colored card with the temperature, one plain sentence such as "Warming to 62° around 2 PM, then dropping fast after 5. Bring a jacket
if you're out tonight", and feels-like, wind and humidity), **Next 24 hours** (a temperature curve with Now / High / Low and the chance of
rain), **Plan around it** (four periods with the temperature range and a clothing tip: light layer, jacket, warm coat or rain jacket),
**This week** (the next six days; highs, lows and icons are the same as the Home calendar's, the bars share one scale) and a **Radar** card
(tap it for the full-screen radar). The sentences and tips are worked out from the forecast, nothing is typed in. Three extras can be switched off:
```json
"weather": { "provider": "open-meteo", "hourly": true, "radar": true, "alerts": true }
```
- `hourly`: Right now details, Next 24 hours and Plan around it (Open-Meteo, free, no key). Off: only the sky card and This week stay.
- `radar`: an animated map of the last hour of rain (RainViewer, free, no key). Tap the small map for the full-screen radar: a back button,
  zoom buttons, play/pause, a time slider and a "Dry near <town> for the next N hours" note. The map pictures come
  straight from the internet; if they can't load, the map says so instead of staying blank. Everything else keeps working.
- `alerts`: warnings and watches for your location from the US National Weather Service (free, no key). The top bar shows an amber / red pill with the alert after the clock (nothing when there are none); tap it for the full text on the Weather page.
  Outside the United States there is no free, worldwide alert service, so the page says alerts are US-only.
- Each extra is on unless set to `false`. All three use your `location` and need the internet; there is nothing to enter, and no key is stored.

## Header (top bar)
```json
"header": {
  "holidays": "US",
  "occasions": [ { "name": "Anniversary", "month": 6, "day": 14 } ],
  "birthdaysFromCalendar": true,
  "sports": { "league": "nfl", "team": "NE" }
}
```
- The top-right pill counts down to the next holiday, occasion or birthday.
  - Holidays follow `calendar.holidays` (your country); `header.holidays: "none"` leaves them out of the pill.
  - `occasions`: your own yearly dates. `month` runs 1–12.
  - `birthdaysFromCalendar`: calendar events with "Birthday" or "Bday" in the title count as birthdays.
- `sports`: on game day, a pill shows your team's game, time and channel, then the live score.
  - Leagues: `nfl`, `college-football`, `nba`, `wnba`, `mens-college-basketball`, `mlb`, `nhl`, `mls`, `nwsl`, `epl`.
  - `team` is the short code shown on scoreboards (`NE`, `BOS`, `LAL`…). Leave it `""` for no sports pill.

## People (who a calendar or list belongs to)
Add the people in your family and say whom each calendar and list is for. Each person shows in the top bar as a circle
with their initial, in their color; tap a circle to show only that person's calendars and lists.

**On the phone:** Settings → Set up from your phone → **Your family** → **People** → *Add a person* (a name and a color). Then, in
**Calendars** and **Lists**, tap a calendar or list (or add one) and choose **Who is it for?**.
- A person can have any number of calendars and lists, and a calendar or list can be for several people
  (a Family calendar, birthdays…): tap all of them.
- **Use the person's color:** a calendar that is for exactly one person can take that person's color. Open the calendar
  on the phone, choose who it's for, and turn on *Use <name>'s color*; the calendar then follows their color if you
  change it later. A calendar for several people keeps its own color. By hand: `"colorFromProfile": true` on the
  calendar source.
- A person can have a **photo**: in the add/edit sheet choose "Choose a photo". It is cropped square and shrunk on the
  phone, and the circle shows it instead of the initial.
- A person can have an **email** (optional): it is only used to invite them to events made with
  [quick add](#quick-add-type-or-say-an-event-ai-helper). It stays on the Pi: it is never sent to the screen's pages or shown in
  the top bar.
- Renaming a person updates everything linked to them; removing a person keeps their calendars and lists, they just
  aren't linked to anyone any more.
- Tapping a circle filters the **calendar page, Home and the lists** to that person. One person at a time: tapping
  another circle switches to them, and tapping the picked person again shows everyone. An event on several of a
  person's calendars appears once.
- While someone is picked, a calendar or list that is for nobody is hidden (the Holidays calendar always stays).
  The countdown in the top bar follows the filter too.
- The filter is per screen and resets when the screen reloads.

What the phone page writes (you never need to edit this by hand):
```json
"profiles": [ { "name": "Mom", "color": "pink", "photo": "data:image/jpeg;base64,..." }, { "name": "Zoe", "color": "#3b82f6" } ],
"calendar": { "sources": [ { "name": "Family", "type": "local", "profiles": ["Mom", "Zoe"] } ] },
"lists": { "lists": [ { "name": "Chores", "profiles": ["Zoe"] } ] }
```

## Calendars
OpenSky can show any number of calendars, each with its own color. Some can also be **added to and edited from the screen**.

```json
"calendar": {
  "sources": [
    { "name": "Family", "type": "local", "color": "blue" },
    { "name": "School", "url": "https://example.org/school-events.ics", "color": "teal" },
    { "name": "Mom", "color": "pink" },
    { "name": "Shared", "type": "caldav", "color": "green" }
  ],
  "holidays": "US",
  "colors": {
    "calendars": {},
    "rules": [ { "match": "dentist", "color": "indigo" }, { "match": "soccer", "color": "green" } ]
  }
}
```

| Kind | How | Edit from the screen? |
|---|---|---|
| **On the Pi** | `"type": "local"`. Nothing to set up; events are kept on the Pi. | ✅ |
| **A calendar link** (Google, Outlook, iCloud, school or team calendars…) | `"url": "…"` in opensky.json if it's public, or no url and the link in `secrets.json → calendar.sources.<name>` if it's private | read-only |
| **Meal plan** (on this screen or Mealie) | the **Meals** card on the phone: *Meals on the calendar* (see [Meals](#meals-on-this-screen-or-mealie)) | read-only (change meals on the Meals page) |
| **Google, with editing** | `"type": "google", "calendarId": "primary"` — a one-time Google key + sign-in, guided on the phone: [Google Calendar](google-calendar.md) | ✅ |
| **iCloud, Fastmail, Nextcloud (CalDAV)** | `"type": "caldav"` and the account in `secrets.json` (below) | ✅ |

- `holidays`: your country's public holidays as a calendar (and in the countdown pill): a two-letter country code —
  `"US"` (Google's US list, with Mother's Day, Halloween…), `"GB"`, `"CA"`, `"DE"`, `"AU"`… (from Nager.Date, about 200 countries).
  `"holidaysRegion": "GB-SCT"` (or `"CA-ON"`, `"DE-BY"`…) adds that region's own days. `"none"` turns it off.
- **Colors:** `pink`, `green`, `blue`, `orange`, `yellow`, `emerald`, `purple`, `red`, `teal`, `indigo`, `tan`, `gray` —
  or any color as a code, `"#8cbfc4"` (or `"#8cf"`; upper or lower case): events get a solid bar in that color on a pale
  background of it. Anything else is ignored (the event gets an automatic color). Each event's color is picked in this order:
  1. a matching `rules` keyword in the title
  2. `colors.calendars` (`{ "Mom": "pink" }`)
  3. the calendar's own `color` in `sources`
  4. otherwise a steady automatic color

### Showing only some events of a calendar (e.g. the school's "Day 1"–"Day 6")
A busy calendar, such as a school district's, can be cut down to the events you want.
**On the phone:** Settings → Set up from your phone → Calendars → tap the calendar → *Only show events titled…*.
Type a pattern (upper or lower case doesn't matter); only events whose whole title matches stay. Empty shows everything.

| Pattern | Keeps |
|---|---|
| `^Day [1-6]$` | exactly "Day 1" … "Day 6" (the school's rotation day) |
| `soccer\|practice` | any title containing either word |

An invalid pattern is ignored (everything shows). It is saved as `only` on the calendar in `opensky.json`; you don't edit it by hand.

**In the header:** turn on *Show today's event in the header* for that calendar (same sheet). Today's matching event, e.g. "Day 3",
appears as a pill at the far right of the header, after the holiday/birthday countdown, in the calendar's color. It goes away at midnight until the next
day's event, and doesn't depend on which person's circle is picked. That calendar's all-day events are then left out of the calendar
views (the pill already shows them); its timed events still appear.

### One event on several calendars (kids who share an activity)
If each person has their own calendar and an event is on more than one of them, turn on **Show shared events once** and it
shows **once**, with a box that blends each person's color, their initials as small badges at the top right of the Home tile (`Q`, `Re`: the shortest start that tells the calendars apart; up to 4, then `+N`), and their full names in the event's details. It's off by default.

**On the phone:** Settings → Set up from your phone → Calendars → *Show shared events once*; then tap your family
calendar and turn on *Shared family calendar*.

**By hand** (`mergeShared`, and `role` on the family calendar, in `opensky.json`):

```json
"calendar": {
  "mergeShared": true,
  "sources": [
    { "name": "Family", "type": "google", "calendarId": "…", "role": "shared" },
    { "name": "Ava", "type": "google", "calendarId": "ava@example.com", "color": "green" },
    { "name": "Ben", "type": "google", "calendarId": "ben@example.com", "color": "red" }
  ]
}
```

- **How to share an event:** enter it on any calendar and **invite the others** (Google Calendar → Add guests; choose
  *All events* for a repeating one). Everyone invited gets their own copy with the same event ID; OpenSky merges
  copies with the same ID and start time. Nobody has to accept first. Anyone who **declines** drops off.
- **Calendars without invites** (a calendar link, or events typed in by hand) are merged when the title, start and end
  are all the same.
- `"role": "shared"` marks a family calendar: its copy is merged in but isn't named, so an event on Family that Ava and
  Ben were invited to reads "Ava, Ben". An event only on Family keeps Family's color.
- Changing or deleting a merged event on the screen changes the **organizer's** copy (Google tells the invitees).
- With it on, an event you've declined in Google is also left off the screen.

### Finding a calendar's link
- **Google Calendar** (on a computer): ⚙ Settings → pick the calendar on the left → *Integrate calendar* → copy **Secret address in iCal format**. It's private, so put it in `secrets.json`.
- **Outlook / Microsoft 365**: Settings → Calendar → *Shared calendars* → *Publish a calendar* → choose "Can view all details" → copy the **ICS** link.
- **iCloud** (read-only link): Calendar app → the calendar's ⓘ → **Public Calendar** → copy the link (`webcal://…` works).
- School, team and sports calendars usually offer an "iCal / ICS / Subscribe" link.

A private link goes in `secrets.json` like this. The name must match opensky.json:
```json
"calendar": { "sources": { "Mom": "https://calendar.google.com/calendar/ical/…/private-…/basic.ics" } }
```

### iCloud / Fastmail / Nextcloud with editing (CalDAV)
In `opensky.json`: `{ "name": "Shared", "type": "caldav", "color": "green" }`. Then in `secrets.json`:
```json
"calendar": { "caldav": {
  "Shared": { "url": "https://caldav.icloud.com/", "username": "you@icloud.com", "password": "abcd-efgh-ijkl-mnop", "calendar": "Family" }
} }
```
- **iCloud needs an app-specific password**, not your Apple ID password. Create one at <https://appleid.apple.com> → *Sign-In and Security* → *App-Specific Passwords*.
- `calendar` is the calendar's name as it appears in the Calendar app.
- **Fastmail**: `"url": "https://caldav.fastmail.com/"` with an app password.
- **Nextcloud**: `"url": "https://your-server/remote.php/dav/"`.
- Repeating events are shown, but are changed in your calendar app rather than on the screen.
- The last copy of each calendar is kept on the Pi, so events still show if the internet is down.

## Quick add: type or say an event (AI helper)
In **New Event** a box at the top takes a sentence like *"dentist Tuesday 3pm"* or *"soccer practice for Mia next Thursday 5 to 6:30"*
and fills the form in. **Nothing is saved until you tap Add Event**, so you can check (and change) the day, time and calendar first.

It needs a model that understands sentences, running somewhere on **your own network**: llama.cpp's `llama-server`, Ollama, LM Studio or
anything with an OpenAI-style `/v1/chat/completions`. Nothing is sent to the internet by OpenSky, and no account or key is needed
(unless your server wants one).

**On the phone:** Settings → Set up from your phone → **AI helper**.
- **AI helper address**, e.g. `https://llama-cpp.example`: turns the box on. Empty = off, and the box never shows. *Test the connection* checks it first.
- **Speech helper address** (optional): adds a microphone button. Tap it, say the event, tap it again (it also stops by itself after 12
  seconds). Any server with an OpenAI-style `/v1/audio/transcriptions` works (llama.cpp with a Qwen3-ASR model, Parakeet, whisper.cpp…).
  The Pi needs a microphone, and the screen has to be allowed to use it.

What it understands:
- The day and time (*"Tuesday"*, *"next Friday"*, *"the 3rd"*), how long (*"5 to 6:30"*, default an hour) and all-day things (a birthday). Days are worked out from
  a calendar OpenSky gives the model, not by the model's own arithmetic, and the form always shows the full date.
- **People.** Name someone from [People](#people-who-a-calendar-or-list-belongs-to) (*"for Mia"*, *"Mia and Dad"*, *"everyone"*).
  One person → their own calendar. Several people → the calendar marked **Shared family calendar**
  (see [One event on several calendars](#one-event-on-several-calendars-kids-who-share-an-activity)), plus an **Invite** row with a switch for each person.
- **Invitations** are real emails from Google Calendar, sent when you tap Add Event, only on a Google calendar. A person is invited
  if they have an **email** (People → tap a person) or their own Google calendar is linked to them and is a main calendar (its id is their address).
  Someone with no address is skipped and the form says so. With *Show shared events once* on, the family calendar's copy and the invited copies show as one event.
- Not yet: repeating events (*"every Thursday"*: it adds the first one and says so), and photos of flyers.

Privacy: only the sentence (or the recording) and the names of your family go to your own server. Email addresses never do, and never reach the screen's pages.
Whatever the model returns is checked again in code and only ever fills the form; it can't save, delete or invite anyone by itself.

By hand (`opensky.json`; the phone page writes this): `"ai": { "url": "https://…", "model": "…", "transcribeUrl": "https://…" }` and, per person, `"profiles": [{ "name": "Mia", "email": "mia@example.com" }]`.
If your server needs a key: `secrets.json → ai.key`.

## Lists
```json
"lists": {
  "lists": [
    { "name": "To-Dos", "color": "blue" },
    { "name": "Groceries", "color": "orange" },
    { "name": "Shopping", "provider": "todoist", "project": "Shopping", "color": "green" }
  ],
  "refreshMinutes": 2,
  "columns": 4
}
```
- `color`: a palette name (as for calendars) or a color code like `"#8cbfc4"`.
- **On the Pi** (default, no `provider`): items are kept on the Pi.
- **Todoist** (`"provider": "todoist"`): shows a Todoist project, by default the one with the same name as the list. Use `"project": "…"` for a different name, or `"projectId": "…"`.
  - Add your token to `secrets.json → lists.todoist.token`. Find it in Todoist → Settings → *Integrations* → *Developer* → **API token**.
  - Changes on the screen show in the Todoist app, and the other way round. The screen checks every `refreshMinutes`.
- **Home Assistant** (`"provider": "homeassistant", "entity": "todo.shopping_list"`): any Home Assistant to-do list
  (the built-in Shopping List, Local To-do, Google Tasks or others connected to HA). Put your HA address and a
  long-lived access token (HA → your profile → Security) in `secrets.json → homeassistant.url / .token`.
- **Mealie** (`"provider": "mealie", "shoppingList": "Weekly Shop"`): one of your Mealie shopping lists. See [Meals (Mealie)](#meals-on-this-screen-or-mealie).
- Home shows the first three lists; the **Lists** page shows them all (`columns` fit across, more scroll sideways). Tap the **+** in a list's header to add, tap the circle to check off (with Undo), or tap an item to edit or delete it.
- **Greenlight chores** have their own page. See [Chores](#chores-greenlight-unofficial).

## Devices (Home Assistant tiles)
The `devices` page shows Home Assistant lights, switches, locks and sensors as tiles in OpenSky's own look, so the family
doesn't need a full Home Assistant page on the wall. Tap a **light or switch** to turn it on or off. A **lock** asks for a
second tap ("Tap again to unlock") so a stray touch can't open the door; a lone tap times out after 4 seconds. **Sensors**
(temperature, a door that is open, power…) are read-only. If Home Assistant can't be reached the page says so and keeps the
last tiles faded until it answers again.

Easiest from the phone page: **Pages → Devices** on, then **Extras → Devices → Find my devices**, tap **Add** on what you
want, type a shorter name if you like, and use the arrows to put them in order.

By hand, in `opensky.json`:
```json
"pages": ["home", "calendar", "devices", "timer"],
"devices": { "tiles": [
  { "entity": "light.hall", "name": "Hall" },
  { "entity": "lock.front_door" },
  { "entity": "sensor.living_room_temperature" }
] }
```
- `entity` is a Home Assistant entity id starting `light.`, `switch.`, `lock.`, `sensor.` or `binary_sensor.` (up to 48).
- `name` is optional; Home Assistant's own name is used without it.
- The address and a long-lived access token (HA → your profile → Security) go in `secrets.json → homeassistant.url / .token`
  — the same ones the Home Assistant lists and Music speakers use. They are read by the Pi, never sent to the screen's page.
  Only the tiles you picked can be changed from the screen.

## Chores (Greenlight, unofficial)
A **Chores** page shows each child's chores for today from the [Greenlight](https://greenlight.com) app: open chores first, finished ones struck through (each group A–Z, ignoring a leading emoji)
below, "2 of 3 done", and the streak and allowance Greenlight reports. Tap a chore to tick it off; tap it again to undo. Greenlight has no public
interface, so this uses the private service its own app talks to and **can stop working whenever Greenlight changes it**. It is off unless you set it up.

1. On the phone: **Chores** (a card next to Lists). Enter the parent's phone number and Greenlight password and tap **Connect to Greenlight**. If Greenlight texts a code, type it in.
2. Turn on the children to show. The first one also turns on the **Chores** page (Settings → Pages, where you can drag it into place).
3. Optional: **Chores left on the badge** puts the number of chores a child still has to do on their circle at the top. It needs a person under Family with the same name as the child.

- The settings are `"chores": { "kids": [{ "id": "<Greenlight user id>", "name": "Reese", "profile": "Reese" }], "badges": true, "refreshMinutes": 5 }` and the page key `chores` in `pages`; a linked profile gives the child's color.
- OpenSky signs in as its own device, so your phone's Greenlight app keeps working; it may show up as another device on the account. Its sign-in details (generated device id and tokens) live in `greenlight-state.json` next to `secrets.json` (chmod 600) and are not part of backups. The phone and password are in `secrets.json → greenlight`.
- Adding, renaming and removing chores is done in the Greenlight app; OpenSky never deletes a chore. Changes made in the app show within `refreshMinutes`.
- A list with `"provider": "greenlight", "kid": "<id>"` also works as a plain list (today's open chores), but the Chores page is the way to use it.

## Meals (on this screen or Mealie)
Phone setup → **Meals** → *Where the meal plan lives*: **On this screen** (no account), **Mealie**, or Off.

### On this screen
The plan is kept on the Pi in `meals.json` (next to `lists.json`; it is part of backups). Plan meals right on the screen:
- Open the **Meals** page and tap the **+** on a day, type the dish, pick breakfast / lunch / dinner / side (if you show more than
  one kind) and tap **Add**. Tap a dish to change it or **Remove** it. Tonight's dish on Home opens the same popup.
- The same settings as for Mealie apply: **Meals to show**, **Meals page**, **Dinner tonight on Home**, **Meals on the calendar**.
  There are no recipes or pictures, and no shopping-list button (those need Mealie).
- Settings: `"meals": { "provider": "local", "types": ["dinner"], "home": true, "calendar": false }`.

### Mealie
[Mealie](https://mealie.io) is a self-hosted recipe manager. OpenSky can show its **meal plan** and **recipes**, and use its
**shopping lists**. Everything is set up on the phone, with no file editing: Settings → *Set up from your phone* → **Meals**.

1. In Mealie, make an API token: your profile (top left) → **API Tokens** → give it a name → *Create*, then copy it.
2. In phone setup, turn on **Use my Mealie meal plan**, type Mealie's address (for example `http://mealie:9000` or
   `http://mealie.local:9925`) and paste the token, then tap **Connect to Mealie**. It is checked straight away; if it works the
   address and token are kept on the Pi (in `secrets.json`, never in the screen's config), so you don't need to Save first.
3. Choose what you want:

| Setting | What it does |
|---|---|
| **Meals to show** | Breakfast, lunch, dinner, sides. One is enough. |
| **Meals page** | A page in the sidebar with the whole week, one column per day (a row per day on a portrait screen), with a picture for every dish. Previous / next week go a week back and five weeks ahead. |
| **Dinner tonight on Home** | A card on Home with tonight's dinner (needs *Dinner* above). Hidden when nothing is planned. |
| **Meals on the calendar** | Each meal as an all-day entry on the week, the Calendar page and Home, in a color you pick. With one meal chosen an entry reads "Lasagna"; with several, "Dinner: Lasagna". |
| **Add a recipe's ingredients to** | Pick one of your Mealie shopping lists, and every recipe gets an **Add ingredients** button that puts its ingredients on that list (Mealie merges what is already there). |

Tap a dish (on Home or the Meals page) to open its recipe: picture, servings and times, ingredients and steps. Entries that are
just a note in Mealie ("Pizza night") show, but have no recipe to open. Mealie's meal plan is read-only on the screen: plan meals in Mealie (or choose *On this screen* above).
It refreshes every 10 minutes (and when you open the page).

**Mealie shopping lists** are separate: Lists → Add a list → **Mealie**, then pick the shopping list. Add, edit, check off (with Undo) and
delete from the screen; changes show in Mealie and its app, and Mealie's changes show here within `refreshMinutes`. It uses the same
connection as the Meals card.

Notes:
- Works with Mealie 1.x, 2.x and later (checked against 3.30). Use an address the Pi (or the Docker container) can reach. In Docker, a
  Mealie on the same Docker network is reachable by its container name, e.g. `http://mealie:9000`; `localhost` would be OpenSky itself.
- In `opensky.json` (if you ever look): `"meals": { "provider": "mealie", "types": ["dinner"], "home": true, "calendar": false, "calendarColor": "orange", "addToList": { "id": "…", "name": "…" } }`,
  `"meals"` in `pages`, and for a shopping list `{ "name": "Food", "provider": "mealie", "shoppingList": "Weekly Shop", "shoppingListId": "…" }`.
  The address and token live in `secrets.json → mealie.url / .token`. (A calendar source `{ "type": "mealie", "meals": ["dinner"] }`
  also works if you want to name the meal calendar yourself.)

## Countdowns (a trip, a birthday, a big day)
Phone setup → **Countdowns** → *Add a countdown*: a name, the date, a color and (if you like) a photo. The screen counts the
days down: a card on Home (the nearest two; on a portrait screen a banner under the top bar with the nearest three), and,
if you switch on **Countdowns page**, a page with every countdown as a large card.
- **Photo:** *From this phone* (it is shrunk on the phone first) or *From the photo library* (a photo already in your
  photo folder; not available with Immich). The picture is kept on the Pi in `countdown-photos/` next to `opensky.json`
  (it is not part of the automatic backup, the settings are).
- **Every year:** for a birthday or anniversary. It always counts to the next one and never hides.
- **Show on Home:** switch it off to show a countdown only on the Countdowns page.
- **After the date has passed, hide it:** a countdown says "Today" on its day and then disappears the day after (or after 2 days,
  4 days, a week, a month, as you choose). It stays in the settings; change its date to use it again.
- In `opensky.json` (if you ever look; phone setup writes it for you):
  `"countdowns": { "keepDays": 0, "items": [ { "id": "c1a2b3c4", "title": "Beach trip", "date": "2026-12-20", "color": "blue", "photo": true, "yearly": false, "home": true } ] }`
  and `"countdowns"` in `pages` for the page. `id` is letters and digits (4 to 24); `keepDays` runs 0 to 365; `color` is a palette name or a `#rrggbb` code.
- This is separate from the top bar's holiday and birthday pill (see [Header](#header-top-bar)), which follows the holidays and your calendar.

## Photos
```json
"photos": { "enabled": true, "provider": "folder", "folder": "~/Pictures", "usb": true, "intervalSeconds": 30 }
```
- `folder`: pictures in this folder and its sub-folders, shuffled. **Add and delete them from your phone:** Set up from your phone →
  **Photos** → *Add photos from this phone* (pick one or many; JPEG, PNG or WebP, up to 40 MB each). Tap a thumbnail to delete that
  photo from the Pi. The list shows the folder as last saved. Or copy files over the network, or with a USB stick and the file manager.
- **In Docker** there is no `~/Pictures` and no USB stick: photos you add from the phone are kept in the `/config` volume
  (`photos/`, next to `opensky.json`), so they survive updates. Mount a folder and set `folder` to it to use pictures you already have.
- `usb`: also show photos from a plugged-in USB stick. Put them in a folder named **`OpenSky`** on the stick; the rest of the stick is ignored.
- Two portrait photos are shown side by side. The date a photo was taken is shown when the photo has it.
- **Immich** (your own photo server): `"provider": "immich", "url": "http://192.168.1.20:2283"`. Put an API key in
  `secrets.json → photos.immich.apiKey`; create it in Immich under Account Settings → *API Keys*.
- `"enabled": false`: no photo card.

## Trash and recycling day
```json
"pickup": { "trashDay": "monday", "preset": "" }
```
A small trash-can icon appears on pickup days in the week view. It moves a day later after a holiday.
- `trashDay`: `"monday"` … `"friday"`. Leave it `""` for no icons.
- `preset`: a city's full schedule, including yard waste and holidays. Current presets: `"new-bedford-ma"`. Want your city added? Open an issue on GitHub with a link to its schedule, or ask an AI assistant to make one with `lib/pickup-presets/new-bedford-ma.json` as the example.
- **From a calendar:** many cities (and services like ReCollect) publish pickup days as a calendar link.
  `"pickup": { "url": "https://…" }` — or keep it private (it can contain your address): `"url": "secret"` and the
  link in `secrets.json → calendar.sources.Pickup`. Events with "trash/garbage/refuse", "recycling" or
  "yard/leaf/compost" in their names become the icons (they don't show as events). Works together with `trashDay`.
- Your own rules (every-other-week recycling, yard-waste weeks…) can go here too; see the notes at the top of `lib/client/pickup.js`.

## Screen and timers
```json
"sidebar": { "idleReturnMinutes": 5 },
"timer":   { "quickAddMinutes": [5, 10, 15, 30, 45, 60], "chimeVolume": 0.6 }
```
- `idleReturnMinutes`: after this many minutes without a touch, open pop-ups close and the screen returns to the first page. A running timer stays put. `0` turns this off.
- **Sleep** (bottom left) blacks out the screen until the next touch.
- `quickAddMinutes`: the timer's quick buttons. `chimeVolume` runs from 0 to 1.

## Event reminders
```json
"reminders": { "minutes": 10, "chime": true, "banner": true, "allDay": false, "people": ["Mom"] }
```
Off unless `minutes` is set (1 to 120; the phone page and Settings offer 5, 10, 15 and 30). That many minutes before an event
starts, the screen plays the timer's chime and shows a banner with the event and its start time (tap **OK** to hide it, or it
goes after 90 seconds). Each event reminds once, also after a reload or a restart.
- `chime` / `banner`: turn either off (the banner alone works as a silent reminder). At least one has to stay on.
- `allDay`: all-day events too. They remind once, at 8 in the morning. Off by default.
- `people`: only the calendars linked to these people (or named like them). Empty or left out = every calendar.
- A sleeping screen (Sleep, or the night schedule) is left alone: nothing plays, and the reminder comes when someone wakes it if the event hasn't started yet.
- Set it from the phone page (Extras -> Event reminders) or on the screen (Settings -> Look & extras -> Event reminders, with a **Test** button; a restart applies it).
  The chime and who it is for are on the phone page.
- In Docker the chime plays in the browser that shows the dashboard (the same Web Audio bell as the timer), so it needs that browser to have been touched once and not be muted; the banner always works.

## Screensaver
```json
"screensaver": { "enabled": true, "afterMinutes": 10, "upNext": true, "showClock": true, "showWeather": true, "photoSeconds": 20 }
```
Off by default. When on, after `afterMinutes` without a touch the screen becomes a full-screen slideshow of your photos
(the same photos as the Home card) with the time, date, weather and an **Up next** list: what is left today, then the start
of tomorrow, and "+N more events today". A touch (or key) brings the dashboard back; that touch doesn't press anything.
It doesn't start while the screen is asleep or a timer is running on the Timer page, and a finished timer ends it.
`upNext`, `showClock` and `showWeather` hide those parts; `photoSeconds` is the time per photo (5 or more). With no photos
you get a dark background and the same information. The text drifts a few pixels with each photo, to spare the screen.
Works the same in Docker with the screen shown in a browser (it only needs page touches).

## On-screen keyboard
```json
"keyboard": { "enabled": true }
```
A keyboard slides up whenever you tap a text box (adding a list item, naming an event). Turn it off with `false`
if you use a real keyboard. Dates and times use pickers instead. The keyboard takes 40 % of the screen height, but never more than 440 px (design size), so on a portrait screen its keys stay normal-sized instead of stretching.

## The Settings panel (on the screen)
| Setting | What it does |
|---|---|
| Brightness | In Docker (no screen hardware) it dims the picture of **this browser only**, and "Dim in the evening" and "Sleep at night" are also kept per browser (in that browser, like the text size), so a tablet and a wall display can differ. On a Pi it uses the display's backlight (Pi touch displays), the monitor's own brightness over HDMI (most monitors; the installer sets this up), or — if neither works — dims the picture. The panel says which. |
| Dim in the evening | From the time you pick until the morning, brightness goes down to the level you pick. |
| Sleep turns off by | (Pi only.) How the screen goes off: **Automatic** (recommended), **Black screen + dim** (works on every screen), **Turn the signal off** (most monitors), **TV standby (HDMI-CEC**, only offered when a TV answers), **Display backlight off** (Pi displays). **Every screen is different — try them with Test** (back after 10 seconds or at a touch). A monitor that turns itself back on when the signal stops is noticed and switched to Black screen + dim; a screen that doesn't come back after waking is retried, then switched too. If none suits your screen, Black screen + dim always works. (There's deliberately no "monitor power-off over HDMI": on some monitors it switches them fully off, and only their power button brings them back.) |
| Sleep at night | The screen goes dark at "Off at" and comes back at "On at". A touch wakes it; it sleeps again after 3 quiet minutes. A running timer keeps it on. |
| Volume / Test | The Pi's speaker volume; Test plays the timer chime. Not shown in Docker. |
| Pages | Turn pages on/off and change their order (also on the phone) for every screen. **Hide here** hides a page's button on the screen you're holding only (kept in that browser, like the text size) — handy when a tablet and a wall display should show different pages. |
| Home cards | Show or hide the cards on the right of Home and change their order (grip or arrows); applies after a restart. |
| Look & extras | **Screen profile** (a saved set of pages, person, text size and color, see [Several screens](#several-screens-screen-profiles)), accent color, text size (both for this screen only), word game (NYT's word or OpenSky's), photo slideshow on/off, trash day. |
| Backups | Every night to a USB stick, a network folder or the Pi itself — the list shows what the Pi can reach right now (in Docker: folders you mount into the container, e.g. `/backups`, and the config folder); keep 7–90; passwords included only if you switch it on; **Back up now**. |
| System | Internet, the Pi's address, the OpenSky version (and **Update** when there is one), Reload, Restart OpenSky, Restart Pi, Shut down. The last three ask you to tap twice. |

## Family share page (photos and notes from everyone's phone)
```json
"share": { "enabled": true, "port": 8091 }
```
A small page that family members open on their own phones to **add photos** to the slideshow or **post a note** that shows
on the Home screen. It is separate from phone setup, which stays closed except while you are setting things up.
- Switch it on in Set up from your phone → **Share with the family**, choose a **family passcode** (6+ characters) and tap **Finish** (OpenSky
  restarts). The card then shows the page's address. Each family member opens it once, types the passcode and stays signed in for 90 days; they
  can add the page to their home screen. There is no secret link: without the passcode the page shows only a sign-in box.
- What the page can do: add photos (JPEG, PNG, WebP; up to 40 MB each, 20 per 10 minutes), post a note (up to 280 characters, kept for a day, a week or until
  removed, 20 at a time), add or remove **countdowns** (a name, a date, optionally every year; 12 at a time) and remove notes. It **cannot** see or change settings, passwords, calendars or backups. Notes also go away when someone taps the
  **x** on the screen. They are kept in `notes.json` next to `opensky.json`; countdowns added from the share page are in
  `family-countdowns.json` there (the share page never writes `opensky.json`). They appear on Home and the Countdowns page with the ones from phone setup, but have no photo and
  are removed from the share page, not from phone setup.
- The passcode is kept only as a salted scrypt hash in `secrets.json → share.hash`; signed-in phones carry a cookie signed with `share.secret`.
  **Changing the passcode** (same card) makes a new secret and signs every phone out. Five wrong passcodes from one phone pause that phone for a
  minute, and many wrong ones from anywhere pause everyone for a few minutes.
- Over plain `http` (a Pi on your Wi-Fi) the passcode crosses the network unencrypted, like the phone setup code; put the page behind HTTPS
  (a reverse proxy, see [docker.md](docker.md#family-share-page)) if that matters to you. With **Immich** as the photo source, the page only offers notes, because photos
  have to be added in Immich.
- `port`: change it if something else uses 8091. In Docker, set `OPENSKY_SHARE_URL` to the address phones use ([docker.md](docker.md#family-share-page)).

## Phone setup
```json
"setup": { "port": 8090 }
```
The port the phone page uses while setup is open (only then). Change it if something else on the Pi uses 8090.

In Docker (or behind a reverse proxy) phones reach the page at a different address than the machine's own: set the
`OPENSKY_SETUP_URL` environment variable to it ([docker.md](docker.md#phone-setup)).

## Automatic backups
```json
"backup": { "destination": "/media/pi/MYSTICK", "time": "03:00", "keep": 14, "includeSecrets": false }
```
Easiest from Settings (on the screen) or the phone page → Backup. Backups go to `<destination>/OpenSky-backups/`, one
file per night, the newest `keep` kept. A USB stick that's unplugged is retried every hour. A network folder: mount it
on the Pi (e.g. open it once in the file manager: *Go → Network*) and it appears in the list. Restore a backup from the
phone page → Backup → Restore.

## Updates
```json
"update": { "channel": "releases" }
```
`opensky update` (and Settings → Update) installs the newest **release**. `"main"` follows the newest development
version instead — for testers. Either way, a version that doesn't start is rolled back by itself.

