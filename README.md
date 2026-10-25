# Cascade Zmanim — minyan board: website + app

Published as **Cascade Zmanim**, a privately run service: the shul's name appears nowhere in the app (the name comes from General → Name).

Shows the next minyan with a live countdown, every room's Shacharis / Mincha / Maariv
minyanim (with the Hodu / Shemoneh Esrei time), the Hebrew date, the parsha of the week,
holidays and today's zmanim. The board itself is in Hebrew and has no editing controls. The gabbai edits everything from a separate admin page in English: `admin.html` on the self-hosted site (PIN), or the claude.ai link with `#admin` added (owner only).

Three ways to use it, all from the same code:

| What | Where | Editing |
|---|---|---|
| Shareable page | https://claude.ai/artifact/5CiKzUDtdy3eTAeNzQrqwA | Owner opens the link with `#admin`, saves for everyone |
| Website + installable app (PWA) | `docs/` on any static host (GitHub Pages, Netlify…) | `admin.html` (PIN) → publishes `config.json` to GitHub |
| App Store / Play Store app | `app/` (Capacitor, Android + iOS projects) | Reads the website's `config.json` |
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
A zman-based time starts from the zman as the zmanim list shows it (to the minute), so with chatzos at 12:40 `חצות-30` is 12:10.
Fixed and repeating rows mix freely; the Sunday Shacharis list is `7:30 לב אהרן`, then `every 15 from 8:00 to 11:15 rooms דברי יואל, ברך משה, שלמה יודא, לב אהרן`, then `11:30 היכל אדל`, `11:45 לב אהרן`, `12:00 דברי יואל` and `חצות-30 ברך משה`.
Day types fall back to a more general one when
empty (Sunday → weekday for the tefillos it has no list for, Rosh Chodesh → weekday, Yom Tov → Shabbos, Erev Yom Tov → Friday). For Mincha and
Maariv a time like `6:45` means 6:45 PM (set per tefilla under General → Tefillos); `00:30` or `01:15` (as the time picker writes them) is a Maariv after midnight,
which still belongs to that night: it sorts at the end of the list and the board counts down to it past midnight. The cut-off is 4:00 AM ("Night cut-off" per tefilla).

## Quick changes for today

The admin page opens on a **Today** tab: today's minyanim with a time box, a room picker and a Cancel button each, and an "+ Add for today" row per tefilla.
Move, cancel or add, then "Save today's changes". It is stored as a one-date special schedule (Special dates tab), so the regular
schedule is untouched and tomorrow is back to normal; "Back to the regular schedule for today" removes it. On a phone this is the
fastest way to say "Mincha is 5:30 today".

## Putting the website online (GitHub Pages, free)

1. Create a GitHub account and a new public repository, e.g. `minyan`.
2. Push this whole project to it (or upload `docs/` on its own; `minyan-site.zip` holds those files).
3. Repository Settings → Pages → Source: "Deploy from a branch", branch `main`, folder `/docs` (or `/ (root)` if you uploaded only the site files). The site appears at `https://USERNAME.github.io/minyan/` after a minute. With a custom domain, keep `docs/CNAME` (it holds the domain name) and point the domain's DNS at GitHub Pages.
4. On a phone, open that address: Android offers "Install app"; on iPhone use Share → "Add to Home Screen". The app works offline.

Editing: open `https://USERNAME.github.io/minyan/admin.html` and enter the PIN (default 1234; change it under General, it is stored hashed). The public page has no edit button.

Letting the gabbai update everyone from the page: in GitHub create a fine-grained personal
access token (Settings → Developer settings → Fine-grained tokens) limited to that one
repository with "Contents: Read and write". On `admin.html`: Publish tab → fill in
`USERNAME/minyan`, branch `main`, path `docs/config.json` (or `config.json` for a root upload), paste the token, "Test connection". From then
on every Save commits `config.json`; the site and the apps pick it up within a few minutes.
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

The app bundles the site for instant offline start and refreshes the schedule from the
website every 15 minutes and whenever it is opened.

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

## Views

Same address, different screens (the `#` forms also work on the claude.ai page):

| View | Address | For |
|---|---|---|
| Lobby screen | `index.html?view=display` or `#display` | the TV in the lobby: large tiles, no controls. A minyan is marked עכשיו for 20 minutes after it starts (General → "Minutes a minyan stays marked now"), then it drops off; on the normal board it is dimmed instead |
| Door display | `index.html?room=ברך משה` or `#room1`, `#room2`… (order of the Rooms list) | a tablet at a room's door: that room's next minyan and its list |
| Weekly sheet | `index.html?view=week` or `#week` | this week and next, Sunday to Shabbos, with candle lighting, Shabbos end and every minyan; Print button |
| QR sign | `sign.html` | a printable sign with the site's QR code and the text number |
| Text service page | `sms.html` | how the texting works (also the opt-in page for the carriers) |

## Calendar

- The big number on a Shacharis tile is the start (ברכות) by default; a "Big number" switch in the footer lets each phone show הודו big instead (then the countdown and "next minyan" follow הודו). General → "Big number on the tiles" sets the board's default; each tefilla has a "name of the start" for the small line.
- The zmanim list shows the board's nightfall (צאת הכוכבים, General → Nightfall), צאת (60) and ר״ת (72); General has a switch for each of the last two, and ר״ת (72) is left out automatically while nightfall itself is set to 72 minutes. A second box, הזמן הבא, counts down to the next important zman of the day (default: sof zman Shema, sof zman tefilla, candle lighting, shkia; General → "Countdown box" picks the set). It turns red in the last 30 minutes and disappears when none is left. Everyone can pick their own set on their phone (the ⚙ on the box, or "Countdown zmanim" in the footer); the General-tab set is the default.
- Once all of today's minyanim of a tefilla are over (for Shacharis, around chatzos), that section shows tomorrow's list, headed מחר with the day's name; the lobby screen does the same.
- The civil date next to the Hebrew date is written Month/Day/Year in US time zones (General → "Civil date" switches to Day.Month.Year or Year-Month-Day).

- Fast days show when the fast begins and ends; Shabbos and Yom Tov show when they end; during Sefirah the board shows the count (tonight's after sunset).
- Special dates (Edit → Special dates) can be one civil date, a Hebrew date every year, or a calendar day every year (Chol Hamoed Sukkos, Purim, Tisha B'Av, Rosh Chodesh…).
- Categories (Edit → General → "+ Add category"): a shiur or event list such as Daf Yomi appears on the board and in text replies ("today", or the category's name) but is never the "next minyan".

## Board extras

- **Temporary banner** (Edit → Notices): one line across the top of the board, and at the start of text replies, until the time you set.
- **Sponsor dates**: each notice can have "show from" and "show until" dates; several entries with the same title form a queue.
- **Undo** (Edit → Backup → Previous versions): every Save made on a device keeps the version before it; Restore loads it into the editor.

## Notes

- Location defaults to Williamsburg, Brooklyn (set exact coordinates under General); candle lighting 15 minutes before sunset and nightfall 72 minutes after sunset as saved on the live page, all adjustable.
- Verified: calendar, SMS and browser tests, offline mode, the SMS webhook replying over HTTP, and saving inside the claude.ai viewer. Not verified: GitHub publishing against a real repository, the native builds, and a real Twilio number.
- The PIN (default 1234) guards `admin.html`; it is stored as a hash in the config. Changing what everyone sees also needs the GitHub token, which stays on the device that entered it. The store app has no admin at all.
