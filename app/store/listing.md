# Store listing — Minyan Board

Replace **[Shul name]** everywhere with the name you want shown in the stores.
Character limits are the stores' own; every line below fits them.

## App Store (Apple)

| Field | Text |
|---|---|
| Name (30) | Minyan Board – [Shul name] |
| Subtitle (30) | Next minyan, live countdown |
| Promotional text (170) | Know the next minyan before you leave the house: live countdown, every room, today's zmanim. |
| Keywords (100) | minyan,shul,davening,zmanim,shacharis,mincha,maariv,synagogue,prayer,times,jewish,luach,tefillah |
| Category | Lifestyle (secondary: Reference) |
| Age rating | 4+ |
| Support URL | your website address |
| Privacy policy URL | your website address, or the privacy page text below hosted on it |
| Price | Free |

**Description (4000):**

Minyan Board shows you the next minyan at [Shul name] the moment you open it, with a live countdown, the room, and the time of Hodu.

• Next minyan at a glance, with a countdown to the second
• Every Shacharis, Mincha and Maariv minyan, room by room, with Hodu and Shemoneh Esrei times
• The right schedule for the day, automatically: weekdays, Erev Shabbos, Shabbos, Yom Tov, Chol Hamoed, Rosh Chodesh, fast days, Chanukah and Purim
• The Hebrew date, the parsha of the week and the day's special occasions
• Today's zmanim: sunrise, sof zman Krias Shema, chatzos, plag, candle lighting, sunset and nightfall
• Shul announcements and sponsors
• Works without a connection and updates itself whenever the shul changes the schedule

The schedule is maintained by the shul. Minyan times that depend on sunset or chatzos are recalculated every day for the shul's location.

Free, no ads, no sign-up, nothing tracked.

**What's new (first release):** First release: next-minyan countdown, full room schedule, zmanim and offline support.

## Google Play

| Field | Text |
|---|---|
| App name (30) | Minyan Board – [Shul name] |
| Short description (80) | The next minyan at [Shul name]: live countdown, every room, today's zmanim. |
| Category | Lifestyle |
| Content rating | Everyone (complete the questionnaire: no user content, no ads, no data) |
| Contact email | the shul's email |
| Data safety | No data collected, no data shared. The app only downloads the shul's public schedule file. |

**Full description (4000):** same text as the App Store description above.

## Hebrew localization (optional, both stores)

| Field | Text |
|---|---|
| Name | לוח המנינים – [שם בית המדרש] |
| Subtitle / short description | המנין הבא, ספירה לאחור, כל החדרים וזמני היום |
| Keywords | מנין,מנינים,בית מדרש,זמנים,שחרית,מנחה,מעריב,תפילה,לוח,זמני היום |

**Description:**

לוח המנינים מראה את המנין הבא ב[שם בית המדרש] ברגע שפותחים את האפליקציה, עם ספירה לאחור, החדר וזמן הודו.

• המנין הבא במבט אחד, עם ספירה לאחור
• כל מניני שחרית, מנחה ומעריב, חדר אחרי חדר, עם זמני הודו ושמונה עשרה
• הלוח הנכון לכל יום, אוטומטית: ימי חול, ערב שבת, שבת, יום טוב, חול המועד, ראש חודש, תעניות, חנוכה ופורים
• התאריך העברי, פרשת השבוע והמאורעות של היום
• זמני היום: נץ החמה, סוף זמן קריאת שמע, חצות, פלג המנחה, הדלקת נרות, שקיעה וצאת הכוכבים
• הודעות ופרנסים
• עובד גם בלי קליטה ומתעדכן מעצמו כשבית המדרש משנה את הלוח

חינם, בלי פרסומות, בלי הרשמה ובלי מעקב.

## Privacy policy (host this text on the website, e.g. docs/privacy.html, and link it in both stores)

Minyan Board – [Shul name] does not collect, store or share any personal information. The app downloads the shul's public prayer schedule and computes times on your device. It uses no analytics, no advertising and no accounts. Questions: [shul email].

## Screenshots and graphics (generated in this folder)

- `ios-6.7-*.png` — 1290×2796, for the iPhone 6.7" slot (Apple scales it to the smaller sizes). Set the Xcode target to iPhone only, otherwise Apple also asks for iPad screenshots.
- `android-phone-*.png` — 1080×2340 phone screenshots (Play needs at least 2).
- `android-feature-graphic.png` — 1024×500, required by Play.
- App icon: the stores take it from the app build; `docs/icon-512.png` is the same 512×512 icon for the Play listing.
