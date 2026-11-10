# Setting up OpenSky

**The easy way: set it up from your phone.** On the screen tap **Settings → Set up from your phone** (the very first
start offers it by itself). Scan the QR code with your phone's camera — or open the address it shows — and type the
6-digit code. You can add calendars (Google, Outlook, iCloud…), lists, photos, pages, web pages, trash day, your team,
then tap **Save** and **Finish**; the screen restarts with your settings. Your phone must be on the same Wi-Fi.
Passwords and links you type there go straight into `secrets.json`; the phone can replace them but never read them back.
The setup page only exists while the code is on the screen (it closes by itself after 30 quiet minutes).

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
screen (the Pi's display settings) and restart OpenSky.

`textSize`: `"small"`, `"normal"` (the default), `"large"` or `"xlarge"`: makes everything on the screen smaller or bigger
(0.9×, 1.15×, 1.3×) on top of the fitted size, e.g. for a screen you read from across the kitchen. Larger sizes show less
at once, like a smaller screen. This setting is the **default for every screen** (set it on the phone: Extras → Text size).
Each screen can pick its **own** size in Settings → Look & extras → Text size (applied at once; "Default" follows the setting
above). That choice is remembered by that screen's browser only, so a kitchen screen and a hallway tablet can differ, and it
isn't saved in `opensky.json`.

`accent`: the color of buttons, highlights and the active page: any palette color name (see Calendars) or any
color as a code, `"#rrggbb"` (or the short `"#rgb"`), e.g. `"#3b82f6"` or your team's color. Leave it out for the
default peach. Pick it on the screen (Settings → Look & extras: a chip, or type a code under "Or a color code") or on
the phone (Extras: a chip, the color picker, or a code). A very light color gets a warning: the text on buttons is
white.

## Pages
```json
"pages": ["home", "calendar", "lists", "timer"]
```
These are the buttons on the left, in this order. The first one is where the screen returns after a few idle minutes.

| Page | What it is |
|---|---|
| `home` | the week ahead, your lists and a photo. Today's tile shows what is left: what is happening now, what is next (with "in 20 min"), and finished events folded into "N done" (tap to see them) |
| `calendar` | month view (two weeks / one week from its toolbar), tap a day or event to see or edit it |
| `lists` | every list side by side, each one scrolls (Home shows the first three) |
| `wordgame` | a daily five-letter word puzzle for the whole family (one shared board a day, family stats) |
| `timer` | kitchen timers with a chime |
| `music` | **add-on**: what's playing on the screen's speakers, with play / pause / skip and the volume — see [Music add-on](music.md) |

You can also add your own **web pages** as pages (next section).

**Word game:** a new puzzle every day at midnight — by default the same word as the New York Times' daily Wordle
(fetched by the Pi). If NYT can't be reached, OpenSky's own word for the day is used (the page says so) and NYT is
tried again until someone guesses. For OpenSky's own words only: `"wordgame": { "source": "opensky" }`.
A word you know is real but isn't accepted? Add it: `"wordgame": { "extraWords": ["emoji"] }`.

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
- `title` is the sidebar label; `icon` is one of `embed globe smarthome camera play music cart food school briefcase
  heart chart cloud car paw book`; `zoom` (e.g. `0.8`) fits more of a busy page.
- Log in once on the screen (the keyboard appears); the page remembers it like a browser does.
- **Back** and **Reload** buttons sit in the bottom-right corner.
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
| **Mealie meal plan** | `"type": "mealie", "meals": ["dinner"]` — set up on the phone: Calendars → Add a calendar → **Mealie** (see [Mealie](#mealie)) | read-only |
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
- **Mealie** (`"provider": "mealie", "shoppingList": "Weekly Shop"`): one of your Mealie shopping lists. See [Mealie](#mealie).
- Home shows the first three lists; the **Lists** page shows them all (`columns` fit across, more scroll sideways). Tap **Add item** to add, tap the circle to check off (with Undo), or tap an item to edit or delete it.
- **Greenlight chores** (`"provider": "greenlight", "kid": "<Greenlight user id>"`): a child's chores for today. See [Greenlight chores](#greenlight-chores-unofficial).

## Greenlight chores (unofficial)
Show a child's chores from the [Greenlight](https://greenlight.com) app as a list, and tick them off from the screen. Greenlight has no public
interface, so this uses the private service its own app talks to and **can stop working whenever Greenlight changes it**. It is off unless you set it up.

1. On the phone: **Lists → Add a list → Greenlight**.
2. Enter the parent's phone number and Greenlight password and tap **Connect to Greenlight**. If Greenlight texts a code, type it in. They are kept on the Pi (`secrets.json`), never on the screen.
3. Choose the child (one list per child) and **Add**.

- OpenSky signs in as its own device, so your phone's Greenlight app keeps working; it may show up as another device on the account. Its sign-in details (generated device id and tokens) live in `greenlight-state.json` next to `secrets.json` (chmod 600) and are not part of backups.
- It shows **today's open chores**. Ticking one off (with Undo time, as in other lists) marks it done in Greenlight. Adding, renaming and removing chores is done in the Greenlight app; OpenSky never deletes a chore.
- Changes made in the app show within `refreshMinutes`.

## Mealie
[Mealie](https://mealie.io) is a self-hosted recipe manager. OpenSky can show its **shopping lists** as lists, and its
**meal plan** as a calendar (the dinners show on Home and the Calendar page). Everything is set up on the phone, with no file editing:

1. Settings → *Set up from your phone*.
2. Create an API token in Mealie: your profile (top left) → **API Tokens** → give it a name → *Create*, then copy it.
3. **Lists → Add a list → Mealie** (or **Calendars → Add a calendar → Mealie**). Type Mealie's address (for example
   `http://mealie.local:9925`) and paste the token, then tap **Connect to Mealie**. It is checked straight away; if it
   works, the address and token are kept on the Pi (in `secrets.json`, never in the screen's config) and you don't need to enter them again.
4. For a list, pick the **shopping list**. For the meal plan, choose which meals show (breakfast, lunch, dinner, sides).
   With one meal chosen an entry reads "Lasagna"; with several, "Dinner: Lasagna".

What to expect:
- Shopping list: add, edit, check off (with Undo) and delete from the screen; it changes in Mealie and the Mealie app too. Changes made in Mealie show within `refreshMinutes`. Checked items disappear from the screen, as with the other lists.
- Meal plan: read-only on the screen (plan meals in Mealie). It refreshes every 5 minutes and shows 30 days back and about 4 months ahead.
- Works with Mealie 1.x, 2.x and later. Use an address the Pi can reach (the one you open Mealie at on a phone on the same Wi-Fi).
- In `opensky.json` (if you ever look): a list is `{ "name": "Food", "provider": "mealie", "shoppingList": "Weekly Shop", "shoppingListId": "…" }`,
  a calendar `{ "name": "Dinner", "type": "mealie", "meals": ["dinner"] }`. The address and token live in `secrets.json → mealie.url / .token`.

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
if you use a real keyboard. Dates and times use pickers instead.

## The Settings panel (on the screen)
| Setting | What it does |
|---|---|
| Brightness | In Docker (no screen hardware) it dims the picture of **this browser only**, and "Dim in the evening" and "Sleep at night" are also kept per browser (in that browser, like the text size), so a tablet and a wall display can differ. On a Pi it uses the display's backlight (Pi touch displays), the monitor's own brightness over HDMI (most monitors; the installer sets this up), or — if neither works — dims the picture. The panel says which. |
| Dim in the evening | From the time you pick until the morning, brightness goes down to the level you pick. |
| Sleep turns off by | (Pi only.) How the screen goes off: **Automatic** (recommended), **Black screen + dim** (works on every screen), **Turn the signal off** (most monitors), **TV standby (HDMI-CEC**, only offered when a TV answers), **Display backlight off** (Pi displays). **Every screen is different — try them with Test** (back after 10 seconds or at a touch). A monitor that turns itself back on when the signal stops is noticed and switched to Black screen + dim; a screen that doesn't come back after waking is retried, then switched too. If none suits your screen, Black screen + dim always works. (There's deliberately no "monitor power-off over HDMI": on some monitors it switches them fully off, and only their power button brings them back.) |
| Sleep at night | The screen goes dark at "Off at" and comes back at "On at". A touch wakes it; it sleeps again after 3 quiet minutes. A running timer keeps it on. |
| Volume / Test | The Pi's speaker volume; Test plays the timer chime. Not shown in Docker. |
| Pages | Turn pages on/off and change their order (also on the phone). |
| Look & extras | Accent color, text size, word game (NYT's word or OpenSky's), photo slideshow on/off, trash day. |
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
  removed, 20 at a time) and remove notes. It **cannot** see or change settings, passwords, calendars or backups. Notes also go away when someone taps the
  **x** on the screen. They are kept in `notes.json` next to `opensky.json`.
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

