# Cascade Zmanim — minyan board: website + app

Published as **Cascade Zmanim**, a privately run service: the shul's name appears nowhere in the app (the name comes from General → Name).

Shows the next minyan with a live countdown, every room's Shacharis / Mincha / Maariv
minyanim (with the Hodu / Shemoneh Esrei time), the Hebrew date, the parsha of the week,
holidays and today's zmanim. The board itself is in Hebrew and has no editing controls. The gabbai edits everything from a separate admin page in English: `/admin` on the self-hosted site — one of three short addresses, `/screen` for the TV and `/tv` for the preview, each a plain page beside the others, with `404.html` sending any spelling of them to the right one — or the claude.ai link with `#admin` added (owner only).

Three ways to use it, all from the same code:

| What | Where | Editing |
|---|---|---|
| Shareable page | https://claude.ai/artifact/5CiKzUDtdy3eTAeNzQrqwA | Owner opens the link with `#admin`, saves for everyone |
| Website + installable app (PWA) | `docs/` on any static host (GitHub Pages, Netlify…) | `admin.html` (PIN) → publishes `config.json` to GitHub |
| App Store / Play Store app | `app/` (Capacitor, Android + iOS projects) | Opens the website itself, so it is always current |
| Text message (SMS) | `sms/` (Twilio Functions, Cloudflare Worker or Node) | Reads the website's `config.json` |

## Files

- `src/cal.js` — Hebrew calendar, parsha algorithm, holidays, sunrise/sunset zmanim (NOAA). No dependencies.
- `src/engine.js` — the schedule engine (config → minyanim for any date), shared by the page, the app and the SMS responder.
- `src/app.js` — rendering, admin panel, saving, offline/app logic.
- `src/sms.js` — turns an incoming text ("מנין", "mincha", "today"…) into the reply text.
- `src/style.css`, `src/template.js`, `src/manifest.webmanifest`, `src/sw.js` — styling, page template, app manifest, service worker.
- `config.default.json` — the schedule and settings built into the page.
- `build.js` — `node build.js` regenerates `src/index.html`, `docs/` and `app/www`.
  `node build.js --remote https://YOUR-SITE/config.json` bakes in the central schedule address (needed for the store app).
- `assets/` — icon source (`make-icons.js` renders the PNGs, `native-icons.py` fills the Android/iOS projects).
- `sms/twilio.js`, `sms/worker.js`, `sms/server.js` — the three deployable responders; `node build.js` bundles the first two into `sms/docs/`.
- `test/cal.test.js`, `test/sms.test.js` — `node test/cal.test.js` / `node test/sms.test.js`. `test/smoke.js`, `test/pwa.js` — browser tests.

## Schedule format

One minyan per line: time first, then the room / minyan name, then an optional `// note`.

```
6:20 ברך משה
שקיעה-15 דברי יואל
הדלקה לב אהרן
צאת+5 שלמה יודא // הערה
שקיעה-20~5 ברך משה      (round down to 5 minutes)
```

Zman words: `שקיעה` `נץ` `הדלקה` `צאת` `פלג` `חצות` `עלות` `שמע` `ר״ת` (or sunset, sunrise,
candles, tzeis, plag, chatzos, alos, shema). The last weekday Shacharis is written `חצות-30 ברך משה`,
so it moves with chatzos every day (change `-30` if your board uses a different gap).
A repeating run: `every 10 from sunrise-30~5 to chatzos-30 rooms ברך משה, דברי יואל` (every 10 minutes, rooms in turn; `~5` rounds every minyan to 5 minutes). The admin page builds these rows for you.

A rule at the end of a line, `until <zman>` or `after <zman>` (עד / אחרי work too, with an offset like `tefilla-10`), keeps the minyan only while it starts before (or from) that zman on that day: `10:45 ברך משה until tefilla` is listed in winter and drops away by itself in summer, and a repeating run with `… rooms A, B until tefilla-5` shortens by itself. In the editor every row has "Show: only while it starts before…", and its preview says "not today" when the rule hides it. Every row also has an On/Off switch: Off keeps the row, with its times and rooms, but takes the minyan off the board, the texts and the Today tab (in the text form the line gets `#off` in front); the Publish list reports it as "switched off".
A zman-based time starts from the zman as the zmanim list shows it (to the minute), so with chatzos at 12:40 `חצות-30` is 12:10.
Fixed and repeating rows mix freely; the Sunday Shacharis list is `7:30 לב אהרן`, then `every 15 from 8:00 to 11:15 rooms דברי יואל, ברך משה, שלמה יודא, לב אהרן`, then `11:30 היכל אדל`, `11:45 לב אהרן`, `12:00 דברי יואל` and `חצות-30 ברך משה`.
Day types fall back to a more general one when
empty (Sunday → weekday for the tefillos it has no list for, Rosh Chodesh → weekday, Yom Tov → Shabbos, Erev Yom Tov → Friday; Rosh Chodesh, Chanukah, a fast, Purim or Chol Hamoed that lands on a Sunday → the Sunday list). For Mincha and
Maariv a time like `6:45` means 6:45 PM (set per tefilla under General → Tefillos); `00:30` or `01:15` (as the time picker writes them) is a Maariv after midnight,
which still belongs to that night: it sorts at the end of the list and the board counts down to it past midnight. The cut-off is 4:00 AM ("Night cut-off" per tefilla).

## Shabbos and Yom Tov

The Schedule tab has a page for every kind of day. **Erev Shabbos (Friday)**, **Shabbos**, **Yom Tov**, **Erev Yom Tov** and **Yom Kippur** are the ones that matter here.

- **Shabbos** has lists of its own and follows no other day. **Yom Tov** uses Shabbos's lists for any tefilla it has no list of its own for, **Erev Yom Tov** uses Friday's, **Yom Kippur** uses Yom Tov's.
- Friday's Mincha is usually written from candle lighting (`candles+10 ברך משה`), Shabbos's Mincha and Maariv from sunset or nightfall (`sunset-25~5 …`, `sunset+50~5 …`, `rt …`), so they move by themselves through the year. For a winter and a summer that differ by more than that, use Extra schedules; for one particular Shabbos or Yom Tov, Special dates (one civil date, or "A calendar day, every year" for a Yom Tov by name: סוכות, שמחת תורה, שבועות …).
- **A Yom Tov on a Friday** keeps Yom Tov's Shacharis, and takes Erev Shabbos's Mincha and Maariv: Shabbos is coming in.
- Each tefilla on each of these pages has a small box, **"On Shabbos: …"** (or "On Yom Tov: …", and so on). In it:
  - **Its name on that day**: Friday's Maariv can be called קבלת שבת. A name belongs to its own kind of day only; Erev Yom Tov borrows Friday's times but not that name.
  - **The second time under each minyan** (the small הודו time of a weekday morning): as usual, none on that day, or one of its own with its name and how many minutes after the start (נשמת, 30). Yom Tov follows Shabbos here unless it is given its own.
- The little preview on every row is worked out for **the coming day of that kind** ("Sat Nov 14 4:10"), not for today, so a time that goes by the sun shows what it will really be. A special date with a civil date previews that date.
- **See the screen on …** at the top of each page opens Home on that day, so the screen can be looked at as it will be on the coming Shabbos or Yom Tov (Save first). Home's "Another day" also has a Yom Tov button, and under the picture Home says in words what that day's evening is (candle lighting and when, or when Shabbos or Yom Tov ends).
- The evening is told by what the next day is: candle lighting before sunset on Erev Shabbos and Erev Yom Tov, and on a Yom Tov that runs into Shabbos; candle lighting **after nightfall** on a Shabbos or Yom Tov that runs into Yom Tov (the second night, Motzaei Shabbos that is Yom Tov); and מוצאי שבת or מוצאי יום טוב only on the day whose nightfall really ends it. On the hallway screen that line stands in a band of its own above the three zmanim.
- The marks "last minyan for סוף זמן תפילה" and "last before חצות" are a weekday matter (they are reckoned at the weekday pace of davening) and are not shown on Shabbos or Yom Tov.

## Shere (the barber's hours)

The admin page's **Shere** tab sets the barber's hours and prices, and anyone who texts **שערן** (or another word listed there) to the shul's number gets the rest of this week back, in Yiddish:

```
שערן די וואך:
היינט, זונטאג ביז מיטוואך: פון 10:00 ביז 8:00, אויך קינדער
דאנערשטאג: פון 10:00 ביז 9:00, אויך קינדער
ערב שבת פרשת ויצא (י׳ כסלו): פון 8:00 ביז 12:00, אויך קינדער; פון 1:30 ביז 3:15, נישט פאר קינדער
פרייז: $15, קינדער $10
```

- **Regular hours**: Sunday to Friday, one day at a time (like the This week tab). A day can have more than one set of hours (Friday morning and afternoon), each with its own "kids too". Every from and until is a clock time or a zman with minutes before or after it (`sunset-30`, `sunrise+20`, `plag`); Friday's last "until" can be Automatic: a set number of minutes before candle lighting or sunset.
- **Calendar: special dates**: a month calendar with the Hebrew dates. Any date can get its own hours, price or note, or be closed; Shabbos and Yom Tov are closed by themselves and Erev Yom Tov is marked.
- **Prices**: a regular price and a kids' price, and a higher price before Yom Tov, from a number of days before it through Erev Yom Tov.
- It is off until "Answer these texts" is ticked; every other text is answered as before. The logic is `src/shere.js`, used by the admin preview and the text responder alike.

## Quick changes for today

The admin page is a full page of its own, styled like a phone app (navy header, gold for the one action that matters, big white cards and large controls; on a phone the sections are a bottom tab bar, the Schedule tab shows one tefilla at a time behind a switch, and minute boxes have − and + steppers). A sidebar lists its sections (Today, General, Schedule, Notices, Special dates, Publish, Backup), the header holds Save, Close and a "Saved …" / "Unsaved changes" marker, Ctrl+S (Cmd+S) saves, and the sidebar also offers "View the board" and "Lock". On a phone the sections become a scrolling strip under the header. Settings are grouped into cards (The board, Look and labels, Location and zmanim, Tefillos, Website and services, Security).

The admin page opens on a **This week** tab: a card for today and each of the next six days (with ערב שבת, שבת and the like marked), and for the chosen day its minyanim with a time box, a room picker and a Cancel button each, and an "+ Add for today" row per tefilla.
Move, cancel or add, then "Save today's changes". It is stored as a one-date special schedule (Special dates tab), so the regular
schedule is untouched and tomorrow is back to normal; "Back to the regular schedule for today" removes it. On a phone this is the
fastest way to say "Mincha is 5:30 today".

## Putting the website online (GitHub Pages, free)

1. Create a GitHub account and a new public repository, e.g. `minyan`.
2. Push this whole project to it (or upload `docs/` on its own; `minyan-site.zip` holds those files).
3. Repository Settings → Pages → Source: "Deploy from a branch", branch `main`, folder `/docs` (or `/ (root)` if you uploaded only the site files). The site appears at `https://USERNAME.github.io/minyan/` after a minute. With a custom domain, keep `docs/CNAME` (it holds the domain name) and point the domain's DNS at GitHub Pages.
4. On a phone, open that address: Android offers "Install app"; on iPhone use Share → "Add to Home Screen". The app works offline.

Editing: open `https://USERNAME.github.io/minyan/admin` (or `admin.html`) and enter the PIN (default 1234; change it under General, it is stored hashed). The public page has no edit button.

Letting the gabbai update everyone from the page: in GitHub create a fine-grained personal
access token (Settings → Developer settings → Fine-grained tokens) limited to that one
repository with "Contents: Read and write". On `admin.html`: Publish tab → fill in
`USERNAME/minyan`, branch `main`, path `docs/config.json` (or `config.json` for a root upload), paste the token, "Test connection". From then
on, Save keeps changes on the device and the Publish tab lists what differs from the website (schedule lines added or removed per day type, notices, special dates, settings); "Publish now", or the bar at the bottom of the admin, commits `config.json`, and the site and the apps pick it up within a few minutes. "Discard" goes back to the published version.
The token stays in that browser only. Without a token, Save only changes that device, and
the Backup tab gives you the JSON to upload as `config.json` by hand.

Any other static host works too (Netlify Drop: drag the `docs` folder). Then update
`config.json` by re-uploading it.

## Store app (Android / iOS) with Capacitor

`app/` is a Capacitor 8 project with the Android and iOS projects already generated and the
app icons and splash screens in place (app id `org.minyanboard.app`, name "מנינים").

1. Host the website first (above). Then build with the central schedule address:
   `node build.js --remote https://USERNAME.github.io/minyan/config.json`
2. `cd app && npm install && npx cap sync`
3. Android: `npx cap open android` (needs Android Studio) → Build → Generate Signed Bundle → upload to Play Console.
   iOS: `npx cap open ios` on a Mac with Xcode → set your Team → Product → Archive → upload to App Store Connect.

The app opens the website itself (`server.url` in `app/capacitor.config.json`, which `build.js` keeps in step with
the site address under General), so it always shows what the website shows: a change to the board, the look or the
schedule needs no new build of the app. Build and upload the app once; after that only a change to the app's own
name, icon or splash needs another build. On Android the site's offline copy keeps the board working without a
connection after the first opening; when the phone has no connection and no copy, the app shows `offline.html`, a
page that stands on its own, looks again by itself and opens the board when the connection is back. Inside the app
the site does not offer to "install the app".

## Next minyan by text message (SMS)

Anyone texts a word to the shul's number and gets the answer back:

| They text | They get |
|---|---|
| מנין / next / anything else | the next minyan with room, time, Hodu time and "in N min", plus the one after it |
| שחרית, מנחה, מעריב / shacharis, mincha, maariv | the remaining minyanim of that tefilla today (or tomorrow's) |
| היום / today, מחר / tomorrow | the whole remaining day, grouped by tefilla |
| זמנים / zmanim | today's zmanim |
| עזרה / help | the list of words |

Hebrew in → Hebrew reply; anything else → English labels (room names stay as configured).
The responder reads the same `config.json` as the website, so one Save updates the page, the app and the texts.

**Setup with Twilio (simplest, about $1.15/month for the number plus under a cent per text):**
1. twilio.com → buy a local number with SMS. For US numbers Twilio will ask you to register the number for
   business texting (A2P 10DLC); follow their form, it is a one-time step.
2. Functions and Assets → Services → Create Service → Add Function (path `/minyan`), paste the whole contents of
   `sms/docs/twilio-function.js`, set visibility to Protected, and under Environment Variables add
   `CONFIG_URL` = `https://USERNAME.github.io/minyan/config.json`. Deploy All.
3. Phone Numbers → your number → Messaging → "A message comes in": Function, pick the service and `/minyan`. Save.
4. Text "מנין" to the number. Enter the number under General → "SMS number" so the website shows it with a
   "שליחת הודעה" (send a message) button.

The same function works for WhatsApp through Twilio's WhatsApp sender.

**Reminders, daily texts, WhatsApp and app notifications** need the Cloudflare Worker version (`sms/dist/worker.js`,
free tier), which also answers the texts. People text `REMIND MINCHA 5:45 15` (15 minutes before the 5:45 Mincha),
`REMIND SHACHARIS` (the first Shacharis), `REMIND SHACHARIS LAST`, `REMIND SHACHARIS BEFORE CHATZOS` / `BEFORE TEFILLA` (the last one before
sof zman tefilla) / `BEFORE SHEMA`, `REMIND MINCHA BEFORE SUNSET` / `BEFORE MAARIV` (the last Mincha before zman Maariv), `REMIND MINCHA 5:45 TODAY`
(today only, dropped afterwards), `REMIND SHKIA 20` / `REMIND SHEMA 15` / `REMIND CHATZOS 30` (before a zman of the day), `DAILY 6:30` (the day's schedule every morning), `REMIND LIST`, `REMIND OFF`
(Hebrew: `תזכורת מנחה 5:45 15`, `תזכורת שקיעה 20`, `תזכורת סוף זמן ק״ש 15`, `תזכורת שחרית אחרון`, `תזכורת שחרית לפני חצות`, `תזכורת שחרית לפני סוף זמן תפילה`, `תזכורת מנחה לפני שקיעה`, `תזכורת מנחה 5:45 היום`, `יומי 6:30`, `תזכורות`, `ביטול`). The worker checks every 5 minutes what is due and sends it
through Twilio. Setup, free, from the Cloudflare dashboard (no computer needed):

1. Create a Cloudflare account at dash.cloudflare.com.
2. Workers & Pages → Create → Workers → "Import a repository" → connect GitHub and pick this repository.
3. Root directory `sms`, build command empty, deploy command `npx wrangler deploy` → Deploy. `sms/wrangler.toml` already
   carries the site address, the 5-minute schedule and the KV storage (created on the first deploy); the worker makes its own
   notification keys. Every later push to the repository redeploys it.
4. Copy the worker's address (`cascade-zmanim-notify.<account>.workers.dev`) into General → "Notification service address"
   (or `notifyUrl` in `config.default.json`).

For texting, add the Twilio secrets under the worker's Settings → Variables and Secrets (`TWILIO_ACCOUNT_SID`,
`TWILIO_AUTH_TOKEN`, `TWILIO_FROM`, optional `WA_FROM`, `WA_CONTENT_SID`) and point the Twilio number's webhook at the
worker address instead of the Twilio Function. From a computer with Node the same deploy is `cd sms && npx wrangler login && npx wrangler deploy`
(`node vapid-keys.js` + `wrangler secret put VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY` only if you prefer your own keys).
With the address entered under General → "Notification service address":
the website and the installed app then show a "Reminders on your phone" box (like the install button, this phone-settings box is in English; the board itself is Hebrew). App notifications are worded in English (room names as on the board). Each reminder row picks a tefilla, which minyan (first, last, last before sof zman Shema / tefilla / chatzos, last before sunset / zman Maariv, or any of today's times), the minutes before, and every day or today only. For a tefilla with a milestone, each reminder counts either to the start (ברכות) or to הודו, as the phone's "Big number" switch says unless changed on the reminder (by text: add the word HODU / הודו). A row can also name a zman of the day (sof zman Shema, chatzos, candle lighting, shkia, tzeis…) instead of a minyan. Tapping any minyan on the board, the מנין הבא box, the הזמן הבא box, or any zman in the zmanim list, opens the same choice for it where people pick the minyanim they want to be reminded
of (works on Android, and on iPhone once the site is added to the home screen).

WhatsApp: enable the WhatsApp sender on the Twilio number, set `WA_FROM` (`whatsapp:+1718…`); the same keywords work.
Messages the shul starts (reminders, the daily schedule) need an approved WhatsApp template: put its Content SID in
`WA_CONTENT_SID` with the text as variable {{1}}. Twilio cannot post to WhatsApp groups.

`sms/server.js` runs the plain responder on any Node host (`CONFIG_URL=... node sms/server.js`). The worker and the server
both answer `GET ?q=mincha` with plain text, handy for testing in a browser.

## Sending a notification

The admin page's Send tab sends a notification right now to every device that turned reminders on (title, up to 300 characters, with a preview and a "Test on this device" button). The notification service checks the admin PIN against the hash in `config.json` (ten wrong tries lock the address out for an hour); the optional `BROADCAST_KEY` secret on the worker is a second way in. Pick a longer PIN than four digits for this.

Rooms in General can be put in order with ◀ ▶: that order is used in the pickers and on the board when two minyanim start at the same time.

## Views

Same address, different screens (the `#` forms also work on the claude.ai page):

| View | Address | For |
|---|---|---|
| Hallway screen | `/screen` (or `screen.html`), `index.html?view=display` or `#display` | the TV in the hallway: three columns, no controls, nothing to scroll. A minyan is marked עכשיו for 20 minutes after it starts (General → "Minutes a minyan stays marked now"), then it drops off; on the normal board it is dimmed instead. See "The hallway screen on a TV" below |
| Door display | `index.html?room=ברך משה` or `#room1`, `#room2`… (order of the Rooms list) | a tablet at a room's door: that room's next minyan and its list |
| Weekly sheet | `index.html?view=week` or `#week` | this week and next, Sunday to Shabbos, with candle lighting, Shabbos end and every minyan; Print button |
| QR sign | `sign.html` | a printable sign with the site's QR code and the text number |
| Picture of the screen | `/tv` (or `tv.html`) | the whole hallway screen on whatever is in your hand: the real screen page in a frame the size of the TV (1080p, 720p or 4K), scaled so that all of it is in view both ways, with nothing to scroll. A phone held sideways shows nothing but the picture, and a tap on it lays the buttons over the top for a moment. **Full screen** takes the browser's bars away; on an upright phone it lays the picture on its side so it takes the phone's whole length. The screen's own address (`/screen`, `?view=display`) lands here on a phone, an upright tablet or any window too narrow or too low for the three columns, `&full=1` or not — the screen would be cut off there — and a day asked for (`&at=…`) goes along. The admin header has a TV link |
| Text service page | `sms.html` | how the texting works (also the opt-in page for the carriers) |

## The hallway screen on a TV

`index.html?view=display` is laid out like a shul's printed board, in three columns that never scroll:

- **No line across the top.** The whole screen goes to the minyanim, the clock and the sponsors; the time, with its seconds, is on the clock face. Hallway screen → "The top line" brings back a line with the day and the parsha, the Hebrew and civil date with any label (ראש חודש, ערב שבת…) and the running clock, for a shul that wants it.
- **The first tefilla of the day** (שחרית) has a frame to itself, with the whole day's minyanim as tiles: room, time and הודו. The tiles sit in the middle of the frame, and whatever height the frame has to spare is shared out between the rows rather than left at the bottom. A tile reads its state by colour: the next one green with הבא, the one before it light green (with עכשיו while it is within the minutes General gives it), the earlier ones light, and the rest, still to come, in the board's own colour. The last minyan that still reaches שמונה עשרה before סוף זמן תפילה is marked with a tab on its bottom edge reading סוף זמן תפילה, and the last one before חצות אחרון לחצות (the pace from הודו to שמונה עשרה is General → "Minutes from הודו to שמונה עשרה"). Under that frame is the next-minyan panel: the room on a line of its own, large, then the time and the countdown.
- **The middle** holds the big round clock at the top of the column — the shul's own mark on the dial, the running time and its seconds in a window on the face, the hands sweeping over both — with the sponsor frames (פרנס החודש and the like) stacked under it. A frame appears only when that notice has something in it for the day. **The clock is what gives up room.** On a day with a donation more than usual (a פרנס היום) the clock gets smaller, down to a floor, so the minyanim and the donations keep their size; the day after, it is back at its full size by itself. Only when the clock is at its floor and the column still does not fit does the whole screen shrink a little.
- **The rest of the day** (מנחה, מעריב) shares one frame, each tefilla named above its own tiles. A repeating line is written as one box with its rooms, "יעדע 10 מינוט · פון 6:15 ביז 7:55", instead of a tile for each minyan, so a long Maariv list stays readable: how often in gold, the two times as large as a tile's time, the rooms under them. The box wears the minyan tiles' colour (and follows it when it is changed), fades when the run is over, and the frame reads in clock order: tiles, then the run boxes, then any minyan that starts after the runs (a 12:00 Maariv). A minyan set at מנחה גדולה carries a tab saying so, like the tabs for סוף זמן תפילה and חצות. Under it are three zmanim: the one being counted to in the middle, the largest and marked with its countdown, with the one that has just gone (dimmed) on one side and the one after it on the other, each a size smaller and set in the middle of its tile. Once the day's are over they come from tomorrow.
- **In the Hallway look it wears the wall's stone.** A lit screen is far brighter than the wall beside it, so the same colour looks lighter on it. The screen therefore takes the stone a step deeper than the phone board does, and its boxes are a lighter cut of the same stone instead of near-white, with the clock face ivory so it still stands out. How light a colour comes out depends on the TV and the lamps around it, so both are set from the back end, in front of the TV (see the Hallway screen tab).
- **Full screen.** In a browser window that still shows its tabs and address bar, a "Full screen" button shows in the corner for a few seconds when the page opens and whenever the mouse moves or the screen is touched; pressing it fills the display. A browser only goes full screen at a press, so the page cannot do it by itself, and F11 on the TV's keyboard does the same and survives a reload.
- **It follows the back end within a minute or two.** A screen on the wall has nobody to refresh it, so it looks for newly published settings every minute; a phone looks every five.
- **It sizes itself to the TV.** Everything is measured from the screen's width and height, so a 60-inch TV and a 32-inch one show the same board and a 4K TV at full resolution is simply twice as sharp; the screen then takes the largest size that fits the day, so a crowded morning shrinks a little by itself. General → "Hallway screen (TV)" caps that size and `&size=80` in the address caps one screen.

## Extra schedules

A tab of its own, for a schedule that is not one of the twelve day types: a season, a week, or one kind of day done differently. Each one is a card with:

- **A name** (זומער שחרית, סליחות…), shown on the board in place of the day's usual label while it runs.
- **Which days it covers**: any day, or one of the day types, and optionally only certain days of the week.
- **From and until**, with a Hebrew date picker beside each civil box. Blank means always.
- **A priority**: when two cover the same day, the higher number wins.
- **An On switch**, so a schedule can be kept and switched off out of season.
- **Its own minyanim per tefilla**, in the same editor as the Schedule tab, with "Copy from…" to start from a day type. A tefilla left empty keeps the day's usual list.

A special date still beats an extra schedule, and an extra schedule beats the day type's own list.

## The Hallway screen tab

The admin has a tab of its own for the TV:

- **The clock.** A logo on the clock face, set between the 12 and the hands the way a watch carries its name; the hands sweep over it. Put the picture beside the website (`logo.png` in `docs/`) and write its name, or paste a web address; leave it empty and the face stays plain.
- **Background and boxes.** The colour behind everything, the colour of the boxes (the frames, the next-minyan panel, the sponsor panels) and the line around them. Each starts as the look's own colour. **Darker** and **Lighter** move it one step at a time, keeping the hue — press, save, and look at the TV a minute later; the colour box beside them takes any colour at all, and "Back to the look's own colours" clears the three.
- **Colours.** One row per kind of tile: minyanim still to come, the next one, the one before it, the earlier ones, and the top line when it is shown. Each has a colour and a writing colour. Tick one to use your own colour; leave it and that tile keeps the colour of the look chosen in General. "Back to the look's own colours" clears them all.
- **The top line.** Off: the screen has no line across the top. On: the day, the date and the time run across the top, and the rest makes room for it.
- **The next-minyan panel.** A switch takes it off the screen altogether, and the minyanim then have its room. **Minutes to stay on a minyan after it starts**: at 0 the panel moves on to the next minyan the moment one starts; at 5 it stays on the minyan that has just started for five minutes, headed עכשיו, with the next one named under it in place of the countdown, so someone a minute late still reads where it is (the latest to have started is the one held, so two minyanim two minutes apart each get their turn). **The countdown runs to** the time that stands large (as before), the start of the minyan, or the tefilla's second time (הודו) where it has one; the panel is on the minyan its countdown runs to, so run to הודו it stays on a shacharis until הודו while the tiles already mark the one after it, and "minutes to stay" count from where the countdown ended. One line per line of a template. `{tefilla}` `{room}` `{time}` `{milestone}` `{countdown}` `{day}` `{note}` are filled in; anything else is shown as written. A line's size follows the piece it carries: the room large, the time largest, the countdown red, plain words small. Buttons put a piece where the cursor is, and one button puts the usual lines back.
- **Which minyanim it shows.** The whole day from the first minyan to the last; only what is near (so many minutes ahead, and so many minutes after one starts); or **the next few and the last few, by number** (so many of each tefilla still to come, so many that have started). With "never leave the screen empty", a tefilla with nothing near still shows its next few. Under the settings, **On the screen now** tells what the screen lists at this very minute with the settings as they stand in the form, saved or not: each tefilla's minyanim as chips (the next one green, the started ones pale) and how many are left out.
- **How the tiles behave.** "Mark the next minyan only shortly before it starts": off, the next minyan is green with הבא all the time; on, only from so many minutes before it, and until then it looks like any minyan still to come (the next-minyan panel names it all along). "Seconds on each page": a frame turns pages only when a day has more minyanim than fit at the screen's smallest size, and then each page stays this long (8 unless changed).

## Another day's minyanim

Above the lists the board has a row of day chips: היום, מחר and the five days after, each with its Hebrew date. A tap shows that day's full schedule, with its own heading (the day, its date and which list it follows: ראש חודש, ערב שבת…), and the side panel shows that day's zmanim. The next-minyan box and the countdowns stay live. The choice is not remembered: a reload, or the next day, returns to today. The lobby screen and door displays have no chips.

## On a phone

The ⚙ in the header and the "Settings" button in the footer open one sheet with everything a person sets for themselves: the big number, the look, the labels, the countdown zmanim, reminders, "Check for updates" and an install guide with the steps for the device at hand (Safari on iPhone and iPad, Chrome on Android, a computer), or a one-tap Install button where the browser offers it; the footer's "Install the app" opens the same guide.

Below 640px the board shows one tefilla at a time behind tabs (the tab of the next minyan opens first), each minyan as a row, with the last three past minyanim kept in view (dimmed) and the older ones folded behind a button. Tablets keep the tile grid, with the same fold for past minyanim; the lobby screen and door displays hide past minyanim outright. Under the next-minyan box, three small cards show the minyanim after it, tomorrow's first Shacharis included once the day runs out; they can be tapped for a reminder like a tile.

## Labels in Hebrew or Yiddish

General → "Board labels" picks Hebrew (היום, מחר, מנין הבא, יום ראשון…) or Yiddish; a person may also put the Settings sheet, the reminder box and the install guide in English (Settings → "Settings language"), while the board itself keeps its Hebrew or Yiddish (היינט, מארגן, זונטאג…) for the board's own words; the headings מנין הבא and הזמן הבא stay in Hebrew in both; room names, tefillos and zmanim stay as entered. The lobby screen and door displays always use that choice; a "Labels" switch in the footer lets each phone pick its own.

In the zmanim list, a zman that has passed keeps today's time, shown dimmed; tapping it sets a reminder for tomorrow's.

## Looks

Four palettes: **Hallway** (the lobby itself: limestone walls, polished brass, and the warm brown of the doors, the mouldings and the screen's own frame — the default), **Shul** (light stone and pale oak, brass, charcoal, the burgundy of the paroches), **Classic** (parchment and navy) and **High contrast** (black on white, larger type). General → Colors sets the default, which the lobby screen and door displays always use; a "Look" switch in the footer lets each phone pick its own. Dark mode follows the phone's setting with darker shades of the chosen palette. The icon and the share image use the shul palette.

## Calendar

- The big number on a Shacharis tile is the start (ברכות) by default; the "Big number" switch in Settings lets each phone show הודו big instead (then the countdown and "next minyan" follow הודו). General → "Big number on the tiles" sets the board's default; each tefilla has a "name of the start" for the small line.
- Mincha gedola: General → Location and zmanim picks how it is counted after chatzos: the Magen Avraham way (half a proportional hour of the day from dawn to nightfall, 72 minutes each side; this shul's setting), the later of 30 clock minutes and half a sunrise-to-sunset hour (the default), or one of those two alone.
- The zmanim list can show the board's nightfall (צאת הכוכבים, General → Nightfall), 60 מינוט אחר השקיעה and ר״ת (72); General has a switch for each. ר״ת (72) is left out automatically while nightfall itself is 72 minutes and צאת הכוכבים is shown. A second box, הזמן הבא, counts down to the next important zman of the day (default: sof zman Shema, sof zman tefilla, candle lighting, shkia; General → "Countdown box" picks the set). It turns red in the last 30 minutes and disappears when none is left. Everyone can pick their own set on their phone (the ⚙ on the box, or "Countdown zmanim" in the footer); the General-tab set is the default.
- Once all of today's minyanim of a tefilla are over (for Shacharis, around chatzos), that section shows tomorrow's list, headed מחר with the day's name; the lobby screen does the same.
- The civil date next to the Hebrew date is written Month/Day/Year in US time zones (General → "Civil date" switches to Day.Month.Year or Year-Month-Day).

- Fast days show when the fast begins and ends; Shabbos and Yom Tov show when they end, on the day they really end (see "Shabbos and Yom Tov" above); during Sefirah the board shows the count (tonight's after sunset).
- Special dates (Edit → Special dates) can be one civil date, a Hebrew date every year, or a calendar day every year (Chol Hamoed Sukkos, Purim, Tisha B'Av, Rosh Chodesh…).
- Categories (Edit → General → "+ Add category"): a shiur or event list such as Daf Yomi appears on the board and in text replies ("today", or the category's name) but is never the "next minyan".

## Board extras

- **How fast a publish reaches everyone**: the website within about two minutes (GitHub Pages builds it); the installed app and the lobby screens the next time they check, every five minutes and whenever the app comes back to the front; the text replies within a minute or two.
- **How a new version of the board itself reaches a phone**: the page looks for one the moment it opens, every five minutes, when it comes back to the front and when the phone comes back online. A new version takes every file straight from the network (the host lets a browser keep a file for ten minutes, and a version built from those kept files would be the old one under a new name), then the page reloads by itself onto it. "Check for updates" in Settings does the same on demand. Both fetch the schedule with an address that changes by the minute, so the site's CDN copy (kept up to ten minutes) is passed by. An open back end with nothing unsaved reloads onto the new version too, so it is never left running an old page for hours; with something unsaved it says so and loads the new version after the next Save.
- **Texting, the language**: General → "Text replies are written in" picks לשון קודש always, English always, or the sender's language (the default). HELP is always answered in the sender's language, as the carriers expect.
- **The last minyan before sof zman Shema / sof zman tefilla / chatzos** (reminder picks, on the board and by text): the last minyan whose הודו is 15 minutes before the zman, so that the davening is said in time. The 15 is General → "Minutes from הודו to שמונה עשרה". Sunset and nightfall picks go by the start time.
- **Texting, the last minyan**: a text that arrives after a minyan has begun, but 3 minutes or more before its הודו (the tefilla's milestone), gets that minyan first as מנין העבר, since one can still run for it, and then the next two. Tefillos without a milestone have no such window.
- **Temporary banner** (Edit → Notices): one line across the top of the board, and at the start of text replies. Give it a start time and it appears by itself at that time (the night before a clock change, say); give it an end time and it disappears by itself. Either may be blank.
- **Home** (the page the back end opens on): the hallway screen itself, in a frame the shape of the TV. **Now** is live. **Another day** shows the same screen as it will be on any day and at any time of day — the day chosen in Hebrew or civil boxes, or with one press for tomorrow, Friday, Shabbos or the next Rosh Chodesh — with that day's schedule, zmanim and donations, and under the picture the same in words: the day, which schedule is in use, the donations on the board, the banner. It shows what is saved on this device, published or not, and says so when there are changes not yet saved. The screen takes the moment from its address (`…?view=display&at=2026-12-05T08:30`, the shul's own clock); opened by itself, such a screen is marked as a preview so it is never taken for today's. The picture is fitted to its frame whenever the frame changes size, and a tap on it (or "Open full size") opens it large.
- **The back end as a shortcut of its own.** The back end's page gives the browser its own install details (`admin.webmanifest`: the name "Back end", a navy icon with a gear, and the back end as the address it opens at), so "Install", "Create shortcut" or "Add to Home Screen" from the back end makes a shortcut that opens the back end, not the board. The two can be installed side by side. In the back end, **Shortcut on this device** (side menu; on a phone, at the foot of Home) does it in one tap where the browser allows, and otherwise gives the steps for the device at hand, with the address to paste for a plain desktop shortcut. The icons are made by `node assets/make-admin-icons.js`.
- **Donations** (the back end's own page for them): a card for each donation with its number, the donor, the kind, its Hebrew first and last day and whether it is on the board, coming up or finished; a search box, filters with counts, and three orders. **Add donation** opens a form over the page: the kind, the name, "in honor of", and the days — one press for this month or the next (this week, next week; today, tomorrow), or any Hebrew or civil date — with the panel shown beside it exactly as the board will draw it. A donation goes on the board by itself on its first day and leaves after its last. Edit, Copy (the same donor for another period) and Remove are on each card; Remove asks first. Saving a donation saves at once, and publishes as well where the website is connected. **Each card has an On/Off switch**: off keeps the donation in the list with everything it holds and takes it off the board and the screen until it is switched on again (a "Switched off" filter appears while any are off); where the website is connected the switch publishes straight away. **The two days are chosen in a calendar that opens on the Hebrew month**: each day shows its Hebrew date large and its civil date small, Shabbos carries its parsha, and Rosh Chodesh, Yom Tov, Chol Hamoed, Chanukah, Purim and the fasts are named and coloured; a line under it spells out the day the pointer or the keyboard is on (day of the week, Hebrew date, the occasion, the week's parsha, the civil date). Arrows and a list of months move through it, "Today" comes back, "Civil months" shows the same days by the civil month, the first day chosen leads straight on to the last, days before the first are shut while the last is chosen, and "No first day" / "No last day" leave an end open. **A donation for part of a day**: with "All day" switched off a donation takes a time on its first day and a time on its last, and the board shows it only between them, to the minute (the days between are whole); its card carries the hours, and an end time before the start time on the same day, or a time left empty, is refused beside the dates.
- **Kinds of donation** ("Kinds…" on that page): פרנס החודש, נר למאור, פרנס השבוע and פרנס היום to begin with, and any the shul adds. A kind holds how its panel reads — the words at the top (`{month}` and `{parsha}` are filled in from the first day), its size on the screen, the line that leads into the name, and how long it usually runs — so a donation needs only a name and a period. The order of the kinds is the order their panels stand in on the board; changing a kind's size or wording changes every donation of that kind that has not been given its own. Every kind starts at the large size, so that a donation reads from the hallway whichever kind it is; a smaller size can be chosen for a kind or for one donation.
- **How a sponsor panel reads**: the name is set large, with the titles around it — מו״ה, הרה״ח, ב״ר, מרת, הי״ו, ע״ה and their like — picked out and set small, in the lines under the name as well, so the name carries the panel. Under "More options" a donation may have a line above the name (נתנדב לעילוי נשמת and its like), its own words at the top, its own size, and a picture beside the name — a sponsor's own mark, such as a business logo, which stands in a column of its own at the side so the name stays in the middle of the panel.
- **On the board (the website and the app)** the panels stand one above the other in the same order as on the hallway screen — פרנס החודש first, the smaller kinds under it — at every width. Each panel sets its type by its own width, so on a phone the name still reads on one line with its titles small around it, and a line too long for the panel breaks into even halves. A sponsor's mark stands beside the name where the panel is wide enough and under the name, in the middle, on a phone.
- **Two hands on the settings**: every page remembers which published version its settings grew from. If the website has moved on since — another phone, another tab, an older page left open — **Publish stops and asks** instead of quietly undoing that work: it lists what publishing from here would change, and offers "Take the newer settings" (what was saved on this device goes to Previous versions), "Publish mine anyway" or Cancel. An open back end with nothing unsaved simply loads newer settings as they arrive; with something typed it keeps what was typed and says so. Newer settings never open the back end past the PIN box. A save is always stamped later than anything the page has seen, so a phone whose clock runs behind another's still publishes a change every board will take.
- **Undo** (Edit → Backup → Previous versions): every Save made on a device keeps the version before it; Restore loads it into the editor.

## Notes

- Location defaults to Williamsburg, Brooklyn (set exact coordinates under General); candle lighting 15 minutes before sunset and nightfall 72 minutes after sunset as saved on the live page, all adjustable.
- Verified: calendar, SMS and browser tests, offline mode, the SMS webhook replying over HTTP, and saving inside the claude.ai viewer. Not verified: GitHub publishing against a real repository, the native builds, and a real Twilio number.
- The PIN (default 1234) guards `admin.html`; it is stored as a hash in the config. Changing what everyone sees also needs the GitHub token, which stays on the device that entered it. The store app has no admin at all.
