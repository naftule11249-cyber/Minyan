/* app.js — minyan board: schedule engine, rendering, admin panel, persistence. Needs cal.js and template.js. */
(function () {
  'use strict';
  function $(sel, root) { return (root || document).querySelector(sel); }
  function el(tag, attrs, children) {
    var e = document.createElement(tag), k;
    if (attrs) for (k in attrs) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'text') e.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    }
    if (children) children.forEach(function (c) { if (c != null) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  var cfg = {}, mode = 'static', inArtifact = false, artifactNs = null, canEdit = false, pinOk = false, ui = {}, deferredInstall = null;
  /* Which view this URL asks for: ?view=display | ?room=NAME | ?view=week, or #display | #room1..#roomN | #week (hashes work on the claude.ai page too). */
  function currentView() {
    var q = {}, h = (location.hash || '').replace(/^#/, ''), m;
    try { location.search.replace(/^\?/, '').split('&').forEach(function (kv) { var p = kv.split('='); if (p[0]) q[decodeURIComponent(p[0])] = decodeURIComponent((p[1] || '').replace(/\+/g, ' ')); }); } catch (e) {}
    if (q.room) return { kind: 'room', room: q.room };
    if (q.view === 'display' || h === 'display') return { kind: 'display', size: +q.size || 0, full: !!q.full }; /* &size=120: this screen only, in percent; &full=1: even on a phone */
    if (q.view === 'week' || h === 'week') return { kind: 'week' };
    m = /^room(\d+)$/.exec(h);
    if (m) { var rooms = (cfg.rooms || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean); if (rooms[+m[1] - 1]) return { kind: 'room', room: rooms[+m[1] - 1] }; }
    return { kind: 'board' };
  }

  /* ---------- schedule engine (engine.js) ---------- */
  var engine = null;
  var TEFILLA_DEFAULTS = MinyanEngine.TEFILLA_DEFAULTS, FALLBACK = MinyanEngine.FALLBACK, TYPE_NAME = MinyanEngine.TYPE_NAME, TYPE_EN = MinyanEngine.TYPE_NAME_EN;
  var sameEntry = MinyanEngine.sameEntry, gregStr = MinyanEngine.gregStr, parseLine = MinyanEngine.parseLine;
  function setCfg(c) { cfg = (c && typeof c === 'object') ? c : {}; cfg.location = cfg.location || {}; engine = MinyanEngine(cfg); applyLook(); }
  /* looks: the palette chosen in General is the default and what the lobby screen and door displays always use; each phone may pick its own in the footer */
  var LOOKS = [['hallway', 'Hallway'], ['shul', 'Shul'], ['classic', 'Classic'], ['contrast', 'High contrast']], LOOK_BAND = { hallway: '#4a3a28', shul: '#3a332c', classic: '#223b68', contrast: '#000000' };
  function isLook(v) { return LOOKS.some(function (l) { return l[0] === v; }); }
  function lookDefault() { return isLook(cfg.palette) ? cfg.palette : 'shul'; }
  function lookMode() {
    var view = currentView(); if (view.kind === 'display' || view.kind === 'room') return lookDefault();
    var v = null; try { v = localStorage.getItem('minyan-look'); } catch (e) {}
    return isLook(v) ? v : lookDefault();
  }
  function applyLook() {
    if (typeof document === 'undefined') return;
    var root = document.documentElement, look = lookMode();
    if (look === 'classic') root.removeAttribute('data-palette'); else root.setAttribute('data-palette', look);
    /* the browser's own bar wears the board's band; on the back end's own page it stays the back end's navy, the colour its shortcut opens in */
    var meta = document.querySelector('meta[name="theme-color"]'); if (meta && !document.querySelector('meta[name="minyan-page"][content="admin"]')) meta.setAttribute('content', LOOK_BAND[look]);
  }
  function loc() { return engine.loc(); }
  function zmanimFor(rd) { return engine.zmanimFor(rd); }
  function resolveMin(spec, rd, type) { return engine.resolveMin(spec, rd, type); }
  function expandLine(p, rd, type) { return engine.expand(p, rd, type); }
  function tefillos() { return engine.tefillos(); }
  function scheduleFor(rd) {
    var s = engine.scheduleFor(rd);
    if (!ui.roomFilter) return s;
    var out = { rd: s.rd, info: s.info, type: s.type, override: s.override, byTefilla: {}, all: [] };
    Object.keys(s.byTefilla).forEach(function (id) { out.byTefilla[id] = s.byTefilla[id].filter(function (e) { return e.room === ui.roomFilter; }); out.all = out.all.concat(out.byTefilla[id]); });
    out.all.sort(function (a, b) { return a.start - b.start; });
    return out;
  }
  /* Which number is big on a tile: the start (ברכות) or the milestone (הודו). The board's default is cfg.bigTime; each device may pick its own. */
  function bigMode() { var v = null; try { v = localStorage.getItem('minyan-big'); } catch (e) {} if (v !== 'milestone' && v !== 'start') v = cfg.bigTime === 'milestone' ? 'milestone' : 'start'; return v; }
  function bigIsMilestone(t) { return !!t.milestone && bigMode() === 'milestone'; }
  function startLabel(t) { return t.startLabel || (t.id === 'shacharis' ? 'ברכות' : 'התחלה'); }
  /* the moment a minyan counts from: its start, or its milestone when that is the big number */
  function keyMs(e) { return bigIsMilestone(e.tefilla) ? e.ms + (+e.tefilla.offset || 0) * 60000 : e.ms; }
  /* the zman countdown box: the next of the chosen zmanim still ahead today */
  var COUNTDOWN_DEFAULT = ['shema', 'tefilla', 'candles', 'sunset'], COUNTDOWN_KEYS = ['shemaMGA', 'shema', 'tefillaMGA', 'tefilla', 'chatzos', 'minchag', 'minchak', 'candles', 'sunset', 'tzeis', 'tzeis60', 'tzeis72'];
  /* ר״ת (72) is the same moment as the board's nightfall when that is set to 72 minutes: then it is left out everywhere */
  function rtSame() { return +cfg.tzeisMinutes === 72 && cfg.showTzeis !== false; }
  function zmanHidden(k) { return (k === 'tzeis' && cfg.showTzeis === false) || (k === 'tzeis72' && (!cfg.showRT || rtSame())) || (k === 'tzeis60' && cfg.show60 === false); }
  function countdownKeysOf(c) { return Array.isArray(c.countdownZmanim) ? c.countdownZmanim : COUNTDOWN_DEFAULT; }
  /* each device may choose its own set; the board's set (General tab) is the default */
  function countdownKeys() { var v = null; try { v = JSON.parse(localStorage.getItem('minyan-countdown') || 'null'); } catch (e) {} return Array.isArray(v) ? v : countdownKeysOf(cfg); }
  function openCountdownChooser() {
    var old = $('#zc-overlay'); if (old) old.remove();
    var cur = countdownKeys(), boxes = {}, ov = el('div', { class: 'overlay modal', id: 'zc-overlay', dir: sheetDir() });
    function close() { ov.remove(); }
    var list = el('div', { class: 'col' }, COUNTDOWN_KEYS.filter(function (k) { return !zmanHidden(k); }).map(function (k) { var c = el('input', { type: 'checkbox', id: 'zc-' + k }); c.checked = cur.indexOf(k) >= 0; boxes[k] = c; return el('label', { for: 'zc-' + k, class: 'push-row' }, [c, ' ' + zmanName(k, SU())]); }));
    ov.appendChild(el('div', { class: 'panel small' }, [el('h2', { text: SU().cdTitle }), el('p', { class: 'hint', text: SU().cdChooserHint }), list,
      el('div', { class: 'bar' }, [el('button', { type: 'button', class: 'btn', id: 'zc-default', text: SU().boardDefault, onclick: function () { try { localStorage.removeItem('minyan-countdown'); } catch (e) {} close(); render(); } }), el('button', { type: 'button', class: 'btn', id: 'zc-cancel', text: SU().cancel, onclick: close }),
        el('button', { type: 'button', class: 'btn primary', id: 'zc-save', text: SU().save, onclick: function () { var sel = COUNTDOWN_KEYS.filter(function (k) { return boxes[k] && boxes[k].checked; }); try { localStorage.setItem('minyan-countdown', JSON.stringify(sel)); } catch (e) {} close(); render(); } })])]));
    ov.addEventListener('click', function (ev) { if (ev.target === ov) close(); });
    document.body.appendChild(ov);
  }
  function nextZman(info, z, rd, now) {
    var tz = loc().tz, best = null;
    countdownKeys().forEach(function (k) {
      if (k === 'candles' && info.candles !== 'day') return;
      if (zmanHidden(k)) return;
      var v = z[k]; if (v == null || isNaN(v)) return;
      var ms = Cal.epochFromWall(rd, Math.round(v), tz);
      if (ms > now && (!best || ms < best.ms)) best = { key: k, min: v, ms: ms };
    });
    return best;
  }
  /* the zmanim after the next one, in the day's order (the lobby's next-zman box lists a few) */
  function laterZmanim(info, z, rd, afterMs, n) {
    var tz = loc().tz, out = [];
    ['alos', 'sunrise', 'shemaMGA', 'shema', 'tefillaMGA', 'tefilla', 'chatzos', 'minchag', 'minchak', 'candles', 'sunset', 'tzeis60', 'tzeis', 'tzeis72', 'chatzosNight'].forEach(function (k) {
      if (k === 'candles' && info.candles !== 'day') return;
      if (zmanHidden(k)) return;
      var v = z[k]; if (v == null || isNaN(v)) return;
      var ms = Cal.epochFromWall(rd, Math.round(v), tz);
      if (ms > afterMs) out.push({ key: k, min: v, ms: ms });
    });
    out.sort(function (a, b) { return a.ms - b.ms; });
    return out.slice(0, n);
  }
  function upcoming(nowMs, nowRd) {
    if (!ui.roomFilter && bigMode() !== 'milestone') return engine.upcoming(nowMs, nowRd);
    var i, j, s;
    for (i = -1; i < 10; i++) { s = scheduleFor(nowRd + i); /* from yesterday: a Maariv after midnight is still ahead */ for (j = 0; j < s.all.length; j++) if (keyMs(s.all[j]) > nowMs && s.all[j].tefilla.kind !== 'event') return { entry: s.all[j], sched: s, daysAhead: i }; }
    return null;
  }
  /* What the hallway screen's countdown runs to (Hallway screen → The next-minyan panel): the time that stands large, the start, or
     the tefilla's second time (הודו) where it has one. The panel is on the minyan its countdown runs to, so with הודו chosen it
     stays on a minyan until הודו, though the tiles already mark the one after it as next. */
  function countMs(e) {
    if (cfg.countTo === 'start') return e.ms;
    if (cfg.countTo === 'milestone' && e.tefilla.milestone) return e.ms + (+e.tefilla.offset || 0) * 60000;
    return keyMs(e);
  }
  function upcomingBy(fn, nowMs, nowRd) {
    var i, j, s;
    for (i = -1; i < 10; i++) { s = scheduleFor(nowRd + i); for (j = 0; j < s.all.length; j++) if (s.all[j].tefilla.kind !== 'event' && fn(s.all[j]) > nowMs) return { entry: s.all[j], sched: s, daysAhead: i }; }
    return null;
  }
  function fmtTime(min) { return engine.fmtTime(min); }
  /* a zman as the lists show it: צאת הכוכבים to the second, as the gabbai asked; the rest to the minute */
  function zTime(k, v) { if (k !== 'tzeis' || isNaN(v)) return fmtTime(v); var sec = Math.round(v * 60); return fmtTime(Math.floor(sec / 60)) + ':' + pad2(sec % 60); }
  function fmtCountdown(ms) { return engine.fmtCountdown(ms); }
  /* the board's labels in Hebrew or Yiddish: General -> Board labels sets the default (the lobby screen and door displays always use it); each phone may pick its own */
  var STR = {
    he: { preview: 'תצוגה מקדימה', lastTefilla: 'סוף זמן תפילה', lastChatzos: 'אחרון לחצות', runEvery: function (every) { return 'יעדע ' + every + ' מינוט'; }, runFrom: 'פון', runTo: 'ביז', uiLangLabel: 'שפת ההגדרות', sameAsBoard: 'כמו הלוח', zmanimOf: 'זמני ', remindMe: 'תזכורת', minutesBefore: 'דקות לפני', before: 'לפני', todayOnly: 'היום בלבד', thatDayOnly: 'באותו יום בלבד', everyDay: 'כל יום', everyDayAt: 'כל יום בשעה זו', remNote: 'התראה במכשיר זה, גם כשהאפליקציה סגורה.', cancel: 'ביטול', setRem: 'קביעת תזכורת', setting: 'קובע…', remSet: 'התזכורת נקבעה: ', remFail: 'לא ניתן לקבוע את התזכורת: ', minBefore: ' דק׳ לפני ', todayOnlyP: ' (היום בלבד)',
      picks: { first: 'המנין הראשון של היום', last: 'המנין האחרון של היום', 'before:shema': 'המנין האחרון לפני סוף זמן ק״ש', 'before:tefilla': 'המנין האחרון לפני סוף זמן תפילה', 'before:chatzos': 'המנין האחרון לפני חצות', 'before:sunset': 'המנין האחרון לפני השקיעה', 'before:tzeis': 'המנין האחרון לפני צאת הכוכבים' }, pickWith: function (label, name) { return label.replace('המנין', 'מנין ' + name); },
      remTitle: 'תזכורות בטלפון', remHint: 'התראה לפני המנינים או הזמנים שתבחרו, גם כשהאפליקציה סגורה. אפשר גם ללחוץ על כל מנין בלוח, או על כל זמן ברשימה, כדי לקבוע לו תזכורת.', zmanimGroup: 'זמנים', remove: 'הסרת התזכורת', noRems: 'עדיין אין תזכורות.', addRem: '+ תזכורת', maxRems: 'עד 10 תזכורות', dailyAt: ' הלוח היומי כל בוקר בשעה ', remUpdate: 'עדכון התזכורות', remOn: 'הפעלת תזכורות', remOff: 'כיבוי התזכורות', remAtLeast: 'הוסיפו לפחות תזכורת אחת.', turningOn: 'מפעיל…', remsOn: 'התזכורות פועלות במכשיר זה.', remOnFail: 'לא ניתן להפעיל תזכורות: ',
      settings: 'הגדרות', close: 'סגירה', display: 'תצוגה', displayHint: 'הבחירות נשמרות במכשיר זה; המסכים בבית המדרש נשארים כפי שקבע הגבאי.', bigNumber: 'המספר הגדול במשבצות', startWord: 'התחלה', look: 'מראה', labels: 'שפת הכיתובים', cdBox: 'תיבת הזמן הבא', cdHint: 'לאילו זמנים היא סופרת לאחור.', chooseZmanim: 'בחירת הזמנים…', installSec: 'התקנה כאפליקציה', appSec: 'האפליקציה', checkUpdates: 'בדיקת עדכונים', upToDate: 'מעודכן. גרסה חדשה נטענת מעצמה כשהיא מגיעה.', checkFail: 'לא ניתן לבדוק כעת.', done: 'סיום',
      cdTitle: 'זמני הספירה לאחור', cdChooserHint: 'תיבת הזמן הבא סופרת לאחור לזמן הקרוב מבין אלה. הבחירה נשמרת במכשיר זה.', boardDefault: 'ברירת המחדל של הלוח', save: 'שמירה', footerSettings: '⚙ הגדרות', edit: 'עריכה', installApp: 'התקנת האפליקציה', setRemTitle: 'קביעת תזכורת',
      installed: 'מותקן. אתם משתמשים באפליקציה, ולכן תזכורות יכולות להגיע למכשיר זה.', oneTap: 'לחיצה אחת מוסיפה את הלוח למכשיר זה כאפליקציה, עם סמל משלה, ומאפשרת תזכורות.', iosSafari: 'באייפון ובאייפד האפליקציה מתווספת מספארי. תזכורות פועלות רק מהאפליקציה המותקנת.', iosStep1: 'לחצו על כפתור השיתוף, הריבוע עם החץ, בתחתית ספארי.', iosStep2: 'גללו למטה ולחצו על „הוסף למסך הבית”.', iosStep3: 'לחצו על „הוסף”, ואז פתחו את הלוח מהסמל החדש.', iosOther: 'באייפון ובאייפד רק ספארי יכול להוסיף את האפליקציה. פתחו תחילה כתובת זו בספארי:', copyAddr: 'העתקת הכתובת', copied: 'הועתק. הדביקו בספארי.', iosOther1: 'הדביקו את הכתובת בספארי ופתחו אותה.', iosOther2: 'לחצו על שיתוף, ואז „הוסף למסך הבית”, ואז „הוסף”.', android: 'באנדרואיד, בכרום:', and1: 'לחצו על תפריט ⋮ בפינה העליונה.', and2: 'לחצו על „הוסף למסך הבית” או „התקן אפליקציה”.', and3: 'לחצו על „התקן”. הלוח מקבל סמל משלו.', desktop: 'במחשב, בכרום או באדג׳:', desk1: 'לחצו על סמל ההתקנה בקצה שורת הכתובת, מסך עם חץ, או פתחו את תפריט ⋮.', desk2: function (name) { return 'בחרו „התקן ' + name + '”.'; },
      installFirst: 'כדי לקבל תזכורות באייפון או באייפד, הוסיפו תחילה את הלוח למסך הבית: בספארי לחצו על שיתוף, ואז „הוסף למסך הבית”, ופתחו אותו מהסמל.', noPush: 'דפדפן זה אינו יכול לקבל התראות. השתמשו בכרום, או באפליקציה המותקנת.',
      today: 'היום', tomorrow: 'מחר', tonight: 'בערב', nextMinyan: 'מנין הבא', nowMinyan: 'עכשיו', thenNext: 'הבא', nextZman: 'הזמן הבא', zmanim: 'זמני היום', none: 'אין מנינים רשומים', showEarlier: 'הצג את הקודמים', badgeNext: 'הבא', badgeNow: 'עכשיו', badgeLast: 'עבר', board: 'לוח ', special: 'לוח מיוחד', noMinyanim: 'לא רשומים מנינים לימים הקרובים.', fastStart: 'תחילת הצום', fastEnd: 'צאת הצום', motzaeiShabbos: 'מוצאי שבת', motzaeiYT: 'מוצאי יום טוב', omerTonight: 'הלילה סופרים', omer: 'ספירת העומר', laomer: ' לעומר', clock: 'השעה', timesBy: 'הזמנים לפי ', chul: 'לוח חוץ לארץ', eretz: 'לוח ארץ ישראל', parsha: ' פרשת ',
      days: Cal.DAY_NAMES, types: {}, minyanim: function (name) { return 'מניני ' + name; } },
    en: { preview: 'Preview', lastTefilla: 'sof zman tefilla', lastChatzos: 'last before chatzos', runEvery: function (every) { return 'every ' + every + ' min'; }, runFrom: 'from', runTo: 'to', uiLangLabel: 'Settings language', sameAsBoard: 'Same as the board', zmanimOf: 'Zmanim for ', remindMe: 'Remind me', minutesBefore: 'Minutes before', before: 'Before', todayOnly: 'Today only', thatDayOnly: 'That day only', everyDay: 'Every day', everyDayAt: 'Every day at this time', remNote: 'A notification on this device, even when the app is closed.', cancel: 'Cancel', setRem: 'Set reminder', setting: 'Setting…', remSet: 'Reminder set: ', remFail: 'Could not set the reminder: ', minBefore: ' min before ', todayOnlyP: ' (today only)',
      picks: { first: 'First minyan of the day', last: 'Last minyan of the day', 'before:shema': 'Last minyan before sof zman Shema', 'before:tefilla': 'Last minyan before sof zman tefilla', 'before:chatzos': 'Last minyan before chatzos', 'before:sunset': 'Last minyan before sunset', 'before:tzeis': 'Last minyan before nightfall' }, pickWith: function (label, name) { return label.replace('minyan', name); },
      remTitle: 'Reminders on your phone', remHint: 'A notification before the minyanim or zmanim you pick, even when the app is closed. Tap any minyan on the board, or any zman in the list, to set a reminder for it.', zmanimGroup: 'Zmanim', remove: 'Remove this reminder', noRems: 'No reminders yet.', addRem: '+ Reminder', maxRems: 'Up to 10 reminders', dailyAt: ' The day\'s board every morning at ', remUpdate: 'Update reminders', remOn: 'Turn on reminders', remOff: 'Turn off reminders', remAtLeast: 'Add at least one reminder.', turningOn: 'Turning on…', remsOn: 'Reminders are on for this device.', remOnFail: 'Could not turn on reminders: ',
      settings: 'Settings', close: 'Close', display: 'Display', displayHint: 'Your choices stay on this device; the screens in the shul keep the gabbai\'s.', bigNumber: 'Big number on the tiles', startWord: 'start', look: 'Look', labels: 'Language', cdBox: 'The next-zman box', cdHint: 'Which zmanim it counts down to.', chooseZmanim: 'Choose the zmanim…', installSec: 'Install as an app', appSec: 'The app', checkUpdates: 'Check for updates', upToDate: 'Up to date. A newer version reloads by itself when it arrives.', checkFail: 'Could not check right now.', done: 'Done',
      cdTitle: 'Countdown zmanim', cdChooserHint: 'The next-zman box counts down to the nearest of these. Your choice stays on this device.', boardDefault: 'Board default', save: 'Save', footerSettings: '⚙ Settings', edit: 'Edit', installApp: 'Install the app', setRemTitle: 'Set a reminder',
      installed: 'Installed. You are using the app, so reminders can reach this device.', oneTap: 'One tap puts the board on this device as an app, with its own icon, and lets reminders through.', iosSafari: 'On iPhone and iPad the app is added from Safari. Reminders work only from the installed app.', iosStep1: 'Tap the Share button, the square with an arrow, at the bottom of Safari.', iosStep2: 'Scroll down and tap "Add to Home Screen".', iosStep3: 'Tap Add, then open the board from its new icon.', iosOther: 'On iPhone and iPad only Safari can add the app. Open this address in Safari first:', copyAddr: 'Copy the address', copied: 'Copied. Paste it in Safari.', iosOther1: 'Paste the address in Safari and open it.', iosOther2: 'Tap Share, then "Add to Home Screen", then Add.', android: 'On Android, in Chrome:', and1: 'Tap the ⋮ menu at the top right.', and2: 'Tap "Add to Home screen" or "Install app".', and3: 'Tap Install. The board gets its own icon.', desktop: 'On a computer, in Chrome or Edge:', desk1: 'Click the install icon at the right end of the address bar, a screen with an arrow, or open the ⋮ menu.', desk2: function (name) { return 'Choose "Install ' + name + '".'; },
      installFirst: 'To get reminders on iPhone or iPad, add the board to your home screen first: in Safari tap Share, then "Add to Home Screen", and open it from that icon.', noPush: 'This browser cannot receive notifications. Use Chrome, or the installed app.',
      today: 'Today', tomorrow: 'Tomorrow', tonight: 'tonight', nextMinyan: 'Next minyan', nowMinyan: 'Now', thenNext: 'Next', nextZman: 'Next zman', zmanim: 'Today\'s zmanim', none: 'No minyanim listed', showEarlier: 'Show earlier', badgeNext: 'Next', badgeNow: 'Now', badgeLast: 'Gone', board: '', special: 'Special schedule', noMinyanim: 'No minyanim are listed for the coming days.', fastStart: 'Fast begins', fastEnd: 'Fast ends', motzaeiShabbos: 'Shabbos ends', motzaeiYT: 'Yom Tov ends', omerTonight: 'Tonight we count', omer: 'Sefiras HaOmer', laomer: ' la\'omer', clock: 'The time', timesBy: 'Times for ', chul: 'Diaspora calendar', eretz: 'Eretz Yisroel calendar', parsha: ' · Parshas ',
      days: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Shabbos'], types: { weekday: 'Weekday schedule', sunday: 'Sunday schedule', friday: 'Erev Shabbos schedule', shabbos: 'Shabbos schedule', yomtov: 'Yom Tov schedule', erev_yomtov: 'Erev Yom Tov schedule', chol_hamoed: 'Chol Hamoed schedule', rosh_chodesh: 'Rosh Chodesh schedule', fast: 'Fast day schedule', chanukah: 'Chanukah schedule', purim: 'Purim schedule', yomkippur: 'Yom Kippur schedule' },
      minyanim: function (name) { return ({ 'שחרית': 'Shacharis', 'מנחה': 'Mincha', 'מעריב': 'Maariv' }[name] || name) + ' minyanim'; },
      zmanNames: { alos: 'Alos hashachar', sunrise: 'Sunrise (netz)', shemaMGA: 'Sof zman Shema (MGA)', shema: 'Sof zman Shema (Gra)', tefillaMGA: 'Sof zman tefilla (MGA)', tefilla: 'Sof zman tefilla (Gra)', chatzos: 'Chatzos', minchag: 'Mincha gedola', minchak: 'Mincha ketana', plag: 'Plag hamincha', candles: 'Candle lighting', sunset: 'Sunset (shkiah)', tzeis: 'Nightfall (tzeis)', tzeis60: '60 minutes after sunset', tzeis72: 'Rabbeinu Tam (72)' } },
    yi: { preview: 'פארויסבליק', lastTefilla: 'סוף זמן תפילה', lastChatzos: 'לעצטער פאר חצות', runEvery: function (every) { return 'יעדע ' + every + ' מינוט'; }, runFrom: 'פון', runTo: 'ביז', uiLangLabel: 'שפראך פון די איינשטעלונגען', sameAsBoard: 'ווי דער לוח', zmanimOf: 'זמנים פון ', remindMe: 'דערמאנונג', minutesBefore: 'מינוט פריער', before: 'פאר', todayOnly: 'נאר היינט', thatDayOnly: 'נאר יענעם טאג', everyDay: 'יעדן טאג', everyDayAt: 'יעדן טאג אין דער צייט', remNote: 'א מעלדונג אויף דעם מכשיר, אויך ווען די אַפּ איז פארמאכט.', cancel: 'אפשטעלן', setRem: 'שטעלן א דערמאנונג', setting: 'שטעלט…', remSet: 'די דערמאנונג איז געשטעלט: ', remFail: 'די דערמאנונג האט זיך נישט געלאזט שטעלן: ', minBefore: ' מינוט פאר ', todayOnlyP: ' (נאר היינט)',
      picks: { first: 'דער ערשטער מנין פון טאג', last: 'דער לעצטער מנין פון טאג', 'before:shema': 'דער לעצטער מנין פאר סוף זמן ק״ש', 'before:tefilla': 'דער לעצטער מנין פאר סוף זמן תפילה', 'before:chatzos': 'דער לעצטער מנין פאר חצות', 'before:sunset': 'דער לעצטער מנין פאר שקיעה', 'before:tzeis': 'דער לעצטער מנין פאר צאת הכוכבים' }, pickWith: function (label, name) { return label.replace('מנין', name); },
      remTitle: 'דערמאנונגען אויפן טעלעפאן', remHint: 'א מעלדונג פאר די מנינים אדער זמנים וואס איר קלויבט אויס, אויך ווען די אַפּ איז פארמאכט. מען קען אויך דריקן אויף יעדן מנין אויפן לוח, אדער אויף יעדן זמן אין דער ליסטע, צו שטעלן א דערמאנונג.', zmanimGroup: 'זמנים', remove: 'אראפנעמען די דערמאנונג', noRems: 'נאך נישטא קיין דערמאנונגען.', addRem: '+ דערמאנונג', maxRems: 'ביז 10 דערמאנונגען', dailyAt: ' דער טעגליכער לוח יעדן אינדערפרי ', remUpdate: 'דערמאנונגען אפדעיטן', remOn: 'דערמאנונגען אנצינדן', remOff: 'דערמאנונגען פארלעשן', remAtLeast: 'לייגט צו כאטש איין דערמאנונג.', turningOn: 'צינדט אן…', remsOn: 'די דערמאנונגען זענען אן אויף דעם מכשיר.', remOnFail: 'די דערמאנונגען האבן זיך נישט געלאזט אנצינדן: ',
      settings: 'איינשטעלונגען', close: 'פארמאכן', display: 'אויסזען', displayHint: 'די ברירות בלייבן אויף דעם מכשיר; די שירעמס אין שול בלייבן ווי דער גבאי האט געשטעלט.', bigNumber: 'די גרויסע נומער אויף די קעסטלעך', startWord: 'אנהייב', look: 'קאלירן', labels: 'שפראך', cdBox: 'די קעסטל הזמן הבא', cdHint: 'צו וועלכע זמנים זי ציילט.', chooseZmanim: 'אויסקלויבן די זמנים…', installSec: 'אינסטאלירן ווי אן אַפּ', appSec: 'די אַפּ', checkUpdates: 'זוכן אפדעיטס', upToDate: 'אפדעיטעד. א נייע ווערסיע לאדט זיך אליין ווען זי קומט אן.', checkFail: 'מען קען יעצט נישט נאכקוקן.', done: 'פארטיג',
      cdTitle: 'זמנים פאר דער ציילונג', cdChooserHint: 'די קעסטל הזמן הבא ציילט צום נאענטסטן פון די דאזיגע זמנים. די ברירה בלייבט אויף דעם מכשיר.', boardDefault: 'ווי דער לוח', save: 'אפהיטן', footerSettings: '⚙ איינשטעלונגען', edit: 'עדיטירן', installApp: 'אינסטאלירן די אַפּ', setRemTitle: 'שטעלן א דערמאנונג',
      today: 'היינט', tomorrow: 'מארגן', tonight: 'ביינאכט', nextMinyan: 'מנין הבא', nowMinyan: 'יעצט', thenNext: 'דערנאך', nextZman: 'הזמן הבא', zmanim: 'היינטיגע זמנים', none: 'קיין מנינים נישט איינגעשריבן', showEarlier: 'ווייז די פריערדיגע', badgeNext: 'הבא', badgeNow: 'יעצט', badgeLast: 'געווען', board: 'לוח ', special: 'ספעציעלער לוח', noMinyanim: 'קיין מנינים נישט איינגעשריבן פאר די קומענדיגע טעג.', fastStart: 'אנהייב תענית', fastEnd: 'סוף תענית', motzaeiShabbos: 'מוצאי שבת', motzaeiYT: 'מוצאי יום טוב', omerTonight: 'היינט ביינאכט ציילט מען', omer: 'ספירת העומר', laomer: ' לעומר', clock: 'די שעה', timesBy: 'די זמנים לויט ', chul: 'לוח חוץ לארץ', eretz: 'לוח ארץ ישראל', parsha: ' פרשת ',
      days: ['זונטאג', 'מאנטאג', 'דינסטאג', 'מיטוואך', 'דאנערשטאג', 'פרייטאג', 'שבת קודש'], types: { weekday: 'וואכן טעג', sunday: 'זונטאג', friday: 'ערב שבת', shabbos: 'שבת', yomtov: 'יום טוב', erev_yomtov: 'ערב יום טוב', chol_hamoed: 'חול המועד', rosh_chodesh: 'ראש חודש', fast: 'תענית', chanukah: 'חנוכה', purim: 'פורים', yomkippur: 'יום כיפור' }, minyanim: function (name) { return name + ' מנינים'; } }
  };
  var LANGS = ['he', 'yi']; /* the board's labels */
  function langDefault() { return cfg.lang === 'yi' ? 'yi' : 'he'; }
  function langMode() {
    var view = currentView(); if (view.kind === 'display' || view.kind === 'room') return langDefault();
    var v = null; try { v = localStorage.getItem('minyan-lang'); } catch (e) {}
    return LANGS.indexOf(v) >= 0 ? v : langDefault();
  }
  /* the sheets (Settings, reminders, the install guide) may be in English while the board itself keeps its Hebrew or Yiddish */
  function uiLang() { var v = null; try { v = localStorage.getItem('minyan-ui-lang'); } catch (e) {} return v === 'en' ? 'en' : langMode(); }
  /* a zman's name in the given strings' language (English has its own; Hebrew and Yiddish share the calendar's) */
  function zmanName(k, L) { L = L || S(); return (L.zmanNames && L.zmanNames[k]) || Cal.ZMAN_NAMES[k] || k; }
  /* the board's own sheets read left to right in English, right to left otherwise */
  function sheetDir() { return uiLang() === 'en' ? 'ltr' : 'rtl'; }
  function strs(m) { if (m === 'he' || !STR[m]) return STR.he; ui.strCache = ui.strCache || {}; if (!ui.strCache[m]) ui.strCache[m] = Object.assign({}, STR.he, STR[m]); return ui.strCache[m]; }
  function S() { return strs(langMode()); }   /* the board's labels */
  function SU() { return strs(uiLang()); }    /* the sheets */
  function applyLang() { if (typeof document === 'undefined') return; var st = document.documentElement.style, L = S(); st.setProperty('--badge-next', '"' + L.badgeNext + '"'); st.setProperty('--badge-now', '"' + L.badgeNow + '"'); st.setProperty('--badge-last', '"' + (L.badgeLast || '') + '"'); }
  function dayLine(info, rd) { var p = Cal.parshaOfWeek(rd, !!cfg.israel); return S().days[info.dow] + (p ? S().parsha + p : ''); }
  function typeLabel(s) {
    if (s.override) return S().special + (s.override.label ? ': ' + s.override.label : '');
    if (s.roll && s.roll.name) return S().board + s.roll.name;
    return S().board + (S().types[s.type] || TYPE_NAME[s.type] || s.type);
  }

  /* ---------- rendering ---------- */
  function render() {
    var view = currentView();
    applyLook(); applyLang();
    if (view.kind === 'week') return renderWeek();
    var now = Date.now(), tz = loc().tz, n = Cal.nowInTz(now, tz), rd = n.rd;
    var info = Cal.dayInfo(rd, !!cfg.israel), z = zmanimFor(rd);
    var root = $('#app'), keepOv = ui.adminOpen ? $('#overlay') : null; /* an open settings panel survives a re-render of the board behind it */
    root.innerHTML = '';
    root.className = view.kind === 'display' ? 'display' : view.kind === 'room' ? 'display room' : '';
    root.setAttribute('data-day', MinyanEngine.isoDate(rd)); /* the day this page is showing, for whatever reads it from outside: the back end's preview frame, the checks */
    /* the lobby screen scales with the TV (the stylesheet sizes it from the screen); General → "Hallway screen size", or &size= in the address, makes everything larger or smaller */
    var html = document.documentElement, lobby = view.kind === 'display';
    html.classList.toggle('lobby', lobby);
    var wl = cfg.wallLook || {};
    ['pageBg', 'tileBg', 'tileInk', 'nextBg', 'nextInk', 'nowBg', 'nowInk', 'lastBg', 'lastInk', 'pastBg', 'pastInk', 'frameBg', 'frameLine', 'barBg', 'barInk'].forEach(function (k) {
      var v = lobby && wl[k] ? wl[k] : '';
      if (v) html.style.setProperty('--w-' + k, v); else html.style.removeProperty('--w-' + k);
    });
    ui.lobbyScale = lobby ? Math.max(50, Math.min(200, view.size || +cfg.displayScale || 100)) / 100 : 1;
    html.style.setProperty('--lobby-scale', String(ui.lobbyScale));
    ui.roomFilter = view.kind === 'room' ? view.room : null;
    var hebLine = Cal.formatHeb(info.heb);
    if (!isNaN(z.sunset) && n.min >= z.sunset) hebLine += ' · ' + S().tonight + ': ' + Cal.formatHeb(Cal.hebFromRD(rd + 1));
    var chips = info.labels.map(function (l) { return el('span', { class: 'chip', text: l }); }), sched = scheduleFor(rd);
    if (lobby && sched.override) chips.push(el('span', { class: 'chip', text: typeLabel(sched) }));
    /* the hallway screen has no top line unless Hallway screen → "The top line" asks for one: the time is on the clock face, and the
       height goes to the minyanim */
    var topLine = !lobby || !!cfg.wallTopBar;
    root.classList.toggle('no-top', !topLine);
    if (topLine) root.appendChild(el('header', { class: 'top' }, [el('div', { class: 'inner' }, [
      lobby && !cfg.logo ? null : el('div', { class: 'shul' }, [view.kind === 'board' ? el('button', { type: 'button', class: 'gear-top', 'aria-label': 'Settings', title: 'Settings', text: '⚙', onclick: openSettings }) : null, cfg.logo ? el('img', { class: 'logo', src: cfg.logo, alt: '' }) : null, el('span', { text: (cfg.name || 'לוח המנינים') + (ui.roomFilter ? ' · ' + ui.roomFilter : '') })]),
      el('h1', { class: 'dayline', text: dayLine(info, rd) }),
      el('div', { class: 'dates' }, [el('span', { text: hebLine }), el('span', { class: 'num', text: engine.fmtDate(rd) })]),
      chips.length ? el('div', { class: 'chips' }, chips) : null,
      view.kind !== 'board' ? (ui.clock = el('div', { class: 'clock num', 'aria-label': S().clock }, [el('span', { class: 'hm' }), el('span', { class: 'ss' })])) : null])]));
    if (view.kind === 'board' || !topLine) ui.clock = null;
    if (view.kind !== 'display') ui.aclock = null;
    updateClock(now);

    var banner = engine.activeBanner(now);
    if (banner) root.appendChild(el('div', { class: 'banner', role: 'status' }, [el('div', { class: 'banner-inner', text: banner.text.trim() })]));
    var strip = sponsorsStrip(rd, n.min); /* a sponsor frame only when there is a sponsor at this hour of that day */
    if (strip && !lobby) root.appendChild(strip); /* on the lobby screen the sponsor box sits in the side column, under the zmanim */
    var up = upcoming(now, rd);
    ui.shabbosWin = shabbosWin(now);
    var main = el('main'), colA = el('div', { class: 'col' }), colB = el('div', { class: 'col' });
    var next = el('section', { class: 'next', 'aria-live': 'polite' }, [el('h2', { text: S().nextMinyan })]);
    ui.countdown = null; ui.countdownMs = 0;
    if (up) {
      var e = up.entry, bigMs = bigIsMilestone(e.tefilla);
      ui.countdownMs = keyMs(e);
      /* on the hallway screen the room stands on its own line, large: from across the room that is what people look for */
      var upP = lobby && (cfg.countTo === 'start' || cfg.countTo === 'milestone') ? (upcomingBy(countMs, now, rd) || up) : up, eP = upP.entry; /* the minyan the panel's countdown runs to */
      var held = lobby ? heldMinyan(now, rd) : null;
      if (held) { /* a minyan that has just started keeps the panel for its few minutes; the screen is drawn again when they are up, or when the next one starts */
        next.classList.add('held'); next.firstChild.textContent = S().nowMinyan;
        ui.countdownMs = Math.min(held.until, countMs(eP)); ui.countdown = null;
        nextPanelFromTemplate(next, held.entry, { daysAhead: 0, sched: held.sched }, now, eP);
      } else if (lobby) { ui.countdownMs = countMs(eP); nextPanelFromTemplate(next, eP, upP, now); }
      else next.appendChild(el('div', { class: 'what', text: e.tefilla.name + (e.room ? ' – ' + e.room : '') }));
      if (!lobby) {
        if (bigMs) next.appendChild(el('div', { class: 'ms num pre', text: startLabel(e.tefilla) + ' ' + fmtTime(e.start) })); /* the start stays first: ברכות above, הודו big below */
        next.appendChild(el('div', { class: 'time num', text: fmtTime(bigMs ? e.milestone : e.start) }));
        if (e.tefilla.milestone && !bigMs) next.appendChild(el('div', { class: 'ms num', text: e.tefilla.milestone + ' ' + fmtTime(e.milestone) }));
        ui.countdown = el('div', { class: 'count num', text: fmtCountdown(ui.countdownMs - now) });
        next.appendChild(ui.countdown);
      }
      /* the three after it, as small cards: tomorrow's first Shacharis included once the day runs out */
      var more = engine.after(now, rd, 3).filter(function (x) { return x.entry.tefilla.kind !== 'event' && !sameEntry(x.entry, e) && keyMs(x.entry) > now; }).slice(0, 3), canTapMore = canSetReminders();
      if (more.length && !lobby) next.appendChild(el('div', { class: 'soon-row' }, more.map(function (x) {
        var en = x.entry, sub = (en.tefilla.id !== e.tefilla.id ? en.tefilla.name : '') + (x.daysAhead > up.daysAhead ? (en.tefilla.id !== e.tefilla.id ? ' · ' : '') + (x.daysAhead === 1 ? S().tomorrow : S().days[x.sched.info.dow]) : '');
        var card = el('div', { class: 'soon' }, [el('div', { class: 'time num', text: fmtTime(bigIsMilestone(en.tefilla) ? en.milestone : en.start) }), el('div', { class: 'room', text: en.room || en.tefilla.name }), sub ? el('div', { class: 'sub', text: sub }) : null]);
        if (canTapMore) makeTappable(card, en);
        return card;
      })));
      if (!lobby && up.daysAhead > 0) next.appendChild(el('div', { class: 'when', text: (up.daysAhead === 1 ? S().tomorrow + ', ' : '') + S().days[up.sched.info.dow] + ' ' + Cal.formatHeb(up.sched.info.heb) }));
      if (!lobby && e.note) next.appendChild(el('div', { class: 'when', text: e.note }));
    } else {
      var heldLast = lobby ? heldMinyan(now, rd) : null;
      if (heldLast) { next.classList.add('held'); next.firstChild.textContent = S().nowMinyan; ui.countdownMs = heldLast.until; nextPanelFromTemplate(next, heldLast.entry, { daysAhead: 0, sched: heldLast.sched }, now, null); }
      else next.appendChild(el('div', { class: 'empty', text: S().noMinyanim }));
    }
    var canTap = canSetReminders(), sw = ui.shabbosWin;
    if (sw && now >= sw.chatzosMs && now < sw.candlesMs) { /* Friday after chatzos: candle lighting, counting down, in place of the next minyan */
      var p0 = Cal.parshaOfWeek(sw.sat, !!cfg.israel);
      next = el('section', { class: 'next candles', 'aria-live': 'polite' }, [el('h2', { text: zmanName('candles') }),
        el('div', { class: 'what', text: (S().today === 'Today' ? 'Erev Shabbos' : 'ערב שבת קודש') + (p0 ? (S().today === 'Today' ? ' ' : ' פרשת ') + p0 : '') }),
        el('div', { class: 'time num', text: fmtTime(sw.candlesMin) })]);
      ui.countdownMs = sw.candlesMs; ui.countdown = el('div', { class: 'count num', text: fmtCountdown(sw.candlesMs - now) }); next.appendChild(ui.countdown);
    } else if (up && canTap && up.entry.tefilla.kind !== 'event') makeTappable(next, up.entry); /* tap the next minyan to be reminded of it */
    ui.zcount = null; ui.zcountMs = 0;
    var nz = nextZman(info, z, rd, now);
    if (lobby) {
      /* the hallway screen: shacharis on one side, the rest on the other, the clock and the sponsors down the middle */
      main.className = 'wall';
      var colR = el('div', { class: 'wcol' }), colM = el('div', { class: 'wcol mid' }), colL = el('div', { class: 'wcol' });
      var items = wallSections(sched, now, up);
      if (!items.length && up) items = wallSections(up.sched, now, up, true); /* nothing left today: tomorrow's lists */
      if (items.length) colR.appendChild(wallCard(items[0].title, items[0].nodes)); /* the first tefilla of the day keeps a frame to itself */
      if (cfg.nextPanel !== false) colR.appendChild(next); else ui.countdown = null; /* Hallway screen → "The next-minyan panel" can take it off; the minyanim then have the whole column */
      if (items.length > 1) { /* the rest of the day shares one frame, each tefilla named above its own tiles */
        var rest = items.slice(1), blocks = [];
        rest.forEach(function (it) { blocks.push(el('div', { class: 'sub', text: it.sub })); blocks = blocks.concat(it.nodes); });
        colL.appendChild(wallCard(S().minyanim(rest.map(function (it) { return it.t.name; }).join(' ')), blocks));
      }
      if (ui.shabbosWin) colL.appendChild(wallCard(shabbosTitle(ui.shabbosWin), [shabbosList(ui.shabbosWin)]));
      colL.appendChild(wallZmanim(info, z, rd, now));
      colM.appendChild(analogClock(now, false)); /* the time with seconds is in the top bar */
      if (strip) colM.appendChild(strip);
      main.appendChild(colR); main.appendChild(colM); main.appendChild(colL);
      root.appendChild(main);
      if (keepOv) root.appendChild(keepOv);
      fitLobby();
      ui.lastRenderDay = rd; ui.lastMinute = Math.floor(now / 60000);
      return;
    }
    colA.appendChild(next);
    if (nz) {
      ui.zcountMs = nz.ms; ui.zcount = el('div', { class: 'count num', text: fmtCountdown(nz.ms - now) });
      var zb = el('section', { class: 'next zman' + (nz.ms - now < 30 * 60000 ? ' urgent' : ''), /* 'urgent', not 'soon': .soon is the next-three strip's box */ 'aria-live': 'polite' }, [el('h2', { text: S().nextZman }), el('div', { class: 'what', text: zmanName(nz.key) }), el('div', { class: 'time num', text: fmtTime(nz.min) }), ui.zcount,
        el('button', { type: 'button', class: 'gear', 'aria-label': 'Choose the countdown zmanim', title: 'Choose zmanim', text: '⚙', onclick: function (ev) { ev.stopPropagation(); openCountdownChooser(); } })]);
      if (canTap) makeTappable(zb, { zman: nz.key, rd: rd, min: nz.min }); /* tap the zman to be reminded before it */
      colA.appendChild(zb);
    }
    var sections = (view.kind === 'board' && isPhone()) ? phoneSections : daySections;
    if (ui.lastRenderDay !== rd) ui.showPast = false;
    /* the board: a row of day chips (today, tomorrow, the five days after) to look at another day's minyanim; the lists and the zmanim panel follow it */
    if (ui.lastRenderDay !== rd) ui.dayOffset = 0;
    var off = view.kind === 'board' ? Math.max(0, Math.min(6, ui.dayOffset || 0)) : 0, showRd = rd + off, showSched = off ? scheduleFor(showRd) : sched;
    if (view.kind === 'board') colA.appendChild(dayChips(rd, off));
    var secToday = sections(showSched, now, up, off === 0), secTomo = !off && up && up.daysAhead > 0 && !(up.daysAhead === 1 && ui.todayAllSwitched) && Cal.mod(rd, 7) !== 4 ? sections(up.sched, now, up, false) : null; /* not on Thursday night: Friday comes up at chatzos, with the Shabbos box */ /* tomorrow is already shown section by section once today is over */
    colA.appendChild(secToday); if (secTomo) colA.appendChild(secTomo);
    colB.appendChild(off ? zmanimPanel(Cal.dayInfo(showRd, !!cfg.israel), zmanimFor(showRd), S().zmanimOf + (off === 1 ? S().tomorrow : S().days[Cal.dayInfo(showRd, !!cfg.israel).dow])) : zmanimPanel(info, z));
    if (view.kind === 'board') {
      var sms = smsPanel();
      if (sms) colB.appendChild(sms);
      var push = pushPanel();
      if (push) colB.appendChild(push);
    }
    main.appendChild(colA); main.appendChild(colB);
    root.appendChild(main);
    if (view.kind === 'board') root.appendChild(footer());
    if (keepOv) root.appendChild(keepOv);
    ui.lastRenderDay = rd; ui.lastMinute = Math.floor(now / 60000);
  }
  /* Printable weekly sheet (?view=week / #week): this week and next, Sunday to Shabbos */
  function renderWeek() {
    var root = $('#app'), now = Date.now(), tz = loc().tz, rd0 = Cal.nowInTz(now, tz).rd, start = rd0 - Cal.mod(rd0, 7);
    root.innerHTML = ''; root.className = 'week';
    root.appendChild(el('header', { class: 'top' }, [el('div', { class: 'inner' }, [el('div', { class: 'shul' }, [cfg.logo ? el('img', { class: 'logo', src: cfg.logo, alt: '' }) : null, el('span', { text: cfg.name || 'לוח המנינים' })]), el('h1', { class: 'dayline', text: 'לוח השבוע' })])]));
    var main = el('main', { class: 'week-main' });
    [0, 7].forEach(function (off) {
      var first = start + off, sec = el('section', { class: 'week-block' });
      var i0 = Cal.dayInfo(first, !!cfg.israel), i6 = Cal.dayInfo(first + 6, !!cfg.israel), parsha = Cal.parshaOfWeek(first, !!cfg.israel);
      sec.appendChild(el('h2', { text: (off ? 'השבוע הבא' : 'השבוע') + (parsha ? ' – פרשת ' + parsha : '') + ' · ' + Cal.formatHeb(i0.heb) + ' – ' + Cal.formatHeb(i6.heb) }));
      for (var d = 0; d < 7; d++) {
        var rd = first + d, info = Cal.dayInfo(rd, !!cfg.israel), sched = scheduleFor(rd), z = zmanimFor(rd), day = el('div', { class: 'wday' + (rd === rd0 ? ' today' : '') });
        var zs = [];
        if (info.candles) zs.push('הדלקת נרות ' + fmtTime(info.candles === 'night' ? z.tzeis : z.candles)); /* before sunset, or after nightfall when Shabbos or Yom Tov is already in */
        if (info.fast && !((info.heb.m === 7 && info.heb.d === 10) || info.heb.m === 5)) zs.push('תחילת הצום ' + fmtTime(z.alos));
        zs.push('שקיעה ' + fmtTime(z.sunset));
        if (info.fast || info.yomKippur) zs.push('צאת הצום ' + fmtTime(z.tzeis)); /* Yom Kippur too: the screen says the same */
        else if (info.motzaei) zs.push((info.motzaei === 'shabbos' ? 'מוצאי שבת ' : 'מוצאי יום טוב ') + fmtTime(z.tzeis)); /* only on the day whose nightfall really ends it */
        day.appendChild(el('div', { class: 'whead' }, [el('strong', { text: Cal.DAY_NAMES[info.dow] }), el('span', { text: Cal.formatHeb(info.heb) + ' · ' + engine.fmtDate(rd) }), info.labels.length ? el('span', { class: 'wlabels', text: info.labels.join(', ') }) : null, el('span', { class: 'wz num', text: zs.join(' · ') })]));
        tefillos().forEach(function (t) {
          var list = sched.byTefilla[t.id] || [];
          if (!list.length) return;
          day.appendChild(el('div', { class: 'wline' }, [el('b', { text: list[0].tefilla.name + ': ' }), el('span', { class: 'num', text: list.map(function (e) { return fmtTime(e.start) + (e.room ? ' ' + e.room : ''); }).join(' · ') })]));
        });
        sec.appendChild(day);
      }
      main.appendChild(sec);
    });
    root.appendChild(main);
    var bar = el('div', { class: 'week-bar' }, [el('a', { class: 'btn', href: inArtifact ? '#' : './', text: 'ללוח' })]);
    if (!inArtifact) bar.appendChild(el('button', { class: 'btn primary', text: 'הדפסה', onclick: function () { window.print(); } }));
    root.appendChild(bar);
    ui.countdown = null; ui.countdownMs = 0; ui.lastRenderDay = rd0; ui.lastMinute = Math.floor(now / 60000);
  }
  var KEEP_PAST = 3; /* on the board, this many of the most recent past minyanim stay in view (dimmed); older ones fold behind a button */
  /* How long a minyan that has started stays marked "now" (cfg.nowMinutes, default 20). After that it is dimmed, and the lobby screen hides it. */
  /* General → "Minutes from הודו to שמונה עשרה": a minyan reaches שמונה עשרה this long after its milestone */
  function amidahMinutes() { var m = cfg.amidahMinutes; return m == null || m === '' || isNaN(+m) ? 15 : Math.max(0, +m); }
  function nowWindowMs() { var m = cfg.nowMinutes; m = (m == null || m === '') ? 20 : +m; return (isNaN(m) || m < 0 ? 20 : m) * 60000; }
  /* per tefilla: today's list, or tomorrow's once all of today's minyanim are over (after chatzos for Shacharis) */
  /* today's Shacharis stays on the board until chatzos, even after its last minyan, before tomorrow's takes its place */
  function staysUntil(t, rd) {
    if (t.id !== 'shacharis' && t.period !== 'am') return 0;
    var c = zmanimFor(rd).chatzos;
    return isFinite(c) ? Cal.epochFromWall(rd, c, loc().tz) : 0;
  }
  function tefillaOver(t, list, rd, now) { return list.every(function (e) { return now - e.ms >= nowWindowMs(); }) && now >= staysUntil(t, rd); }
  function tefillaLists(s, now, isToday) {
    var tomorrow = isToday ? scheduleFor(s.rd + 1) : null, out = [], allSwitched = true;
    tefillos().forEach(function (t) {
      if (isToday && ui.shabbosWin && isPmMinyan(t)) return; /* Mincha and Maariv give their place to the Shabbos zmanim */
      var next = tomorrow;
      if (next && ui.shabbosWin && next.info.shabbos && t.kind !== 'event') next = scheduleFor(s.rd + 2);
      if (next && isPmMinyan(t) && Cal.mod(s.rd, 7) === 4) next = null; /* Thursday night: Mincha and Maariv stay (Friday's do not take their place) until chatzos, when the Shabbos box comes up */ /* Shabbos's Shacharis is in the Shabbos box: after chatzos on Friday, Sunday's minyanim */
      var list = s.byTefilla[t.id] || [], fromTomorrow = false;
      if (next && t.kind !== 'event' && tefillaOver(t, list, s.rd, now) && (next.byTefilla[t.id] || []).length) { list = next.byTefilla[t.id]; fromTomorrow = true; }
      if (!fromTomorrow && t.kind !== 'event') allSwitched = false;
      var day = fromTomorrow ? next : s;
      out.push({ t: (day.tefillos && day.tefillos[t.id]) || t, list: list, fromTomorrow: fromTomorrow, tomorrow: next, todayRd: s.rd }); /* the tefilla as that day has it: its name and second time can differ by the kind of day */
    });
    if (isToday) ui.todayAllSwitched = allSwitched;
    return out;
  }
  /* From chatzos on Thursday night until Motzei Shabbos the board is in "Shabbos" mode: the Shabbos zmanim take the place of Mincha and
     Maariv, and on Friday after chatzos the next-minyan box counts down to candle lighting. */
  function shabbosWin(now) {
    var tz = loc().tz, rd = Cal.nowInTz(now, tz).rd, dow = Cal.mod(rd, 7), fri = dow === 4 ? rd + 1 : dow === 5 ? rd : dow === 6 ? rd - 1 : null;
    if (fri == null) return null;
    var zt = zmanimFor(fri - 1), zf = zmanimFor(fri), zs = zmanimFor(fri + 1);
    if (!isFinite(zt.chatzosNight) || !isFinite(zf.candles) || !isFinite(zs.tzeis72)) return null;
    var from = Cal.epochFromWall(fri - 1, Math.round(zt.chatzosNight), tz), until = Cal.epochFromWall(fri + 1, Math.round(zs.tzeis72), tz);
    if (now < from || now >= until) return null;
    return { fri: fri, sat: fri + 1, candlesMin: zf.candles, candlesMs: Cal.epochFromWall(fri, Math.round(zf.candles), tz), chatzosMs: Cal.epochFromWall(fri, Math.round(zf.chatzos), tz), motzash: Math.ceil(zs.tzeis72) }; /* Motzei Shabbos rounded up, as on the weekly sheet */
  }
  function isPmMinyan(t) { return t.kind !== 'event' && (t.period === 'pm' || t.id === 'mincha' || t.id === 'maariv'); }
  function shabbosTitle(w) { var p = Cal.parshaOfWeek(w.sat, !!cfg.israel), en = S().today === 'Today'; return (en ? 'Shabbos zmanim' : 'זמני שבת קודש') + (p ? (en ? ' – ' : ' – פרשת ') + p : ''); }
  /* the Shabbos zmanim: candle lighting, Friday's Mincha and Maariv, Shabbos's minyanim and Motzei Shabbos */
  function shabbosList(w) {
    var ul = el('ul', { class: 'zlist shabbos-z' }), L = S(), en = L.today === 'Today', fs = scheduleFor(w.fri), ss = scheduleFor(w.sat);
    function li(label, value, hi) { ul.appendChild(el('li', hi ? { class: 'hi' } : null, [el('span', { text: label }), el('span', { class: 'z num', text: value })])); }
    function times(s, t, bare) { /* bare: the start time alone, as Shabbos Shacharis is given (ברכות only, no room) */
      return (s.byTefilla[t.id] || []).map(function (e) { var tt = (s.tefillos && s.tefillos[t.id]) || t; return fmtTime(e.start) + (bare ? '' : (tt.milestone && e.milestone != null ? ' (' + tt.milestone + ' ' + fmtTime(e.milestone) + ')' : '') + (e.room ? ' ' + e.room : '')); }).join(' · ');
    }
    function name(s, t, suffix) { var n = ((s.tefillos && s.tefillos[t.id]) || t).name; return n !== t.name ? n : n + suffix; } /* a tefilla with a name of its own that day (מנחה וקבלת שבת) needs no ערש״ק */
    /* the week's shiurim and the like (This week tab → "Shabbos box"), in small type under the tefilla they follow */
    var satIso = MinyanEngine.isoDate(w.sat), extras = (cfg.shabbosExtras || []).filter(function (x) { return x && x.name && (!x.week || x.week === 'every' || x.week === satIso); });
    function small(when) {
      extras.filter(function (x) { return x.when === when; }).forEach(function (x) {
        ul.appendChild(el('li', { class: 'sm' }, [el('span', null, [el('span', { class: 'sm-n', text: x.name }), x.detail ? el('span', { class: 'sm-d', text: x.detail }) : null]), el('span', { class: 'z num', text: x.time || '' })]));
      });
    }
    li(zmanName('candles'), fmtTime(w.candlesMin), true);
    tefillos().forEach(function (t) { if (isPmMinyan(t)) { var v = times(fs, t); if (v) li(name(fs, t, en ? ' (Friday)' : ' ערש״ק'), v); } });
    small('fri');
    small('morning');
    tefillos().forEach(function (t) { if (t.kind === 'event') return; var v = times(ss, t, t.id === 'shacharis' || t.period === 'am'); if (v) li(name(ss, t, en ? ' (Shabbos)' : ' שב״ק'), v); if (t.id === 'shacharis' || t.period === 'am') small('day'); });
    li(L.motzaeiShabbos, fmtTime(w.motzash), true);
    small('motzash');
    return ul;
  }
  function shabbosSection(w) { return el('section', { class: 'tefilla shabbos-box' }, [el('h3', { text: shabbosTitle(w) }), shabbosList(w)]); }
  /* a day by the name people call it: Shabbos, a Yom Tov by its own name (פסח, שבועות …), otherwise the day of the week */
  function dayName(info) { return info.shabbos ? S().days[6] : info.yomtov && info.labels && info.labels.length ? info.labels[0] : S().days[info.dow]; }
  /* "מחר, יום ראשון" — or just the day's name when it is further on (Sunday's minyanim shown on Friday afternoon) */
  function whenLabel(x, short) { var t1 = x.tomorrow && x.tomorrow.rd === x.todayRd + 1; return short ? (t1 ? S().tomorrow : dayName(x.tomorrow.info)) : (t1 ? S().tomorrow + ', ' : '') + dayName(x.tomorrow.info); }
  function sectionTitle(x) { return x.t.kind === 'event' ? x.t.name : S().minyanim(x.t.name) + (x.fromTomorrow ? ' – ' + whenLabel(x) : ''); }
  /* how long a minyan that has started says עכשיו: a tefilla with a second time (שחרית's הודו) until that time; מנחה and מעריב five minutes.
     After that, the minyan that went last says עבר. */
  function nowLasts(e) { var t = e.tefilla || {}; return t.milestone && +t.offset > 0 ? +t.offset * 60000 : 5 * 60000; }
  function entryState(e, now, up) { if (up && sameEntry(e, up.entry)) return 'next'; if (e.ms <= now) return now - e.ms < nowLasts(e) ? 'now' : 'past'; return ''; }
  function dayHead(s, isToday) { return el('div', { class: 'day-head' }, [el('h2', { text: isToday ? S().today : S().days[s.info.dow] + ' – ' + Cal.formatHeb(s.info.heb) }), el('span', { class: 'sub', text: typeLabel(s) })]); }
  /* the board's day chips: today, tomorrow and the five days after, each with its Hebrew date; a tap shows that day's minyanim and zmanim */
  function dayChips(rd, off) {
    var row = el('div', { class: 'daychips board-days', role: 'tablist', 'aria-label': S().today + ' / ' + S().tomorrow }), k;
    for (k = 0; k < 7; k++) (function (i) {
      var d = rd + i, info = Cal.dayInfo(d, !!cfg.israel), name = i === 0 ? S().today : i === 1 ? S().tomorrow : S().days[info.dow];
      row.appendChild(el('button', { type: 'button', role: 'tab', class: 'daychip' + (i === off ? ' on' : ''), 'aria-selected': String(i === off), onclick: function () { ui.dayOffset = i; render(); } }, [
        el('span', { class: 'dc-day', text: name }), el('span', { class: 'dc-date', text: Cal.formatHeb(info.heb) })]));
    })(k);
    return row;
  }
  /* tablets, the lobby screen and door displays: a grid of tiles per tefilla */
  function daySections(s, now, up, isToday) {
    var wrap = el('div', { class: 'col' }), canRemind = canSetReminders();
    wrap.appendChild(dayHead(s, isToday));
    tefillaLists(s, now, isToday).forEach(function (x) {
      var t = x.t, list = x.list, sec = el('section', { class: 'tefilla' + (x.fromTomorrow || !isToday ? ' tomo' : '') });
      if ($('#app').classList.contains('display') && !x.fromTomorrow && list.every(function (e) { return e.ms <= now; }) && tefillaOver(t, list, s.rd, now) && !(isToday && isPmMinyan(t) && Cal.mod(s.rd, 7) === 4)) return;
      sec.appendChild(el('h3', null, [sectionTitle(x)]));
      if (!list.length) { sec.appendChild(el('div', { class: 'none', text: S().none })); }
      else {
        var grid = el('div', { class: 'grid' }), onBoard = !$('#app').classList.contains('display');
        /* on the board, more than two past minyanim fold behind a button (the lobby screen hides them outright) */
        var past = onBoard ? list.filter(function (e) { return entryState(e, now, up) === 'past'; }) : [], hidden = onBoard && !ui.showPast && past.length > KEEP_PAST && past.length < list.length ? past.slice(0, past.length - KEEP_PAST) : [], fold = hidden.length > 0; /* the last three past minyanim stay, dimmed */
        if (fold) sec.appendChild(el('button', { type: 'button', class: 'btn small foldbtn', text: S().showEarlier + ' (' + hidden.length + ')', onclick: function () { ui.showPast = true; render(); } }));
        list.forEach(function (e) {
          var st = entryState(e, now, up), cls = 'tile' + (st ? ' ' + st : '') + (t.kind === 'event' ? ' event' : '');
          if (fold && hidden.indexOf(e) >= 0) return;
          var tile = el('div', { class: cls }, [
            el('div', { class: 'room', text: e.room || t.name }),
            bigIsMilestone(t) ? el('div', { class: 'ms num pre', text: startLabel(t) + ' ' + fmtTime(e.start) }) : null, /* chronological: ברכות above, הודו big below */
            el('div', { class: 'time num', text: fmtTime(bigIsMilestone(t) ? e.milestone : e.start) }),
            t.milestone && !bigIsMilestone(t) ? el('div', { class: 'ms num', text: t.milestone + ' ' + fmtTime(e.milestone) }) : null,
            e.note ? el('div', { class: 'note', text: e.note }) : null]);
          if (canRemind && t.kind !== 'event') makeTappable(tile, e);
          grid.appendChild(tile);
        });
        sec.appendChild(grid);
      }
      wrap.appendChild(sec);
    });
    if (isToday && ui.shabbosWin && !$("#app").classList.contains("display")) wrap.appendChild(shabbosSection(ui.shabbosWin));
    return wrap;
  }
  /* ---------- the hallway screen (?view=display): one card per tefilla, tiles in columns, nothing to scroll ---------- */
  /* A card per tefilla. A repeating line ("every 10 minutes from … to …") shows its next minyan as a tile and the rest as one line. */
  var NEXT_TEMPLATE = '{tefilla}\n{room}\n{time}\n{milestone}\n{countdown}';
  var NEXT_VARS = ['tefilla', 'room', 'time', 'milestone', 'countdown', 'day', 'note'];
  /* The hallway screen's next-minyan panel, line by line, from the template in the Hallway screen tab. A line is styled by the piece it
     carries: {room} large, {time} largest, {countdown} in red; a line of plain words comes out small. */
  /* The hallway screen can stay on a minyan for a few minutes after it starts (Hallway screen → The next-minyan panel), so someone
     a minute late still reads where it is. The latest minyan to have started within that time is the one held. */
  function heldMinyan(now, rd) {
    var hold = Math.max(0, Math.min(60, +cfg.nextHold || 0)) * 60000, best = null, i, j, s, e, k;
    if (!hold) return null;
    for (i = -1; i <= 0; i++) {
      s = scheduleFor(rd + i);
      for (j = 0; j < s.all.length; j++) { e = s.all[j]; if (e.tefilla.kind === 'event') continue; k = countMs(e); if (k <= now && now - k < hold && (!best || k >= best.at)) best = { entry: e, sched: s, at: k, until: k + hold }; }
    }
    return best;
  }
  function nextPanelFromTemplate(next, e, up, now, after) {
    var tpl = (cfg.nextTemplate == null || cfg.nextTemplate === '' ? NEXT_TEMPLATE : String(cfg.nextTemplate)), bigMs = bigIsMilestone(e.tefilla);
    var vals = {
      tefilla: e.tefilla.name,
      room: e.room || '',
      time: fmtTime(bigMs ? e.milestone : e.start),
      milestone: e.tefilla.milestone && !bigMs ? e.tefilla.milestone + ' ' + fmtTime(e.milestone) : (bigMs ? startLabel(e.tefilla) + ' ' + fmtTime(e.start) : ''),
      countdown: '',
      day: up.daysAhead > 0 ? (up.daysAhead === 1 ? S().tomorrow + ', ' : '') + S().days[up.sched.info.dow] + ' ' + Cal.formatHeb(up.sched.info.heb) : '',
      note: e.note || ''
    };
    tpl.split('\n').forEach(function (line) {
      var txt = line.replace(/\{(\w+)\}/g, function (m, k) { return vals.hasOwnProperty(k) ? vals[k] : m; }).trim();
      var isCount = /\{countdown\}/.test(line);
      if (!txt && !isCount) return;
      var cls = isCount ? 'count num' : /\{time\}/.test(line) ? 'time num' : /\{room\}/.test(line) ? 'rm' : /\{tefilla\}/.test(line) ? 'tf' : /\{milestone\}/.test(line) ? 'ms num' : 'when';
      if (isCount && after !== undefined) { /* a minyan that has started has nothing to count down to: the one after it is named there instead */
        if (after) next.appendChild(el('div', { class: 'then' }, [el('span', { class: 'lbl', text: S().thenNext }), el('span', { class: 'num', text: fmtTime(bigIsMilestone(after.tefilla) ? after.milestone : after.start) }), el('span', { text: after.room || after.tefilla.name })]));
        return;
      }
      var node = el('div', { class: cls, text: isCount ? fmtCountdown(ui.countdownMs - now) : txt });
      if (isCount) ui.countdown = node;
      next.appendChild(node);
    });
  }
  function wallCard(title, nodes) {
    var sec = el('section', { class: 'tefilla' }, [el('h3', null, [title])]);
    nodes.forEach(function (n) { if (n) sec.appendChild(n); });
    return sec;
  }
  function wallSections(s, now, up, force) {
    var out = [], latestMs = (s.all || []).reduce(function (m, e) { return e.tefilla.kind !== 'event' && e.ms <= now && e.ms > m ? e.ms : m; }, 0);
    tefillaLists(s, now, !force).forEach(function (x) {
      var t = x.t, list = x.fromTomorrow ? x.list : wallWindowList(x.list, now, up), counts = {}, feature = {}; /* the next day's list (Sunday's Shacharis on a Friday afternoon) is shown whole, every minyan a tile */
      if (!list.length) return;
      /* the whole day stays on the screen: the ones that have gone are shown light, the one that went last in its own colour */
      var started = list.filter(function (e) { return e.ms <= now; }), lastStarted = started[started.length - 1];
      function st(e) {
        var s0 = entryState(e, now, up);
        if (e === lastStarted) return 'prev' + (s0 === 'now' && e.ms >= latestMs ? ' now' : ' gone'); /* עכשיו belongs to the minyan that started last on the whole screen: Mincha's last one gives it up the moment a Maariv starts */ /* the one before the next: light green, with עכשיו while it is fresh */
        if (s0 === 'next' && !nextMarkedNow(e, now)) return 'next-quiet'; /* still the next one (it keeps a tile of its own), not yet marked as such */
        return s0 === 'now' ? 'past' : s0;
      }
      list.forEach(function (e) {
        if (!e.series) return;
        counts[e.series.id] = (counts[e.series.id] || 0) + 1;
        /* a run shows its next minyan as a tile (its last one once the run is over) and the whole run as a line */
        if (!feature[e.series.id] || (feature[e.series.id].ms <= now && e.ms > now)) feature[e.series.id] = e;
      });
      /* the last minyan that still says שמונה עשרה before סוף זמן תפילה, and the last before חצות */
      var marks = {}, zz = zmanimFor(list[0].rd), am = amidahMinutes(), dayOf = Cal.dayInfo(list[0].rd, !!cfg.israel);
      if (t.milestone && !dayOf.shabbos && !dayOf.yomtov) { /* "the last minyan to reach שמונה עשרה in time" is reckoned at the weekday pace: on Shabbos and Yom Tov davening runs longer, and the mark would mislead */
        [['tefilla', S().lastTefilla], ['chatzos', S().lastChatzos]].forEach(function (pair) {
          var lim = zz[pair[0]], best = null;
          if (lim == null || isNaN(lim)) return;
          list.forEach(function (e) { if ((e.milestone != null ? e.milestone : e.start) + am <= lim) best = e; });
          if (best) marks[list.indexOf(best)] = marks[list.indexOf(best)] ? marks[list.indexOf(best)] + ' · ' + pair[1] : pair[1];
        });
      }
      /* A minyan the gabbai set at מנחה גדולה (the schedule line goes by that zman) says so on the same kind of tab, on any day:
         it is the reason the minyan is when it is. */
      list.forEach(function (e, i) { if (e.zman === 'minchag' && Math.abs(e.zoff || 0) <= 15) marks[i] = marks[i] ? marks[i] + ' · ' + zmanName('minchag') : zmanName('minchag'); });
      var nodes = [], grid = el('div', { class: 'grid' }), late = el('div', { class: 'grid after-runs' }), opened = {}, runs = [], tiles = [];
      list.forEach(function (e) {
        var s0 = st(e), sid = e.series && e.series.id, keep = s0.indexOf('next') === 0 || s0.indexOf('prev') === 0; /* the next one and the one before it always get a tile of their own */
        if (sid && counts[sid] >= 3 && !keep && !x.fromTomorrow) {
          if (!opened[sid]) { opened[sid] = { s: e.series, items: [] }; runs.push(opened[sid]); }
          opened[sid].items.push(e); return; /* a run is its box; only its next minyan and the one before it (above) get tiles of their own. A tile for a run's first minyan, hours ahead, read as an extra minyan beside the box. */
        }
        tiles.push(e);
      });
      /* a run with a single minyan left over shows it as a tile, in its place among the others */
      runs.forEach(function (r) { if (r.items.length < 2) tiles = tiles.concat(r.items); });
      tiles.sort(function (a, b) { return list.indexOf(a) - list.indexOf(b); });
      /* The frame reads in the order of the clock: the tiles, then the runs as lines, then any minyan that starts after the last
         run has ended (a 12:00 Maariv after "every 15 minutes, 10:30–11:30"). Such a tile used to stand above the lines. */
      var lines = runs.filter(function (r) { return r.items.length >= 2; }), lastEnd = lines.reduce(function (m, r) { return Math.max(m, r.s.to); }, -Infinity);
      tiles.forEach(function (e) { (lines.length && e.start > lastEnd ? late : grid).appendChild(wallTile(e, t, st(e), marks[list.indexOf(e)])); });
      if (grid.children.length) nodes.push(grid);
      lines.forEach(function (r) {
        nodes.push(el('div', { class: 'runline' + (r.s.to <= Cal.nowInTz(now, loc().tz).min ? ' past' : '') }, [
          /* how often in the board's accent, the hours large beside it, the rooms under them: read from across the hallway like a tile */
          el('span', { class: 'num' }, [el('span', { class: 'ev', text: S().runEvery(r.s.every) }), el('span', { class: 'dot', text: ' · ' }), el('span', { class: 'hrs' }, [el('span', { class: 'w', text: S().runFrom }), ' ', el('span', { class: 'h', text: fmtTime(r.s.from) }), ' ', el('span', { class: 'w', text: S().runTo }), ' ', el('span', { class: 'h', text: fmtTime(r.s.to) })])]), /* "פון 6:05 ביז 10:25": the words small, the two times as large as a tile's */
          r.s.rooms && r.s.rooms.length ? el('span', { class: 'rooms', text: r.s.rooms.join(' · ') }) : null]));
      });
      if (late.children.length) nodes.push(late);
      out.push({ t: t, title: sectionTitle(x), sub: t.name + (x.fromTomorrow ? ' – ' + whenLabel(x) : ''), nodes: nodes });
    });
    return out;
  }
  /* General → Hallway screen: the whole day, or only the minyanim near this moment */
  /* w: the settings to go by — the saved ones, or, for the back end's "on the screen now", the ones standing in its form */
  function wallWindowList(list, now, up, w) {
    w = w || cfg.wallWindow || {};
    if (!list.length || (w.mode !== 'window' && w.mode !== 'count')) return list;
    var ahead = list.filter(function (e) { return e.ms > now; }), near;
    if (w.mode === 'count') { /* by number: so many still to come, so many that have started */
      var nNext = Math.max(1, Math.min(60, Math.round(w.next == null ? 6 : +w.next) || 1)), nRecent = Math.max(0, Math.min(20, Math.round(w.recent == null ? 2 : +w.recent) || 0));
      var gone = list.filter(function (e) { return e.ms <= now; });
      near = (nRecent ? gone.slice(-nRecent) : []).concat(ahead.slice(0, nNext));
      if (ahead.length || w.neverEmpty === false) return ahead.length ? near : []; /* with none still to come the tefilla is over: its frame goes, unless the screen is never to be left empty */
      return near.length ? near : list.slice(-3);
    }
    var before = (w.before == null ? 180 : +w.before) * 60000, after = (w.after == null ? 20 : +w.after) * 60000;
    near = list.filter(function (e) { return e.ms > now ? e.ms - now <= before : now - e.ms <= after; });
    if (near.length || w.neverEmpty === false) return near;
    return ahead.length ? ahead.slice(0, 4) : list.slice(-3); /* nothing near: rather than an empty frame, a tefilla still shows its next few */
  }
  /* the next minyan's tile is marked (green, הבא) all the time, or only from so many minutes before it starts (Hallway screen → How the tiles behave) */
  function nextMarkedNow(e, now) {
    var m = cfg.nextMark; if (m == null || m === '' || !(+m > 0)) return true;
    return keyMs(e) - now <= +m * 60000;
  }
  function wallTile(e, t, st, mark) {
    return el('div', { class: 'tile' + (st ? ' ' + st : '') + (mark ? ' marked' : '') + (t.kind === 'event' ? ' event' : '') }, [
      el('div', { class: 'room', text: e.room || t.name }),
      bigIsMilestone(t) ? el('div', { class: 'ms num pre', text: startLabel(t) + ' ' + fmtTime(e.start) }) : null,
      el('div', { class: 'time num', text: fmtTime(bigIsMilestone(t) ? e.milestone : e.start) }),
      t.milestone && !bigIsMilestone(t) ? el('div', { class: 'ms num', text: t.milestone + ' ' + fmtTime(e.milestone) }) : null,
      e.note ? el('div', { class: 'note', text: e.note }) : null,
      mark ? el('div', { class: 'mark', text: mark }) : null]);
  }
  /* the hallway screen: only the next three zmanim, large; the first of them carries the countdown. Once the day's are over they come
     from tomorrow, and a tomorrow one that fills the row late in the day is marked. */
  var ZMAN_ORDER = ['alos', 'sunrise', 'shemaMGA', 'shema', 'tefillaMGA', 'tefilla', 'chatzos', 'minchag', 'minchak', 'candles', 'sunset', 'tzeis60', 'tzeis', 'tzeis72', 'chatzosNight'];
  /* the zman that has just gone, so the hallway screen can show one on either side of the one it is counting to */
  function prevZman(info, z, rd, now) {
    var tz = loc().tz, best = null;
    function day(d, dInfo, dz) {
      ZMAN_ORDER.forEach(function (k) {
        if (k === 'candles' && dInfo.candles !== 'day') return;
        if (zmanHidden(k)) return;
        var v = dz[k]; if (v == null || isNaN(v)) return;
        var ms = Cal.epochFromWall(d, Math.round(v), tz);
        if (ms <= now && (!best || ms > best.ms)) best = { key: k, min: v, ms: ms, past: true };
      });
    }
    day(rd, info, z);
    if (!best) { var d0 = rd - 1; day(d0, Cal.dayInfo(d0, !!cfg.israel), zmanimFor(d0)); }
    return best;
  }
  function nextZmanim(info, z, rd, now, n) {
    var keys = ZMAN_ORDER, tz = loc().tz, out = [];
    function day(d, dInfo, dz, ahead) {
      keys.forEach(function (k) {
        if (k === 'candles' && dInfo.candles !== 'day') return;
        if (zmanHidden(k)) return;
        var v = dz[k]; if (v == null || isNaN(v)) return;
        var ms = Cal.epochFromWall(d, Math.round(v), tz);
        if (ms > now) out.push({ key: k, min: v, ms: ms, tomorrow: ahead });
      });
    }
    day(rd, info, z, false);
    if (out.length < n) { var d2 = rd + 1; day(d2, Cal.dayInfo(d2, !!cfg.israel), zmanimFor(d2), true); }
    out.sort(function (a, b) { return a.ms - b.ms; });
    return out.slice(0, n);
  }
  function wallZmanim(info, z, rd, now) {
    var sec = el('section', { class: 'tefilla zcard' }), grid = el('div', { class: 'grid zgrid' }), L = S();
    /* the one that has just gone, the one being counted to, and the one after it: the middle one large, its neighbours small */
    var ahead = nextZmanim(info, z, rd, now, 2), gone = prevZman(info, z, rd, now);
    var list = (gone ? [gone] : []).concat(ahead), hereIdx = gone ? 1 : 0;
    var allTomorrow = ahead.length && ahead.every(function (x) { return x.tomorrow; });
    sec.appendChild(el('h3', null, [allTomorrow ? L.zmanimOf + L.tomorrow : L.zmanim]));
    function tile(name, time, cls, tag) {
      return el('div', { class: 'ztile' + (cls ? ' ' + cls : '') }, [
        el('div', { class: 'room', text: name }), tag ? el('div', { class: 'tag', text: tag }) : null, el('div', { class: 'time num', text: time })]);
    }
    var h = info.heb, nightFast = (h.m === 7 && h.d === 10) || (h.m === 5 && info.fast), nowMin = Cal.nowInTz(now, loc().tz).min;
    /* What the day itself has to say stands in a row of its own above the three zmanim, so those keep their order: gone, now, next.
       A line with a time leaves the card once that time is an hour gone and the three below are already tomorrow's: last night's
       "מוצאי שבת" is not left standing under "זמני מחר". */
    var dayRow = el('div', { class: 'zday' });
    function dayTile(name, value, at) { if (at != null && !isNaN(at) && allTomorrow && nowMin > at + 60) return; dayRow.appendChild(tile(name, value, 'hi')); }
    if (info.fast && !nightFast) dayTile(L.fastStart, fmtTime(z.alos), z.alos);
    if (info.fast || info.yomKippur) dayTile(L.fastEnd, fmtTime(z.tzeis), z.tzeis);
    if (info.motzaei && !info.yomKippur) dayTile(info.motzaei === 'shabbos' ? L.motzaeiShabbos : L.motzaeiYT, fmtTime(z.tzeis), z.tzeis); /* only on the day whose nightfall ends it */
    else if (info.candles === 'night') dayTile(zmanName('candles'), fmtTime(z.tzeis), z.tzeis); /* Shabbos or Yom Tov running into Yom Tov: candles after nightfall */
    var omer = rd - Cal.rdFromHeb(h.m <= 6 ? h.y : h.y + 1, 1, 15);
    if (omer >= 0 && omer <= 49) {
      if (!isNaN(z.sunset) && nowMin >= z.sunset && omer + 1 <= 49) dayTile(L.omerTonight, (omer + 1) + L.laomer);
      else if (omer >= 1) dayTile(L.omer, omer + L.laomer);
    }
    if (dayRow.children.length) sec.appendChild(dayRow);
    ui.zcount = null; ui.zcountMs = 0;
    list.forEach(function (x, i) {
      var here = i === hereIdx;
      var t = tile(zmanName(x.key), zTime(x.key, x.min), (here ? 'now' : 'zsm') + (x.past ? ' past' : ''), x.tomorrow && !allTomorrow ? L.tomorrow : '');
      if (here) { ui.zcountMs = x.ms; ui.zcount = el('div', { class: 'count num', text: fmtCountdown(x.ms - now) }); t.appendChild(ui.zcount); }
      grid.appendChild(t);
    });
    if (!list.length) grid.appendChild(el('div', { class: 'hint', text: L.none }));
    sec.appendChild(grid);
    return sec;
  }
  /* a frame with more minyanim than fit turns its pages: so many seconds on each (Hallway screen → How the tiles behave) */
  function pageMs() { var v = +cfg.pageSeconds; return (v >= 3 && v <= 60 ? v : 8) * 1000; }
  /* The hallway screen fits the TV: it scales with the screen (General → "Hallway screen size"), and when a column still does not fit, the
     whole screen shrinks a little (never below 60%); only if that is not enough does the fullest card page through its tiles. */
  function fitLobby() {
    var html = document.documentElement, main = $('#app') && $('#app').querySelector('main.wall');
    ui.pages = [];
    if (!main) return;
    var want = ui.lobbyScale || 1, pass, lo = 0.5, hi = want, best = 0, over;
    function set(v) { html.style.setProperty('--lobby-scale', String(v)); }
    function overflow() {
      var worst = Math.max(0, html.scrollHeight - window.innerHeight);
      Array.prototype.forEach.call(main.children, function (c) { worst = Math.max(worst, c.scrollHeight - c.clientHeight); });
      return worst;
    }
    set(want); over = overflow();
    if (over > 1) { /* the largest size that still fits, to about half a percent */
      for (pass = 0; pass < 7; pass++) {
        var mid = (lo + hi) / 2; set(mid);
        if (overflow() <= 1) { best = mid; lo = mid; } else hi = mid;
      }
      set(best || lo); over = overflow();
    }
    if (over <= 1) return;
    /* still too tall: the tallest card pages through its tiles, whole rows at a time */
    Array.prototype.forEach.call(main.children, function (col) {
      var spare = col.clientHeight - col.scrollHeight;
      while (spare < -1) {
        var cards = Array.prototype.filter.call(col.children, function (c) { return c.querySelector('.grid') && !c.dataset.paged; });
        if (!cards.length) break;
        var card = cards.sort(function (a, b) { return b.offsetHeight - a.offsetHeight; })[0], grid = card.querySelector('.grid'), tiles = grid.children;
        if (!tiles.length) { card.dataset.paged = '1'; continue; }
        var cs = getComputedStyle(grid), gap = parseFloat(cs.rowGap) || 0, rowH = tiles[0].offsetHeight + gap;
        var rows = Math.max(1, Math.floor((grid.clientHeight + spare + gap) / rowH)), hgt = rows * rowH - gap;
        if (hgt >= grid.scrollHeight - 1) { card.dataset.paged = '1'; break; }
        grid.style.height = hgt + 'px'; grid.style.overflow = 'hidden'; card.dataset.paged = '1';
        var pages = Math.ceil(grid.scrollHeight / hgt), dots = el('span', { class: 'pg', 'aria-hidden': 'true' });
        card.querySelector('h3').appendChild(dots);
        var p = { grid: grid, step: hgt + gap, pages: pages, idx: 0, dots: dots };
        paintDots(p); ui.pages.push(p);
        spare = col.clientHeight - col.scrollHeight;
      }
    });
    if (!ui.pageAt) ui.pageAt = Date.now();
  }
  function paintDots(p) { var t = '', i; for (i = 0; i < p.pages; i++) t += (i ? ' ' : '') + (i === p.idx ? '●' : '○'); p.dots.textContent = t; }
  function turnPage(p) { p.idx = (p.idx + 1) % p.pages; p.grid.scrollTo({ top: p.idx * p.step, behavior: 'smooth' }); paintDots(p); }
  /* phones: one tefilla at a time behind tabs, each minyan a row, the past ones folded away */
  function isPhone() { return !!(window.matchMedia && window.matchMedia('(max-width: 640px)').matches); }
  function phoneSections(s, now, up, isToday) {
    var wrap = el('div', { class: 'col phone' }), canRemind = canSetReminders();
    var lists = tefillaLists(s, now, isToday).filter(function (x) { return x.list.length || x.t.kind !== 'event'; });
    wrap.appendChild(dayHead(s, isToday));
    if (!lists.length) return wrap;
    var ids = lists.map(function (x) { return x.t.id; }), want = ui.phoneTab || (up ? up.entry.tefilla.id : null), active = ids.indexOf(want) >= 0 ? want : ids[0];
    var tabs = el('div', { class: 'ttabs', role: 'tablist' });
    lists.forEach(function (x) { tabs.appendChild(el('button', { type: 'button', role: 'tab', 'aria-selected': String(x.t.id === active), text: x.t.name + (x.fromTomorrow ? ' · ' + whenLabel(x, true) : ''), onclick: function () { ui.phoneTab = x.t.id; render(); } })); });
    wrap.appendChild(tabs);
    var x = lists.filter(function (l) { return l.t.id === active; })[0], t = x.t, sec = el('section', { class: 'tefilla' });
    sec.appendChild(el('h3', null, [sectionTitle(x)]));
    if (!x.list.length) sec.appendChild(el('div', { class: 'none', text: S().none }));
    else {
      var rows = el('div', { class: 'rows' }), past = x.list.filter(function (e) { return entryState(e, now, up) === 'past'; });
      var hidden = !ui.showPast && past.length > KEEP_PAST && past.length < x.list.length ? past.slice(0, past.length - KEEP_PAST) : [], fold = hidden.length > 0; /* the last three past minyanim stay, dimmed */
      if (fold) rows.appendChild(el('button', { type: 'button', class: 'btn small foldbtn', text: S().showEarlier + ' (' + hidden.length + ')', onclick: function () { ui.showPast = true; render(); } }));
      x.list.forEach(function (e) {
        var st = entryState(e, now, up);
        if (fold && hidden.indexOf(e) >= 0) return;
        var big = bigIsMilestone(t), row = el('div', { class: 'row' + (st ? ' ' + st : '') + (t.kind === 'event' ? ' event' : '') }, [
          el('div', { class: 'rtime' }, [el('span', { class: 'time num', text: fmtTime(big ? e.milestone : e.start) }), t.milestone ? el('span', { class: 'ms num', text: big ? startLabel(t) + ' ' + fmtTime(e.start) : t.milestone + ' ' + fmtTime(e.milestone) }) : null]),
          el('div', { class: 'rroom' }, [el('span', { class: 'room', text: e.room || t.name }), e.note ? el('span', { class: 'note', text: e.note }) : null]),
          st === 'next' ? el('span', { class: 'badge next', text: S().badgeNext }) : st === 'now' ? el('span', { class: 'badge now', text: S().badgeNow }) : null]);
        if (canRemind && t.kind !== 'event') makeTappable(row, e);
        rows.appendChild(row);
      });
      sec.appendChild(rows);
    }
    wrap.appendChild(sec);
    if (isToday && ui.shabbosWin) wrap.appendChild(shabbosSection(ui.shabbosWin));
    return wrap;
  }
  function zmanimPanel(info, z, title) {
    var keys = ['alos', 'sunrise', 'shemaMGA', 'shema', 'tefillaMGA', 'tefilla', 'chatzos', 'minchag', 'minchak', 'candles', 'sunset', 'tzeis60', 'tzeis', 'tzeis72', 'chatzosNight'];
    var ul = el('ul', { class: 'zlist' }), rd = info.rd, nowMin = title ? -1 : Cal.nowInTz(Date.now(), loc().tz).min, canRemind = !title && canSetReminders(), nowMs = Date.now(), tz = loc().tz, zt = zmanimFor(rd + 1), L = S(); /* another day's panel: no "passed" marks, no reminders */
    var h = info.heb, nightFast = (h.m === 7 && h.d === 10) || (h.m === 5 && info.fast); /* Yom Kippur and Tisha B'Av begin the evening before */
    if (info.fast && !nightFast) ul.appendChild(el('li', { class: 'hi' }, [el('span', { text: L.fastStart }), el('span', { class: 'z num', text: fmtTime(z.alos) })]));
    if (info.fast || info.yomKippur) ul.appendChild(el('li', { class: 'hi' }, [el('span', { text: L.fastEnd }), el('span', { class: 'z num', text: fmtTime(z.tzeis) })]));
    if (info.motzaei && !info.yomKippur) ul.appendChild(el('li', { class: 'hi' }, [el('span', { text: info.motzaei === 'shabbos' ? L.motzaeiShabbos : L.motzaeiYT }), el('span', { class: 'z num', text: fmtTime(z.tzeis) })]));
    else if (info.candles === 'night') ul.appendChild(el('li', { class: 'hi' }, [el('span', { text: zmanName('candles') }), el('span', { class: 'z num', text: fmtTime(z.tzeis) })])); /* Shabbos or Yom Tov running into Yom Tov: candles after nightfall */
    var omer = rd - Cal.rdFromHeb(h.m <= 6 ? h.y : h.y + 1, 1, 15); /* days since 15 Nisan of this spring */
    if (omer >= 0 && omer <= 49) {
      var tonight = omer + 1, today = omer;
      if (!isNaN(z.sunset) && nowMin >= z.sunset && tonight <= 49) ul.appendChild(el('li', { class: 'hi' }, [el('span', { text: L.omerTonight }), el('span', { class: 'z num', text: tonight + L.laomer })]));
      else if (today >= 1) ul.appendChild(el('li', { class: 'hi' }, [el('span', { text: L.omer }), el('span', { class: 'z num', text: today + L.laomer })]));
    }
    keys.forEach(function (k) {
      if (k === 'candles' && info.candles !== 'day') return;
      if (zmanHidden(k)) return;
      if (k === 'tzeis' && (info.motzaei || info.candles === 'night' || info.fast)) return; /* it already stands at the head of the list under its own name */
      var hi = k === 'candles', v = z[k];
      /* a zman that has passed keeps today's time, dimmed; tapping it then sets a reminder for tomorrow's */
      var passed = !isNaN(v) && nowMs >= Cal.epochFromWall(rd, Math.round(v), tz) + 60000, nextDay = passed && !isNaN(zt[k]);
      var li = el('li', { class: (hi ? 'hi' : '') + (passed ? ' past' : '') }, [el('span', { text: zmanName(k) }), el('span', { class: 'z num', text: zTime(k, v) })]);
      if (canRemind && (nextDay || (!passed && !isNaN(v)))) makeTappable(li, nextDay ? { zman: k, rd: rd + 1, min: zt[k] } : { zman: k, rd: rd, min: v }); /* tap a zman to be reminded before it */
      ul.appendChild(li);
    });
    return el('section', { class: 'side' }, [el('h3', { text: title || L.zmanim }), ul]);
  }
  /* The titles around a name — מו״ה, ב״ר, הי״ו and their like — are set small, so the name itself carries the panel. */
  var HON_WORDS = 'מו"ה מוה"ר הרה"ח הרה"ג הרה"צ הרה"ק הר"ר הרב הגאון הרבני כ"ק ה"ה רבי ר\' הי"ו שליט"א ני"ו נ"י ז"ל ע"ה זצ"ל זי"ע שיחי\' תחי\' ב"ר בהר"ר בה"ר בן בת מרת האשה החשובה החשוב הנגיד'.split(' ');
  var HONS = {};
  function normHon(t) { return t.replace(/[\u05f4"]/g, '"').replace(/[\u05f3']/g, "'"); }
  HON_WORDS.forEach(function (t) { HONS[normHon(t)] = 1; });
  function nameRuns(name) {
    var toks = (name || '').trim().split(/\s+/).filter(Boolean), runs = [];
    if (!toks.length) return runs;
    if (!toks.some(function (t) { return !HONS[normHon(t)]; })) return [{ text: toks.join(' '), small: false }]; /* titles only: let them stand full size */
    toks.forEach(function (t) {
      var small = !!HONS[normHon(t)], last = runs[runs.length - 1];
      if (last && last.small === small) last.text += ' ' + t; else runs.push({ text: t, small: small });
    });
    return runs;
  }
  /* the lines under the name read the same way: a title small, everything else as it is */
  function honLines(text) {
    return (text || '').split('\n').map(function (line) {
      var toks = line.split(/(\s+)/), out = [];
      toks.forEach(function (t) {
        if (!t) return;
        if (/^\s+$/.test(t)) { out.push(t); return; }
        out.push(HONS[normHon(t)] ? el('span', { class: 'hon', text: t }) : t);
      });
      return out;
    });
  }
  /* One sponsor panel, as the board shows it; the donation form in the back end shows the same one as its preview. */
  function sponsorPanel(n) {
    var nm = (n.name || '').trim(), logo = (n.logo || '').trim();
    var nameEl = nm ? el('div', { class: 'n' }, nameRuns(nm).map(function (r) {
      return el('span', { class: r.small ? 'hon' : 'nm', text: r.text });
    })) : null;
    return el('section', { class: 'sponsor' + (n.size === 'big' ? ' sp-big' : n.size === 'small' ? ' sp-sm' : n.size === 'tiny' ? ' sp-xs' : '') + (n.kind === 'day' || /פרנס היום/.test(n.title || '') ? ' sp-day' : '') }, [ /* פרנס היום stands out in gold */
      el('div', { class: 'frame' }),
      el('h2', { class: 't', text: n.title || '' }),
      (n.lead || '').trim() ? el('div', { class: 'lead', text: n.lead.trim() }) : null, /* the line that leads into the name: נתנדב לעילוי נשמת and its like */
      nameEl && logo ? el('div', { class: 'nrow' }, [el('img', { class: 'slogo', src: logo, alt: '', loading: 'lazy' }), nameEl]) : nameEl,
      /* each line its own block: a line too long for the panel then breaks into even halves, never leaving its last word alone */
      el('div', { class: 'b' }, honLines((n.body || '').trim()).map(function (parts) { return el('div', { class: 'bl' }, parts.length ? parts : ['\u00a0']); }))]);
  }
  /* The kinds of donation a shul sells, each with how its panel reads: the title ({month} and {parsha} are filled in from the
     start date), how big it stands on the screen, the line that leads into the name, and how long it usually runs. */
  /* Every kind starts at the large size: a donation has to read from the hallway, whichever kind it is. On the hallway screen the
     clock gives up the room for it (see .aclock in the stylesheet). A smaller size is still there to choose, per kind or per donation. */
  var DONATION_KINDS = [
    { id: 'month', name: 'פרנס החודש', title: 'פרנס חודש {month}', size: 'big', lead: '', period: 'month' },
    { id: 'ner', name: 'נר למאור', title: 'נר למאור לחודש {month}', size: 'big', lead: 'נתנדב לעילוי נשמת', period: 'month' },
    { id: 'week', name: 'פרנס השבוע', title: 'פרנס השבוע', size: 'big', lead: '', period: 'week' },
    { id: 'day', name: 'פרנס היום', title: 'פרנס היום', size: 'big', lead: '', period: 'day' }];
  /* Sponsor boxes (פרנס החודש and friends) in a framed strip under the header */
  function sponsorsStrip(rd, min) {
    var items = [];
    engine.activeNotices(rd, min).forEach(function (n) { items.push(sponsorPanel(n)); });
    if (ui.sponsorTimer) { clearInterval(ui.sponsorTimer); ui.sponsorTimer = null; }
    if (!items.length) return null;
    var rotate = $('#app').classList.contains('room') && items.length > 1; /* a door tablet shows one at a time; the hallway screen has a column for them all */
    if (!rotate) return el('div', { class: 'sponsors' }, [el('div', { class: 'sponsors-inner' }, items)]);
    /* lobby / door screens: one sponsor at a time, cycling with a fade; the index survives the minute-by-minute re-render */
    var idx = (ui.sponsorIndex || 0) % items.length, secs = Math.max(2, +cfg.sponsorSeconds || 8);
    function show(i) { items.forEach(function (it, k) { it.classList.toggle('on', k === i); it.setAttribute('aria-hidden', k === i ? 'false' : 'true'); }); }
    show(idx);
    ui.sponsorTimer = setInterval(function () { idx = (idx + 1) % items.length; ui.sponsorIndex = idx; show(idx); }, secs * 1000);
    return el('div', { class: 'sponsors' }, [el('div', { class: 'sponsors-inner rotating' }, items)]);
  }
  function smsPanel() {
    var num = (cfg.smsNumber || '').trim();
    if (!num) return null;
    var digits = num.replace(/[^\d+]/g, '');
    return el('section', { class: 'side' }, [
      el('h3', { text: 'המנין הבא בהודעת טקסט' }),
      el('p', { class: 'sms-text', text: 'שלחו את המילה „מנין” למספר' }),
      el('div', { class: 'sms-num num', dir: 'ltr', text: num }),
      el('p', { class: 'hint', text: 'אפשר גם: שחרית, מנחה, מעריב, היום, מחר, זמנים' }),
      el('a', { class: 'btn', href: 'sms:' + digits + '?&body=' + encodeURIComponent('מנין'), text: 'שליחת הודעה' }),
      cfg.siteUrl ? el('p', { class: 'hint' }, [el('a', { href: cfg.siteUrl.replace(/\/?$/, '/') + 'sms.html', text: 'פרטי השירות' })]) : null]);
  }
  /* ---------- app notifications (web push through the notification service) ---------- */
  /* a reminder service is configured for this board */
  function pushConfigured() { return !inArtifact && window.isSecureContext && !!(cfg.notifyUrl || '').trim(); }
  /* ...and this browser can actually receive notifications (on iPhone/iPad only the installed app can) */
  function pushSupported() { return pushConfigured() && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; }
  function pushState() { try { return JSON.parse(localStorage.getItem('minyan-push') || 'null'); } catch (e) { return null; } }
  function urlB64ToBytes(b) { b = b.replace(/-/g, '+').replace(/_/g, '/'); while (b.length % 4) b += '='; var bin = atob(b), out = new Uint8Array(bin.length), i; for (i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
  function notifyBase() { return cfg.notifyUrl.trim().replace(/\/+$/, ''); }
  /* ---------- reminders: which minyan, how long before, every day or today only ---------- */
  var ZMAN_KEYS = ['alos', 'sunrise', 'shemaMGA', 'shema', 'tefillaMGA', 'tefilla', 'chatzos', 'minchag', 'minchak', 'candles', 'sunset', 'tzeis60', 'tzeis', 'tzeis72', 'chatzosNight'];
  function picksFor(t) { return t.period === 'pm' ? ['first', 'last', 'before:sunset', 'before:tzeis'] : ['first', 'last', 'before:shema', 'before:tefilla', 'before:chatzos']; }
  function pushPrefs() { var st = pushState(); return (st && st.prefs) || { reminders: [], daily: null }; }
  function isoOf(rd) { return MinyanEngine.isoDate(rd); }
  function canSetReminders() { return pushConfigured() && !$('#app').classList.contains('display') && !ui.roomFilter; }
  function describeReminder(r) {
    if (r.zman) return r.lead + SU().minBefore + zmanName(r.zman, SU()) + (r.once ? SU().todayOnlyP : '');
    var t = tefillos().filter(function (x) { return x.id === r.tefilla; })[0], name = t ? t.name : r.tefilla;
    return r.lead + SU().minBefore + (r.time != null ? name + ' ' + fmtTime(r.time) : SU().pickWith(SU().picks[r.pick || 'first'] || '', name)) + (r.ref === 'milestone' && t && t.milestone ? ' (' + t.milestone + ')' : '') + (r.once ? SU().todayOnlyP : '');
  }
  /* a minyan tile on the board opens a small "remind me" box */
  function makeTappable(tile, e) {
    tile.classList.add('tap'); tile.setAttribute('role', 'button'); tile.setAttribute('tabindex', '0'); tile.setAttribute('title', SU().setRemTitle);
    tile.addEventListener('click', function () { openReminder(e); });
    tile.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openReminder(e); } });
  }
  function openReminder(e) {
    if (isIOS() && !isStandalone()) { toast(SU().installFirst, 9000); return; }
    if (!pushSupported()) { toast(SU().noPush, 7000); return; }
    preparePush().catch(function () {}); /* ready before "Set reminder" is tapped */
    var old = $('#rem-overlay'); if (old) old.remove();
    var what = e.zman ? zmanName(e.zman, SU()) + ' ' + fmtTime(e.min) : e.tefilla.name + (e.room ? ' – ' + e.room : '') + ' ' + fmtTime(e.start), dayIso = isoOf(e.rd), isToday = dayIso === isoOf(Cal.nowInTz(Date.now(), loc().tz).rd);
    var lead = el('input', { type: 'number', min: '1', max: '180', value: '10', class: 'mins', inputmode: 'numeric', id: 'rem-lead' });
    var once = el('input', { type: 'radio', name: 'rem-when', value: 'once', id: 'rem-once' }), daily = el('input', { type: 'radio', name: 'rem-when', value: 'daily', id: 'rem-daily' });
    once.checked = true;
    /* for a minyan with a milestone: count to the start or to הודו, as this phone's big number says unless changed here */
    var refStart = el('input', { type: 'radio', name: 'rem-ref', value: 'start', id: 'rem-ref-start' }), refMs = el('input', { type: 'radio', name: 'rem-ref', value: 'milestone', id: 'rem-ref-ms' });
    (bigMode() === 'milestone' ? refMs : refStart).checked = true;
    var refRow = (!e.zman && e.tefilla.milestone) ? el('div', { class: 'push-row' }, [el('span', { class: 'push-lbl', text: SU().before }), el('label', { for: 'rem-ref-start' }, [refStart, ' ' + startLabel(e.tefilla) + ' ' + fmtTime(e.start)]), el('label', { for: 'rem-ref-ms' }, [refMs, ' ' + e.tefilla.milestone + ' ' + fmtTime(e.milestone)])]) : null;
    var msg = el('div', { class: 'hint', id: 'rem-msg' }), ov = el('div', { class: 'overlay modal', id: 'rem-overlay', dir: sheetDir() });
    function close() { ov.remove(); }
    var setB = el('button', { type: 'button', class: 'btn primary', id: 'rem-set', text: SU().setRem, onclick: function () {
      var prefs = pushPrefs(), ld = Math.max(1, Math.min(180, +lead.value || 10)), r = e.zman ? { zman: e.zman, lead: ld } : { tefilla: e.tefilla.id, time: e.start, lead: ld };
      if (once.checked) r.once = dayIso;
      if (refRow && refMs.checked) r.ref = 'milestone';
      prefs.reminders = (prefs.reminders || []).filter(function (x) { return e.zman ? x.zman !== e.zman : !(x.tefilla === r.tefilla && x.time === r.time); }).concat([r]).slice(-10);
      setB.disabled = true; msg.textContent = SU().setting;
      subscribePush(prefs).then(function () { close(); ui.remDraft = null; toast(SU().remSet + describeReminder(r), 6000); render(); },
        function (err) { setB.disabled = false; msg.textContent = SU().remFail + (err && err.message || err); });
    } });
    ov.appendChild(el('div', { class: 'panel small' }, [
      el('h2', { text: SU().remindMe }),
      el('div', { class: 'rem-what', dir: 'rtl', text: what }),
      el('div', { class: 'push-row' }, [el('label', { for: 'rem-lead', class: 'push-lbl', text: SU().minutesBefore }), lead]),
      refRow,
      el('div', { class: 'push-row' }, [el('label', { for: 'rem-once' }, [once, ' ' + (isToday ? SU().todayOnly : SU().thatDayOnly)]), el('label', { for: 'rem-daily' }, [daily, ' ' + (e.zman ? SU().everyDay : SU().everyDayAt)])]),
      el('p', { class: 'hint', text: SU().remNote }),
      msg,
      el('div', { class: 'bar' }, [el('button', { type: 'button', class: 'btn', id: 'rem-cancel', text: SU().cancel, onclick: close }), setB])]));
    ov.addEventListener('click', function (ev) { if (ev.target === ov) close(); });
    document.body.appendChild(ov);
    lead.focus();
  }
  function pushPanel(L) {
    L = L || S();
    if (!pushConfigured()) return null;
    var st = pushState(), box = el('section', { class: 'side', id: 'push-panel' }, [el('h3', { text: L.remTitle })]);
    if (isIOS() && !isStandalone()) { box.appendChild(el('p', { class: 'hint', text: L.installFirst })); return box; }
    if (!pushSupported()) { box.appendChild(el('p', { class: 'hint', text: L.noPush })); return box; }
    preparePush().catch(function () {}); /* ready before the first tap */
    var prefs = pushPrefs(), today = scheduleFor(Cal.nowInTz(Date.now(), loc().tz).rd), tfs = tefillos().filter(function (t) { return t.kind !== 'event'; });
    if (!tfs.length) return null;
    box.appendChild(el('p', { class: 'hint', text: L.remHint }));
    /* the rows being edited survive the board's minute-by-minute refresh */
    var draft = ui.remDraft || { list: prefs.reminders.map(function (r) { return { tefilla: r.zman ? 'z:' + r.zman : r.tefilla, time: r.time == null ? null : +r.time, pick: r.pick || 'first', lead: +r.lead || 10, once: r.once || null, ref: r.ref === 'milestone' ? 'milestone' : 'start' }; }),
      daily: prefs.daily != null, dailyAt: prefs.daily != null ? pad2(Math.floor(prefs.daily / 60)) + ':' + pad2(prefs.daily % 60) : '06:00' };
    ui.remDraft = draft;
    var list = draft.list, rows = el('div', { class: 'col rem-rows' });
    function rowEl(r) {
      var tSel = el('select', { 'aria-label': 'Tefilla or zman' });
      tfs.forEach(function (t) { tSel.appendChild(el('option', { value: t.id, text: t.name })); });
      var zg = el('optgroup', { label: L.zmanimGroup }); ZMAN_KEYS.forEach(function (k) { if (zmanHidden(k)) return; zg.appendChild(el('option', { value: 'z:' + k, text: zmanName(k, L) })); }); tSel.appendChild(zg);
      tSel.value = r.tefilla; if (tSel.selectedIndex < 0) { tSel.value = tfs[0].id; r.tefilla = tfs[0].id; }
      var wSel = el('select', { 'aria-label': 'Which minyan' });
      function fillWhich() {
        wSel.textContent = '';
        wSel.hidden = tSel.value.indexOf('z:') === 0; if (wSel.hidden) return; /* a zman is its own target */
        var t = tfs.filter(function (x) { return x.id === tSel.value; })[0] || tfs[0];
        picksFor(t).forEach(function (p) { wSel.appendChild(el('option', { value: 'p:' + p, text: L.picks[p] })); });
        (today.byTefilla[t.id] || []).forEach(function (x) { wSel.appendChild(el('option', { value: 't:' + x.start, text: fmtTime(x.start) + (x.room ? ' ' + x.room : '') })); });
        wSel.value = r.time != null ? 't:' + r.time : 'p:' + r.pick;
        if (wSel.selectedIndex < 0) { wSel.appendChild(el('option', { value: 't:' + r.time, text: fmtTime(r.time) })); wSel.value = 't:' + r.time; }
      }
      fillWhich();
      /* before the start or before the milestone (הודו), for a tefilla that has one */
      var refSel = el('select', { 'aria-label': 'Before the start or the milestone' }, [el('option', { value: 'start', text: 'start' }), el('option', { value: 'milestone', text: 'milestone' })]);
      function fillRef() {
        var t = tfs.filter(function (x) { return x.id === tSel.value; })[0], has = !!(t && t.milestone) && tSel.value.indexOf('z:') !== 0;
        refSel.hidden = !has;
        if (has) { refSel.options[0].text = startLabel(t); refSel.options[1].text = t.milestone; refSel.value = r.ref === 'milestone' ? 'milestone' : 'start'; }
      }
      fillRef();
      refSel.addEventListener('change', function () { r.ref = refSel.value; });
      tSel.addEventListener('change', function () { r.tefilla = tSel.value; r.time = null; r.pick = 'first'; r.ref = bigMode(); fillWhich(); fillRef(); });
      wSel.addEventListener('change', function () { var v = wSel.value; if (v.charAt(0) === 't') { r.time = +v.slice(2); r.pick = 'first'; } else { r.time = null; r.pick = v.slice(2); } });
      var lead = el('input', { type: 'number', min: '1', max: '180', value: String(r.lead), class: 'mins', inputmode: 'numeric', 'aria-label': 'Minutes before' });
      lead.addEventListener('input', function () { r.lead = Math.max(1, Math.min(180, +lead.value || 10)); });
      var when = el('select', { 'aria-label': 'Every day or today only' }, [el('option', { value: 'daily', text: L.everyDay }), el('option', { value: 'today', text: L.todayOnly })]);
      when.value = r.once ? 'today' : 'daily';
      when.addEventListener('change', function () { r.once = when.value === 'today' ? isoOf(Cal.nowInTz(Date.now(), loc().tz).rd) : null; });
      var del = el('button', { type: 'button', class: 'btn small', text: '×', title: L.remove, 'aria-label': L.remove, onclick: function () { list.splice(list.indexOf(r), 1); renderRows(); } });
      return el('div', { class: 'rem-row' }, [tSel, wSel, el('span', { class: 'rem-lead' }, [lead, L.minBefore]), refSel, when, del]);
    }
    function renderRows() { rows.textContent = ''; list.forEach(function (r) { rows.appendChild(rowEl(r)); }); if (!list.length) rows.appendChild(el('div', { class: 'hint', text: L.noRems })); }
    renderRows();
    var addB = el('button', { type: 'button', class: 'btn small', id: 'rem-add', text: L.addRem, onclick: function () { if (list.length >= 10) { toast(L.maxRems); return; } list.push({ tefilla: tfs[0].id, time: null, pick: 'first', lead: 10, once: null, ref: bigMode() }); renderRows(); } });
    var daily = el('input', { type: 'checkbox', id: 'push-daily' }); daily.checked = draft.daily;
    daily.addEventListener('change', function () { draft.daily = daily.checked; });
    var dailyAt = el('input', { type: 'time', id: 'push-daily-at', value: draft.dailyAt });
    dailyAt.addEventListener('change', function () { draft.dailyAt = dailyAt.value; });
    var msg = el('div', { class: 'hint', id: 'push-msg' });
    var saveB = el('button', { class: 'btn primary small', id: 'push-save', text: st ? L.remUpdate : L.remOn, onclick: function () {
      var reminders = list.map(function (r) { var o = r.tefilla.indexOf('z:') === 0 ? { zman: r.tefilla.slice(2), lead: r.lead } : { tefilla: r.tefilla, time: r.time, lead: r.lead }; if (!o.zman && r.time == null) o.pick = r.pick; if (!o.zman && r.ref === 'milestone') o.ref = 'milestone'; if (r.once) o.once = r.once; return o; });
      var d = daily.checked ? (function () { var m = /^(\d{2}):(\d{2})$/.exec(dailyAt.value); return m ? +m[1] * 60 + +m[2] : 6 * 60; })() : null;
      if (!reminders.length && d == null) { msg.textContent = L.remAtLeast; return; }
      saveB.disabled = true; msg.textContent = L.turningOn;
      subscribePush({ reminders: reminders, daily: d }).then(function () { ui.remDraft = null; msg.textContent = L.remsOn; render(); }, function (e) { saveB.disabled = false; msg.textContent = L.remOnFail + (e && e.message || e); });
    } });
    var form = el('div', { class: 'col' }, [rows, el('div', { class: 'tabs' }, [addB]),
      el('div', { class: 'push-row' }, [el('label', { for: 'push-daily', class: 'push-lbl' }, [daily, L.dailyAt]), dailyAt]),
      el('div', { class: 'tabs' }, [saveB, st ? el('button', { class: 'btn small', id: 'push-off', text: L.remOff, onclick: function () { ui.remDraft = null; unsubscribePush().then(function () { render(); }); } }) : null]),
      msg]);
    box.appendChild(form);
    return box;
  }
  /* The service-worker registration and the push key are fetched ahead of time, so that subscribing can start inside the user's tap:
     Safari shows the notification prompt from subscribe() itself and refuses it once the tap has "expired". */
  function preparePush() {
    if (!pushSupported()) return Promise.reject(new Error(SU().noPush));
    if (!ui.pushPrep) ui.pushPrep = Promise.all([
      navigator.serviceWorker.ready,
      fetch(notifyBase() + '/push/key').then(function (r) { if (!r.ok) throw new Error('The reminder service did not answer (' + r.status + ')'); return r.text(); })
    ]).then(function (x) { ui.swReg = x[0]; ui.pushKey = x[1].trim(); }, function (e) { ui.pushPrep = null; throw e; });
    return ui.pushPrep;
  }
  function subscribePush(prefs) {
    var base = notifyBase(), st = pushState(), p;
    function doSubscribe() { return ui.swReg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToBytes(ui.pushKey) }); }
    /* Safari only honours these calls while the tap is being handled. Permission not granted yet: ask for it first (that is what shows the
       system prompt), then subscribe straight away. Already granted and prepared: subscribe synchronously, right here. */
    var perm0 = (typeof Notification !== 'undefined' && Notification.permission) || '?', asked = '';
    if (perm0 !== 'granted') {
      p = Notification.requestPermission().then(function (res) { asked = res; if (res !== 'granted') throw new Error('Notification permission: ' + res); return (ui.swReg && ui.pushKey) ? doSubscribe() : preparePush().then(doSubscribe); });
    } else if (ui.swReg && ui.pushKey) { try { p = doSubscribe(); } catch (e) { p = Promise.reject(e); } }
    else p = preparePush().then(doSubscribe);
    return p.catch(function (e) {
      var ua = navigator.userAgent || '', eng = /CriOS/.test(ua) ? 'Chrome' : /FxiOS/.test(ua) ? 'Firefox' : /EdgiOS/.test(ua) ? 'Edge' : 'Safari', osm = /OS (\d+)[_.](\d+)/.exec(ua);
      var perm = (typeof Notification !== 'undefined' && Notification.permission) || '?', detail = ' [was ' + perm0 + (asked ? ', asked: ' + asked : '') + ', now ' + perm + '; ' + ((e && e.name) || '') + ': ' + ((e && e.message) || e) + '; ' + eng + (osm ? ', iOS ' + osm[1] + '.' + osm[2] : '') + (isStandalone() ? ', installed' : ', browser tab') + ']';
      if (e && (e.name === 'NotAllowedError' || /denied/i.test(e.message || ''))) {
        if (perm === 'denied') throw new Error('Notifications are blocked for this app. iPhone/iPad: Settings → Notifications → ' + (cfg.name || 'the app') + ' → Allow Notifications; if the app is not listed there, check Settings → Apps → Safari → Advanced → Feature Flags (Notifications, Push API on), Screen Time restrictions and Lockdown Mode. Chrome: the lock next to the address → Notifications → Allow. Then tap again.' + detail);
        throw new Error('The device did not let the app ask for notifications. Tap "Set reminder" once more; if it fails again, close the app fully, open it again from its icon and retry.' + detail);
      }
      throw e;
    }).then(function (sub) {
      return fetch(base + '/push/subscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: st && st.id, subscription: sub.toJSON(), reminders: prefs.reminders, daily: prefs.daily, lang: 'he' }) /* notifications in English; room names stay as on the board */ })
        .then(function (r) { if (!r.ok) throw new Error('The service did not answer (' + r.status + ')'); return r.json(); });
    }).then(function (j) { try { localStorage.setItem('minyan-push', JSON.stringify({ id: j.id, prefs: prefs })); } catch (e) {} });
  }
  function unsubscribePush() {
    var st = pushState(), base = notifyBase();
    try { localStorage.removeItem('minyan-push'); } catch (e) {}
    return Promise.resolve(st && st.id ? fetch(base + '/push/unsubscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: st.id }) }).catch(function () {}) : null)
      .then(function () { return navigator.serviceWorker.ready; }).then(function (reg) { return reg.pushManager.getSubscription(); }).then(function (sub) { if (sub) return sub.unsubscribe(); }).catch(function () {});
  }
  /* ---------- Settings sheet: everything a person can set for themselves, in one place ---------- */
  function installApp() { if (!deferredInstall) return; var ev = deferredInstall; deferredInstall = null; ev.prompt(); ev.userChoice.then(refreshInstallBtn, refreshInstallBtn); }
  /* step by step: how to put the board on the home screen of this device */
  function installGuide(closeSheet) {
    var ua = navigator.userAgent || '', ios = isIOS(), android = /Android/i.test(ua), safari = ios && !/CriOS|FxiOS|EdgiOS|OPiOS|OPT\//.test(ua), out = [];
    function step(k, text, icon) { return el('li', null, [el('span', { class: 'stepn', text: String(k) }), icon ? svgIcon(icon) : null, el('span', { text: text })]); }
    function copyRow() {
      var url = location.href.split('#')[0].replace(/admin\.html$/, '');
      return el('div', { class: 'copyrow' }, [el('code', { text: url }), el('button', { type: 'button', class: 'btn small', text: SU().copyAddr, onclick: function () {
        (navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(url) : Promise.reject()).then(function () { toast(SU().copied); }, function () { toast(url, 8000); });
      } })]);
    }
    if (inArtifact) return out;
    if (isStandalone()) { out.push(el('div', { class: 'installed' }, [el('span', { class: 'okmark', text: '✓' }), el('span', { text: SU().installed })])); return out; }
    if (deferredInstall) {
      out.push(el('p', { class: 'hint', text: SU().oneTap }));
      out.push(el('button', { type: 'button', class: 'btn primary', text: SU().installApp, onclick: function () { installApp(); closeSheet(); } }));
      return out;
    }
    if (ios && safari) {
      out.push(el('p', { class: 'hint', text: SU().iosSafari }));
      out.push(el('ol', { class: 'guide' }, [step(1, SU().iosStep1, 'share'), step(2, SU().iosStep2, 'plus'), step(3, SU().iosStep3, 'home')]));
    } else if (ios) {
      out.push(el('p', { class: 'hint', text: SU().iosOther }));
      out.push(copyRow());
      out.push(el('ol', { class: 'guide' }, [step(1, SU().iosOther1, 'link'), step(2, SU().iosOther2, 'share')]));
    } else if (android) {
      out.push(el('p', { class: 'hint', text: SU().android }));
      out.push(el('ol', { class: 'guide' }, [step(1, SU().and1, 'menu'), step(2, SU().and2, 'plus'), step(3, SU().and3, 'home')]));
    } else {
      out.push(el('p', { class: 'hint', text: SU().desktop }));
      out.push(el('ol', { class: 'guide' }, [step(1, SU().desk1, 'install'), step(2, SU().desk2(cfg.name || 'לוח המנינים'), 'plus')]));
    }
    return out;
  }
  /* The back end on this device as a shortcut of its own (its page has its own manifest: name, icon, the address it opens at).
     Where the browser can do it itself, one button does it; elsewhere, the steps for this device, and the address to paste. */
  function adminShortcut() {
    var ua = navigator.userAgent || '', ios = isIOS(), android = /Android/i.test(ua), safari = ios && !/CriOS|FxiOS|EdgiOS|OPiOS|OPT\//.test(ua), edge = /Edg\//.test(ua), nodes = [], buttons = [];
    var url = location.origin + location.pathname.replace(/[^/]*$/, '') + 'admin';
    function steps(list) { return el('ol', { class: 'guide' }, list.map(function (x, i) { return el('li', null, [el('span', { class: 'stepn', text: String(i + 1) }), x[1] ? svgIcon(x[1]) : null, el('span', { text: x[0] })]); })); }
    function copyRow() {
      return el('div', { class: 'copyrow' }, [el('code', { text: url }), el('button', { type: 'button', class: 'btn small', id: 'adm-copy', 'data-nodirty': '1', text: 'Copy', onclick: function () {
        (navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(url) : Promise.reject()).then(function () { toast('Address copied'); }, function () { toast(url, 8000); });
      } })]);
    }
    if (isStandalone()) {
      nodes.push(el('div', { class: 'installed' }, [el('span', { class: 'okmark', text: '✓' }), el('span', { text: 'This is the back end\'s own shortcut: you opened it from its icon.' })]));
      buttons.push({ text: 'Close', kind: 'primary', cancel: true });
    } else if (deferredInstall) {
      nodes.push(el('p', { text: 'Puts the back end on this device with an icon of its own, named “Back end”. The icon opens the back end, not the board.' }));
      buttons.push({ text: 'Not now', cancel: true });
      buttons.push({ text: 'Add it', kind: 'primary', id: 'adm-install-go', act: function () { installApp(); } });
    } else {
      nodes.push(el('p', { text: 'A shortcut made from this page opens the back end, with an icon of its own, named “Back end”.' }));
      if (ios && safari) nodes.push(steps([['Tap the Share button, the square with an arrow, at the bottom of Safari.', 'share'], ['Choose “Add to Home Screen”.', 'plus'], ['Tap “Add”.', 'home']]));
      else if (ios) { nodes.push(el('p', { class: 'hint', text: 'On an iPhone or iPad a shortcut is added from Safari. Open this address in Safari:' })); nodes.push(copyRow()); nodes.push(steps([['In Safari, tap the Share button, the square with an arrow.', 'share'], ['Choose “Add to Home Screen”, then “Add”.', 'plus']])); }
      else if (android) nodes.push(steps([['Tap the three dots at the top of the browser.', 'menu'], ['Choose “Add to Home screen” or “Install app”.', 'plus'], ['Tap “Add” or “Install”.', 'home']]));
      else {
        nodes.push(steps(edge ? [['Open the browser\'s menu, the three dots at the top right.', 'menu'], ['Choose “Apps”, then “Install this site as an app”.', 'install'], ['Press “Install”. Tick “Create Desktop shortcut” when it asks.', 'plus']]
          : [['Open the browser\'s menu, the three dots at the top right.', 'menu'], ['Choose “Cast, save and share”, then “Install page as app”.', 'install'], ['Press “Install”.', 'plus']]));
        nodes.push(el('p', { class: 'hint', text: 'Or, on any computer: right-click the desktop, choose New, then Shortcut, and paste this address.' }));
        nodes.push(copyRow());
      }
      buttons.push({ text: 'Close', kind: 'primary', cancel: true });
    }
    askBox('The back end on this device', nodes, buttons);
  }
  function openSettings(goto) {
    var old = $('#set-overlay'); if (old) old.remove();
    var ov = el('div', { class: 'overlay modal', id: 'set-overlay', dir: sheetDir() });
    function close() { ov.remove(); }
    function section(title, desc, kids) { return el('section', { class: 'sset' }, [el('h3', { text: title }), desc ? el('p', { class: 'hint', text: desc }) : null].concat(kids)); }
    function srow(label, ctl, forId) { return el('label', { class: 'srow', for: forId }, [el('span', { text: label }), ctl]); }
    function keep(key, value, def) { try { if (value === def) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch (e) {} render(); }
    var disp = [], msT = tefillos().filter(function (t) { return t.milestone && t.kind !== 'event'; })[0];
    if (msT) { /* the milestone (הודו) as the big number instead of the start */
      var bigSel = el('select', { id: 'big-time', 'aria-label': 'Which time is the big number' }, [el('option', { value: 'start', text: startLabel(msT) + ' (' + SU().startWord + ')' }), el('option', { value: 'milestone', text: msT.milestone })]);
      bigSel.value = bigMode();
      bigSel.addEventListener('change', function () { try { localStorage.setItem('minyan-big', bigSel.value); } catch (e) {} render(); });
      disp.push(srow(SU().bigNumber, bigSel, 'big-time'));
    }
    var lookSel = el('select', { id: 'look', 'aria-label': 'Look of the board' }, LOOKS.map(function (l) { return el('option', { value: l[0], text: l[1] }); }));
    lookSel.value = lookMode();
    lookSel.addEventListener('change', function () { keep('minyan-look', lookSel.value, lookDefault()); });
    disp.push(srow(SU().look, lookSel, 'look'));
    var langSel = el('select', { id: 'lang', 'aria-label': 'Language of the labels' }, [el('option', { value: 'he', text: 'עברית' }), el('option', { value: 'yi', text: 'יידיש' })]);
    langSel.value = langMode();
    langSel.addEventListener('change', function () { keep('minyan-lang', langSel.value, langDefault()); });
    disp.push(srow(SU().labels, langSel, 'lang'));
    /* English for the sheets only: the board keeps its Hebrew or Yiddish */
    var uiSel = el('select', { id: 'ui-lang', 'aria-label': 'Language of the settings' }, [el('option', { value: '', text: SU().sameAsBoard }), el('option', { value: 'en', text: 'English' })]);
    uiSel.value = uiLang() === 'en' ? 'en' : '';
    uiSel.addEventListener('change', function () { try { if (uiSel.value === 'en') localStorage.setItem('minyan-ui-lang', 'en'); else localStorage.removeItem('minyan-ui-lang'); } catch (e) {} render(); close(); openSettings(); });
    disp.push(srow(SU().uiLangLabel, uiSel, 'ui-lang'));
    var sheet = el('div', { class: 'panel sheet' }, [
      el('div', { class: 'sheet-head' }, [el('h2', { text: SU().settings }), el('button', { type: 'button', class: 'btn icon', text: '✕', 'aria-label': SU().close, onclick: close })]),
      section(SU().display, SU().displayHint, disp),
      section(SU().cdBox, SU().cdHint, [el('button', { type: 'button', class: 'btn small', id: 'zc-open', text: SU().chooseZmanim, onclick: openCountdownChooser })])]);
    var pp = pushPanel(SU()); if (pp) { pp.classList.add('inset'); sheet.appendChild(pp); }
    var app = inStoreApp() ? [] : installGuide(close); /* already the app: no guide to installing it, only the check for updates */
    app.push(el('button', { type: 'button', class: 'btn small', id: 'check-updates', text: SU().checkUpdates, onclick: function () {
      var p = ('serviceWorker' in navigator) ? navigator.serviceWorker.getRegistration().then(function (r) { return r ? r.update() : null; }) : Promise.resolve();
      p.then(function () { return loadRemote(); }).then(function () { toast(SU().upToDate); }, function () { toast(SU().checkFail); });
    } }));
    var appSec = section(inStoreApp() ? SU().appSec : SU().installSec, '', app); appSec.id = 'sset-app';
    sheet.appendChild(appSec);
    sheet.appendChild(el('div', { class: 'bar' }, [el('button', { type: 'button', class: 'btn primary', id: 'set-done', text: SU().done, onclick: close })]));
    ov.appendChild(sheet);
    ov.addEventListener('click', function (ev) { if (ev.target === ov) close(); });
    document.body.appendChild(ov);
    if (goto === 'app') appSec.scrollIntoView({ block: 'start' });
  }
  function footer() {
    var L = cfg.location || {};
    var f = el('footer', null, [el('span', { text: S().timesBy + (L.name || (L.lat + ', ' + L.lng)) + ' · ' + (cfg.israel ? S().eretz : S().chul) })]);
    var right = el('div', { class: 'tabs ltr', dir: 'ltr' });
    ui.iosHint = el('button', { type: 'button', class: 'btn small', id: 'install-guide', text: S().installApp, onclick: function () { openSettings('app'); } });
    ui.installBtn = el('button', { class: 'btn small primary', text: S().installApp, onclick: installApp });
    ui.editBtn = el('button', { class: 'btn small', text: S().edit, onclick: openAdmin });
    ui.editBtn.hidden = !canEditNow();
    right.appendChild(el('button', { type: 'button', class: 'btn small', id: 'settings-open', text: S().footerSettings, onclick: openSettings }));
    right.appendChild(ui.iosHint); right.appendChild(ui.installBtn); right.appendChild(ui.editBtn);
    refreshInstallBtn();
    f.appendChild(right);
    return f;
  }
  function updateClock(now) {
    if (!ui.clock && !ui.aclock) return;
    var p = Cal.tzParts(now, loc().tz), h = cfg.clock24 ? pad2(p.hh) : String(p.hh % 12 || 12);
    if (ui.clock) { ui.clock.firstChild.textContent = h + ':' + pad2(p.mm); ui.clock.lastChild.textContent = pad2(p.ss); }
    if (ui.aclock) {
      function turn(list, deg) { Array.prototype.forEach.call(list, function (x) { x.setAttribute('transform', 'rotate(' + deg + ' 100 100)'); }); }
      turn(ui.aclock.h, (p.hh % 12) * 30 + p.mm * 0.5); turn(ui.aclock.m, p.mm * 6 + p.ss * 0.1); turn(ui.aclock.s, p.ss * 6);
      if (ui.aclock.t) ui.aclock.t.textContent = h + ':' + pad2(p.mm) + ':' + pad2(p.ss);
      if (ui.aclock.d) ui.aclock.d.textContent = h + ':' + pad2(p.mm) + ':' + pad2(p.ss);
    }
  }
  /* the lobby screen's round clock: an SVG face whose hands updateClock turns every second */
  function analogClock(now, withDigital) {
    var wrap = el('div', { class: 'aclock', 'aria-hidden': 'true' }), svg = '', i, a;
    for (i = 0; i < 60; i++) svg += '<line class="tick' + (i % 5 ? '' : ' major') + '" x1="100" y1="' + (i % 5 ? 9 : 6) + '" x2="100" y2="' + (i % 5 ? 13 : 16) + '" transform="rotate(' + (i * 6) + ' 100 100)"/>';
    for (i = 1; i <= 12; i++) { a = i * Math.PI / 6; svg += '<text x="' + (100 + 73 * Math.sin(a)).toFixed(1) + '" y="' + (100 - 73 * Math.cos(a)).toFixed(1) + '">' + i + '</text>'; }
    wrap.innerHTML = '<svg viewBox="0 0 200 200"><circle class="face" cx="100" cy="100" r="97"/><circle class="rim" cx="100" cy="100" r="91"/>' + svg +
      '<rect class="digbox" x="60" y="128" width="80" height="25" rx="8"/>' +
      /* Over the digital time a hand is drawn as an outline only, so the time can be read through it: the solid hands leave out the
         readout's box (mask), and inside the box the same hands are drawn hollow, with the time on top of them. */
      '<defs><mask id="ac-mask"><rect x="0" y="0" width="200" height="200" fill="#fff"/><rect x="60" y="128" width="80" height="25" rx="8" fill="#000"/></mask>' +
      '<clipPath id="ac-clip"><rect x="60" y="128" width="80" height="25" rx="8"/></clipPath></defs>' +
      '<g mask="url(#ac-mask)"><line class="hand hour" x1="100" y1="112" x2="100" y2="52"/><line class="hand minute" x1="100" y1="114" x2="100" y2="30"/><line class="hand second" x1="100" y1="118" x2="100" y2="24"/></g>' +
      '<g clip-path="url(#ac-clip)" class="ol"><line class="hand hour" x1="100" y1="112" x2="100" y2="52"/><line class="hand minute" x1="100" y1="114" x2="100" y2="30"/>' +
      '<line class="hand hour in" x1="100" y1="112" x2="100" y2="52"/><line class="hand minute in" x1="100" y1="114" x2="100" y2="30"/><line class="hand second" x1="100" y1="118" x2="100" y2="24"/></g>' +
      '<text class="dig" x="100" y="141"></text><circle class="cap" cx="100" cy="100" r="5"/></svg>';
    if (cfg.wallLogo) { /* a logo on the dial, between the 12 and the hands, the way a watch carries its name */
      var svgEl = wrap.querySelector('svg'), lg = document.createElementNS('http://www.w3.org/2000/svg', 'image');
      lg.setAttribute('class', 'dial-logo'); lg.setAttribute('x', '61'); lg.setAttribute('y', '45'); lg.setAttribute('width', '78'); lg.setAttribute('height', '36');
      lg.setAttribute('preserveAspectRatio', 'xMidYMid meet'); lg.setAttribute('href', cfg.wallLogo);
      lg.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', cfg.wallLogo);
      svgEl.insertBefore(lg, svgEl.querySelector('.digbox'));
    }
    var digital = withDigital === false ? null : el('div', { class: 'atime num' });
    if (digital) wrap.appendChild(digital);
    ui.aclock = { h: wrap.querySelectorAll('.hour'), m: wrap.querySelectorAll('.minute'), s: wrap.querySelectorAll('.second'), t: digital, d: wrap.querySelector('.dig') };
    updateClock(now);
    return wrap;
  }
  function tick() {
    var now = Date.now();
    if (ui.adminOpen) return;
    updateClock(now);
    if (ui.countdownMs && now >= ui.countdownMs) { render(); return; }
    if (ui.zcountMs && now >= ui.zcountMs) { render(); return; }
    if (ui.countdown) ui.countdown.textContent = fmtCountdown(ui.countdownMs - now);
    if (ui.zcount) ui.zcount.textContent = fmtCountdown(ui.zcountMs - now);
    if (ui.pages && ui.pages.length && now - (ui.pageAt || 0) >= pageMs()) { ui.pageAt = now; ui.pages.forEach(turnPage); }
    if (Math.floor(now / 60000) !== ui.lastMinute) render();
  }

  /* ---------- admin ---------- */
  /* The admin page knows itself by what it is, not only by its address: a host that serves admin.html at the short address /admin
     (GitHub Pages does) must still open the back end there, not the board. */
  function isAdminPage() {
    return /(^|\/)admin(\.html|\/)?$/i.test(location.pathname) || location.hash === '#admin' ||
      !!document.querySelector('meta[name="minyan-page"][content="admin"]');
  }
  function canEditNow() { return isAdminPage() && (mode === 'artifact' ? canEdit : true); }
  function sha256Hex(str) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(str)).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    });
  }
  function checkPin(value) {
    var subtle = window.crypto && crypto.subtle;
    if (cfg.pinHash && subtle) return sha256Hex(value).then(function (h) { return h === cfg.pinHash; });
    if (cfg.pin != null && cfg.pin !== '') return Promise.resolve(value === String(cfg.pin));
    if (cfg.pinHash) return Promise.resolve(false);
    return Promise.resolve(value === '1234');
  }
  function refreshEditBtn() { if (ui.editBtn) ui.editBtn.hidden = !canEditNow(); }
  function toast(msg, ms) {
    var t = $('#toast');
    if (t) t.remove();
    t = el('div', { id: 'toast', class: 'toast', dir: /[\u0590-\u05FF]/.test(msg) ? 'rtl' : 'ltr', text: msg });
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, ms || 3500);
  }
  /* A question that must be answered before going on: a title, what it is about, and a button for each answer. Escape and the
     first button marked `safe` are the way out that changes nothing. */
  function askBox(title, nodes, buttons) {
    var prev = document.activeElement, old = $('#askbox'); if (old) old.remove();
    var foot = el('div', { class: 'dn-foot' }, [el('span', { class: 'sp' })]), back;
    function close() { document.removeEventListener('keydown', onKey, true); back.remove(); if (prev && prev.focus) { try { prev.focus(); } catch (e) {} } }
    function onKey(ev) { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); close(); buttons.forEach(function (b) { if (b.cancel && b.act) b.act(); }); } }
    buttons.forEach(function (b) { foot.appendChild(el('button', { type: 'button', class: 'btn' + (b.kind ? ' ' + b.kind : ''), id: b.id || null, 'data-nodirty': '1', text: b.text, onclick: function () { close(); if (b.act) b.act(); } })); });
    back = el('div', { class: 'dn-modal', id: 'askbox', dir: 'ltr' }, [el('div', { class: 'dn-sheet ask', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': title }, [
      el('div', { class: 'dn-head' }, [el('h2', { text: title })]), el('div', { class: 'dn-body one' }, [el('div', { class: 'ask-body' }, nodes)]), foot])]);
    document.addEventListener('keydown', onKey, true);
    ($('#overlay') || document.body).appendChild(back);
    var first = foot.querySelector('.btn.primary') || foot.querySelector('.btn'); if (first) first.focus();
  }
  function overlay(content, cls) {
    var old = $('#overlay'); if (old) old.remove();
    var o = el('div', { id: 'overlay', class: 'overlay ' + (cls || 'full'), dir: 'ltr' }, [el('div', { class: 'panel' }, [content])]);
    $('#app').appendChild(o);
    ui.adminOpen = true;
  }
  function closeOverlay() { ui.adminOpen = false; render(); }
  function openAdmin() { ui.adminDirty = false; if (mode !== 'artifact' && !pinOk) showPin(); else { ui.formBase = ui.inc || 0; buildAdmin(); } }
  function showPin() {
    var input = el('input', { type: 'password', id: 'pin-input', inputmode: 'numeric', autocomplete: 'off' });
    var msg = el('div', { class: 'hint' });
    var form = el('form', { class: 'pin', onsubmit: function (ev) {
      ev.preventDefault();
      checkPin(input.value).then(function (ok) {
        if (ok) {
          pinOk = true;
          try { sessionStorage.setItem('minyan-pin', '1'); } catch (e) {}
          ui.pinValue = input.value; ui.adminDirty = false; closeOverlay(); ui.formBase = ui.inc || 0; buildAdmin();
        } else { msg.textContent = 'Wrong PIN'; input.select(); }
      });
    } }, [
      el('div', { class: 'pin-mark' }, [svgIcon('lock')]),
      el('h2', { text: cfg.name || 'Board settings' }),
      el('div', { class: 'hint', text: 'Enter the PIN to open the settings.' }),
      el('div', { class: 'field' }, [el('label', { for: 'pin-input', text: 'PIN' }), input]), msg,
      el('div', { class: 'bar' }, [el('button', { class: 'btn primary', type: 'submit', text: 'Enter' }), el('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: closeOverlay })])]);
    overlay(form, 'modal');
    input.focus();
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function field(label, input, extra) { return el('div', { class: 'field' }, [el('label', { for: input.id, text: label }), input, extra || null]); }
  function inp(id, value, attrs) {
    var a = { id: id, type: 'text', dir: 'auto', value: value == null ? '' : String(value) }, k;
    if (attrs) for (k in attrs) a[k] = attrs[k];
    return el('input', a);
  }
  function chk(id, checked, label) {
    var c = el('input', { id: id, type: 'checkbox' });
    c.checked = !!checked;
    return el('label', { for: id }, [c, ' ' + label]);
  }
  var ICONS = {
    rolls: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 4v16"/>',
    screen: '<rect x="2" y="4" width="20" height="14" rx="2"/><path d="M8 21h8M12 18v3"/>',
    tv: '<rect x="2" y="4" width="20" height="14" rx="2"/><path d="M8 21h8M12 18v3"/>',
    today: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><circle cx="12" cy="15.5" r="1.7" fill="currentColor" stroke="none"/>',
    general: '<path d="M4 6h8M18 6h2M4 12h2M12 12h8M4 18h10M20 18h0"/><circle cx="14" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="16" cy="18" r="2"/>',
    schedule: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    notices: '<path d="M3 10v4a1 1 0 0 0 1 1h3l6 4V5L7 9H4a1 1 0 0 0-1 1z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/>',
    donations: '<path d="M12 20.5s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.9c0 5.4-7.5 10-7.5 10z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12M9 7V4h6v3"/>',
    overrides: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
    publish: '<path d="M7 18a4 4 0 0 1-.6-7.95A6 6 0 0 1 18 8.5a4 4 0 0 1-1 7.5"/><path d="M12 12v9M8.5 15.5 12 12l3.5 3.5"/>',
    data: '<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4"/>',
    send: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10 21a2 2 0 0 0 4 0"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    share: '<path d="M12 3v12M8 7l4-4 4 4"/><path d="M5 11v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9"/>',
    plus: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 8v8M8 12h8"/>',
    home: '<path d="M3 11 12 3l9 8"/><path d="M5 10v10h14V10"/>',
    menu: '<circle cx="12" cy="5" r="1.7" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="12" cy="19" r="1.7" fill="currentColor" stroke="none"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.5 1.5"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.5-1.5"/>',
    install: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M12 8v5M9.5 10.5 12 13l2.5-2.5M8 20h8"/>',
    chev: '<path d="M6 9l6 6 6-6"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    open: '<path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
    logout: '<path d="M10 17l5-5-5-5M15 12H3M13 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6"/>',
    shere: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12"/>'
  };
  function svgIcon(name) {
    var sp = el('span', { class: 'ico', 'aria-hidden': 'true' });
    sp.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + (ICONS[name] || '') + '</svg>';
    return sp;
  }
  /* a minutes box with − and + beside it (5 at a time); typing still works */
  function stepper(input, big) {
    var w = el('span', { class: 'step' }), dec = el('button', { type: 'button', text: '−', 'aria-label': 'Less', tabindex: '-1' }), inc = el('button', { type: 'button', text: '+', 'aria-label': 'More', tabindex: '-1' });
    function bump(d) { var min = input.min === '' ? -Infinity : +input.min, v = (+input.value || 0) + d; if (v < min) v = min; input.value = String(v); input.dispatchEvent(new Event('input', { bubbles: true })); }
    dec.addEventListener('click', function () { bump(-(big || 1)); }); inc.addEventListener('click', function () { bump(big || 1); });
    w.appendChild(dec); w.appendChild(input); w.appendChild(inc);
    return w;
  }
  /* a titled card for the admin pages; fill card.body */
  function card(title, desc, opts) {
    var body = el('div', { class: 'cbody' }), fold = !!(opts && opts.fold);
    var head = el('div', { class: 'chead' }, [el('div', null, [el('h3', { text: title }), desc ? el('div', { class: 'cdesc', text: desc }) : null]), opts && opts.extra ? opts.extra : null, fold ? el('span', { class: 'chev' }, [svgIcon('chev')]) : null]);
    var c = el('section', { class: 'card' + (fold ? ' fold' : '') + (opts && opts.cls ? ' ' + opts.cls : '') }, [head, body]);
    /* on a phone a folding card is a full-width box that opens on tap; on a wide screen it is always open */
    if (fold) head.addEventListener('click', function (ev) { if (ev.target.closest('button, a, input, select')) return; c.classList.toggle('open'); });
    c.body = body;
    return c;
  }
  var uid = 0;
  function buildAdmin(draft) {
    var d = draft ? clone(draft) : clone(cfg);
    d.location = d.location || {}; d.schedules = d.schedules || {}; d.overrides = d.overrides || []; d.notices = d.notices || [];
    d.tefillos = (d.tefillos && d.tefillos.length) ? d.tefillos : clone(TEFILLA_DEFAULTS);
    var todayRd = Cal.nowInTz(Date.now(), loc().tz).rd, todayInfo = Cal.dayInfo(todayRd, !!cfg.israel);
    var tabs = [['home', 'Home', 'The hallway screen as it is now, and as it will be on any day you choose.'], ['today', 'This week', 'Move, cancel or add a minyan for today or for one of the next days; that day only.', 'Week'], ['general', 'General', 'Name, rooms, location, looks and the tefillos.'], ['schedule', 'Schedule', 'The regular minyanim for each kind of day.'], ['donations', 'Donations', 'Who sponsors what on the board, and from when to when.', 'Donors'], ['notices', 'Banner', 'One line across the top of the board, for as long as you say.'], ['shere', 'Shere', 'The barber\'s hours: what people get when they text שערן.'], ['rolls', 'Extra schedules', 'A named list that takes over for the days it covers: a season, a week, or one kind of day.', 'Extra'], ['screen', 'Hallway screen', 'The TV in the hallway: its colours, and which minyanim it shows.', 'Screen'], ['overrides', 'Special dates', 'A different schedule for one date or for a day every year.', 'Special']];
    if (mode !== 'artifact') tabs.push(['publish', 'Publish', 'What is waiting to go out, and the connection to the website.']);
    if (mode !== 'artifact') tabs.push(['send', 'Send', 'A notification, right now, to everyone who turned reminders on.']);
    tabs.push(['data', 'Backup', 'Previous versions and the settings as text.']);
    var pages = {}, tabBar = el('div', { class: 'tabs', role: 'tablist' }), pageTitle = el('h2', { text: '' }), pageDesc = el('div', { class: 'cdesc', text: '' });
    /* The menu holds what is used every week; the rest is behind Settings, with a row of its own at the top of the page. */
    var SUB = ['general', 'rolls', 'overrides', 'shere', 'publish', 'send', 'data'], subBar = el('div', { class: 'tabs subtabs', role: 'tablist', 'aria-label': 'Settings' });
    function isSub(id) { return SUB.indexOf(id) >= 0 && tabs.some(function (t) { return t[0] === id; }); }
    tabs.forEach(function (t) { if (isSub(t[0])) subBar.appendChild(el('button', { type: 'button', role: 'tab', id: 'tab-' + t[0], 'aria-selected': 'false', 'data-nodirty': '1', text: t[1], onclick: function () { selectTab(t[0]); } })); });
    tabs.forEach(function (t, i) { if (isSub(t[0])) return;
      tabBar.appendChild(el('button', { type: 'button', role: 'tab', id: 'tab-' + t[0], 'aria-selected': 'false', onclick: function () { selectTab(t[0]); } }, [svgIcon(t[0]), el('span', { class: 'lbl', text: t[1] }), el('span', { class: 'lbl-s', text: t[3] || t[1] })])); });
    tabBar.appendChild(el('button', { type: 'button', role: 'tab', id: 'tab-settings', 'aria-selected': 'false', 'data-nodirty': '1', onclick: function () { selectTab(ui.adminSub || 'general'); } }, [svgIcon('general'), el('span', { class: 'lbl', text: 'Settings' }), el('span', { class: 'lbl-s', text: 'Settings' })])); /* last in the menu */
    function selectTab(id) {
      ui.adminTab = id; /* a rebuild (adding a category, restoring a backup) keeps the gabbai on the same tab */
      if (id === 'settings') id = ui.adminSub || 'general';
      var sub = isSub(id); if (sub) ui.adminSub = id; ui.adminTab = id;
      subBar.hidden = !sub; $('#tab-settings', tabBar) && $('#tab-settings', tabBar).setAttribute('aria-selected', String(sub));
      tabs.forEach(function (t) { pages[t[0]].hidden = t[0] !== id; $('#tab-' + t[0], sub || !isSub(t[0]) ? (isSub(t[0]) ? subBar : tabBar) : subBar).setAttribute('aria-selected', String(t[0] === id)); if (t[0] === id) { pageTitle.textContent = t[1]; pageDesc.textContent = t[2]; } });
      try { $('#overlay').scrollTop = 0; } catch (e) {}
      if (id === 'data') dataArea.value = JSON.stringify(collect(), null, 2);
      if (id === 'home') paintHome();
      if (id === 'screen' && ui.paintOnScreen) ui.paintOnScreen(); /* what the screen lists is asked again each time the page is opened */
    }

    var oRows = [];
    /* general */
    var g = el('div', { class: 'col' });
    var F = { fold: true };
    var cBoard = card('The board', 'The name on the board and the rooms the minyanim are in.', F),
      cLook = card('Look and labels', 'How the board reads. Everyone may still switch the look and the labels on their own phone.', F),
      cZman = card('Location and zmanim', 'Where the shul is, how nightfall is figured, and which zmanim the countdown box shows.', F),
      cTef = card('Tefillos', 'Minyanim count for "next minyan" and reminders. A shiur or event category is listed on the board and in texts but never shown as the next minyan.', F),
      cServices = card('Website and services', 'Addresses the app, the share preview and the reminders use.', F),
      cSec = card('Security', 'The PIN keeps strangers out of this page.', F);
    var fName = inp('f-name', d.name), fLocName = inp('f-locname', d.location.name), fLat = inp('f-lat', d.location.lat, { inputmode: 'decimal' }),
      fLng = inp('f-lng', d.location.lng, { inputmode: 'decimal' }), fTz = inp('f-tz', d.location.tz || 'America/New_York', { list: 'tz-list' }),
      fElev = inp('f-elev', d.location.elev || 0, { inputmode: 'numeric' }), fCandles = inp('f-candles', d.candles == null ? 18 : d.candles, { inputmode: 'numeric' }),
      fTzeisMin = inp('f-tzeismin', d.tzeisMinutes || '', { inputmode: 'numeric', placeholder: 'blank = by degrees' }), fTzeisDeg = inp('f-tzeisdeg', d.tzeisDeg || 8.5, { inputmode: 'decimal' }),
      fPin = inp('f-pin', '', { type: 'password', autocomplete: 'new-password', placeholder: 'leave empty to keep the current PIN' });
    var fSms = inp('f-sms', d.smsNumber || '', { dir: 'ltr', placeholder: '+1 718 555 0100' });
    var fSmsLang = el('select', { id: 'f-sms-lang' }, [el('option', { value: 'he', text: 'לשון קודש, always' }), el('option', { value: 'auto', text: 'The language the sender wrote in (Hebrew or English)' }), el('option', { value: 'en', text: 'English, always' })]);
    fSmsLang.value = d.smsLang === 'he' || d.smsLang === 'en' ? d.smsLang : 'auto';
    var fRooms = inp('f-rooms', d.rooms || '', { placeholder: 'ברך משה, דברי יואל, לב אהרן' });
    var fSite = inp('f-site', d.siteUrl || '', { dir: 'ltr', placeholder: 'https://yourname.github.io/minyan/' }), fLogo = inp('f-logo', d.logo || '', { dir: 'ltr', placeholder: 'logo.png' });
    var fNotify = inp('f-notify', d.notifyUrl || '', { dir: 'ltr', placeholder: 'https://minyan-sms.yourname.workers.dev' });
    var fSponsorSecs = inp('f-sponsor-secs', d.sponsorSeconds || 8, { type: 'number', min: '2', max: '120', inputmode: 'numeric' });
    var fDateFmt = el('select', { id: 'f-datefmt' }, [el('option', { value: 'mdy', text: 'Month/Day/Year (10/25/2026)' }), el('option', { value: 'dmy', text: 'Day.Month.Year (25.10.2026)' }), el('option', { value: 'iso', text: 'Year-Month-Day (2026-10-25)' })]);
    fDateFmt.value = d.dateFormat || (/^America\//.test((d.location || {}).tz || '') ? 'mdy' : 'dmy');
    var fBig = el('select', { id: 'f-bigtime' }, [el('option', { value: 'start', text: 'The start time (e.g. ברכות)' }), el('option', { value: 'milestone', text: 'The milestone (e.g. הודו)' })]);
    fBig.value = d.bigTime === 'milestone' ? 'milestone' : 'start';
    var fNowMins = inp('f-now-mins', d.nowMinutes == null || d.nowMinutes === '' ? 20 : d.nowMinutes, { type: 'number', min: '0', max: '180', inputmode: 'numeric' });
    cBoard.body.appendChild(el('div', { class: 'fields' }, [field('Shul name (shown on the board)', fName), field('Location name (shown in the footer)', fLocName)]));
    var roomSelects = [];
    function roomList() { return fRooms.value.split(',').map(function (x) { return x.trim(); }).filter(Boolean); }
    function roomsChanged() { refreshRooms(); paintRoomsEditor(); roomSelects.forEach(function (f) { try { f(); } catch (e) {} }); }
    function addRoomToList(name) { var l = roomList(); if (l.indexOf(name) < 0) { l.push(name); fRooms.value = l.join(', '); } roomsChanged(); }
    var roomsChips = el('div', { class: 'chips-row' }), roomAdd = el('input', { id: 'f-room-add', type: 'text', dir: 'auto', placeholder: 'Room / minyan name', class: 'room', autocomplete: 'off' });
    function paintRoomsEditor() {
      roomsChips.innerHTML = '';
      var all = roomList();
      all.forEach(function (name, idx) {
        function move(dir) { var l = roomList(), j = idx + dir; if (j < 0 || j >= l.length) return; l.splice(idx, 1); l.splice(j, 0, name); fRooms.value = l.join(', '); roomsChanged(); }
        roomsChips.appendChild(el('span', { class: 'rchip' }, [el('span', { class: 'n', text: (idx + 1) + '.' }), el('span', { text: name }),
          all.length > 1 ? el('button', { type: 'button', class: 'x', text: '◀', title: 'Earlier', 'aria-label': 'Move ' + name + ' earlier', onclick: function () { move(-1); } }) : null,
          all.length > 1 ? el('button', { type: 'button', class: 'x', text: '▶', title: 'Later', 'aria-label': 'Move ' + name + ' later', onclick: function () { move(1); } }) : null,
          el('button', { type: 'button', class: 'x', text: '✕', 'aria-label': 'Remove ' + name, onclick: function () { var l = roomList(); l.splice(idx, 1); fRooms.value = l.join(', '); roomsChanged(); } })]));
      });
      if (!roomList().length) roomsChips.appendChild(el('span', { class: 'hint', text: 'No rooms yet. Add the rooms or minyan names here; the schedule rows pick from this list.' }));
    }
    function addRoomFromInput() { var v = roomAdd.value.trim(); if (!v) return; roomAdd.value = ''; addRoomToList(v); }
    roomAdd.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); addRoomFromInput(); } });
    fRooms.hidden = true;
    cBoard.body.appendChild(el('div', { class: 'field' }, [el('label', { for: 'f-room-add', text: 'Rooms / minyan names' }), roomsChips,
      el('div', { class: 'mrow-l' }, [roomAdd, el('button', { type: 'button', class: 'btn small', text: '+ Add room', onclick: addRoomFromInput })]), fRooms,
      el('div', { class: 'hint', text: 'The schedule rows pick from this list, so a room is always spelled the same way. The order here is the order in the pickers and on the board when two minyanim start at the same time (◀ ▶ to move).' })]));
    /* a dropdown of the defined rooms; "New room…" adds one to the list */
    function roomPicker(current, onPick, label) {
      var sel = el('select', { 'aria-label': label || 'Room' }), newIn = el('input', { type: 'text', dir: 'auto', placeholder: 'New room name', class: 'room', 'aria-label': 'New room name' }), okBtn = el('button', { type: 'button', class: 'btn small', text: 'Add' });
      newIn.hidden = true; okBtn.hidden = true;
      function cur() { return (typeof current === 'function' ? current() : current) || ''; }
      function fill() {
        var c = cur(), names = knownRooms.slice();
        if (c && names.indexOf(c) < 0) names.push(c);
        sel.innerHTML = '';
        sel.appendChild(el('option', { value: '', text: label === 'Add a room' ? '+ add a room…' : '— no room —' }));
        names.forEach(function (n) { sel.appendChild(el('option', { value: n, text: n })); });
        sel.appendChild(el('option', { value: '__new', text: 'New room…' }));
        sel.value = c;
      }
      function hideNew() { newIn.hidden = true; okBtn.hidden = true; }
      sel.addEventListener('change', function () {
        if (sel.value === '__new') { newIn.hidden = false; okBtn.hidden = false; newIn.focus(); return; }
        hideNew(); onPick(sel.value); fill();
      });
      function commitNew() { var v = newIn.value.trim(); hideNew(); newIn.value = ''; if (!v) { fill(); return; } addRoomToList(v); fill(); sel.value = v; onPick(v); fill(); }
      okBtn.addEventListener('click', commitNew);
      newIn.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); commitNew(); } });
      fill(); roomSelects.push(fill);
      return [sel, newIn, okBtn];
    }
    cServices.body.appendChild(el('div', { class: 'fields' }, [field('Website address (used for share previews and the app)', fSite), field('Logo file shown in the header (file name next to index.html)', fLogo)]));
    cServices.body.appendChild(el('div', { class: 'fields' }, [field('Notification service address (the Cloudflare worker; enables reminders in the app)', fNotify), field('SMS number (once the text service is set up)', fSms), field('Text replies are written in (HELP is always answered in the sender\'s language)', fSmsLang)]));
    cZman.body.appendChild(el('div', { class: 'fields' }, [field('Latitude', fLat), field('Longitude', fLng), field('Time zone', fTz), field('Elevation (meters)', fElev)]));
    cZman.body.appendChild(el('datalist', { id: 'tz-list' }, ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Toronto', 'Europe/London', 'Europe/Antwerp', 'Europe/Zurich', 'Asia/Jerusalem', 'Australia/Melbourne'].map(function (z) { return el('option', { value: z }); })));
    cZman.body.appendChild(el('div', { class: 'fields' }, [field('Candle lighting: minutes before sunset', fCandles), field('Nightfall (tzeis): minutes after sunset', fTzeisMin), field('Nightfall: degrees below the horizon (used when minutes is blank)', fTzeisDeg)]));
    var fMinchag = el('select', { id: 'f-minchag' }, [el('option', { value: 'mga', text: 'Magen Avraham: half a proportional hour of the day from dawn to nightfall (72 minutes each side)' }), el('option', { value: 'later', text: 'The later of the two: 30 clock minutes after chatzos, or half a proportional hour (sunrise to sunset) if that is later' }), el('option', { value: 'fixed30', text: '30 clock minutes after chatzos, all year' }), el('option', { value: 'zmanis', text: 'Half a proportional hour (sunrise to sunset) after chatzos' })]);
    fMinchag.value = d.minchaGedola || 'later';
    var fAmidah = inp('f-amidah', d.amidahMinutes == null || d.amidahMinutes === '' ? 15 : d.amidahMinutes, { type: 'number', min: '0', max: '60', inputmode: 'numeric' });
    cZman.body.appendChild(el('div', { class: 'fields' }, [field('Mincha gedola: how it is counted', fMinchag), field('Minutes from הודו to שמונה עשרה: "the last minyan before sof zman Shema / sof zman tefilla / chatzos" is the last whose הודו is this long before the zman, so the davening is said in time', fAmidah)]));
    var lookRow2 = el('div', { class: 'fields' }, [field('Civil date on the board and the weekly sheet', fDateFmt), field('Big number on the tiles, by default (everyone may switch it on their own phone)', fBig), field('Minutes a minyan stays marked "now" after it starts (then it is dimmed, and the lobby screen hides it)', fNowMins), field('Lobby screen: seconds per sponsor box (they take turns when there is more than one)', fSponsorSecs)]);
    var fPalette = el('select', { id: 'f-palette' }, [el('option', { value: 'hallway', text: 'Hallway: the lobby\'s limestone, brass and bronze' }), el('option', { value: 'shul', text: 'Shul: light stone, brass, charcoal, burgundy' }), el('option', { value: 'classic', text: 'Classic: parchment and navy' }), el('option', { value: 'contrast', text: 'High contrast: black on white, larger type' })]);
    fPalette.value = lookDefault.call(null) && isLook(d.palette) ? d.palette : 'shul';
    var fLang = el('select', { id: 'f-lang' }, [el('option', { value: 'he', text: 'Hebrew (היום, מחר, מנין הבא…)' }), el('option', { value: 'yi', text: 'Yiddish (היינט, מארגן, זונטאג…)' })]); fLang.value = d.lang === 'yi' ? 'yi' : 'he';
    cLook.body.appendChild(el('div', { class: 'fields' }, [field('Colors: the look everyone gets unless they pick another in the footer; the lobby screen and door displays always use it', fPalette), field('Board labels: the language everyone gets unless they pick another in the footer', fLang)]));
    cLook.body.appendChild(lookRow2);
    var fDispSize = el('select', { id: 'f-display-size' }, [['100', 'Full (100%)'], ['90', 'A little smaller (90%)'], ['80', 'Smaller (80%)'], ['70', 'Smallest (70%)']].map(function (o) { return el('option', { value: o[0], text: o[1] }); }));
    fDispSize.value = String(d.displayScale || 100); if (!fDispSize.value) fDispSize.value = '100';
    cLook.body.appendChild(el('div', { class: 'fields' }, [field('Hallway screen (TV): the largest size it may use. The screen fits itself to the TV on its own and is usually already at this size; pick a smaller one to leave more air around the lists', fDispSize)]));
    cZman.body.appendChild(el('div', { class: 'field' }, [el('label', { text: 'Countdown box ("הזמן הבא"): the next of these zmanim still ahead today' }), el('div', { class: 'chipset' }, COUNTDOWN_KEYS.map(function (k) { return chk('cd-' + k, countdownKeysOf(d).indexOf(k) >= 0, Cal.ZMAN_NAMES[k]); }))]));
    cZman.body.appendChild(el('div', { class: 'checks' }, [chk('f-israel', d.israel, 'Eretz Yisroel calendar (one-day Yom Tov)'), chk('f-weekly', d.weeklyEarliest, 'Weekday zman-based times use the earliest sunset of the week (Sun–Thu)'), chk('f-24', d.clock24, '24-hour clock'), chk('f-tzeis', d.showTzeis !== false, 'Show צאת הכוכבים (the board\'s nightfall) in the zmanim list'), chk('f-rt', d.showRT, 'Show Rabbeinu Tam (72 minutes after sunset) in the zmanim list; hidden by itself while nightfall is 72 and צאת הכוכבים is shown'), chk('f-60', d.show60 !== false, 'Show 60 מינוט אחר השקיעה in the zmanim list')]));
    if (mode !== 'artifact') cSec.body.appendChild(el('div', { class: 'fields' }, [field('New PIN for the admin page', fPin, el('span', { class: 'hint', text: 'Stored scrambled (hashed), so it cannot be read from the site files. It keeps strangers out of the admin page; what everyone else sees can only be changed with the GitHub token on the Publish tab, which stays on the device that entered it.' }))]));
    var tRows = [];
    d.tefillos.forEach(function (t, i) {
      var r = { name: inp('t-name-' + i, t.name), ms: inp('t-ms-' + i, t.milestone), off: inp('t-off-' + i, t.offset, { inputmode: 'numeric' }), start: inp('t-start-' + i, t.startLabel || ''), night: inp('t-night-' + i, t.nightUntil == null ? '' : t.nightUntil, { type: 'number', min: '0', max: '11', inputmode: 'numeric', placeholder: '4' }),
        period: el('select', { id: 't-period-' + i }, [el('option', { value: 'am', text: 'Morning: 6:45 means 6:45 AM' }), el('option', { value: 'pm', text: 'Afternoon/evening: 6:45 means 6:45 PM' })]),
        kind: el('select', { id: 't-kind-' + i }, [el('option', { value: 'minyan', text: 'Minyan' }), el('option', { value: 'event', text: 'Shiur / event' })]) };
      r.period.value = t.period || 'am'; r.kind.value = t.kind === 'event' ? 'event' : 'minyan';
      tRows.push(r);
      var removeBtn = i >= 3 ? el('button', { type: 'button', class: 'btn small danger', text: 'Remove category', onclick: function () { var c = collect(); c.tefillos.splice(i, 1); ui.adminDirty = true; closeOverlay(); buildAdmin(c); } }) : null;
      var rowEl = el('div', { class: 'tef' }, [el('div', { class: 'tefhead' }, [el('span', { text: t.name || 'Category ' + (i + 1) }), removeBtn]), el('div', { class: 'fields' }, [field('Name (shown on the board)', r.name), field('Type', r.kind), field('Milestone shown under the time (e.g. הודו)', r.ms), field('Milestone: minutes after the start', r.off), field('Name of the start, shown small when the milestone is the big number (e.g. ברכות)', r.start), field('How to read the hours', r.period), field('Night cut-off: a time before this hour (0–11) still belongs to the previous night, e.g. a Maariv at 12:30 AM; blank = 4', r.night)])]);
      cTef.body.appendChild(rowEl);
    });
    cTef.body.appendChild(el('div', null, [el('button', { type: 'button', class: 'btn', text: '+ Add category (e.g. שיעור)', onclick: function () {
      var c = collect(); c.tefillos.push({ id: 'c' + Date.now().toString(36), name: 'שיעור', milestone: '', offset: 0, period: 'pm', kind: 'event' }); ui.adminDirty = true; closeOverlay(); buildAdmin(c);
    } })]));
    [cBoard, cLook, cZman, cTef, cServices, mode !== 'artifact' ? cSec : null].forEach(function (c) { if (c) g.appendChild(c); });
    pages.general = g;
    function liveTefilla(i) { var r = tRows[i], t = d.tefillos[i]; return { id: t.id, name: r.name.value.trim() || t.name, milestone: r.ms.value.trim(), offset: +r.off.value || 0, startLabel: r.start.value.trim(), nightUntil: r.night.value === '' ? undefined : Math.max(0, Math.min(11, +r.night.value || 0)), period: r.period.value, kind: r.kind.value === 'event' ? 'event' : 'minyan' }; }

    /* schedule: one row per minyan */
    var lines = {};
    Cal.DAY_TYPES.forEach(function (t) { lines[t[0]] = {}; d.tefillos.forEach(function (tf) { lines[t[0]][tf.id] = { value: (d.schedules[t[0]] && d.schedules[t[0]][tf.id]) || '' }; }); });
    var ZMAN_OPTS = [['fixed', 'Fixed time'], ['sunrise', 'Sunrise (netz)'], ['alos', 'Dawn (alos)'], ['shema', 'Sof zman Shema'], ['tefilla', 'Sof zman tefilla'], ['chatzos', 'Chatzos'], ['minchag', 'Mincha gedola'],
      ['minchak', 'Mincha ketana (MGA 72)'], ['plag', 'Plag hamincha'], ['candles', 'Candle lighting'], ['fricandles', 'Friday\'s candle lighting (for Shabbos)'], ['sunset', 'Sunset (shkiah)'], ['tzeis', 'Nightfall (tzeis)'], ['tzeis60', 'Sunset + 60 min'], ['tzeis72', 'Rabbeinu Tam (72 min)']];
    var ZWORD = { sunrise: 'sunrise', alos: 'alos', shema: 'shema', tefilla: 'tefilla', chatzos: 'chatzos', minchag: 'minchag', minchak: 'minchak', plag: 'plag', candles: 'candles', fricandles: 'fricandles', sunset: 'sunset', tzeis: 'tzeis', tzeis60: 'tzeis60', tzeis72: 'rt' };
    function hhmm(min) { min = Math.round(min); return pad2(Math.floor(min / 60) % 24) + ':' + pad2(min % 60); }
    function specToRow(spec) { return spec.kind === 'fixed' ? { kind: 'fixed', time: hhmm(spec.min), off: 0, round: false } : { kind: spec.zman, time: '', off: spec.offset || 0, round: spec.round || 0, roundUp: !!spec.roundUp }; }
    function lineToRow(line, tf) {
      var off = false, m0 = /^#\s*off\s+(\S.*)$/i.exec(line.trim());
      if (m0) { off = true; line = m0[1]; } /* a switched-off row: kept in the text, ignored by the board */
      var p = parseLine(line, tf);
      if (!p) return /^\s*#/.test(line) ? { raw: line.trim(), comment: true } : null;
      if (!p.spec) return { raw: line.trim(), disabled: off };
      if (p.series) {
        var st = specToRow(p.spec.start), en;
        if (p.spec.end) en = specToRow(p.spec.end);
        else { /* legacy "count N": same span, expressed as an end that moves with the start */
          var span = p.spec.every * Math.max(0, (p.spec.count || 1) - 1);
          en = st.kind === 'fixed' ? { kind: 'fixed', time: hhmm(p.spec.start.min + span), off: 0, round: false } : { kind: st.kind, time: '', off: st.off + span, round: false };
        }
        return { series: true, every: p.spec.every, start: st, endMode: 'to', end: en, rooms: p.rooms.join(', '), note: p.note, cond: condOf(p), disabled: off };
      }
      var r = specToRow(p.spec); r.room = p.room; r.note = p.note; r.cond = condOf(p); r.disabled = off;
      return r;
    }
    /* the row's "show only" condition: {op: 'until'|'after', zman, off} or null */
    function condOf(p) { return p.cond ? { op: p.cond.op, zman: p.cond.spec.zman, off: p.cond.spec.offset || 0 } : null; }
    function condTok(r) { return r.cond && r.cond.op ? ' ' + r.cond.op + ' ' + (ZWORD[r.cond.zman] || r.cond.zman) + (r.cond.off ? (r.cond.off < 0 ? '-' : '+') + Math.abs(r.cond.off) : '') : ''; }
    function tokOf(w) { return w.kind === 'fixed' ? (w.time || '07:00') : (ZWORD[w.kind] + (w.off ? (w.off < 0 ? '-' : '+') + Math.abs(w.off) : '') + (w.round ? (w.roundUp ? '^' : '~') + (w.round === true ? 5 : w.round) : '')); }
    /* clean = without the "#off" marker (for previews and sorting) */
    function rowToLine(r, clean) {
      var pre = r.disabled && !clean ? '#off ' : '';
      if (r.raw != null) return r.comment ? r.raw : pre + r.raw;
      if (r.series) return pre + 'every ' + (r.every || 10) + ' from ' + tokOf(r.start) + ' to ' + tokOf(r.end) + (r.rooms ? ' rooms ' + r.rooms : '') + condTok(r) + (r.note ? ' // ' + r.note : '');
      return pre + tokOf(r) + (r.room ? ' ' + r.room : '') + condTok(r) + (r.note ? ' // ' + r.note : '');
    }
    var roomsList = el('datalist', { id: 'rooms-list' }), knownRooms = [];
    function refreshRooms() {
      var set = {}, probe = { period: 'am' };
      fRooms.value.split(',').forEach(function (x) { if (x.trim()) set[x.trim()] = 1; });
      function take(l) { var p = parseLine(l, probe); if (!p) return; if (p.rooms) p.rooms.forEach(function (x) { set[x] = 1; }); else if (p.room) set[p.room] = 1; }
      Object.keys(lines).forEach(function (k) { Object.keys(lines[k]).forEach(function (id) { lines[k][id].value.split('\n').forEach(take); }); });
      oRows.forEach(function (r) { Object.keys(r.lines).forEach(function (id) { r.lines[id].value.split('\n').forEach(take); }); });
      roomsList.innerHTML = '';
      var ordered = fRooms.value.split(',').map(function (x) { return x.trim(); }).filter(function (x, i, a) { return x && a.indexOf(x) === i; });
      knownRooms = ordered.concat(Object.keys(set).filter(function (x) { return ordered.indexOf(x) < 0; }).sort()); /* the list's order, then anything else found in the rows */
      knownRooms.forEach(function (name) { roomsList.appendChild(el('option', { value: name })); });
    }
    /* "דברי יואל ברך משה" typed without commas -> ["דברי יואל", "ברך משה"] when it is exactly a run of known room names */
    function splitKnown(str) {
      var names = knownRooms.filter(function (n) { return n !== str; }).sort(function (a, b) { return b.length - a.length; }), out = [], rest = str.trim(), hit, i;
      while (rest) {
        hit = null;
        for (i = 0; i < names.length; i++) if (rest.indexOf(names[i]) === 0) { hit = names[i]; break; }
        if (!hit) return [str];
        out.push(hit); rest = rest.slice(hit.length).trim();
      }
      return out.length ? out : [str];
    }
    /* store = {value: lines text}; tfIndex = index into d.tefillos; typeKeyFn() = day type used for the "today" preview */
    /* The day a row's little preview is worked out for. The Shabbos page shows the coming Shabbos, the Yom Tov page the coming Yom Tov,
       a special date its own date: "today 4:12" on the Shabbos page would be Wednesday's sunset, which is nobody's question. */
    var MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], DAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    function previewDay(rd) { if (rd === todayRd) return 'today'; var g = Cal.gregFromRD(rd); return DAYS_EN[Cal.dayInfo(rd, !!d.israel).dow] + ' ' + MONTHS_EN[g.m - 1] + ' ' + g.d; }
    var nextOfType = null;
    function nextDayOfType(key) { /* the first day from today on that is this kind of day; every kind comes round within a year */
      if (!nextOfType) { nextOfType = {}; for (var i = 0; i < 400; i++) { var k = Cal.dayType(Cal.dayInfo(todayRd + i, !!d.israel)); if (nextOfType[k] == null) nextOfType[k] = todayRd + i; } }
      return nextOfType[key] == null ? todayRd : nextOfType[key];
    }
    function minyanEditor(store, tfIndex, typeKeyFn, copyFrom, dayFn) {
      var wrap = el('div', { class: 'editor' }), list = el('div', { class: 'rows' }), rows = [], ta = null;
      function pday() { var rd = dayFn ? dayFn() : null; return rd == null || isNaN(rd) ? todayRd : rd; }
      function tf() { return liveTefilla(tfIndex); }
      function sync() { store.value = rows.map(function (r) { return rowToLine(r); }).join('\n'); if (ta) ta.value = store.value; refreshRooms(); markTabs(); }
      /* rows are kept in time order (by today's time for zman-based ones); unreadable lines go last */
      function sortRows() { rows.sort(function (x, y) { var a = previewOf(x), b = previewOf(y); return (isNaN(a) ? 1e9 : a) - (isNaN(b) ? 1e9 : b); }); }
      function load() { rows = []; store.value.split('\n').forEach(function (l) { var r = lineToRow(l, tf()); if (r) rows.push(r); }); sortRows(); }
      function timesOf(r) { return expandLine(parseLine(rowToLine(r, true), tf()), pday(), typeKeyFn()).map(function (x) { return x.start; }); }
      function previewOf(r) { var t = timesOf(r); return t.length ? t[0] : NaN; }
      function condText(r) {
        if (!r.cond || !r.cond.op) return '';
        var lim = engine.condLimit(parseLine(rowToLine(r, true), tf()), pday(), typeKeyFn()), name = Cal.ZMAN_NAMES[r.cond.zman] || r.cond.zman;
        return (r.cond.op === 'until' ? 'before ' : 'from ') + name + (r.cond.off ? (r.cond.off < 0 ? ' −' : ' +') + Math.abs(r.cond.off) + ' min' : '') + (isNaN(lim) ? '' : ', ' + previewDay(pday()) + ' ' + fmtTime(lim));
      }
      function previewText(r) { var b = previewBase(r); return r.disabled ? 'off' + (b ? ' · ' + b : '') : b; }
      function previewBase(r) {
        var t = timesOf(r), c = condText(r), rd = pday(), w = previewDay(rd), on = rd === todayRd ? 'today' : 'on ' + w;
        if (!t.length) return c ? 'not ' + on + ': only ' + c : (r.series ? 'no minyanim ' + on + ' (check the times)' : '');
        if (!r.series) return w + ' ' + fmtTime(t[0]) + (c ? ' · only ' + c : '');
        var head = t.slice(0, 3).map(fmtTime).join(', ');
        return w + ' ' + head + (t.length > 4 ? ' … ' : t.length === 4 ? ', ' : '') + (t.length > 3 ? fmtTime(t[t.length - 1]) : '') + (c ? ' · only ' + c : '');
      }
      /* the "when" widget: fixed time picker, or zman + minutes before/after + rounding. Mutates w and calls onChange. */
      function timeWidget(w, onChange, label, roundLabel) {
        var when = el('select', { 'aria-label': label || 'Time type' });
        ZMAN_OPTS.forEach(function (o) { when.appendChild(el('option', { value: o[0], text: o[1] })); });
        when.value = w.kind;
        var time = el('input', { type: 'time', value: w.time || '', 'aria-label': 'Time' });
        var sign = el('select', { 'aria-label': 'Before or after' }, [el('option', { value: '-', text: 'min before' }), el('option', { value: '+', text: 'min after' })]);
        sign.value = w.off < 0 ? '-' : '+';
        var mins = el('input', { type: 'number', min: '0', step: '1', inputmode: 'numeric', class: 'mins', value: String(Math.abs(w.off || 0)), 'aria-label': 'Minutes' }), minsW = stepper(mins, 5);
        /* rounding: none, or down / up to 5, 10, 15 or 30 minutes ("~5" / "^5" in the text form) */
        var roundC = el('select', { 'aria-label': 'Rounding', class: 'roundsel' }, [el('option', { value: '', text: 'no rounding' })].concat(
          [5, 10, 15, 30].map(function (n) { return el('option', { value: 'd' + n, text: 'round down to ' + n }); }),
          [5, 10, 15, 30].map(function (n) { return el('option', { value: 'u' + n, text: 'round up to ' + n }); })));
        var r0 = w.round === true ? 5 : +w.round || 0;
        if (r0 && [5, 10, 15, 30].indexOf(r0) < 0) roundC.appendChild(el('option', { value: (w.roundUp ? 'u' : 'd') + r0, text: 'round ' + (w.roundUp ? 'up' : 'down') + ' to ' + r0 }));
        roundC.value = r0 ? (w.roundUp ? 'u' : 'd') + r0 : '';
        var roundL = el('span', { class: 'small roundw' }, [roundC]);
        function show() { var fixed = when.value === 'fixed'; time.hidden = !fixed; sign.hidden = fixed; minsW.hidden = fixed; roundL.hidden = fixed || roundLabel === ''; }
        when.addEventListener('change', function () { w.kind = when.value; if (w.kind === 'fixed' && !w.time) { w.time = '07:00'; time.value = w.time; } show(); onChange(); });
        time.addEventListener('input', function () { w.time = time.value; onChange(); });
        function offChange() { w.off = (+mins.value || 0) * (sign.value === '-' ? -1 : 1); onChange(); }
        sign.addEventListener('change', offChange); mins.addEventListener('input', offChange);
        roundC.addEventListener('change', function () { var v = roundC.value; w.round = v ? +v.slice(1) : 0; w.roundUp = v.charAt(0) === 'u'; onChange(); });
        show();
        return [when, time, sign, minsW, roundL];
      }
      /* "Show: only while it starts before <zman>": a late Shacharis drops away by itself in summer, a run shortens by itself */
      function condWidget(r, onChange) {
        var op = el('select', { 'aria-label': 'Show only' }, [el('option', { value: '', text: 'Always' }), el('option', { value: 'until', text: 'Only while it starts before' }), el('option', { value: 'after', text: 'Only once it starts at or after' })]);
        var zman = el('select', { 'aria-label': 'Condition zman' }); ZMAN_OPTS.forEach(function (o) { if (o[0] !== 'fixed') zman.appendChild(el('option', { value: o[0], text: o[1] })); });
        var mins = el('input', { type: 'number', min: '0', step: '1', inputmode: 'numeric', class: 'cmins', 'aria-label': 'Condition minutes' }), minsW = stepper(mins, 5);
        var sign = el('select', { 'aria-label': 'Condition before or after' }, [el('option', { value: '-', text: 'min before it' }), el('option', { value: '+', text: 'min after it' })]);
        function paint() {
          var on = !!(r.cond && r.cond.op);
          op.value = on ? r.cond.op : ''; zman.hidden = minsW.hidden = sign.hidden = !on;
          if (on) { zman.value = r.cond.zman; if (zman.selectedIndex < 0) zman.value = 'tefilla'; sign.value = r.cond.off > 0 ? '+' : '-'; mins.value = String(Math.abs(r.cond.off || 0)); }
        }
        op.addEventListener('change', function () {
          if (!op.value) r.cond = null;
          else r.cond = { op: op.value, zman: (r.cond && r.cond.zman) || (tf().period === 'pm' ? 'sunset' : 'tefilla'), off: (r.cond && r.cond.off) || 0 };
          paint(); onChange();
        });
        zman.addEventListener('change', function () { r.cond.zman = zman.value; onChange(); });
        function offChange() { r.cond.off = (+mins.value || 0) * (sign.value === '-' ? -1 : 1); onChange(); }
        sign.addEventListener('change', offChange); mins.addEventListener('input', offChange);
        paint();
        return el('div', { class: 'mrow-l cond' }, [el('span', { class: 'k', text: 'Show:' }), op, zman, minsW, sign]);
      }
      function renderRow(r) {
        var row = el('div', { class: 'mrow' + (r.series ? ' series' : '') + (r.disabled ? ' off' : '') + (r.comment ? ' note-line' : '') });
        var del = el('button', { type: 'button', class: 'btn small danger icon', text: '✕', title: 'Remove', 'aria-label': 'Remove', onclick: function () { rows.splice(rows.indexOf(r), 1); row.remove(); sync(); } });
        var pv = el('span', { class: 'pv num' });
        function changed() { sync(); pv.textContent = previewText(r); }
        /* On/Off: an Off row stays here, with its times and rooms, but is not on the board, in the texts or in Today */
        var onIn = el('input', { type: 'checkbox', 'aria-label': 'On' }), swl = el('span', { class: 'swl', text: r.disabled ? 'Off' : 'On' });
        onIn.checked = !r.disabled;
        var sw = el('label', { class: 'switch', title: 'Off keeps the row but takes the minyan off the board' }, [onIn, swl]);
        onIn.addEventListener('change', function () { r.disabled = !onIn.checked; row.classList.toggle('off', r.disabled); swl.textContent = r.disabled ? 'Off' : 'On'; changed(); });
        row.appendChild(el('div', { class: 'mrow-h' }, [pv, el('span', { class: 'sp' }), r.comment ? null : sw, del]));
        if (r.raw != null) {
          var rawIn = el('input', { type: 'text', dir: 'auto', value: r.raw, class: 'grow' });
          rawIn.addEventListener('input', function () { r.raw = rawIn.value; sync(); });
          row.appendChild(el('div', { class: 'mrow-l' }, [el('span', { class: r.comment ? 'k' : 'bad', text: r.comment ? 'Note line (not a minyan):' : 'Cannot read this line:' }), rawIn]));
          return row;
        }
        var note = el('input', { type: 'text', dir: 'auto', placeholder: 'Note (optional)', value: r.note || '', class: 'grow' });
        note.addEventListener('input', function () { r.note = note.value; sync(); });
        if (r.series) {
          var every = el('input', { type: 'number', min: '1', step: '1', inputmode: 'numeric', class: 'mins', value: String(r.every || 10), 'aria-label': 'Every how many minutes' });
          every.addEventListener('input', function () { r.every = Math.max(1, +every.value || 1); changed(); });
          var endW = timeWidget(r.end, changed, 'Until time', '');
          var seq = (r.rooms || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
          if (seq.length === 1) { seq = splitKnown(seq[0]); if (seq.length > 1) r.rooms = seq.join(', '); }
          var chips = el('div', { class: 'chips-row' });
          function paint() {
            chips.innerHTML = '';
            seq.forEach(function (name, idx) {
              function move(dir) { var j = idx + dir; if (j < 0 || j >= seq.length) return; seq.splice(idx, 1); seq.splice(j, 0, name); commitRooms(); }
              chips.appendChild(el('span', { class: 'rchip' }, [
                el('span', { class: 'n', text: (idx + 1) + '.' }), el('span', { text: name }),
                seq.length > 1 ? el('button', { type: 'button', class: 'x', text: '◀', title: 'Earlier', 'aria-label': 'Move ' + name + ' earlier', onclick: function () { move(-1); } }) : null,
                seq.length > 1 ? el('button', { type: 'button', class: 'x', text: '▶', title: 'Later', 'aria-label': 'Move ' + name + ' later', onclick: function () { move(1); } }) : null,
                el('button', { type: 'button', class: 'x', text: '✕', 'aria-label': 'Remove ' + name, onclick: function () { seq.splice(idx, 1); commitRooms(); } })]));
            });
            if (!seq.length) chips.appendChild(el('span', { class: 'k', text: 'no rooms yet: pick them below in the order they take turns' }));
          }
          function commitRooms() { r.rooms = seq.join(', '); paint(); changed(); }
          var picker = roomPicker('', function (v) { if (v) { seq.push(v); commitRooms(); } }, 'Add a room');
          paint();
          row.appendChild(el('div', { class: 'mrow-l' }, [el('span', { class: 'tag', text: 'Repeating' }), el('span', { class: 'k', text: 'every' }), stepper(every, 5), el('span', { class: 'k', text: 'min, from' })].concat(timeWidget(r.start, changed, 'From', 'round every minyan to 5'))));
          row.appendChild(el('div', { class: 'mrow-l' }, [el('span', { class: 'k', text: 'to' })].concat(endW)));
          row.appendChild(el('div', { class: 'mrow-l' }, [el('span', { class: 'k', text: 'rooms, in this order (1st minyan, 2nd, …, then again from 1):' }), chips]));
          row.appendChild(el('div', { class: 'mrow-l' }, picker));
          row.appendChild(el('div', { class: 'mrow-l' }, [note]));
          row.appendChild(condWidget(r, changed));
        } else {
          var room = roomPicker(function () { return r.room; }, function (v) { r.room = v; sync(); }, 'Room');
          row.appendChild(el('div', { class: 'mrow-l' }, timeWidget(r, changed)));
          row.appendChild(el('div', { class: 'mrow-l' }, room.concat([note])));
          row.appendChild(condWidget(r, changed));
        }
        pv.textContent = previewText(r);
        /* when the gabbai leaves this row, it moves to its place in time order */
        row.addEventListener('focusout', function (ev) {
          if (ev.relatedTarget && row.contains(ev.relatedTarget)) return;
          setTimeout(function () { if (document.activeElement && row.contains(document.activeElement)) return; var before = rows.slice(); sortRows(); if (before.some(function (x, i) { return x !== rows[i]; })) { renderAll(); sync(); } }, 50);
        });
        return row;
      }
      function renderAll() { list.innerHTML = ''; rows.forEach(function (r) { list.appendChild(renderRow(r)); }); }
      function addRow(r) { rows.push(r); list.appendChild(renderRow(r)); sync(); }
      var addBtn = el('button', { type: 'button', class: 'btn small primary', text: '+ Add minyan', onclick: function () {
        var last = rows.length ? rows[rows.length - 1] : null, r = { kind: 'fixed', time: '07:00', off: 0, round: false, room: last ? last.room : '', note: '' };
        if (last && last.raw == null) { r.kind = last.kind; r.off = last.off; r.round = last.round; r.roundUp = last.roundUp; if (last.kind === 'fixed') { var m = previewOf(last); r.time = hhmm((isNaN(m) ? 7 * 60 : m) + 15); } }
        addRow(r);
        var inputs = list.lastChild.querySelectorAll('input, select'); if (inputs.length) inputs[0].focus();
      } });
      var repeatBtn = el('button', { type: 'button', class: 'btn small', text: '+ Add repeating', title: 'A run of minyanim every few minutes, in rooms taken in turn', onclick: function () {
        var last = rows.length ? rows[rows.length - 1] : null, m = last ? previewOf(last) : NaN;
        addRow({ series: true, every: 15, start: { kind: 'fixed', time: hhmm(isNaN(m) ? 7 * 60 : m + 15), off: 0, round: false }, endMode: 'to',
          end: { kind: 'fixed', time: hhmm(isNaN(m) ? 9 * 60 : m + 135), off: 0, round: false }, rooms: fRooms.value.trim(), note: '' });
        var inputs = list.lastChild.querySelectorAll('input, select'); if (inputs.length) inputs[0].focus();
      } });
      var copySel = el('select', { 'aria-label': 'Copy from another day' });
      function fillCopy() {
        copySel.innerHTML = ''; copySel.appendChild(el('option', { value: '', text: 'Copy from…' }));
        (copyFrom || []).forEach(function (src) { if (src.store().value.trim()) copySel.appendChild(el('option', { value: src.key, text: src.label })); });
      }
      copySel.addEventListener('change', function () {
        var src = (copyFrom || []).filter(function (x) { return x.key === copySel.value; })[0];
        if (src) { store.value = src.store().value; load(); renderAll(); sync(); }
        copySel.value = '';
      });
      copySel.addEventListener('focus', fillCopy); fillCopy();
      var sortBtn = el('button', { type: 'button', class: 'btn small', text: 'Sort by time', 'data-nodirty': '1', onclick: function () {
        sortRows(); renderAll(); sync();
      } });
      var textBtn = el('button', { type: 'button', class: 'btn small', text: 'Edit as text', 'data-nodirty': '1', onclick: function () {
        if (ta.hidden) { ta.value = store.value; ta.hidden = false; list.hidden = true; textBtn.textContent = 'Back to the list'; }
        else { load(); renderAll(); ta.hidden = true; list.hidden = false; textBtn.textContent = 'Edit as text'; }
      } });
      ta = el('textarea', { spellcheck: 'false', dir: 'auto' }); ta.hidden = true;
      ta.addEventListener('input', function () { store.value = ta.value; refreshRooms(); markTabs(); });
      load(); renderAll();
      wrap.reload = function () { load(); renderAll(); if (ta) ta.value = store.value; };
      wrap.appendChild(list); wrap.appendChild(ta);
      wrap.appendChild(el('div', { class: 'editor-bar' }, [addBtn, repeatBtn, copySel, sortBtn, textBtn]));
      return wrap;
    }
    var sp = el('div', { class: 'col' });
    sp.appendChild(roomsList);
    sp.appendChild(el('details', { class: 'help' }, [el('summary', { text: 'How this works' }), el('div', { class: 'hint' }, [
      el('p', { text: 'Pick a day type, then add one row per minyan: a fixed time, or a zman (sunset, chatzos, candle lighting…) with minutes before or after. Type the room name; names you already used are suggested. The small label on each row shows what it gives on the coming day of that kind: "today", or a date such as "Sat Nov 14" on the Shabbos page.' }),
      el('p', { text: '"+ Add repeating" makes one row that stands for a whole run: every N minutes, from a time or a zman, until a time or zman, in the rooms you pick, taken in turn in the order shown. It is recalculated every day, so a run that starts at sunrise moves with sunrise. Mix repeating rows and single rows freely; the board shows them all sorted by time.' }),
      el('p', { text: '"Copy from…" starts a day type from another one. A day type with no rows uses the more general one (Rosh Chodesh empty → Weekdays; Yom Tov empty → Shabbos).' }),
      el('p', { text: 'Shabbos and Yom Tov: Friday\'s Mincha is usually set from candle lighting, and Shabbos\'s Mincha and Maariv from sunset, so they move through the year by themselves. Yom Tov uses the Shabbos lists unless you give it its own; for one particular Yom Tov, use Special dates and choose "A calendar day, every year". On these pages every tefilla has a small box, "On Shabbos: …", for another name or another second time on that kind of day. "See the screen on …" shows the screen as it will be on that day.' }),
      el('p', null, ['"Edit as text" shows the same rows as lines like ', el('code', { text: '6:20 ברך משה' }), ', ', el('code', { text: 'sunset-15 דברי יואל // note' }), ' or ', el('code', { text: 'every 10 from sunrise-30 to chatzos-30 rooms ברך משה, דברי יואל' }), ', handy for pasting a whole list.'])])]));
    var typeTabs = el('div', { class: 'tabs daytypes', role: 'tablist' }), typePages = {};
    /* What a tefilla is called and what its second time is on one kind of day (the engine's tefillaOn reads these). Shabbos's
       שחרית can have another second time or none; Friday's מעריב can be called קבלת שבת; Yom Tov follows Shabbos unless set. */
    var dayTef = clone(d.dayTefilla || {});
    function whole(text) { return '\u2068' + text + '\u2069'; } /* a Hebrew name inside an English line stays in one piece, with the numbers after it where they were written */
    function dayTefillaBox(key, tf, typeName) {
      var cur = (dayTef[key] && dayTef[key][tf.id]) || {}, idb = key + '-' + tf.id, follows = TYPE_EN[FALLBACK[key]] || '';
      var fName = inp('dt-name-' + idb, cur.name || '', { placeholder: tf.name, dir: 'auto', autocomplete: 'off' });
      var fSecond = el('select', { id: 'dt-second-' + idb }, [el('option', { value: '', text: follows ? 'As on ' + follows : 'The usual one' }), el('option', { value: 'none', text: 'None on ' + typeName }), el('option', { value: 'own', text: 'Its own' })]);
      fSecond.value = cur.second === 'none' || cur.second === 'own' ? cur.second : '';
      var fMs = inp('dt-ms-' + idb, cur.milestone || '', { placeholder: 'נשמת', dir: 'auto', autocomplete: 'off' }), fOff = inp('dt-off-' + idb, cur.offset == null ? 30 : cur.offset, { type: 'number', min: '0', max: '180', inputmode: 'numeric', 'aria-label': 'Minutes after the start' });
      var msErr = el('div', { class: 'hint err', id: 'dt-err-' + idb, role: 'alert', text: 'Write what this time is called, like ' + whole('נשמת') + ', or choose “None”.' });
      var ownRow = el('div', { class: 'fields' }, [field('What the second time is called', fMs, msErr), field('How many minutes after the start', stepper(fOff, 5))]);
      var sum = el('summary'), box = el('details', { class: 'dayset', id: 'dt-box-' + idb }, [sum,
        el('div', { class: 'fields' }, [field('Its name on ' + typeName, fName, el('div', { class: 'hint', text: 'Leave empty to keep ' + whole(tf.name) + '.' + (key === 'friday' && tf.id === 'maariv' ? ' Many call it ' + whole('קבלת שבת') + '.' : '') }))]),
        el('div', { class: 'fields' }, [field('The second time under each minyan', fSecond, el('div', { class: 'hint', text: 'The small time under a minyan, like ' + whole('הודו') + ' on a weekday morning.' }))]), ownRow]);
      function sync() {
        ownRow.hidden = fSecond.value !== 'own';
        var o = { name: fName.value.trim(), second: fSecond.value }, has = !!(o.name || o.second), nameless = fSecond.value === 'own' && !fMs.value.trim();
        msErr.hidden = !nameless || !box.classList.contains('asked'); fMs.setAttribute('aria-invalid', String(nameless && box.classList.contains('asked'))); /* said once Save has been tried, not while the gabbai is still on his way to the box */
        if (o.second === 'own') { o.milestone = fMs.value.trim(); o.offset = Math.max(0, Math.min(180, Math.round(+fOff.value) || 0)); }
        dayTef[key] = dayTef[key] || {};
        if (has) dayTef[key][tf.id] = o; else delete dayTef[key][tf.id];
        if (!Object.keys(dayTef[key]).length) delete dayTef[key];
        sum.textContent = 'On ' + typeName + ': ' + (has ? [o.name ? 'called ' + whole(o.name) : '', o.second === 'none' ? 'no second time' : o.second === 'own' ? 'second time ' + whole(o.milestone || '…') + ', ' + o.offset + ' min after the start' : ''].filter(Boolean).join(' · ') : follows ? 'the usual name · second time as on ' + follows : 'the usual name and second time');
        box.classList.toggle('set', has);
      }
      [fName, fSecond, fMs, fOff].forEach(function (f) { f.addEventListener('input', sync); f.addEventListener('change', sync); });
      box.ask = function () { box.classList.add('asked'); box.open = true; sync(); try { fMs.focus(); } catch (e) {} };
      sync();
      return box;
    }
    sp.appendChild(typeTabs);
    var infoUpdaters = [];
    /* which day type actually supplies this tefilla for `key` when its own box is empty */
    function sourceOf(key, tfId) {
      var k = FALLBACK[key];
      while (k) { if (lines[k][tfId].value.trim()) return k; k = FALLBACK[k]; }
      return null;
    }
    Cal.DAY_TYPES.forEach(function (t) {
      var key = t[0], b = el('button', { type: 'button', id: 'dt-' + key, text: t[3], 'aria-selected': 'false', 'data-nodirty': '1', onclick: function () { showType(key); } }); /* looking at another kind of day changes nothing */
      typeTabs.appendChild(b);
      var page = el('div', { class: 'col dtp tef-0', id: 'dtp-' + key });
      page.hidden = true;
      var onSunday = FALLBACK[key] === 'weekday' && key !== 'sunday' && key !== 'friday' ? ' When it lands on a Sunday it follows the Sunday list.' : '';
      page.appendChild(el('div', { class: 'hint', text: FALLBACK[key] ? t[3] + ': each tefilla either follows the ' + TYPE_EN[FALLBACK[key]] + ' schedule or gets its own list for this day.' + onSunday + (key === 'yomtov' ? ' When Yom Tov is on a Friday, its Mincha and Maariv are Erev Shabbos\'s: Shabbos is coming in.' : '')
        : key === 'weekday' ? t[3] + ' is the base schedule: every day that has no list of its own for a tefilla (Sunday, Friday, Rosh Chodesh…) uses it.'
        : t[3] + ' has its own lists; it follows no other day. Yom Tov uses these wherever it has no list of its own.' }));
      var row = el('div', { class: 'fields three' });
      d.tefillos.forEach(function (tf, i) {
        var store = lines[key][tf.id], fb = FALLBACK[key];
        var sources = Cal.DAY_TYPES.filter(function (o) { return o[0] !== key; }).map(function (o) { return { key: o[0], label: o[3], store: function () { return lines[o[0]][tf.id]; } }; });
        var editor = minyanEditor(store, i, function () { return key; }, sources, function () { return nextDayOfType(key); });
        var block = el('div', { class: 'field tefcard' }, [el('label', { class: 'tefname', text: tf.name })]);
        if (key !== 'weekday' && tf.kind !== 'event') block.appendChild(dayTefillaBox(key, tf, t[3])); /* a shiur or other category has no second time; the tefillos do */
        if (fb) {
          var same = el('input', { type: 'checkbox', id: 'same-' + key + '-' + tf.id }), info = el('div', { class: 'hint same-info' });
          same.checked = !store.value.trim();
          editor.hidden = same.checked;
          var kept = '';
          function update() {
            if (!same.checked) { info.textContent = 'Own list for ' + t[3] + '.'; return; }
            var src = sourceOf(key, tf.id);
            info.textContent = src ? 'Follows the ' + TYPE_EN[src] + ' list.' + (src === 'weekday' && onSunday ? ' On a Sunday, the Sunday list.' : '') : 'No list here and none to follow: no ' + tf.name + ' minyanim on this day.';
          }
          same.addEventListener('change', function () {
            if (same.checked) { kept = store.value; store.value = ''; editor.hidden = true; }
            else { var src = sourceOf(key, tf.id); store.value = kept.trim() ? kept : (src ? lines[src][tf.id].value : ''); editor.hidden = false; editor.reload(); }
            markTabs();
          });
          infoUpdaters.push(update);
          block.appendChild(el('label', { class: 'same', for: same.id }, [same, ' Same as ' + TYPE_EN[fb] + (fb === 'weekday' ? '' : ' (or whatever that day follows)')]));
          block.appendChild(info);
        }
        block.appendChild(editor);
        row.appendChild(block);
      });
      /* the coming day of this kind, on the screen: Home's "Another day", set to it */
      var seeRd = nextDayOfType(key);
      page.appendChild(el('div', { class: 'see-day' }, [el('button', { type: 'button', class: 'btn small', id: 'see-' + key, 'data-nodirty': '1', onclick: function () { seeDayOnScreen(seeRd, key === 'shabbos' || key === 'yomtov' || key === 'yomkippur' ? '09:00' : null); } },
        [el('span', { text: 'See the screen on ' + (seeRd === todayRd ? 'this day (today)' : previewDay(seeRd)) }), svgIcon('tv')]),
        el('span', { class: 'hint', text: 'Opens Home on the coming day of this kind. Save first to see your changes there.' })]));
      var seg = el('div', { class: 'seg', role: 'tablist' });
      d.tefillos.forEach(function (tf, i) {
        seg.appendChild(el('button', { type: 'button', role: 'tab', 'aria-selected': String(i === 0), text: tf.name, 'data-nodirty': '1', onclick: function () {
          page.className = 'col dtp tef-' + i;
          Array.prototype.forEach.call(seg.children, function (x, j) { x.setAttribute('aria-selected', String(j === i)); });
        } }));
      });
      page.appendChild(seg);
      page.appendChild(row);
      typePages[key] = { page: page, button: b };
      sp.appendChild(page);
    });
    function markTabs() {
      Cal.DAY_TYPES.forEach(function (t) {
        var has = d.tefillos.some(function (tf) { return lines[t[0]][tf.id].value.trim(); });
        typePages[t[0]].button.classList.toggle('has', has);
      });
      infoUpdaters.forEach(function (f) { try { f(); } catch (e) {} });
    }
    function showType(key) { Cal.DAY_TYPES.forEach(function (t) { typePages[t[0]].page.hidden = t[0] !== key; typePages[t[0]].button.setAttribute('aria-selected', String(t[0] === key)); }); }
    refreshRooms();
    if (!fRooms.value.trim()) fRooms.value = knownRooms.join(', ');
    paintRoomsEditor(); roomsChanged();
    pages.schedule = sp;

    /* the banner's page */
    var np = el('div', { class: 'col' });
    /* a Hebrew date beside a civil one: the three boxes write the civil date, and follow it when it is typed */
  /* A calendar that opens on the Hebrew month. Each day shows its Hebrew date large and its civil date small; Shabbos carries its
     parsha, and Rosh Chodesh, Yom Tov, Chol Hamoed, Chanukah, Purim and the fasts are named and coloured. Under the grid a line
     spells out the day the pointer or the keyboard is on. A switch shows the same by civil months.
       o.range()  -> { from: iso, to: iso, end: 'from' | 'to' }  the two ends and the one being chosen
       o.pick(iso)                                               a day was pressed ('' = no date)
       o.close()                                                 Done was pressed */
  var CAL_SHORT = { 'חול המועד סוכות': 'חוה״מ', 'חול המועד פסח': 'חוה״מ', 'שבעה עשר בתמוז': 'י״ז בתמוז', 'יום הכיפורים': 'יום כיפור', 'ערב יום כיפור': 'ערב יו״כ', 'ערב ראש השנה': 'ערב ר״ה',
    'שמיני עצרת ושמחת תורה': 'שמחת תורה', 'שביעי של פסח': 'שביעי ש״פ', 'אחרון של פסח': 'אחרון ש״פ' };
  var CIVIL_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function hebCalendar(o) {
    var israel = !!o.israel, todayRd = Cal.nowInTz(Date.now(), loc().tz).rd, byCivil = false, viewRd = todayRd, focusRd = null, wantFocus = false;
    var root = el('div', { class: 'hcal', dir: 'rtl' });
    function iso(rd) { return MinyanEngine.isoDate(rd); }
    function rdOf(v) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || ''); return m ? Cal.rdFromGreg(+m[1], +m[2], +m[3]) : null; }
    function civilLong(rd) { var g = Cal.gregFromRD(rd); return new Date(Date.UTC(g.y, g.m - 1, g.d)).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }); }
    /* the month on show: its first day, its length, and what to call it in both calendars */
    function month(rd) {
      var first, len, a, b;
      if (byCivil) {
        var g = Cal.gregFromRD(rd); first = Cal.rdFromGreg(g.y, g.m, 1); len = Cal.rdFromGreg(g.m === 12 ? g.y + 1 : g.y, g.m === 12 ? 1 : g.m + 1, 1) - first;
        a = Cal.hebFromRD(first); b = Cal.hebFromRD(first + len - 1);
        return { first: first, len: len, title: CIVIL_MONTHS[g.m - 1] + ' ' + g.y, sub: Cal.monthName(a.y, a.m) + (a.m !== b.m ? ' – ' + Cal.monthName(b.y, b.m) : '') + ' ' + Cal.gematria(b.y % 1000) };
      }
      var h = Cal.hebFromRD(rd); first = Cal.rdFromHeb(h.y, h.m, 1); len = Cal.hebMonthLength(h.y, h.m);
      a = Cal.gregFromRD(first); b = Cal.gregFromRD(first + len - 1);
      return { first: first, len: len, title: Cal.monthName(h.y, h.m) + ' ' + Cal.gematria(h.y % 1000), sub: CIVIL_MONTHS[a.m - 1] + (a.m !== b.m ? ' – ' + CIVIL_MONTHS[b.m - 1] : '') + ' ' + b.y };
    }
    /* everything there is to say about one day */
    function about(rd) {
      var info = Cal.dayInfo(rd, israel), labels = info.labels.slice(), special = labels.filter(function (l) { return l.indexOf('ראש חודש') !== 0; });
      var week = Cal.parshaOfWeek(rd, israel) || '', parsha = info.shabbos ? week : ''; /* a Shabbos that is Yom Tov has no parsha of its own */
      var tag = parsha ? parsha : special.length ? (CAL_SHORT[special[0]] || special[0]) : info.roshChodesh ? 'ר״ח' : ''; /* a Shabbos is named by its parsha; its colour still tells Chanukah or Rosh Chodesh */
      var line = Cal.DAY_NAMES[info.dow] + (parsha ? ' פרשת ' + parsha : '') + ' · ' + Cal.formatHeb(info.heb) + (labels.length ? ' · ' + labels.join(' · ') : '') + (!parsha && week ? ' · פרשת השבוע: ' + week : '');
      return { info: info, tag: tag, line: line, civil: civilLong(rd), kind: info.yomtov ? 'yt' : info.fast ? 'fast' : (info.cholHamoed || info.chanukah || info.purim) ? 'moed' : info.roshChodesh ? 'rc' : '' };
    }
    function step(n) { /* a month back or forward, by whichever calendar is on show */
      var mo = month(viewRd); viewRd = n > 0 ? mo.first + mo.len : mo.first - 1; focusRd = null; paint();
    }
    function paint() {
      var r = o.range() || {}, a = rdOf(r.from), b = rdOf(r.to), end = r.end === 'to' ? 'to' : 'from', mo = month(viewRd), i, rd;
      var hadFocus = wantFocus || root.contains(document.activeElement) && document.activeElement.classList.contains('hcal-day');
      wantFocus = false;
      root.textContent = '';
      root.setAttribute('data-end', end); root.setAttribute('data-view', byCivil ? 'civil' : 'heb');
      /* the head: back and forward, the month in both calendars, a list to jump far, today, and the switch between the two calendars */
      var jump = el('select', { class: 'hcal-jump', 'aria-label': 'Jump to a month', 'data-nodirty': '1' }), y, m, yNow, first;
      if (byCivil) {
        yNow = Cal.gregFromRD(todayRd).y;
        for (y = yNow - 1; y <= yNow + 3; y++) for (m = 1; m <= 12; m++) { first = Cal.rdFromGreg(y, m, 1); jump.appendChild(el('option', { value: String(first), text: CIVIL_MONTHS[m - 1] + ' ' + y })); }
      } else {
        yNow = Cal.hebFromRD(todayRd).y;
        for (y = yNow - 1; y <= yNow + 3; y++) [7, 8, 9, 10, 11, 12, 13, 1, 2, 3, 4, 5, 6].forEach(function (hm) { if (hm === 13 && !Cal.hebLeap(y)) return; var f = Cal.rdFromHeb(y, hm, 1); jump.appendChild(el('option', { value: String(f), text: Cal.monthName(y, hm) + ' ' + Cal.gematria(y % 1000) })); });
      }
      if (!Array.prototype.some.call(jump.options, function (op) { return op.value === String(mo.first); })) jump.insertBefore(el('option', { value: String(mo.first), text: mo.title }), jump.firstChild);
      jump.value = String(mo.first);
      jump.addEventListener('change', function () { viewRd = +jump.value; focusRd = null; paint(); });
      function nav(n, label) { return el('button', { type: 'button', class: 'hcal-nav' + (n > 0 ? ' next' : ' prev'), 'aria-label': label, title: label, 'data-nodirty': '1', onclick: function () { step(n); } }, [svgIcon('chev')]); }
      function seg(civil, text) { var on = byCivil === civil; return el('button', { type: 'button', class: 'hcal-seg' + (on ? ' on' : ''), 'aria-pressed': String(on), 'data-nodirty': '1', 'data-cal': civil ? 'civil' : 'heb', text: text, onclick: function () { if (byCivil === civil) return; byCivil = civil; paint(); } }); }
      root.appendChild(el('div', { class: 'hcal-head', dir: 'ltr' }, [
        nav(-1, 'The month before'),
        el('div', { class: 'hcal-title' }, [jump, el('div', { class: 'hcal-sub', dir: 'auto', text: mo.sub })]),
        nav(1, 'The month after')]));
      root.appendChild(el('div', { class: 'hcal-tools', dir: 'ltr' }, [
        el('div', { class: 'hcal-segs', role: 'group', 'aria-label': 'Which calendar the months follow' }, [seg(false, 'Hebrew months'), seg(true, 'Civil months')]),
        el('button', { type: 'button', class: 'hcal-today', 'data-nodirty': '1', text: 'Today', onclick: function () { viewRd = todayRd; focusRd = todayRd; wantFocus = true; paint(); } })]));
      root.appendChild(el('div', { class: 'hcal-dow', 'aria-hidden': 'true' }, Cal.DAY_SHORT.map(function (dname, k) { return el('span', { class: k === 6 ? 'shab' : '', text: dname }); })));
      /* the days */
      var grid = el('div', { class: 'hcal-grid', role: 'grid', 'aria-label': mo.title }), lead = Cal.mod(mo.first, 7), cells = {};
      for (i = 0; i < lead; i++) grid.appendChild(el('span', { class: 'hcal-pad', 'aria-hidden': 'true' }));
      if (focusRd == null || focusRd < mo.first || focusRd >= mo.first + mo.len) focusRd = (end === 'to' ? b : a) != null && (end === 'to' ? b : a) >= mo.first && (end === 'to' ? b : a) < mo.first + mo.len ? (end === 'to' ? b : a) : (todayRd >= mo.first && todayRd < mo.first + mo.len ? todayRd : mo.first);
      for (i = 0; i < mo.len; i++) {
        rd = mo.first + i;
        (function (rd) {
          var t = about(rd), g = Cal.gregFromRD(rd), h = t.info.heb, shut = end === 'to' && a != null && rd < a; /* the last day cannot come before the first */
          var cls = 'hcal-day' + (t.info.shabbos ? ' shab' : '') + (t.kind ? ' ' + t.kind : '') + (rd === todayRd ? ' today' : '') + (a != null && rd === a ? ' a' : '') + (b != null && rd === b ? ' b' : '') + (a != null && b != null && rd > a && rd < b ? ' in' : '') + (shut ? ' shut' : '');
          var big = byCivil ? String(g.d) : Cal.gematria(h.d), small = byCivil ? Cal.gematria(h.d) + (h.d === 1 || i === 0 ? ' ' + Cal.monthName(h.y, h.m) : '') : (g.d === 1 || i === 0 ? CIVIL_MONTHS[g.m - 1] + ' ' : '') + g.d;
          var btn = el('button', { type: 'button', class: cls, role: 'gridcell', 'data-iso': iso(rd), 'data-nodirty': '1', tabindex: rd === focusRd ? '0' : '-1', 'aria-label': t.line + ' · ' + t.civil, 'aria-selected': String((a != null && rd === a) || (b != null && rd === b)), title: t.line + ' · ' + t.civil }, [
            el('span', { class: 'hd', text: big }), el('span', { class: 'cd', dir: byCivil ? 'rtl' : 'ltr', text: small }), el('span', { class: 'tg', text: t.tag })]);
          if (shut) btn.setAttribute('aria-disabled', 'true');
          btn.addEventListener('click', function () { if (shut) return; focusRd = rd; wantFocus = true; o.pick(iso(rd)); });
          btn.addEventListener('mouseenter', function () { say(rd); }); btn.addEventListener('focus', function () { focusRd = rd; say(rd); });
          cells[rd] = btn; grid.appendChild(btn);
        })(rd);
      }
      grid.addEventListener('mouseleave', function () { say(null); });
      grid.addEventListener('keydown', function (ev) {
        var move = { ArrowLeft: 1, ArrowRight: -1, ArrowDown: 7, ArrowUp: -7 }[ev.key]; /* the week runs from the right, so left is the day after */
        if (ev.key === 'PageDown' || ev.key === 'PageUp') { ev.preventDefault(); var keepDay = focusRd - mo.first; step(ev.key === 'PageDown' ? 1 : -1); var m2 = month(viewRd); focusRd = m2.first + Math.min(keepDay, m2.len - 1); wantFocus = true; paint(); return; }
        if (!move) return;
        ev.preventDefault();
        var to = focusRd + move;
        if (to < mo.first || to >= mo.first + mo.len) { viewRd = to; focusRd = to; wantFocus = true; paint(); return; }
        focusRd = to; Object.keys(cells).forEach(function (k) { cells[k].tabIndex = +k === to ? 0 : -1; }); cells[to].focus();
      });
      root.appendChild(grid);
      /* the day in words, and the way out */
      var line = el('div', { class: 'hcal-line', 'aria-live': 'polite' });
      function say(rd) {
        var r2 = rd != null ? rd : (end === 'to' ? b : a), t;
        line.textContent = '';
        if (r2 == null) { line.appendChild(el('span', { class: 'none', dir: 'ltr', text: 'Point at a day, or press one, to read all about it.' })); return; }
        t = about(r2);
        line.appendChild(el('span', { class: 'heb', text: t.line })); line.appendChild(el('span', { class: 'civ', dir: 'ltr', text: t.civil }));
      }
      say(null);
      root.appendChild(line);
      root.appendChild(el('div', { class: 'hcal-foot', dir: 'ltr' }, [
        el('span', { class: 'hcal-which', text: end === 'to' ? 'Choosing the last day' : 'Choosing the first day' }),
        el('span', { class: 'sp' }),
        el('button', { type: 'button', class: 'btn small', 'data-nodirty': '1', 'data-cal': 'none', text: end === 'to' ? 'No last day' : 'No first day', title: end === 'to' ? 'It stays on the board until it is removed' : 'It is on the board from the moment it is saved', onclick: function () { o.pick(''); } }),
        el('button', { type: 'button', class: 'btn small primary', 'data-nodirty': '1', 'data-cal': 'done', text: 'Done', onclick: function () { o.close(); } })]));
      if (hadFocus && cells[focusRd]) { try { cells[focusRd].focus({ preventScroll: true }); } catch (e) { cells[focusRd].focus(); } }
    }
    return { el: root, paint: paint,
      /* open on the month of the end being chosen (today's month when it has no date yet), by Hebrew months */
      open: function () { var r = o.range() || {}, at = rdOf(r.end === 'to' ? (r.to || r.from) : (r.from || r.to)); byCivil = false; viewRd = at != null ? at : todayRd; focusRd = at; wantFocus = true; paint(); },
      show: function (isoDay) { var at = rdOf(isoDay); if (at != null) { viewRd = at; focusRd = at; } paint(); } };
  }
  function hebPicker(input) {
    var wrap = el('span', { class: 'hebpick' }), dSel = el('select', { 'aria-label': 'Hebrew day' }), mSel = el('select', { 'aria-label': 'Hebrew month' }), ySel = el('select', { 'aria-label': 'Hebrew year' }), shown = el('span', { class: 'hebshow' });
    var thisY = Cal.hebFromRD(Cal.nowInTz(Date.now(), loc().tz).rd).y, quiet = false;
    function fillYears() { ySel.textContent = ''; for (var y = thisY - 1; y <= thisY + 2; y++) ySel.appendChild(el('option', { value: String(y), text: Cal.formatHeb({ y: y, m: 7, d: 1 }).split(' ').slice(-1)[0] })); }
    function fillMonths() {
      var y = +ySel.value || thisY, last = Cal.hebLeap(y) ? 13 : 12, order = [7, 8, 9, 10, 11, 12, 13, 1, 2, 3, 4, 5, 6], cur = mSel.value;
      mSel.textContent = '';
      order.forEach(function (m) { if (m === 13 && last === 12) return; mSel.appendChild(el('option', { value: String(m), text: Cal.monthName(y, m) })); });
      if (cur) mSel.value = cur;
      if (mSel.selectedIndex < 0) mSel.selectedIndex = 0;
    }
    function fillDays() {
      var y = +ySel.value || thisY, m = +mSel.value || 7, len = Cal.hebMonthLength(y, m), cur = dSel.value, i;
      dSel.textContent = '';
      for (i = 1; i <= len; i++) dSel.appendChild(el('option', { value: String(i), text: Cal.formatHeb({ y: y, m: m, d: i }).split(' ')[0] }));
      if (cur && +cur <= len) dSel.value = cur; else dSel.selectedIndex = 0;
    }
    function fromInput() {
      var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.value || '');
      quiet = true;
      var h = m ? Cal.hebFromRD(Cal.rdFromGreg(+m[1], +m[2], +m[3])) : Cal.hebFromRD(Cal.nowInTz(Date.now(), loc().tz).rd); /* no date yet: the boxes start at today, and nothing is written until one is changed */
      ySel.value = String(h.y); fillMonths(); mSel.value = String(h.m); fillDays(); dSel.value = String(h.d);
      shown.textContent = m ? Cal.formatHeb(h) : '';
      quiet = false;
    }
    function toInput() {
      if (quiet) return;
      var y = +ySel.value, m = +mSel.value, d = +dSel.value, g = Cal.gregFromRD(Cal.rdFromHeb(y, m, d));
      input.value = g.y + '-' + pad2(g.m) + '-' + pad2(g.d);
      shown.textContent = Cal.formatHeb({ y: y, m: m, d: d });
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    fillYears(); fillMonths(); fillDays(); fromInput();
    ySel.addEventListener('change', function () { fillMonths(); fillDays(); toInput(); });
    mSel.addEventListener('change', function () { fillDays(); toInput(); });
    dSel.addEventListener('change', toInput);
    input.addEventListener('change', fromInput);
    input.addEventListener('input', fromInput);
    wrap.appendChild(dSel); wrap.appendChild(mSel); wrap.appendChild(ySel);
    return { wrap: wrap, shown: shown, sync: fromInput };
  }
    var bText = el('textarea', { id: 'banner-text', dir: 'auto', placeholder: 'e.g. אין מעריב בלב אהרן הערב' }), bFrom = inp('banner-from', (d.banner && d.banner.from) || '', { type: 'datetime-local' }), bUntil = inp('banner-until', (d.banner && d.banner.until) || '', { type: 'datetime-local' });
    bText.value = (d.banner && d.banner.text) || ''; bText.style.minHeight = '60px';
    var cBanner = card('Temporary banner', 'One line shown across the top of the board (and at the start of text replies). Give it a start time and it appears by itself; give it an end time and it disappears by itself. Blank means right away, or for good.');
    cBanner.body.appendChild(el('div', { class: 'fields' }, [field('Banner text', bText)]));
    cBanner.body.appendChild(el('div', { class: 'fields' }, [field('Show from (shul time; blank = right away)', bFrom), field('Show until (shul time; blank = until you clear it)', bUntil, el('button', { type: 'button', class: 'btn small', text: 'Clear banner', onclick: function () { bText.value = ''; bFrom.value = ''; bUntil.value = ''; } }))]));
    np.appendChild(cBanner);
    /* ---------- home: the hallway screen as it is now, and as it will be on any day ----------
       The screen itself, in a frame the size of the TV scaled to fit the page. "Now" is live; "Another day" opens the same screen with
       its clock set to that day and time, so the schedule, the zmanim and the donations shown are that day's. It shows what is saved
       on this device, published or not. */
    var hp = el('div', { class: 'col', id: 'page-home', 'data-nodirty': '1' });
    ui.home = ui.home || { mode: 'now', date: MinyanEngine.isoDate(todayRd + 1), time: '08:00' };
    var H = ui.home, homeFrame = el('iframe', { id: 'home-tv', title: 'The hallway screen', scrolling: 'no', tabindex: '-1' }),
      homeZoom = el('a', { class: 'home-zoom', id: 'home-zoom', target: '_blank', rel: 'noopener', 'aria-label': 'Open the screen large', title: 'Open the screen large' }), /* a frame swallows a tap: this lies over it and opens the large view */
      homeStage = el('div', { class: 'home-stage' }, [homeFrame, homeZoom]);
    var homeCap = el('div', { class: 'home-cap', role: 'status' }), homeFacts = el('dl', { class: 'home-facts' }), homeWhen = el('div', { class: 'home-when' });
    var homeUnsaved = el('div', { class: 'home-note warn', text: 'You have changes that are not saved yet. Press Save and they appear here.' }); homeUnsaved.hidden = true;
    var fHDate = inp('home-date', H.date, { type: 'date' }), hHDate = hebPicker(fHDate), homeCivil = el('span', { class: 'dn-civil' });
    var fHTime = inp('home-time', H.time, { type: 'time', step: '300' });
    var homeOpen = el('a', { class: 'btn', id: 'home-open', target: '_blank', rel: 'noopener' }, [el('span', { text: 'Open full size' }), svgIcon('open')]);
    var homeModes = el('div', { class: 'dn-filters', role: 'group', 'aria-label': 'Which moment to show' }), homeDays = el('div', { class: 'dn-quick' }), homeTimes = el('div', { class: 'dn-quick' });
    function homeRd() { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fHDate.value || ''); return m ? Cal.rdFromGreg(+m[1], +m[2], +m[3]) : null; }
    function homeMin() { var m = /^(\d{2}):(\d{2})/.exec(fHTime.value || ''); return m ? +m[1] * 60 + +m[2] : null; }
    function homeUrl() { return 'index.html?view=display&full=1' + (H.mode === 'at' && homeRd() != null && homeMin() != null ? '&at=' + fHDate.value + 'T' + fHTime.value.slice(0, 5) : ''); }
    function nextDay(test) { for (var i = 1; i <= 60; i++) if (test(Cal.dayInfo(todayRd + i, !!d.israel))) return todayRd + i; return todayRd + 1; }
    var HOME_DAYS = [['Tomorrow', todayRd + 1], ['Friday', nextDay(function (x) { return x.dow === 5; })], ['Shabbos', nextDay(function (x) { return x.dow === 6; })], ['Rosh Chodesh', nextDay(function (x) { return x.roshChodesh; })], ['Yom Tov', nextDayOfType('yomtov')]];
    function seeDayOnScreen(rd, time) { /* from the Schedule page: Home, on that day */
      var iso = MinyanEngine.isoDate(rd);
      H.mode = 'at'; H.date = iso; fHDate.value = iso; hHDate.sync();
      if (time) { H.time = time; fHTime.value = time; }
      selectTab('home'); paintHome();
      try { window.scrollTo(0, 0); } catch (e) {}
    }
    var HOME_TIMES = [['Morning', '07:30'], ['Midday', '13:00'], ['Evening', '18:00'], ['Night', '21:30']];
    function clock12(min) { var h = Math.floor(min / 60), m = min % 60; return ((h + 11) % 12 + 1) + ':' + pad2(m) + (h < 12 ? ' AM' : ' PM'); }
    function fitHome() {
      var w = homeStage.clientWidth; if (!w) return;
      var k = w / 1920, hgt = Math.round(1080 * k) + 'px', tr = 'scale(' + k + ')';
      if (homeStage.style.height !== hgt) homeStage.style.height = hgt;
      if (homeFrame.style.transform !== tr) homeFrame.style.transform = tr;
    }
    function fact(label, value, rtl) { homeFacts.appendChild(el('dt', { text: label })); homeFacts.appendChild(el('dd', rtl ? { dir: 'rtl', text: value } : { dir: 'auto', text: value })); }
    function paintHome(force) {
      var at = H.mode === 'at', rd = at ? homeRd() : todayRd, min = at ? homeMin() : Math.floor(Cal.nowInTz(Date.now(), loc().tz).min), ok = rd != null && min != null;
      homeModes.textContent = '';
      [['now', 'Now'], ['at', 'Another day']].forEach(function (mo) {
        var on = H.mode === mo[0];
        homeModes.appendChild(el('button', { type: 'button', class: 'dn-chip' + (on ? ' on' : ''), id: 'home-' + mo[0], 'data-nodirty': '1', 'aria-pressed': String(on), text: mo[1], onclick: function () { H.mode = mo[0]; paintHome(); } }));
      });
      homeWhen.hidden = !at;
      homeDays.textContent = '';
      HOME_DAYS.forEach(function (q) {
        var iso = MinyanEngine.isoDate(q[1]), on = fHDate.value === iso;
        homeDays.appendChild(el('button', { type: 'button', class: 'dn-chip' + (on ? ' on' : ''), 'data-nodirty': '1', 'aria-pressed': String(on), 'data-day': iso, text: q[0], onclick: function () { fHDate.value = iso; hHDate.sync(); H.date = iso; paintHome(); } }));
      });
      homeTimes.textContent = '';
      HOME_TIMES.forEach(function (q) {
        var on = fHTime.value.slice(0, 5) === q[1];
        homeTimes.appendChild(el('button', { type: 'button', class: 'dn-chip' + (on ? ' on' : ''), 'data-nodirty': '1', 'aria-pressed': String(on), 'data-time': q[1] }, [el('span', { text: q[0] }), el('span', { class: 'dn-chipsub', text: clock12(+q[1].slice(0, 2) * 60 + +q[1].slice(3)) })]));
        homeTimes.lastChild.addEventListener('click', function () { fHTime.value = q[1]; H.time = q[1]; paintHome(); });
      });
      if (!ok) { homeCap.textContent = 'Choose a day and a time to see the screen then.'; homeFacts.textContent = ''; return; }
      var g = Cal.gregFromRD(rd), info = Cal.dayInfo(rd, !!d.israel), civil = new Date(Date.UTC(g.y, g.m - 1, g.d)).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
      homeCivil.textContent = civil;
      homeCap.textContent = at ? 'The screen as it will be on ' + civil + ' at ' + clock12(min) + '.' : 'The screen as it is right now.';
      var url = homeUrl();
      homeOpen.setAttribute('href', url); homeZoom.setAttribute('href', url);
      if (force || homeFrame.getAttribute('data-url') !== url) { homeFrame.setAttribute('data-url', url); homeFrame.src = url + (force ? '&r=' + Date.now() : ''); }
      /* what that day holds, in words */
      var sc = scheduleFor(rd), kindOfDay = sc.override ? 'A special date' + (sc.override.label ? ': ' + sc.override.label : '') : sc.roll && sc.roll.name ? 'Extra schedule: ' + sc.roll.name : ((Cal.DAY_TYPES.filter(function (t) { return t[0] === sc.type; })[0] || [])[3] || sc.type || 'Regular');
      var on = engine.activeNotices(rd, min), ms = Cal.epochFromWall(rd, min, loc().tz), ban = engine.activeBanner(ms);
      homeFacts.textContent = '';
      fact('Day', dayLine(info, rd) + ' · ' + Cal.formatHeb(info.heb) + (info.labels && info.labels.length ? ' · ' + info.labels.join(' · ') : ''), true);
      if (sc.type === 'yomtov' && info.dow === 5 && !sc.override && !(sc.roll && sc.roll.name)) kindOfDay += ' · Mincha and Maariv as on Erev Shabbos (Friday)';
      fact('Schedule in use', kindOfDay);
      /* what the evening of that day is: the one thing about Shabbos and Yom Tov that is easy to get wrong */
      var zEve = zmanimFor(rd);
      if (info.candles) fact('Evening', info.candles === 'night' ? 'Candle lighting after nightfall, ' + fmtTime(zEve.tzeis) : 'Candle lighting ' + fmtTime(zEve.candles));
      else if (info.yomKippur) fact('Evening', 'The fast ends ' + fmtTime(zEve.tzeis));
      else if (info.motzaei) fact('Evening', (info.motzaei === 'shabbos' ? 'Shabbos' : 'Yom Tov') + ' ends ' + fmtTime(zEve.tzeis));
      fact('Donations on the board', on.length ? on.map(function (n) { return ((n.name || '').trim() || (n.body || '').trim().split('\n')[0]) + (n.title ? ' (' + n.title + ')' : ''); }).join('  ·  ') : 'None that day');
      if (ban && ban.text) fact('Banner', ban.text);
      fitHome();
    }
    fHDate.addEventListener('change', function () { H.date = fHDate.value; paintHome(); });
    fHTime.addEventListener('change', function () { H.time = fHTime.value.slice(0, 5); paintHome(); });
    homeWhen.appendChild(el('div', { class: 'fields home-pick' }, [
      el('div', { class: 'field' }, [el('label', { for: fHDate.id, text: 'Day' }), el('div', { class: 'hebrow' }, [hHDate.wrap]), el('div', { class: 'dn-civilrow' }, [fHDate, homeCivil]), homeDays]),
      el('div', { class: 'field' }, [el('label', { for: fHTime.id, text: 'Time of day' }), fHTime, homeTimes])]));
    hp.appendChild(el('div', { class: 'home-bar' }, [homeModes, el('span', { class: 'sp' }), el('button', { type: 'button', class: 'btn', id: 'home-refresh', 'data-nodirty': '1', text: 'Refresh', title: 'Load the screen again', onclick: function () { paintHome(true); } }), homeOpen]));
    hp.appendChild(homeWhen); hp.appendChild(homeUnsaved);
    hp.appendChild(el('div', { class: 'home-tv' }, [homeStage, el('div', { class: 'home-stand' })]));
    hp.appendChild(homeCap); hp.appendChild(homeFacts);
    hp.appendChild(el('div', { class: 'home-note', text: 'This is the hallway screen itself, with what is saved on this device. The TV shows the same once you publish. Tap the picture to see it large; on a phone, turn it sideways.' }));
    if (mode !== 'artifact' && !isStandalone() && !inStoreApp()) hp.appendChild(el('div', { class: 'home-shortcut' }, [el('button', { type: 'button', class: 'btn small', id: 'home-shortcut', 'data-nodirty': '1', onclick: adminShortcut }, [svgIcon('install'), el('span', { text: 'Put the back end on this device' })]),
      el('span', { class: 'hint', text: 'A shortcut of its own, so it opens here and not on the board.' })]));
    if (ui.homeFit) window.removeEventListener('resize', ui.homeFit); /* a rebuild of the back end leaves one listener, not one more each time */
    ui.homeFit = fitHome; window.addEventListener('resize', fitHome);
    /* The frame is measured whenever its own size changes, not only when the window's does: the page laid out a moment after it
       was built, a scroll bar appearing, a phone turned. Measured once too early, the picture stayed at full size and showed only
       its top corner. */
    if (ui.homeWatch) { try { ui.homeWatch.disconnect(); } catch (e) {} ui.homeWatch = null; }
    if (window.ResizeObserver) { ui.homeWatch = new ResizeObserver(function () { fitHome(); }); ui.homeWatch.observe(homeStage); }
    homeFrame.addEventListener('load', fitHome);
    [60, 300, 1200].forEach(function (ms) { setTimeout(fitHome, ms); });
    pages.home = hp;

    /* ---------- donations: who sponsors what on the board, and from when to when ----------
       Each donation is a card: who, which kind, its Hebrew start and end dates, and whether it is on the board now, still to come or
       finished. A kind (פרנס החודש, נר למאור …) carries how its panel reads — title, size, the line that leads into the name, its usual
       length — so adding a donation is a kind, a name, a line or two and a period. They are stored as the board's notices, as before. */
    var donPage = el('div', { class: 'col', id: 'page-donations' });
    var kinds = clone((d.donationKinds && d.donationKinds.length) ? d.donationKinds : DONATION_KINDS);
    var todayIso = MinyanEngine.isoDate(todayRd), donSeq = 0;
    ui.dn = ui.dn || { q: '', filter: 'all', sort: 'board' };
    function opt(v, t) { return el('option', { value: v, text: t }); }
    function rdOf(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? Cal.rdFromGreg(+m[1], +m[2], +m[3]) : null; }
    function kindById(kid) { return kinds.filter(function (k) { return k.id === kid; })[0] || null; }
    function kindIndex(kid) { for (var i = 0; i < kinds.length; i++) if (kinds[i].id === kid) return i; return kinds.length; }
    function kindSize(kid) { var k = kindById(kid); return k ? (k.size || 'normal') : 'normal'; }
    function guessKind(n) {
      if (n.kind && (n.kind === 'other' || kindById(n.kind))) return n.kind;
      var t = n.title || '', hit = kinds.filter(function (k) { return k.name && t.indexOf(k.name) >= 0; })[0];
      if (hit) return hit.id;
      if (/נר למאור/.test(t) && kindById('ner')) return 'ner';
      if (/פרנס ה?חודש/.test(t) && kindById('month')) return 'month';
      if (/פרנס השבוע/.test(t) && kindById('week')) return 'week';
      if (/פרנס היום/.test(t) && kindById('day')) return 'day';
      return 'other';
    }
    /* the title a kind gives a donation that starts on that day: {month} and {parsha} are filled in from it */
    function titleFor(kid, fromIso, toIso) {
      var k = kindById(kid); if (!k) return '';
      var r = rdOf(fromIso); if (r == null) r = rdOf(toIso); if (r == null) r = todayRd;
      var h = Cal.hebFromRD(r);
      return (k.title || k.name || '').replace(/\{month\}/g, Cal.monthName(h.y, h.m)).replace(/\{parsha\}/g, Cal.parshaOfWeek(r, !!d.israel) || '').replace(/\s+/g, ' ').trim();
    }
    function effTitle(x) { return (x.titleOwn || '').trim() || titleFor(x.kind, x.from, x.to); }
    function effSize(x) { var v = x.sizeOwn || kindSize(x.kind); return v === 'normal' ? '' : v; }
    var dons = (d.notices || []).filter(function (n) { return ((n.name || '') + (n.body || '') + (n.lead || '')).trim(); }).map(function (n) {
      var kd = guessKind(n);
      return { id: n.id || '', no: +n.no || 0, kind: kd, lead: n.lead || '', name: n.name || '', body: n.body || '', logo: n.logo || '', from: n.from || '', to: n.to || '', fromTime: n.fromTime || '', toTime: n.toTime || '', off: !!n.off,
        titleOwn: n.titleOwn != null ? n.titleOwn : ((n.title || '') === titleFor(kd, n.from, n.to) ? '' : (n.title || '')),
        sizeOwn: n.sizeOwn != null ? n.sizeOwn : ((n.size || 'normal') === kindSize(kd) ? '' : (n.size || 'normal')) };
    });
    dons.forEach(function (x) { if (x.no > donSeq) donSeq = x.no; });
    dons.forEach(function (x) { if (!x.no) x.no = ++donSeq; if (!x.id) x.id = 'd' + x.no + Math.random().toString(36).slice(2, 7); });
    /* on the board the panels stand in the order of their kinds, and within a kind by their start */
    function boardOrder(a, b) { return kindIndex(a.kind) - kindIndex(b.kind) || (a.from || '').localeCompare(b.from || '') || a.no - b.no; }
    function donNotices() {
      return dons.slice().sort(boardOrder).map(function (x) {
        var n = { id: x.id, no: x.no, kind: x.kind, title: effTitle(x), titleOwn: (x.titleOwn || '').trim(), lead: (x.lead || '').trim(), name: (x.name || '').trim(), body: (x.body || '').trim(),
          size: effSize(x), sizeOwn: x.sizeOwn || '', logo: (x.logo || '').trim(), from: x.from || '', to: x.to || '' };
        if (x.off) n.off = true; /* switched off: kept in the list, not shown on the board */
        if (x.from && x.fromTime) n.fromTime = x.fromTime; /* a donation for part of a day: from a time on its first day … */
        if (x.to && x.toTime) n.toTime = x.toTime; /* … until a time on its last */
        return n;
      });
    }
    /* where a donation stands today; a switched-off one is off whatever its dates say */
    function minuteNow() { return Cal.nowInTz(Date.now(), loc().tz).min; }
    function dateState(x) {
      var a = parseHHMM(x.fromTime), b = parseHHMM(x.toTime), m = minuteNow();
      if (x.from && (todayIso < x.from || (todayIso === x.from && a != null && m < a))) return 'soon';
      if (x.to && (todayIso > x.to || (todayIso === x.to && b != null && m >= b))) return 'done';
      return 'on';
    }
    function hourText(v) { var m = parseHHMM(v); return m == null ? '' : clock12(m); }
    function donState(x) { return x.off ? 'off' : dateState(x); }
    var STATE_TEXT = { on: 'On the board', soon: 'Coming up', done: 'Finished', off: 'Switched off' };
    function dayWord(n) { return n === 1 ? '1 day' : n + ' days'; }
    function whenText(x, side) {
      var r = rdOf(side === 'from' ? x.from : x.to), n;
      if (r == null) return side === 'from' ? 'no start date' : 'no end date';
      var at = parseHHMM(side === 'from' ? x.fromTime : x.toTime), hour = at == null ? '' : ' at ' + clock12(at), late = at != null && minuteNow() >= at;
      if (side === 'from') { n = todayRd - r; return n === 0 ? (at != null && !late ? 'starts today' : 'started today') + hour : n === 1 ? 'started yesterday' : n > 1 ? 'started ' + dayWord(n) + ' ago' : n === -1 ? 'starts tomorrow' + hour : 'starts in ' + dayWord(-n); }
      n = r - todayRd; return n === 0 ? (late ? 'ended today' : 'ends today') + hour : n === 1 ? 'ends tomorrow' + hour : n > 1 ? 'ends in ' + dayWord(n) : n === -1 ? 'ended yesterday' : 'ended ' + dayWord(-n) + ' ago';
    }
    function hebDate(iso) { var r = rdOf(iso); return r == null ? '—' : Cal.formatHeb(Cal.hebFromRD(r)); }
    function civilDate(iso) { var r = rdOf(iso); if (r == null) return ''; var g = Cal.gregFromRD(r); return new Date(Date.UTC(g.y, g.m - 1, g.d)).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }); }
    function donName(x) { return (x.name || '').trim() || (x.body || '').trim().split('\n')[0] || effTitle(x) || 'Donation'; }
    function donSub(x) { var lines = (x.body || '').trim().split('\n').filter(Boolean); return (x.name || '').trim() ? (lines[0] || '') : (lines[1] || ''); }
    function initials(x) {
      var words = nameRuns(donName(x)).filter(function (r) { return !r.small; }).map(function (r) { return r.text; }).join(' ').split(/\s+/).filter(Boolean);
      function first(wd) { var m = /[א-תA-Za-z0-9]/.exec(wd || ''); return m ? m[0] : ''; }
      return (first(words[0]) + (words.length > 1 ? first(words[words.length - 1]) : '')) || '•';
    }
    function numText(no) { return '#' + (no < 1000 ? ('00' + no).slice(-3) : String(no)); }
    /* this month, next month; this week, next week; today, tomorrow — how a shul gives these out */
    function periodRange(period, ahead) {
      var a, b, i, y, m, h;
      if (period === 'month') {
        h = Cal.hebFromRD(todayRd); y = h.y; m = h.m;
        for (i = 0; i < ahead; i++) { h = Cal.hebFromRD(Cal.rdFromHeb(y, m, 1) + Cal.hebMonthLength(y, m)); y = h.y; m = h.m; }
        a = Cal.rdFromHeb(y, m, 1); b = a + Cal.hebMonthLength(y, m) - 1;
        return { from: MinyanEngine.isoDate(a), to: MinyanEngine.isoDate(b), text: Cal.monthName(y, m), sub: ahead ? 'next month' : 'this month' };
      }
      if (period === 'week') { a = todayRd - todayInfo.dow + 7 * ahead; return { from: MinyanEngine.isoDate(a), to: MinyanEngine.isoDate(a + 6), text: ahead ? 'Next week' : 'This week' }; }
      a = todayRd + ahead; return { from: MinyanEngine.isoDate(a), to: MinyanEngine.isoDate(a), text: ahead ? 'Tomorrow' : 'Today' };
    }

    /* a form that opens over the page: Escape closes it, Tab stays inside it, and a slip outside does not throw away what was typed */
    function dnModal(title, body, foot) {
      var prev = document.activeElement, closeBtn = el('button', { type: 'button', class: 'dn-x', 'aria-label': 'Close' }, [svgIcon('x')]);
      var sheet = el('div', { class: 'dn-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, [el('div', { class: 'dn-head' }, [el('h2', { text: title }), closeBtn]), body, foot]);
      var back = el('div', { class: 'dn-modal' }, [sheet]), api = { sheet: sheet, changed: false, close: close };
      function close() { document.removeEventListener('keydown', onKey, true); back.remove(); if (prev && prev.focus) { try { prev.focus(); } catch (e) {} } }
      function onKey(ev) {
        if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); if (api.escape && api.escape()) return; close(); return; } /* something open inside the form (its calendar) closes first */
        if (ev.key !== 'Tab') return;
        var f = Array.prototype.filter.call(sheet.querySelectorAll('button, input, select, textarea, summary'), function (n) { return !n.disabled && n.offsetParent !== null; });
        if (!f.length) return;
        if (ev.shiftKey && document.activeElement === f[0]) { ev.preventDefault(); f[f.length - 1].focus(); }
        else if (!ev.shiftKey && document.activeElement === f[f.length - 1]) { ev.preventDefault(); f[0].focus(); }
      }
      closeBtn.addEventListener('click', close);
      back.addEventListener('mousedown', function (ev) { if (ev.target === back && !api.changed) close(); });
      document.addEventListener('keydown', onKey, true);
      $('#overlay').appendChild(back);
      return api;
    }
    function errLine() { return el('div', { class: 'dn-err', role: 'alert' }); }
    function isConnected() { return mode !== 'artifact' && ghConfigured(ghSettings()); }

    /* add or edit one donation; `like` starts a new one from another's details */
    function openDonation(orig, like) {
      var isNew = !orig, fid = ++uid, src = orig || like || null, datesTouched = false, m;
      var w = { kind: src ? src.kind : (kinds[0] ? kinds[0].id : 'other') };
      var k0 = kindById(w.kind), r0 = periodRange(k0 ? k0.period : 'day', 0);
      var fName = inp('dn-name-' + fid, src ? src.name : '', { autocomplete: 'off', placeholder: 'מו״ה ראובן בן יעקב הי״ו' });
      var fBody = el('textarea', { id: 'dn-body-' + fid, dir: 'auto', rows: '3', placeholder: 'לעילוי נשמת …' }); fBody.value = src ? src.body : '';
      /* The two days are kept as civil dates, as everywhere, and chosen in a calendar that opens on the Hebrew month. Each has a
         button that shows it in both calendars; pressing one opens the calendar under them for that end. */
      var fFrom = el('input', { type: 'hidden', id: 'dn-from-' + fid, value: orig ? orig.from : r0.from }), fTo = el('input', { type: 'hidden', id: 'dn-to-' + fid, value: orig ? orig.to : r0.to });
      var picking = null, calBox = el('div', { class: 'dn-cal' }); calBox.hidden = true;
      function dateButton(which) { return el('button', { type: 'button', class: 'dn-date', id: 'dn-' + which + 'btn-' + fid, 'data-end': which, 'aria-expanded': 'false', onclick: function () { setPicking(picking === which ? null : which); } }); }
      var bFrom = dateButton('from'), bTo = dateButton('to');
      var cal = hebCalendar({ israel: !!d.israel,
        range: function () { return { from: fFrom.value, to: fTo.value, end: picking || 'from' }; },
        pick: function (isoDay) {
          datesTouched = true;
          if (picking === 'to') { fTo.value = isoDay; afterDates(); setPicking(null); bTo.focus(); }
          else { fFrom.value = isoDay; if (isoDay && fTo.value && fTo.value < isoDay) fTo.value = isoDay; afterDates(); if (isoDay) setPicking('to'); else { setPicking(null); bFrom.focus(); } } /* the first day chosen, the calendar goes straight on to the last */
          changed();
        },
        close: function () { var was = picking; setPicking(null); (was === 'to' ? bTo : bFrom).focus(); } });
      calBox.appendChild(cal.el);
      function paintDates() {
        [[bFrom, fFrom, 'First day', 'No first day', 'On the board as soon as it is saved'], [bTo, fTo, 'Last day', 'No last day', 'Stays until it is removed']].forEach(function (t) {
          var b = t[0], v = t[1].value, on = picking === b.getAttribute('data-end');
          b.textContent = '';
          b.appendChild(el('span', { class: 'dn-datelbl', text: t[2] }));
          b.appendChild(el('span', { class: 'dn-hebd', dir: v ? 'rtl' : 'ltr', text: v ? hebDate(v) : t[3] }));
          b.appendChild(el('span', { class: 'dn-civil', text: v ? civilDate(v) : t[4] }));
          b.appendChild(svgIcon('today'));
          b.classList.toggle('on', on); b.setAttribute('aria-expanded', String(on));
        });
        if (picking) cal.paint();
      }
      function setPicking(which) {
        picking = which; calBox.hidden = !which;
        paintDates();
        if (which) { cal.open(); try { calBox.scrollIntoView({ block: 'nearest' }); } catch (e) {} }
      }
      function afterDates() { errDates.textContent = ''; paintQuick(); refresh(); }
      /* All day, or part of it: from a time on the first day until a time on the last. Midnight to 11:59 PM is the whole day, said the long way. */
      var hasHours = !!(src && orig && (orig.fromTime || orig.toTime));
      var fAllDay = el('input', { type: 'checkbox', role: 'switch', id: 'dn-allday-' + fid }); fAllDay.checked = !hasHours;
      var fFromT = inp('dn-fromt-' + fid, orig && orig.fromTime ? orig.fromTime : '00:00', { type: 'time' }), fToT = inp('dn-tot-' + fid, orig && orig.toTime ? orig.toTime : '23:59', { type: 'time' });
      var allDayNote = el('span', { class: 'dn-hint' }), hoursRow = el('div', { class: 'fields dn-hours' }, [field('From, on the first day', fFromT), field('Until, on the last day', fToT)]);
      function hours() { /* what is kept: nothing for a whole day, or for an end left at the day's own edge */
        var a = fAllDay.checked || !fFrom.value ? '' : fFromT.value, b = fAllDay.checked || !fTo.value ? '' : fToT.value;
        return { from: a && a !== '00:00' ? a : '', to: b && b !== '23:59' ? b : '' };
      }
      function hoursSync() {
        hoursRow.hidden = fAllDay.checked;
        fFromT.disabled = !fFrom.value; fToT.disabled = !fTo.value; /* a time belongs to a day: with no first or last day there is nothing for it to stand on */
        allDayNote.textContent = fAllDay.checked ? 'From the start of its first day to the end of its last.' : 'Only between these times: from the first on its first day until the second on its last.';
      }
      fAllDay.addEventListener('change', function () { hoursSync(); errDates.textContent = ''; refresh(); changed(); });
      [fFromT, fToT].forEach(function (f) { f.addEventListener('change', function () { errDates.textContent = ''; refresh(); changed(); }); });
      var fLead = inp('dn-lead-' + fid, src ? src.lead : (k0 ? k0.lead || '' : ''));
      var fTitle = inp('dn-title-' + fid, src ? src.titleOwn : '');
      var fSize = el('select', { id: 'dn-size-' + fid }, [opt('', 'As this kind usually is'), opt('big', 'Big'), opt('normal', 'Normal'), opt('small', 'Small'), opt('tiny', 'Smallest')]);
      fSize.value = src ? (src.sizeOwn || '') : '';
      var fLogo = inp('dn-logo-' + fid, src ? src.logo : '', { dir: 'ltr', placeholder: 'logo.png' });
      var errName = errLine(), errDates = errLine(), stage = el('div', { class: 'dn-stage', dir: 'rtl' }), stageNote = el('div', { class: 'dn-note' });
      var kindRow = el('div', { class: 'dn-kinds', role: 'radiogroup', 'aria-label': 'Kind of donation' }), quick = el('div', { class: 'dn-quick' });
      function changed() { m.changed = true; }
      function current() {
        var sz = fSize.value || kindSize(w.kind);
        return { title: fTitle.value.trim() || titleFor(w.kind, fFrom.value, fTo.value), lead: fLead.value, name: fName.value, body: fBody.value, size: sz === 'normal' ? '' : sz, logo: fLogo.value.trim() };
      }
      function refresh() {
        var c = current(), empty = !(c.name + c.body).trim();
        stage.textContent = ''; stage.appendChild(sponsorPanel(c));
        var hr = hours(), ds = dateState({ from: fFrom.value, to: fTo.value, fromTime: hr.from, toTime: hr.to });
        hoursSync();
        stageNote.textContent = empty ? 'The name and the lines appear here as you type.' : orig && orig.off ? 'This donation is switched off, so it is not on the board. Switch it on in the list to show it.' : ds === 'on' ? 'This is on the board from the moment you publish' + (hr.to ? ', until ' + hourText(hr.to) + ' on its last day.' : '.') : ds === 'soon' ? 'It goes on the board by itself on its first day' + (hr.from ? ' at ' + hourText(hr.from) + '.' : '.') : 'These dates have passed, so it will not be on the board.';
        fTitle.placeholder = titleFor(w.kind, fFrom.value, fTo.value) || 'The words at the top of the panel';
        paintDates();
      }
      function paintKinds() {
        kindRow.textContent = '';
        kinds.concat([{ id: 'other', name: 'Other' }]).forEach(function (k) {
          kindRow.appendChild(el('button', { type: 'button', role: 'radio', class: 'dn-kindbtn' + (w.kind === k.id ? ' on' : ''), 'aria-checked': String(w.kind === k.id), 'data-kind': k.id, dir: 'auto', text: k.name || 'Kind', onclick: function () { setKind(k.id); } }));
        });
      }
      function ranges() {
        var k = kindById(w.kind), per = k ? k.period : '';
        if (per === 'month' || per === 'week' || per === 'day') return [periodRange(per, 0), periodRange(per, 1)];
        var t = periodRange('day', 0), wk = periodRange('week', 0), mo = periodRange('month', 0);
        return [t, wk, mo];
      }
      function paintQuick() {
        quick.textContent = '';
        ranges().forEach(function (r) {
          var on = fFrom.value === r.from && fTo.value === r.to;
          quick.appendChild(el('button', { type: 'button', class: 'dn-chip' + (on ? ' on' : ''), 'aria-pressed': String(on), 'data-from': r.from, 'data-to': r.to, onclick: function () { datesTouched = true; setDates(r.from, r.to); changed(); } },
            [el('bdi', { text: r.text }), r.sub ? el('span', { class: 'dn-chipsub', text: r.sub }) : null]));
        });
      }
      function setDates(a, b) { fFrom.value = a; fTo.value = b; errDates.textContent = ''; paintQuick(); refresh(); if (picking) cal.show(picking === 'to' ? b : a); }
      function setKind(kid) {
        var was = kindById(w.kind), now = kindById(kid);
        if (!fLead.value.trim() || (was && fLead.value.trim() === (was.lead || '').trim())) fLead.value = now ? (now.lead || '') : ''; /* the lead-in follows the kind unless it was written by hand */
        w.kind = kid;
        if (isNew && !datesTouched) { var r = periodRange(now ? now.period : 'day', 0); fFrom.value = r.from; fTo.value = r.to; } /* a new donation takes its kind's usual length */
        placeTitle(); paintKinds(); paintQuick(); refresh(); changed();
        var sel = kindRow.querySelector('.on'); if (sel) sel.focus();
      }
      fFrom.addEventListener('change', function () { datesTouched = true; if (fTo.value && fFrom.value && fTo.value < fFrom.value) fTo.value = fFrom.value; errDates.textContent = ''; paintQuick(); refresh(); });
      fTo.addEventListener('change', function () { datesTouched = true; errDates.textContent = ''; paintQuick(); refresh(); });
      [fName, fBody, fLead, fTitle, fLogo].forEach(function (f) { f.addEventListener('input', function () { errName.textContent = ''; refresh(); changed(); }); });
      fSize.addEventListener('change', function () { refresh(); changed(); });
      function save(publish) {
        var nameV = fName.value.trim(), bodyV = fBody.value.trim();
        errName.textContent = ''; errDates.textContent = '';
        if (!nameV && !bodyV) { errName.textContent = 'Enter the name of the donor.'; fName.focus(); return; }
        if (fFrom.value && fTo.value && fTo.value < fFrom.value) { errDates.textContent = 'The last day is before the first day. Pick a later last day.'; setPicking('to'); return; }
        var hrs = hours();
        if (!fAllDay.checked && (!fFromT.value || !fToT.value)) { errDates.textContent = 'Enter both times, or switch "All day" back on.'; (fFromT.value ? fToT : fFromT).focus(); return; }
        if (hrs.from && hrs.to && fFrom.value === fTo.value && parseHHMM(hrs.to) <= parseHHMM(hrs.from)) { errDates.textContent = 'The end time is not after the start time. Pick a later end time.'; fToT.focus(); return; }
        var rec = orig || { id: 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), no: ++donSeq };
        rec.kind = w.kind; rec.lead = fLead.value.trim(); rec.name = nameV; rec.body = bodyV; rec.logo = fLogo.value.trim(); rec.from = fFrom.value; rec.to = fTo.value; rec.fromTime = hrs.from; rec.toTime = hrs.to; rec.sizeOwn = fSize.value;
        rec.titleOwn = fTitle.value.trim() === titleFor(w.kind, fFrom.value, fTo.value) ? '' : fTitle.value.trim();
        if (isNew) dons.push(rec);
        ui.dn.flash = rec.id; clearTimeout(ui.dn.flashT); ui.dn.flashT = setTimeout(function () { ui.dn.flash = ''; }, 3000); /* the list shows where it landed, through the rebuild that follows a save */
        m.close(); setDirty(true); paintList();
        saveConfig(collect(), publish ? { publish: true } : null);
      }
      var titleField = field('Words at the top of the panel', fTitle, el('div', { class: 'dn-hint', text: 'Leave it empty to use the kind\'s own title.' }));
      var moreBox = el('details', { class: 'dn-more' }, [el('summary', { text: 'More options' }),
        el('div', { class: 'fields' }, [field('Line above the name', fLead, el('div', { class: 'dn-hint', text: 'For example נתנדב לעילוי נשמת. Leave it empty for none.' }))]),
        el('div', { class: 'fields' }, [field('Size on the screen', fSize), field('Picture beside the name', fLogo, el('div', { class: 'dn-hint', text: 'The name of a picture file kept beside the website, such as a business logo.' }))])]);
      /* an "Other" donation has no kind to take its title from, so the title box stands in the form itself; for the rest it is an extra */
      var titleSlotMain = el('div', { class: 'fields' }), titleSlotMore = el('div', { class: 'fields' });
      moreBox.insertBefore(titleSlotMore, moreBox.children[1]);
      function placeTitle() { var to = w.kind === 'other' ? titleSlotMain : titleSlotMore; if (titleField.parentNode !== to) to.appendChild(titleField); titleSlotMain.hidden = w.kind !== 'other'; }
      placeTitle();
      if (src && (src.titleOwn || src.sizeOwn || src.logo)) moreBox.open = true;
      var form = el('div', { class: 'dn-form' }, [
        el('div', { class: 'field' }, [el('span', { class: 'dn-label', text: 'Kind of donation' }), kindRow]),
        titleSlotMain,
        el('div', { class: 'fields' }, [field('Name', fName, el('div', null, [errName, el('div', { class: 'dn-hint', text: 'Titles such as מו״ה and הי״ו are set small by themselves, so the name stands out.' })]))]),
        el('div', { class: 'fields' }, [field('In honor of', fBody, el('div', { class: 'dn-hint', text: 'Each line you write is a line on the panel.' }))]),
        el('div', { class: 'field' }, [el('span', { class: 'dn-label', text: 'When it is on the board' }), quick]),
        el('div', { class: 'dn-datepair' }, [bFrom, bTo, fFrom, fTo]),
        calBox,
        el('div', { class: 'dn-allday' }, [el('label', { class: 'switch', for: fAllDay.id }, [fAllDay, el('span', { class: 'swl', text: 'All day' })]), allDayNote]),
        hoursRow, errDates, moreBox]);
      var body = el('div', { class: 'dn-body' }, [form, el('aside', { class: 'dn-preview' }, [el('div', { class: 'dn-label', text: 'How it looks on the board' }), stage, stageNote])]);
      var saveMain = el('button', { type: 'button', class: 'btn primary', id: 'dn-save', text: isConnected() ? 'Save and publish' : 'Save donation', onclick: function () { save(isConnected()); } });
      var saveOnly = isConnected() ? el('button', { type: 'button', class: 'btn', id: 'dn-save-only', text: 'Save only', onclick: function () { save(false); } }) : null;
      var cancel = el('button', { type: 'button', class: 'btn', id: 'dn-cancel', text: 'Cancel', onclick: function () { m.close(); } });
      var foot = el('div', { class: 'dn-foot' });
      function footNormal() {
        foot.textContent = '';
        if (orig) foot.appendChild(el('button', { type: 'button', class: 'btn danger', id: 'dn-remove', text: 'Remove', onclick: footConfirm }));
        foot.appendChild(el('span', { class: 'sp' })); foot.appendChild(cancel); if (saveOnly) foot.appendChild(saveOnly); foot.appendChild(saveMain);
      }
      function footConfirm() {
        foot.textContent = '';
        var keep = el('button', { type: 'button', class: 'btn', text: 'Keep it', onclick: footNormal });
        foot.appendChild(el('span', { class: 'dn-ask', text: 'Remove this donation for good?' })); foot.appendChild(el('span', { class: 'sp' })); foot.appendChild(keep);
        foot.appendChild(el('button', { type: 'button', class: 'btn danger solid', id: 'dn-remove-yes', text: 'Yes, remove', onclick: function () { m.close(); removeDonation(orig); } }));
        keep.focus();
      }
      footNormal();
      form.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' && ev.target.tagName === 'INPUT' && ev.target.type !== 'date') { ev.preventDefault(); saveMain.click(); } });
      m = dnModal(orig ? 'Edit donation ' + numText(orig.no) : 'Add a donation', body, foot);
      m.escape = function () { if (!picking) return false; var was = picking; setPicking(null); (was === 'to' ? bTo : bFrom).focus(); return true; };
      paintKinds(); paintQuick(); refresh();
      fName.focus();
    }
    function removeDonation(x) {
      var i = dons.indexOf(x); if (i < 0) return;
      dons.splice(i, 1); setDirty(true); paintList();
      saveConfig(collect());
    }

    /* the kinds: what a shul sells, and how each one's panel reads */
    function openKinds() {
      var rows = [], list = el('div', { class: 'dn-krows' }), kid = ++uid, m, err = errLine();
      function addRow(k, isNew) {
        var n = rows.length + 1, r = { id: k.id,
          name: inp('dk-name-' + kid + '-' + n, k.name || '', { placeholder: 'e.g. קידוש' }),
          title: inp('dk-title-' + kid + '-' + n, k.title || ''),
          size: el('select', { id: 'dk-size-' + kid + '-' + n }, [opt('big', 'Big'), opt('normal', 'Normal'), opt('small', 'Small'), opt('tiny', 'Smallest')]),
          lead: inp('dk-lead-' + kid + '-' + n, k.lead || ''),
          period: el('select', { id: 'dk-period-' + kid + '-' + n }, [opt('month', 'A month'), opt('week', 'A week'), opt('day', 'A day')]) };
        r.size.value = k.size || 'normal'; r.period.value = k.period || 'day';
        function move(dir) { var i = rows.indexOf(r), j = i + dir; if (j < 0 || j >= rows.length) return; rows.splice(i, 1); rows.splice(j, 0, r); repaint(); m.changed = true; r.up.focus(); }
        r.up = el('button', { type: 'button', class: 'btn small', text: '▲', title: 'Earlier on the board', 'aria-label': 'Move up', onclick: function () { move(-1); } });
        r.down = el('button', { type: 'button', class: 'btn small', text: '▼', title: 'Later on the board', 'aria-label': 'Move down', onclick: function () { move(1); } });
        r.wrap = el('div', { class: 'dn-krow' }, [
          el('div', { class: 'dn-khead' }, [el('strong', { class: 'dn-kname', dir: 'auto' }), el('span', { class: 'sp' }), r.up, r.down,
            el('button', { type: 'button', class: 'btn small danger', text: 'Remove', onclick: function () { rows.splice(rows.indexOf(r), 1); repaint(); m.changed = true; } })]),
          el('div', { class: 'fields' }, [field('Name of the kind', r.name), field('Words at the top of the panel', r.title, el('div', { class: 'dn-hint', text: 'Write {month} where the month\'s name belongs, {parsha} for the week\'s parsha.' }))]),
          el('div', { class: 'fields three' }, [field('Size on the screen', r.size), field('Usually runs for', r.period), field('Line above the name', r.lead)])]);
        r.name.addEventListener('input', function () { r.wrap.querySelector('.dn-kname').textContent = r.name.value.trim() || 'New kind'; err.textContent = ''; m.changed = true; });
        [r.title, r.lead, r.size, r.period].forEach(function (f) { f.addEventListener('input', function () { m.changed = true; }); f.addEventListener('change', function () { m.changed = true; }); });
        r.wrap.querySelector('.dn-kname').textContent = (k.name || '').trim() || 'New kind';
        rows.push(r);
        if (isNew) { repaint(); r.name.focus(); m.changed = true; }
      }
      function repaint() { list.textContent = ''; rows.forEach(function (r, i) { list.appendChild(r.wrap); r.up.disabled = i === 0; r.down.disabled = i === rows.length - 1; }); if (!rows.length) list.appendChild(el('div', { class: 'dn-note', text: 'No kinds. Add one below, or every donation is an "Other" with its own title.' })); }
      var body = el('div', { class: 'dn-body one' }, [el('div', { class: 'dn-form' }, [
        el('p', { class: 'dn-hint', text: 'Each kind decides how its panel reads, so adding a donation is only a name and a date. The order here is the order they stand in on the board.' }), list, err,
        el('div', null, [el('button', { type: 'button', class: 'btn', id: 'dk-add', text: '+ Add a kind', onclick: function () { addRow({ id: 'k' + Date.now().toString(36), name: '', title: '', size: 'normal', lead: '', period: 'day' }, true); } })])])]);
      var foot = el('div', { class: 'dn-foot' }, [el('span', { class: 'sp' }), el('button', { type: 'button', class: 'btn', text: 'Cancel', onclick: function () { m.close(); } }),
        el('button', { type: 'button', class: 'btn primary', id: 'dk-save', text: 'Save kinds', onclick: function () {
          var bad = rows.filter(function (r) { return !r.name.value.trim(); })[0];
          if (bad) { err.textContent = 'Give every kind a name, or remove the empty one.'; bad.name.focus(); return; }
          kinds = rows.map(function (r) { return { id: r.id, name: r.name.value.trim(), title: r.title.value.trim() || r.name.value.trim(), size: r.size.value, lead: r.lead.value.trim(), period: r.period.value }; });
          dons.forEach(function (x) { if (x.kind !== 'other' && !kindById(x.kind)) { x.titleOwn = x.titleOwn || x.titleWas || ''; x.sizeOwn = x.sizeOwn || x.sizeWas || ''; x.kind = 'other'; } });
          m.close(); setDirty(true); paintList(); saveConfig(collect());
        } })]);
      /* a donation whose kind is removed keeps the title it had */
      dons.forEach(function (x) { x.titleWas = effTitle(x); x.sizeWas = x.sizeOwn || kindSize(x.kind); });
      m = dnModal('Kinds of donation', body, foot);
      kinds.forEach(function (k) { addRow(k); }); repaint();
      var firstBox = list.querySelector('input'); if (firstBox) firstBox.focus();
    }

    /* the list */
    var dnGrid = el('div', { class: 'dn-grid', id: 'dn-list' }), dnFilters = el('div', { class: 'dn-filters', role: 'group', 'aria-label': 'Show' });
    var dnSearch = inp('dn-search', ui.dn.q, { type: 'search', placeholder: 'Search by name, text or kind', 'aria-label': 'Search donations', autocomplete: 'off', 'data-nodirty': '1' });
    var dnSort = el('select', { id: 'dn-sort', 'aria-label': 'Order', 'data-nodirty': '1' }, [opt('board', 'On the board first'), opt('new', 'Newest first'), opt('old', 'Oldest first')]);
    dnSort.value = ui.dn.sort;
    function donMatches(x, q) {
      if (!q) return true;
      var k = kindById(x.kind), hay = [x.name, x.body, x.lead, effTitle(x), k ? k.name : '', numText(x.no), String(x.no), hebDate(x.from), hebDate(x.to)].join(' ').toLowerCase();
      return q.toLowerCase().split(/\s+/).filter(Boolean).every(function (part) { return hay.indexOf(part) >= 0; });
    }
    function donSorted(list) {
      var rank = { on: 0, soon: 1, off: 2, done: 3 };
      return list.slice().sort(function (a, b) {
        if (ui.dn.sort === 'new') return (b.from || '').localeCompare(a.from || '') || b.no - a.no;
        if (ui.dn.sort === 'old') return (a.from || '').localeCompare(b.from || '') || a.no - b.no;
        var sa = donState(a), sb = donState(b);
        if (sa !== sb) return rank[sa] - rank[sb];
        if (sa === 'done') return (b.to || '').localeCompare(a.to || '') || b.no - a.no;
        if (sa === 'soon') return (a.from || '').localeCompare(b.from || '') || a.no - b.no;
        return boardOrder(a, b);
      });
    }
    function donCard(x) {
      var st = donState(x), k = kindById(x.kind), sub = donSub(x), acts = el('div', { class: 'dn-acts' });
      /* On or off: off keeps the donation here with everything it holds, and takes it off the board and the screen until it is
         switched on again. Like the form's own button it publishes straight away where the website is connected, since a switch
         that waited for a second press would look as if it had done nothing. */
      function flip(on) {
        x.off = !on;
        ui.dn.flash = x.id; clearTimeout(ui.dn.flashT); ui.dn.flashT = setTimeout(function () { ui.dn.flash = ''; }, 3000);
        setDirty(true); paintList();
        saveConfig(collect(), isConnected() ? { publish: true } : null);
      }
      function onOff() {
        var box = el('input', { type: 'checkbox', role: 'switch', 'data-act': 'onoff', 'data-nodirty': '1', 'aria-label': (x.off ? 'Switch on ' : 'Switch off ') + donName(x) });
        box.checked = !x.off;
        box.addEventListener('change', function () { flip(box.checked); });
        return el('label', { class: 'switch dn-switch', 'data-nodirty': '1', title: x.off ? 'Off: kept here, not on the board. Switch it on to show it again.' : 'On. Switch it off to take it off the board without removing it.' }, [box, el('span', { class: 'swl', text: x.off ? 'Off' : 'On' })]);
      }
      function actsNormal() {
        acts.textContent = '';
        acts.appendChild(onOff());
        acts.appendChild(el('button', { type: 'button', class: 'btn small', 'data-act': 'edit', 'data-nodirty': '1', onclick: function () { openDonation(x); } }, [svgIcon('edit'), el('span', { text: 'Edit' })]));
        acts.appendChild(el('button', { type: 'button', class: 'btn small', 'data-act': 'copy', 'data-nodirty': '1', title: 'Start a new donation with these details', onclick: function () { openDonation(null, x); } }, [svgIcon('copy'), el('span', { text: 'Copy' })]));
        acts.appendChild(el('span', { class: 'sp' }));
        acts.appendChild(el('button', { type: 'button', class: 'btn small danger', 'data-act': 'remove', 'data-nodirty': '1', 'aria-label': 'Remove ' + donName(x), onclick: actsConfirm }, [svgIcon('trash'), el('span', { text: 'Remove' })]));
      }
      function actsConfirm() {
        acts.textContent = '';
        var keep = el('button', { type: 'button', class: 'btn small', 'data-nodirty': '1', text: 'Keep it', onclick: actsNormal });
        acts.appendChild(el('span', { class: 'dn-ask', text: 'Remove for good?' })); acts.appendChild(el('span', { class: 'sp' })); acts.appendChild(keep);
        acts.appendChild(el('button', { type: 'button', class: 'btn small danger solid', 'data-act': 'remove-yes', 'data-nodirty': '1', text: 'Yes, remove', onclick: function () { removeDonation(x); } }));
        keep.focus();
      }
      actsNormal();
      return el('article', { class: 'dn-card ' + st + (ui.dn.flash === x.id ? ' flash' : ''), 'data-id': x.id, 'data-no': String(x.no) }, [
        el('div', { class: 'dn-top' }, [
          el('span', { class: 'dn-av k' + (kindIndex(x.kind) % 5), 'aria-hidden': 'true', text: initials(x) }),
          el('div', { class: 'dn-who' }, [el('div', { class: 'dn-name', dir: 'auto', title: donName(x), text: donName(x) }), sub ? el('div', { class: 'dn-sub', dir: 'auto', text: sub }) : null]),
          el('div', { class: 'dn-meta' }, [el('span', { class: 'dn-no num', text: numText(x.no) }), el('span', { class: 'dn-st ' + st, text: STATE_TEXT[st] })])]),
        el('div', { class: 'dn-chips' }, [el('span', { class: 'dn-kind', dir: 'auto', text: k ? k.name : (effTitle(x) || 'Other') })]),
        el('div', { class: 'dn-dates' }, [
          el('div', null, [el('span', { class: 'dn-lbl', text: 'Start' }), el('span', { class: 'dn-heb', dir: 'rtl', title: civilDate(x.from), text: hebDate(x.from) }), x.from && x.fromTime ? el('span', { class: 'dn-hour num', text: 'from ' + hourText(x.fromTime) }) : null, el('span', { class: 'dn-rel', text: whenText(x, 'from') })]),
          el('div', null, [el('span', { class: 'dn-lbl', text: 'End' }), el('span', { class: 'dn-heb', dir: 'rtl', title: civilDate(x.to), text: hebDate(x.to) }), x.to && x.toTime ? el('span', { class: 'dn-hour num', text: 'until ' + hourText(x.toTime) }) : null, el('span', { class: 'dn-rel', text: whenText(x, 'to') })])]),
        acts]);
    }
    function paintList() {
      var counts = { all: dons.length, on: 0, soon: 0, done: 0, off: 0 };
      dons.forEach(function (x) { counts[donState(x)]++; });
      if (ui.dn.filter === 'off' && !counts.off) ui.dn.filter = 'all'; /* the last one switched back on: its list is gone, so show them all */
      dnFilters.textContent = '';
      [['all', 'All'], ['on', 'On the board'], ['soon', 'Coming up'], ['done', 'Finished']].concat(counts.off ? [['off', 'Switched off']] : []).forEach(function (f) {
        var on = ui.dn.filter === f[0];
        dnFilters.appendChild(el('button', { type: 'button', class: 'dn-chip' + (on ? ' on' : ''), 'aria-pressed': String(on), 'data-filter': f[0], 'data-nodirty': '1', onclick: function () { ui.dn.filter = f[0]; paintList(); } }, [el('span', { text: f[1] }), el('span', { class: 'dn-count num', text: String(counts[f[0]]) })]));
      });
      var shown = donSorted(dons.filter(function (x) { return (ui.dn.filter === 'all' || donState(x) === ui.dn.filter) && donMatches(x, ui.dn.q.trim()); }));
      dnGrid.textContent = '';
      if (!dons.length) {
        dnGrid.appendChild(el('div', { class: 'dn-empty' }, [svgIcon('donations'), el('h3', { text: 'No donations yet' }), el('p', { text: 'Add the first one and it goes on the board for the days you choose.' }),
          el('button', { type: 'button', class: 'btn primary', 'data-nodirty': '1', text: '+ Add a donation', onclick: function () { openDonation(null); } })]));
      } else if (!shown.length) {
        dnGrid.appendChild(el('div', { class: 'dn-empty' }, [svgIcon('search'), el('h3', { text: 'Nothing matches' }), el('p', { text: ui.dn.q.trim() ? 'No donation has "' + ui.dn.q.trim() + '" in it.' : 'There is nothing under "' + STATE_TEXT[ui.dn.filter] + '" right now.' }),
          el('button', { type: 'button', class: 'btn', 'data-nodirty': '1', text: 'Show all donations', onclick: function () { ui.dn.q = ''; ui.dn.filter = 'all'; dnSearch.value = ''; paintList(); } })]));
      } else shown.forEach(function (x) { dnGrid.appendChild(donCard(x)); });
      if (ui.dn.flash) { var lit = dnGrid.querySelector('.flash'); if (lit && lit.scrollIntoView) { try { lit.scrollIntoView({ block: 'nearest' }); } catch (e) {} } }
    }
    dnSearch.addEventListener('input', function () { ui.dn.q = dnSearch.value; paintList(); });
    dnSort.addEventListener('change', function () { ui.dn.sort = dnSort.value; paintList(); });
    donPage.appendChild(el('div', { class: 'dn-tools' }, [
      el('div', { class: 'dn-search' }, [svgIcon('search'), dnSearch]), dnSort,
      el('button', { type: 'button', class: 'btn', id: 'dn-kinds', 'data-nodirty': '1', text: 'Kinds…', title: 'The kinds of donation, and how each one\'s panel reads', onclick: openKinds }),
      el('button', { type: 'button', class: 'btn primary', id: 'dn-add', 'data-nodirty': '1', text: '+ Add donation', onclick: function () { openDonation(null); } })]));
    donPage.appendChild(dnFilters); donPage.appendChild(dnGrid);
    paintList();
    pages.donations = donPage;
    /* extra schedules: named lists that take over for the days they cover */
    var rp = el('div', { class: 'col', id: 'page-rolls' }), rollRows = [], rollList = el('div', { class: 'col' }), rollUid = 0;
    var ROLL_TYPES = [['any', 'Any day']].concat(Cal.DAY_TYPES.map(function (t) { return [t[0], t[3]]; }));
    function rollState(r) {
      var today = MinyanEngine.isoDate(todayRd);
      if (!r.active.checked) return { k: 'done', t: 'Off' };
      if (r.from.value && today < r.from.value) return { k: 'soon', t: 'Not yet' };
      if (r.to.value && today > r.to.value) return { k: 'done', t: 'Over' };
      return { k: 'on', t: 'On' };
    }
    function addRoll(v) {
      v = v || {};
      var id = ++rollUid, r = {
        name: inp('r-name-' + id, v.name || '', { dir: 'auto', placeholder: 'e.g. זומער שחרית' }),
        type: el('select', { id: 'r-type-' + id }, ROLL_TYPES.map(function (t) { return el('option', { value: t[0], text: t[1] }); })),
        priority: inp('r-pri-' + id, v.priority == null ? 1 : v.priority, { type: 'number', min: '0', max: '99', inputmode: 'numeric' }),
        active: el('input', { type: 'checkbox', id: 'r-on-' + id }),
        from: inp('r-from-' + id, v.from || '', { type: 'date' }),
        to: inp('r-to-' + id, v.to || '', { type: 'date' }),
        dows: [], lines: {}
      };
      r.type.value = ROLL_TYPES.some(function (t) { return t[0] === v.type; }) ? v.type : 'any';
      r.active.checked = v.active !== false;
      d.tefillos.forEach(function (tf) { r.lines[tf.id] = { value: (v.lines && v.lines[tf.id]) || '' }; });
      var chip = el('span', { class: 'ochip' }), headT = el('span', { class: 'otitle' }), sub = el('span', { class: 'osub' });
      function head() {
        headT.textContent = r.name.value.trim() || 'Extra schedule';
        var st = rollState(r); chip.textContent = st.t; chip.className = 'ochip ' + st.k;
        var days = r.dows.filter(function (c) { return c.checked; }).map(function (c) { return Cal.DAY_SHORT[+c.value]; });
        sub.textContent = (ROLL_TYPES.filter(function (t) { return t[0] === r.type.value; })[0] || ['', ''])[1] + (days.length && days.length < 7 ? ' · ' + days.join(' ') : '') + ' · ' + (r.priority.value || 0);
      }
      [r.name, r.priority, r.from, r.to].forEach(function (x) { x.addEventListener('input', head); x.addEventListener('change', head); });
      r.type.addEventListener('change', head); r.active.addEventListener('change', head);
      var dowRow = el('div', { class: 'chips-row' });
      Cal.DAY_NAMES.forEach(function (nm, i) {
        var c = el('input', { type: 'checkbox', id: 'r-dow-' + id + '-' + i, value: String(i) });
        c.checked = !v.dows || !v.dows.length || v.dows.indexOf(i) >= 0;
        c.addEventListener('change', head);
        r.dows.push(c);
        dowRow.appendChild(el('label', { class: 'dowpick', for: c.id }, [c, el('span', { text: Cal.DAY_SHORT[i] })]));
      });
      var hFrom = hebPicker(r.from), hTo = hebPicker(r.to);
      var editors = el('div', { class: 'fields three' });
      d.tefillos.forEach(function (tf, i) {
        var store = r.lines[tf.id];
        var sources = Cal.DAY_TYPES.map(function (o) { return { key: o[0], label: o[3], store: function () { return lines[o[0]][tf.id]; } }; });
        var ed = minyanEditor(store, i, function () { return r.type.value === 'any' ? 'weekday' : r.type.value; }, sources);
        editors.appendChild(el('div', { class: 'field tefcard' }, [el('label', { class: 'tefname', text: tf.name }), el('div', { class: 'hint', text: 'Empty: this tefilla keeps the day\'s usual list.' }), ed]));
      });
      var c = card('Extra schedule', '', { fold: true, cls: 'rollcard' });
      var h3 = c.querySelector('.chead h3'); h3.textContent = ''; h3.appendChild(headT); h3.appendChild(chip); h3.appendChild(sub);
      c.body.appendChild(el('div', { class: 'fields' }, [field('Name', r.name), field('Which days it covers', r.type), field('Priority (higher wins)', stepper(r.priority, 1))]));
      c.body.appendChild(el('div', { class: 'field' }, [el('label', { text: 'Only on these days of the week' }), dowRow]));
      c.body.appendChild(el('div', { class: 'fields' }, [
        field('From (blank = always)', r.from, el('div', { class: 'hebrow' }, [hFrom.wrap, hFrom.shown])),
        field('Until (blank = no end)', r.to, el('div', { class: 'hebrow' }, [hTo.wrap, hTo.shown]))]));
      c.body.appendChild(el('div', { class: 'checks' }, [el('label', { for: r.active.id }, [r.active, ' On'])]));
      c.body.appendChild(editors);
      c.body.appendChild(el('div', { class: 'bar actions' }, [el('button', { type: 'button', class: 'btn small danger', text: 'Remove this schedule', onclick: function () { rollRows.splice(rollRows.indexOf(r), 1); c.remove(); } })]));
      r.wrap = c; rollRows.push(r); rollList.appendChild(c); head();
    }
    (d.rolls || []).forEach(addRoll);
    var cRolls = card('Extra schedules', 'Each one is a named list with its own minyanim. It takes over for the days it covers, and the one with the highest priority wins. A special date still beats them all, and a tefilla left empty keeps the day\'s usual list.');
    cRolls.body.appendChild(rollList);
    cRolls.body.appendChild(el('div', null, [el('button', { type: 'button', class: 'btn', id: 'add-roll', text: '+ Extra schedule', onclick: function () { addRoll({ type: 'weekday', priority: 1, active: true }); } })]));
    rp.appendChild(cRolls);
    pages.rolls = rp;

    pages.notices = np;

    /* shere: the barber's hours, answered in Yiddish to anyone who texts שערן (src/shere.js). Laid out like the This week tab:
       day buttons along the top, one day open at a time, its sets of hours as rows with "+ Add hours" and Remove. */
    var shp = el('div', { class: 'col', id: 'page-shere' }), sh = MinyanShere.settings(d), EN_DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Shabbos'];
    var shToday = Cal.nowInTz(Date.now(), loc().tz).rd, shWeekState = clone(sh.week), shDaysState = {}, shPrices = Object.assign({ adult: '', kid: '', ytAdult: '', ytKid: '', ytDays: 0 }, sh.prices || {});
    Object.keys(sh.days || {}).forEach(function (k) { if (k >= MinyanShere.iso(shToday)) shDaysState[k] = clone(sh.days[k]); }); /* past changes are dropped */
    function hhmm(min) { return min == null || !isFinite(min) ? '' : pad2(Math.floor(min / 60)) + ':' + pad2(Math.round(min) % 60); }
    function shOut(extra) { return Object.assign({}, d, { shere: Object.assign(collectShere(), extra || {}) }); }

    /* Texts */
    var cShText = card('Texts', 'Anyone who texts one of these words to the shul\'s number gets this week\'s shere hours and price, in Yiddish. Every other text is answered as before.');
    var fShOn = chk('sh-on', sh.on, 'Answer these texts with the shere hours');
    var fShWords = inp('sh-words', sh.words), fShNote = inp('sh-note', sh.note, { placeholder: 'optional: a line at the end of every answer' });
    var shPreview = el('pre', { class: 'shere-preview', dir: 'rtl', lang: 'yi' });
    cShText.body.appendChild(el('div', { class: 'checks' }, [fShOn]));
    cShText.body.appendChild(el('div', { class: 'fields' }, [field('Words that get the answer (separate with commas)', fShWords), field('Extra line', fShNote)]));
    cShText.body.appendChild(el('div', { class: 'field' }, [el('label', { text: 'Someone who texts now gets:' }), shPreview]));

    /* a time: a clock time, or a zman with minutes before (−) or after (+) it; "Automatic" = the Erev Shabbos rule */
    var SH_ZMAN_EN = { alos: 'Alos', sunrise: 'Sunrise (netz)', shema: 'Sof zman Shema', tefilla: 'Sof zman tefilla', chatzos: 'Chatzos', minchag: 'Mincha gedola', minchak: 'Mincha ketana', plag: 'Plag hamincha', candles: 'Candle lighting', sunset: 'Shkiah (sunset)', tzeis: 'Tzeis', tzeis72: 'Rabbeinu Tam (72)' };
    var shUid = 0;
    function shTime(label, value, auto, onChange, rdFn, up) {
      var id = 'sh-t-' + (++shUid), kind = el('select', { id: id, 'aria-label': label + ': clock time or zman' }), t = el('input', { type: 'time', 'aria-label': label + ' time' }),
        off = el('input', { type: 'number', step: '5', inputmode: 'numeric', placeholder: '0', 'aria-label': label + ': minutes before (−) or after (+) the zman' }),
        offWrap = el('span', { class: 'shoff' }, [off, el('span', { text: 'min' })]), hint = el('div', { class: 'hint shres' });
      if (auto) kind.appendChild(el('option', { value: 'auto', text: 'Automatic (before Shabbos)' }));
      kind.appendChild(el('option', { value: 'clock', text: 'Clock time' }));
      MinyanShere.ZMANIM.forEach(function (k) { kind.appendChild(el('option', { value: k, text: SH_ZMAN_EN[k] || k })); });
      function get() { if (kind.value === 'auto') return ''; if (kind.value === 'clock') return t.value; var o = Math.round(+off.value) || 0; return kind.value + (o ? (o > 0 ? '+' : '') + o : ''); }
      function paint() {
        t.hidden = kind.value !== 'clock'; offWrap.hidden = kind.value === 'clock' || kind.value === 'auto';
        var v = get(), p = MinyanShere.parse(v), rd = rdFn(), x;
        if (!v) { x = MinyanShere.day(shOut(), rd, false); hint.textContent = x && x.auto != null ? '= ' + engine.fmtTime(x.auto) + ' on ' + engine.fmtDate(rd) : ''; }
        else if (p && p.zman) { var m = MinyanShere.resolve(shOut(), rd, v, up); hint.textContent = m == null ? '' : '= ' + engine.fmtTime(m) + ' on ' + engine.fmtDate(rd); }
        else hint.textContent = '';
      }
      var p0 = MinyanShere.parse(value);
      if (!p0) { kind.value = auto ? 'auto' : 'clock'; t.value = auto ? '' : '10:00'; } else if (p0.min != null) { kind.value = 'clock'; t.value = hhmm(p0.min); } else { kind.value = p0.zman; off.value = p0.off ? String(p0.off) : ''; }
      kind.addEventListener('change', function () { if (kind.value === 'clock' && !t.value) t.value = '10:00'; onChange(get()); paint(); });
      t.addEventListener('change', function () { onChange(get()); paint(); });
      off.addEventListener('input', function () { onChange(get()); paint(); });
      paint();
      return el('div', { class: 'field shtime' }, [el('label', { for: id, text: label }), el('div', { class: 'shtime-row' }, [kind, t, offWrap]), hint]);
    }
    /* the sets of hours of one day, as rows; "+ Add hours" for a second set (Friday morning and afternoon) */
    function rangesEditor(list, opts, changed) {
      var box = el('div', { class: 'col shranges' });
      function paint() {
        box.textContent = '';
        list.forEach(function (r, i) {
          var kids = el('input', { type: 'checkbox', id: 'sh-k-' + (++shUid) }); kids.checked = !!r.kids;
          kids.addEventListener('change', function () { r.kids = kids.checked; changed(); });
          box.appendChild(el('div', { class: 'shrange' }, [
            el('div', { class: 'shnum', text: list.length > 1 ? (i === 0 ? 'Morning' : i === 1 ? 'Afternoon' : 'Hours ' + (i + 1)) : 'Hours' }),
            shTime('From', r.from, false, function (v) { r.from = v || '10:00'; changed(); }, opts.rd, true),
            shTime('Until', r.until, opts.auto, function (v) { r.until = v; changed(); }, opts.rd, false),
            el('label', { for: kids.id, class: 'shchk' }, [kids, ' Kids too']),
            list.length > 1 ? el('button', { type: 'button', class: 'btn small danger', text: 'Remove', onclick: function () { list.splice(i, 1); paint(); changed(); } }) : el('span')]));
        });
        if (!list.length) box.appendChild(el('div', { class: 'hint', text: 'No hours yet.' }));
        box.appendChild(el('div', null, [el('button', { type: 'button', class: 'btn small', text: '+ Add hours', onclick: function () {
          var last = list[list.length - 1], lp = last && MinyanShere.parse(last.until);
          list.push({ from: lp && lp.min != null ? last.until : '13:00', until: opts.auto ? '' : '18:00', kids: last ? last.kids : true });
          if (last && opts.auto && !last.until) last.until = '12:00'; /* the automatic end moves to the new last set */
          paint(); changed();
        } })]));
      }
      paint();
      return box;
    }

    /* Regular hours: Sunday to Friday, one at a time */
    var cShWeek = card('Regular hours', 'Every week, unless a date is changed in the calendar. A day can have more than one set of hours, like Friday morning and afternoon: "+ Add hours". Each time is a clock time or a zman with minutes before (−30) or after (+30) it.');
    var shWeekDay = ui.shWeekDay == null ? 5 : ui.shWeekDay, shWeekChips = el('div', { class: 'daychips', role: 'tablist' }), shWeekBody = el('div', { class: 'col' });
    function nextOf(dow) { return shToday + Cal.mod(dow - Cal.mod(shToday, 7), 7); }
    function paintWeek() {
      shWeekChips.textContent = '';
      EN_DOW.slice(0, 6).forEach(function (n, i) {
        var w = shWeekState[i];
        shWeekChips.appendChild(el('button', { type: 'button', role: 'tab', class: 'daychip' + (i === shWeekDay ? ' on' : ''), 'aria-selected': String(i === shWeekDay), 'data-nodirty': '1', onclick: function () { shWeekDay = ui.shWeekDay = i; paintWeek(); } }, [
          el('span', { class: 'dc-day', text: n }), el('span', { class: 'dc-date', text: !w.open ? 'Closed' : w.ranges.length > 1 ? w.ranges.length + ' sets of hours' : 'Open' })]));
      });
      shWeekBody.textContent = '';
      var w = shWeekState[shWeekDay], open = el('input', { type: 'checkbox', id: 'sh-wopen' }); open.checked = !!w.open;
      open.addEventListener('change', function () { w.open = open.checked; if (w.open && !w.ranges.length) w.ranges.push({ from: '10:00', until: shWeekDay === 5 ? '' : '20:00', kids: true }); paintWeek(); paintShere(); });
      shWeekBody.appendChild(el('div', { class: 'checks' }, [el('label', { for: open.id }, [open, ' Open on ' + EN_DOW[shWeekDay]])]));
      if (w.open) shWeekBody.appendChild(rangesEditor(w.ranges, { auto: shWeekDay === 5, rd: function () { return nextOf(shWeekDay); } }, function () { paintShere(); paintChipsOnly(); }));
    }
    function paintChipsOnly() { Array.prototype.forEach.call(shWeekChips.children, function (b, i) { var w = shWeekState[i]; b.lastChild.textContent = !w.open ? 'Closed' : w.ranges.length > 1 ? w.ranges.length + ' sets of hours' : 'Open'; }); }
    cShWeek.body.appendChild(shWeekChips); cShWeek.body.appendChild(shWeekBody);

    /* Calendar: any date can have its own hours, price, a note, or be closed */
    var cShCal = card('Calendar: special dates', 'Pick a date to give it its own hours, price or note, or to close it. Shabbos and Yom Tov are closed by themselves; Erev Yom Tov is marked. A gold dot is a date you changed.');
    var shCalBox = el('div', { class: 'col' }), shSel = ui.shSel && ui.shSel >= shToday ? ui.shSel : shToday;
    function firstOfMonth(rd) { var g = Cal.gregFromRD(rd); return Cal.rdFromGreg(g.y, g.m, 1); }
    var shMonthRd = ui.shMonth && ui.shMonth >= firstOfMonth(shToday) ? ui.shMonth : firstOfMonth(shSel);
    function paintCal() {
      shCalBox.textContent = '';
      var g = Cal.gregFromRD(shMonthRd), monthName = new Date(Date.UTC(g.y, g.m - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
      var h0 = Cal.hebFromRD(shMonthRd), h1 = Cal.hebFromRD(shMonthRd + 27), hebName = Cal.monthName(h0.y, h0.m) + (h1.m !== h0.m ? ' – ' + Cal.monthName(h1.y, h1.m) : '') + ' ' + Cal.gematria(h1.y % 1000);
      shCalBox.appendChild(el('div', { class: 'shcal-head' }, [
        el('button', { type: 'button', class: 'btn small', 'data-nodirty': '1', text: '‹', 'aria-label': 'Previous month', disabled: shMonthRd > firstOfMonth(shToday) ? null : 'disabled', onclick: function () { shMonthRd = ui.shMonth = firstOfMonth(shMonthRd - 1); paintCal(); } }),
        el('div', { class: 'shcal-title' }, [el('b', { text: monthName }), el('span', { dir: 'rtl', text: hebName })]),
        el('button', { type: 'button', class: 'btn small', 'data-nodirty': '1', text: '›', 'aria-label': 'Next month', onclick: function () { shMonthRd = ui.shMonth = firstOfMonth(shMonthRd + 31); paintCal(); } })]));
      var grid = el('div', { class: 'shcal' });
      ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Shab'].forEach(function (n) { grid.appendChild(el('div', { class: 'shcal-dow', text: n })); });
      for (var k = 0; k < Cal.mod(shMonthRd, 7); k++) grid.appendChild(el('div'));
      for (var rd = shMonthRd; Cal.gregFromRD(rd).m === g.m; rd++) (function (rd) {
        var info = Cal.dayInfo(rd, !!d.israel), holy = info.shabbos || info.yomtov, past = rd < shToday, iso = MinyanShere.iso(rd), h = Cal.hebFromRD(rd);
        var tag = info.yomtov ? info.labels[0] : info.candles === 'day' && Cal.mod(rd, 7) !== 5 ? 'ערב יו״ט' : MinyanShere.price(shOut(), rd).yt ? '$ יו״ט' : '';
        grid.appendChild(el('button', { type: 'button', class: 'shcal-day' + (holy ? ' holy' : '') + (past ? ' past' : '') + (rd === shSel ? ' on' : '') + (shDaysState[iso] ? ' has' : '') + (rd === shToday ? ' today' : ''),
          'data-nodirty': '1', disabled: holy || past ? 'disabled' : null, 'aria-label': engine.fmtDate(rd) + (tag ? ' ' + tag : ''), 'aria-pressed': String(rd === shSel), onclick: function () { shSel = ui.shSel = rd; paintCal(); } }, [
          el('span', { class: 'n', text: String(Cal.gregFromRD(rd).d) }), el('span', { class: 'h', text: Cal.gematria(h.d) }), tag ? el('span', { class: 't', text: tag }) : null]));
      })(rd);
      shCalBox.appendChild(grid);
      shCalBox.appendChild(dayEditor(shSel));
    }
    function dayEditor(rd) {
      var iso = MinyanShere.iso(rd), base = MinyanShere.day(shOut({ days: {} }), rd, false);
      if (!base) return el('div', { class: 'hint', text: 'Shabbos and Yom Tov are closed by themselves.' });
      var bp = MinyanShere.price(shOut({ days: {} }), rd);
      var st = shDaysState[iso] ? clone(shDaysState[iso]) : { closed: !base.open, ranges: clone(base.specs), note: '', price: {} };
      st.ranges = MinyanShere.rangesOf(st, base.specs); st.price = st.price || {};
      var wrap = el('div', { class: 'shday' + (shDaysState[iso] ? ' changed' : '') });
      var back = el('button', { type: 'button', class: 'btn small', text: 'Back to regular', onclick: function () { delete shDaysState[iso]; paintCal(); paintShere(); } });
      back.hidden = !shDaysState[iso];
      function save() { shDaysState[iso] = { closed: st.closed, ranges: clone(st.ranges), note: st.note, price: clone(st.price) }; wrap.classList.add('changed'); back.hidden = false; var cell = $('.shcal-day.on', shCalBox); if (cell) cell.classList.add('has'); paintShere(); }
      var closed = el('input', { type: 'checkbox', id: 'sh-dclosed' }); closed.checked = !!st.closed;
      var hoursBox = rangesEditor(st.ranges, { auto: base.erev, rd: function () { return rd; } }, save); hoursBox.hidden = !!st.closed;
      closed.addEventListener('change', function () { st.closed = closed.checked; hoursBox.hidden = st.closed; save(); });
      var note = inp('sh-dnote', st.note, { placeholder: 'optional' }); note.addEventListener('input', function () { st.note = note.value.trim(); save(); });
      var pa = inp('sh-dprice', st.price.adult || '', { inputmode: 'decimal', placeholder: bp.adult || 'none' }), pk = inp('sh-dpricek', st.price.kid || '', { inputmode: 'decimal', placeholder: bp.kid || 'none' });
      pa.addEventListener('input', function () { st.price.adult = pa.value.trim(); save(); }); pk.addEventListener('input', function () { st.price.kid = pk.value.trim(); save(); });
      wrap.appendChild(el('div', { class: 'shday-head' }, [el('div', null, [el('div', { class: 'd', text: EN_DOW[base.dow] + ' · ' + engine.fmtDate(rd) }), el('div', { class: 'cdesc', dir: 'rtl', text: base.label + ' · ' + base.heb })]), back]));
      wrap.appendChild(el('div', { class: 'checks' }, [el('label', { for: closed.id }, [closed, ' Closed this day'])]));
      wrap.appendChild(hoursBox);
      wrap.appendChild(el('div', { class: 'fields' }, [field('Note for this day', note), field('Price this day' + (bp.yt ? ' (before Yom Tov)' : ''), pa), field('Kids this day', pk)]));
      return wrap;
    }
    cShCal.body.appendChild(shCalBox);

    /* Prices */
    var cShPrice = card('Prices', 'Said with the hours. Before Yom Tov the price can go up: from the number of days you set, through Erev Yom Tov. A date in the calendar can have its own price. Leave a box empty to say nothing.', F);
    function moneyInp(key, ph) { var i = inp('sh-p-' + key, shPrices[key], { inputmode: 'decimal', placeholder: ph }); i.addEventListener('input', function () { shPrices[key] = i.value.trim(); }); return i; }
    var fYtDays = inp('sh-p-ytdays', shPrices.ytDays || 0, { type: 'number', min: '0', max: '30', inputmode: 'numeric' });
    fYtDays.addEventListener('input', function () { shPrices.ytDays = Math.max(0, Math.min(30, Math.round(+fYtDays.value) || 0)); paintCal(); });
    cShPrice.body.appendChild(el('div', { class: 'fields' }, [field('Regular price', moneyInp('adult', '$15')), field('Kids', moneyInp('kid', '$10'))]));
    cShPrice.body.appendChild(el('div', { class: 'fields' }, [field('Before Yom Tov', moneyInp('ytAdult', '$20')), field('Kids before Yom Tov', moneyInp('ytKid', '$15')),
      field('Days before Yom Tov the higher price starts (0 = Erev Yom Tov only)', stepper(fYtDays, 1))]));

    /* Erev Shabbos and Erev Yom Tov */
    var cShZman = card('Erev Shabbos and Erev Yom Tov', '"Automatic" closes this many minutes before the zman, every Friday and Erev Yom Tov. Times by a zman are rounded to the minutes below (a start up, an end down).', F);
    var fShZman = el('select', { id: 'sh-zman' }, [el('option', { value: 'candles', text: 'Candle lighting' }), el('option', { value: 'sunset', text: 'Sunset (shkiah)' })]); fShZman.value = sh.zman === 'sunset' ? 'sunset' : 'candles';
    var fShBefore = inp('sh-before', sh.before, { type: 'number', min: '0', max: '600', inputmode: 'numeric' }), fShRound = inp('sh-round', sh.round, { type: 'number', min: '1', max: '30', inputmode: 'numeric' });
    cShZman.body.appendChild(el('div', { class: 'fields' }, [field('Minutes before', stepper(fShBefore, 5)), field('Counted from', fShZman), field('Round to (minutes)', fShRound)]));

    function collectShere() {
      var days = {};
      Object.keys(shDaysState).forEach(function (k) { if (k >= MinyanShere.iso(shToday)) days[k] = shDaysState[k]; });
      return { on: $('#sh-on', shp).checked, words: fShWords.value.trim(), note: fShNote.value.trim(), zman: fShZman.value,
        before: Math.max(0, Math.min(600, Math.round(+fShBefore.value) || 0)), round: Math.max(1, Math.min(30, Math.round(+fShRound.value) || 1)),
        prices: clone(shPrices), week: clone(shWeekState), days: days };
    }
    function paintShere() {
      try { shPreview.textContent = MinyanShere.text(shOut(), Date.now()); } catch (e) { shPreview.textContent = '—'; }
    }
    shp.addEventListener('input', paintShere); shp.addEventListener('change', paintShere);
    [cShText, cShWeek, cShCal, cShPrice, cShZman].forEach(function (c) { shp.appendChild(c); });
    paintWeek(); paintCal(); paintShere();
    pages.shere = shp;

    /* the hallway screen: its colours, and which minyanim it shows */
    var sp = el('div', { class: 'col', id: 'page-screen' }), wall = clone(d.wallLook || {}), win = clone(d.wallWindow || {});
    var cWallLook = card('Colours', 'Each kind of tile on the hallway screen. Leave one empty and it keeps the colour of the look chosen in General.'),
      cWallShow = card('Which minyanim it shows', 'The whole day, only what is near, or the next few and the last few.');
    var KINDS = [['tile', 'Minyanim still to come', 'Ink'], ['next', 'The next minyan', 'Ink'], ['now', 'The one before it', 'Ink'],
      ['past', 'The earlier ones', 'Ink'], ['bar', 'The top line, when it is shown', 'Ink']];
    var SWATCHES = [];
    KINDS.forEach(function (k) { SWATCHES.push([k[0] + 'Bg']); SWATCHES.push([k[0] + k[2]]); });
    /* The page behind everything and the boxes on it. A lit screen never looks the colour it was given: how light it comes out
       depends on the TV and on the lamps around it, so these two are tuned standing in front of it, a step darker or lighter at a
       time. LOOK_WALL is what each look gives them (the same values as in the stylesheet), the place a first step starts from. */
    var LOOK_WALL = { hallway: { pageBg: '#baaf9b', frameBg: '#ddd5c4', frameLine: '#a59880' }, shul: { pageBg: '#e8e3da', frameBg: '#f7f4ee', frameLine: '#d3c7b3' },
      classic: { pageBg: '#ece2cf', frameBg: '#fbf7ef', frameLine: '#d8cab2' }, contrast: { pageBg: '#ffffff', frameBg: '#ffffff', frameLine: '#000000' } };
    function lookWall(key) { return (LOOK_WALL[fPalette.value] || LOOK_WALL.shul)[key]; }
    function shade(hex, steps) { /* so many steps darker (below zero) or lighter than hex: every channel by the same factor, so the hue stays and only the depth moves */
      var n = parseInt(hex.slice(1), 16), f = Math.pow(0.94, -steps), out = '#';
      [n >> 16 & 255, n >> 8 & 255, n & 255].forEach(function (c) { var v = Math.max(0, Math.min(255, Math.round((steps > 0 ? Math.max(c, 8) : c) * f))); out += (v < 16 ? '0' : '') + v.toString(16); });
      return out;
    }
    var cWallBase = card('Background and boxes', 'The colour behind everything on the hallway screen, and the colour of the boxes on it. A lit screen shows a colour lighter than a wall does, so set these standing in front of the TV: press Darker or Lighter, then Save and Publish, and the screen follows within a minute or two.');
    var baseRows = el('div', { class: 'shades' }), BASE = [['pageBg', 'The background', true], ['frameBg', 'The boxes', true], ['frameLine', 'The line around the boxes', false]];
    BASE.forEach(function (b) {
      var key = b[0], col = el('input', { type: 'color', id: 'w-' + key, value: wall[key] || lookWall(key), 'aria-label': b[1] + ': choose any colour' }),
        on = el('input', { type: 'checkbox', id: 'w-on-' + key, 'aria-label': 'Use a colour of your own for ' + b[1].toLowerCase() }),
        chip = el('span', { class: 'shade-chip', 'aria-hidden': 'true' }), state = el('span', { class: 'shade-state' });
      on.checked = !!wall[key];
      /* the steps are counted from the colour they started at, so three presses of Darker and three of Lighter come back to it exactly */
      var from = col.value, steps = 0;
      function sync() { /* the colour box stays open to a click even while the look's own colour is in use: choosing one is what switches it on */
        col.classList.toggle('off', !on.checked); wall[key] = on.checked ? col.value : '';
        if (!on.checked) { col.value = lookWall(key); from = col.value; steps = 0; }
        chip.style.background = col.value; state.textContent = on.checked ? 'Your own colour' : 'The look\'s own colour';
      }
      function step(lighter) {
        var next = shade(from, steps + (lighter ? 1 : -1));
        if (next !== col.value) { steps += lighter ? 1 : -1; col.value = next; } /* at white or black there is no further step to count */
        on.checked = true; sync(); markDirty();
      }
      on.addEventListener('change', sync); col.addEventListener('input', function () { on.checked = true; from = col.value; steps = 0; sync(); });
      var row = el('div', { class: 'shade' }, [el('div', { class: 'shade-name' }, [chip, el('div', null, [el('div', { class: 'swname', text: b[1] }), state])]),
        el('div', { class: 'shade-acts' }, [
          b[2] ? el('button', { type: 'button', class: 'btn small', id: 'w-' + key + '-lighter', text: 'Lighter', 'data-nodirty': '1', onclick: function () { step(true); } }) : null,
          b[2] ? el('button', { type: 'button', class: 'btn small', id: 'w-' + key + '-darker', text: 'Darker', 'data-nodirty': '1', onclick: function () { step(false); } }) : null,
          el('span', { class: 'swpick' }, [on, col])])]);
      row._sync = sync;
      baseRows.appendChild(row);
      SWATCHES.push([key]);
      sync();
    });
    fPalette.addEventListener('change', function () { Array.prototype.forEach.call(baseRows.children, function (r) { r._sync(); }); }); /* another look: the rows left on "the look's own" show that look's colours */
    cWallBase.body.appendChild(baseRows);
    cWallBase.body.appendChild(el('div', { class: 'bar actions' }, [el('button', { type: 'button', class: 'btn small', id: 'w-base-reset', text: 'Back to the look\'s own colours', 'data-nodirty': '1', onclick: function () {
      BASE.forEach(function (b) { $('#w-on-' + b[0]).checked = false; }); Array.prototype.forEach.call(baseRows.children, function (r) { r._sync(); }); markDirty(); } })]));
    /* the line across the top: the day, the date, the time. Off unless asked for. */
    var cWallTop = card('The top line', 'A line across the top of the hallway screen with the day, the date and the time. Without it the minyanim and the clock get its room; the time stays on the clock face.');
    var fTopBar = el('input', { type: 'checkbox', id: 'w-topbar' }); fTopBar.checked = !!d.wallTopBar;
    cWallTop.body.appendChild(el('div', { class: 'checks' }, [el('label', { for: 'w-topbar' }, [fTopBar, ' Show the top line'])]));
    var swatchRows = el('div', { class: 'swatches' });
    swatchRows.appendChild(el('div', { class: 'swhead' }, [el('span'), el('span', { text: 'Colour' }), el('span', { text: 'Writing' })]));
    KINDS.forEach(function (kind) {
      var row = el('div', { class: 'swatch' }, [el('span', { class: 'swname', text: kind[1] })]);
      [kind[0] + 'Bg', kind[0] + kind[2]].forEach(function (key) {
        var col = el('input', { type: 'color', id: 'w-' + key, value: wall[key] || '#808080' }), on = el('input', { type: 'checkbox', id: 'w-on-' + key, 'aria-label': 'Use this colour' });
        on.checked = !!wall[key];
        function sync() { col.disabled = !on.checked; wall[key] = on.checked ? col.value : ''; }
        on.addEventListener('change', sync); col.addEventListener('input', function () { on.checked = true; sync(); });
        sync();
        row.appendChild(el('span', { class: 'swpick' }, [on, col]));
      });
      swatchRows.appendChild(row);
    });
    cWallLook.body.appendChild(swatchRows);
    cWallLook.body.appendChild(el('div', { class: 'bar actions' }, [el('button', { type: 'button', class: 'btn small', text: 'Back to the look\'s own colours', 'data-nodirty': '1', onclick: function () { SWATCHES.forEach(function (sw) { if (/^(pageBg|frameBg|frameLine)$/.test(sw[0])) return; wall[sw[0]] = ''; $('#w-on-' + sw[0]).checked = false; $('#w-' + sw[0]).disabled = true; }); markDirty(); } })]));
    var fWinMode = el('select', { id: 'w-mode' }, [el('option', { value: 'day', text: 'The whole day' }), el('option', { value: 'window', text: 'Only what is near (by minutes)' }),
      el('option', { value: 'count', text: 'The next few and the last few' })]); /* short enough to read whole in the closed box on a phone */
    fWinMode.value = win.mode === 'window' ? 'window' : win.mode === 'count' ? 'count' : 'day';
    var fWinNext = inp('w-next', win.next == null ? 6 : win.next, { type: 'number', min: '1', max: '60', inputmode: 'numeric' });
    var fWinRecent = inp('w-recent', win.recent == null ? 2 : win.recent, { type: 'number', min: '0', max: '20', inputmode: 'numeric' });
    var fWinBefore = inp('w-before', win.before == null ? 180 : win.before, { type: 'number', min: '10', max: '1440', inputmode: 'numeric' });
    var fWinAfter = inp('w-after', win.after == null ? 20 : win.after, { type: 'number', min: '0', max: '240', inputmode: 'numeric' });
    var fWinKeep = el('input', { type: 'checkbox', id: 'w-keep' }); fWinKeep.checked = win.neverEmpty !== false;
    var winRow = el('div', { class: 'fields' }, [field('Minutes ahead to show', stepper(fWinBefore, 30)), field('Minutes to keep one after it starts', stepper(fWinAfter, 5))]);
    var cntRow = el('div', { class: 'fields' }, [field('Minyanim still to come, of each tefilla', stepper(fWinNext, 1)), field('Minyanim that have started, to keep', stepper(fWinRecent, 1))]);
    var keepRow = el('div', { class: 'checks' }, [el('label', { for: 'w-keep' }, [fWinKeep, ' Never leave the screen empty: when nothing is near, show the next ones anyway'])]);
    /* the settings as they stand in the form, saved or not: the screen is asked what it would list under these */
    function winNow() {
      return { mode: fWinMode.value, before: Math.max(10, Math.min(1440, +fWinBefore.value || 180)), after: Math.max(0, Math.min(240, +fWinAfter.value || 0)), neverEmpty: fWinKeep.checked,
        next: Math.max(1, Math.min(60, Math.round(+fWinNext.value) || 6)), recent: Math.max(0, Math.min(20, Math.round(+fWinRecent.value) || 0)) };
    }
    /* "On the screen now": what the hallway screen lists at this minute under the settings above, tefilla by tefilla, and how many it leaves out */
    var onScreen = el('div', { class: 'onscreen', id: 'w-onscreen', 'data-nodirty': '1', 'aria-live': 'polite' });
    function paintOnScreen() {
      var nowMs = Date.now(), w = winNow(), keepFlag = ui.todayAllSwitched, lists = tefillaLists(scheduleFor(todayRd), nowMs, true), up = upcoming(nowMs, todayRd), total = 0, left = 0;
      ui.todayAllSwitched = keepFlag; /* asking is not the board's own drawing: its note of the day is left as it was */
      var rows = el('div', { class: 'os-rows' });
      lists.forEach(function (x) {
        if (x.t.kind === 'event' || !x.list.length) return;
        var shown = wallWindowList(x.list, nowMs, up, w), hid = x.list.length - shown.length, chips = el('div', { class: 'os-chips' }), MOST = 10;
        total += shown.length; left += hid;
        shown.slice(0, MOST).forEach(function (e) {
          var st = up && sameEntry(e, up.entry) ? ' next' : e.ms <= nowMs ? ' gone' : '';
          chips.appendChild(el('span', { class: 'os-chip' + st }, [el('b', { class: 'num', text: fmtTime(bigIsMilestone(x.t) ? e.milestone : e.start) }), el('bdi', { text: e.room || x.t.name })]));
        });
        if (shown.length > MOST) chips.appendChild(el('span', { class: 'os-more', text: 'and ' + (shown.length - MOST) + ' more' })); /* a long day is told, not spelled out */
        if (!shown.length) chips.appendChild(el('span', { class: 'os-none', text: 'No frame for it right now' }));
        rows.appendChild(el('div', { class: 'os-row' }, [el('div', { class: 'os-name', dir: 'rtl', text: x.t.name + (x.fromTomorrow ? ' – ' + whenLabel(x, true) : '') }), chips, hid ? el('div', { class: 'os-hid', text: hid + ' not shown' }) : null]));
      });
      onScreen.textContent = '';
      onScreen.appendChild(el('div', { class: 'os-head' }, [el('span', { class: 'os-dot', 'aria-hidden': 'true' }), el('span', { class: 'os-title', text: 'On the screen now' }),
        el('span', { class: 'os-time num', text: new Date(nowMs).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: loc().tz }) })]));
      onScreen.appendChild(rows);
      onScreen.appendChild(el('div', { class: 'os-foot', text: !total ? 'Nothing would be on the screen at this minute.' : total + (total === 1 ? ' minyan' : ' minyanim') + ' on the screen' + (left ? ', ' + left + ' left out for now.' : ', none left out.') + ' The green one is the next; the pale ones have started.' }));
    }
    function winSync() { winRow.hidden = fWinMode.value !== 'window'; cntRow.hidden = fWinMode.value !== 'count'; keepRow.hidden = fWinMode.value === 'day'; paintOnScreen(); }
    fWinMode.addEventListener('change', winSync);
    cWallShow.body.appendChild(el('div', { class: 'fields' }, [field('What the hallway screen lists', fWinMode)]));
    cWallShow.body.appendChild(winRow); cWallShow.body.appendChild(cntRow);
    cWallShow.body.appendChild(keepRow);
    cWallShow.body.appendChild(onScreen);
    cWallShow.body.addEventListener('input', function () { paintOnScreen(); }); cWallShow.body.addEventListener('change', function () { paintOnScreen(); });
    ui.paintOnScreen = paintOnScreen;
    winSync();
    /* how the tiles behave: when the next minyan is marked, and how fast a frame that has too many turns its pages */
    var cWallTiles = card('How the tiles behave', 'When the next minyan is marked, and how fast a frame with more than fits turns its pages.');
    var fMarkOn = el('input', { type: 'checkbox', id: 'w-mark-on' }); fMarkOn.checked = +d.nextMark > 0;
    var fMark = inp('w-mark', +d.nextMark > 0 ? d.nextMark : 15, { type: 'number', min: '1', max: '240', inputmode: 'numeric' });
    var markRow = el('div', { class: 'fields' }, [field('Minutes before it starts', stepper(fMark, 5), el('div', { class: 'hint', text: 'Until then the next minyan looks like any other still to come; from then on its tile is green and carries הבא.' }))]);
    function markSync() { markRow.hidden = !fMarkOn.checked; }
    fMarkOn.addEventListener('change', markSync); markSync();
    var fPage = inp('w-page', d.pageSeconds == null ? 8 : d.pageSeconds, { type: 'number', min: '3', max: '60', inputmode: 'numeric' });
    cWallTiles.body.appendChild(el('div', { class: 'checks' }, [el('label', { for: 'w-mark-on' }, [fMarkOn, ' Mark the next minyan only shortly before it starts'])]));
    cWallTiles.body.appendChild(markRow);
    cWallTiles.body.appendChild(el('div', { class: 'fields' }, [field('Seconds on each page', stepper(fPage, 1), el('div', { class: 'hint', text: 'A frame turns pages only when a day has more minyanim than fit on the screen even at its smallest size. Then each page stays this long.' }))]));
    var cWallNext = card('The next-minyan panel', 'One line per line. Put a piece in braces and it is filled in; anything else is shown as you write it.');
    var fNextT = el('textarea', { id: 'w-next-template', dir: 'ltr', spellcheck: 'false' });
    fNextT.value = d.nextTemplate == null || d.nextTemplate === '' ? NEXT_TEMPLATE : d.nextTemplate;
    fNextT.style.minHeight = '120px'; fNextT.style.fontFamily = 'var(--font-ui)';
    var varRow = el('div', { class: 'chips-row' }, NEXT_VARS.map(function (v) {
      return el('button', { type: 'button', class: 'btn small', text: '{' + v + '}', title: 'Put it where the cursor is', 'data-nodirty': '1', onclick: function () {
        var i = fNextT.selectionStart == null ? fNextT.value.length : fNextT.selectionStart, j = fNextT.selectionEnd == null ? i : fNextT.selectionEnd;
        fNextT.value = fNextT.value.slice(0, i) + '{' + v + '}' + fNextT.value.slice(j);
        fNextT.focus(); fNextT.selectionStart = fNextT.selectionEnd = i + v.length + 2; markDirty();
      } });
    }));
    var fNextPanel = el('input', { type: 'checkbox', id: 'w-nextpanel' }); fNextPanel.checked = d.nextPanel !== false;
    var fNextHold = inp('w-nexthold', d.nextHold == null ? 0 : d.nextHold, { type: 'number', min: '0', max: '30', inputmode: 'numeric' });
    var nextRest = el('div', { class: 'col' });
    function nextSync() { nextRest.hidden = !fNextPanel.checked; }
    fNextPanel.addEventListener('change', nextSync);
    cWallNext.body.appendChild(el('div', { class: 'checks' }, [el('label', { for: 'w-nextpanel' }, [fNextPanel, ' Show the next-minyan panel on the hallway screen'])]));
    cWallNext.body.appendChild(nextRest);
    nextRest.appendChild(el('div', { class: 'fields' }, [field('Minutes to stay on a minyan after it starts', stepper(fNextHold, 1), el('div', { class: 'hint', text: '0 moves on to the next minyan the moment one starts. With 5, the panel stays on the minyan that has just started for five minutes, headed עכשיו, with the next one named under it.' }))]));
    var fCountTo = el('select', { id: 'w-countto' }, [el('option', { value: '', text: 'The time that stands large (as it is now)' }), el('option', { value: 'start', text: 'The start of the minyan' }), el('option', { value: 'milestone', text: 'The second time (הודו), where a tefilla has one' })]);
    fCountTo.value = d.countTo === 'start' || d.countTo === 'milestone' ? d.countTo : '';
    nextRest.appendChild(el('div', { class: 'fields' }, [field('The countdown runs to', fCountTo, el('div', { class: 'hint', text: 'The panel stays on a minyan until its countdown ends. Run to הודו, it stays on a shacharis until הודו while the tiles already mark the one after it.' }))]));
    nextRest.appendChild(el('div', { class: 'fields' }, [field('The panel, line by line', fNextT)]));
    nextRest.appendChild(el('div', { class: 'hint', text: '{tefilla} שחרית · {room} the shtibl · {time} the big time · {milestone} הודו and its time · {countdown} the red countdown · {day} tomorrow and its date · {note} the row\'s note' }));
    nextRest.appendChild(varRow);
    nextRest.appendChild(el('div', { class: 'bar actions' }, [el('button', { type: 'button', class: 'btn small', text: 'Back to the usual lines', 'data-nodirty': '1', onclick: function () { fNextT.value = NEXT_TEMPLATE; markDirty(); } })]));
    nextSync();
    var cWallClock = card('The clock', 'A logo on the clock face, above the hands. Put the picture beside the website (logo.png) or paste its web address; leave it empty for a plain face.');
    var fWallLogo = inp('w-logo', d.wallLogo || '', { dir: 'ltr', placeholder: 'logo.png' });
    cWallClock.body.appendChild(el('div', { class: 'fields' }, [field('Logo on the clock face', fWallLogo)]));
    sp.appendChild(cWallBase); sp.appendChild(cWallLook); sp.appendChild(cWallTop); sp.appendChild(cWallClock); sp.appendChild(cWallNext); sp.appendChild(cWallShow); sp.appendChild(cWallTiles);
    pages.screen = sp;

    /* this week: add, move or cancel a minyan for today or one of the next six days, without the editor; each day is saved as its own one-date schedule */
    var tp = el('div', { class: 'col', id: 'page-today' }), quickDays = {}; /* iso -> { rd, iso, sched, quick: { tefillaId: [{start, room, note}] } } */
    if (!ui.quickRd || ui.quickRd < todayRd || ui.quickRd > todayRd + 6) ui.quickRd = todayRd;
    function hhmm(min) { var m = Math.round(min); return pad2(Math.floor(m / 60) % 24) + ':' + pad2(m % 60); }
    function parseHHMM(v) { var m = /^(\d{2}):(\d{2})$/.exec(v || ''); return m ? +m[1] * 60 + +m[2] : null; }
    function shortDate(rd) { var g = Cal.gregFromRD(rd); return (d.dateFormat || cfg.dateFormat) === 'dmy' ? g.d + '.' + g.m : g.m + '/' + g.d; }
    function dayState(rd) { var iso = MinyanEngine.isoDate(rd); if (!quickDays[iso]) quickDays[iso] = { rd: rd, iso: iso, sched: scheduleFor(rd), quick: {} }; return quickDays[iso]; }
    function dayList(st, tf) { return st.quick[tf.id] || (st.sched.byTefilla[tf.id] || []).map(function (e) { return { start: e.start, room: e.room, note: e.note }; }); }
    function touch(st, tf) { if (!st.quick[tf.id]) st.quick[tf.id] = dayList(st, tf).map(function (x) { return { start: x.start, room: x.room, note: x.note }; }); return st.quick[tf.id]; }
    function quickLines(st, tf) {
      var list = st.quick[tf.id]; if (!list) return null;
      if (!list.length) return '# בוטל להיום'; /* a comment line: the special schedule applies, with no minyanim */
      return list.slice().sort(function (a, b) { return a.start - b.start; }).map(function (x) { return hhmm(x.start) + (x.room ? ' ' + x.room : '') + (x.note ? ' // ' + x.note : ''); }).join('\n');
    }
    function dayName(rd) { return rd === todayRd ? 'Today' : rd === todayRd + 1 ? 'Tomorrow' : Cal.DAY_NAMES[dayState(rd).sched.info.dow]; }
    function renderToday() {
      tp.textContent = '';
      var st = dayState(ui.quickRd), isToday = st.rd === todayRd, existing = d.overrides.filter(function (o) { return o.date === st.iso; })[0];
      /* the day cards: today and the next six days */
      var chips = el('div', { class: 'daychips', role: 'tablist' });
      for (var k = 0; k < 7; k++) (function (rd) {
        var s2 = dayState(rd), has = Object.keys(s2.quick).length > 0 || d.overrides.some(function (o) { return o.date === s2.iso; });
        chips.appendChild(el('button', { type: 'button', role: 'tab', class: 'daychip' + (rd === ui.quickRd ? ' on' : '') + (has ? ' has' : ''), 'aria-selected': String(rd === ui.quickRd), 'data-nodirty': '1', onclick: function () { ui.quickRd = rd; renderToday(); } }, [
          el('span', { class: 'dc-day', text: dayName(rd) }), el('span', { class: 'dc-date num', text: shortDate(rd) }),
          s2.sched.type !== 'weekday' ? el('span', { class: 'dc-tag', text: TYPE_NAME[s2.sched.type] || s2.sched.type }) : null]));
      })(todayRd + k);
      tp.appendChild(chips);
      tp.appendChild(el('div', { class: 'card today-head' }, [
        el('div', null, [el('div', { class: 'd', text: Cal.DAY_NAMES[st.sched.info.dow] + ' · ' + engine.fmtDate(st.rd) }), el('div', { class: 'cdesc', text: Cal.formatHeb(st.sched.info.heb) + (st.sched.type !== 'weekday' ? ' · ' + (TYPE_NAME[st.sched.type] || '') : '') })]),
        el('div', { class: 'note' }, [existing ? el('span', { class: 'status dirty', text: (isToday ? 'Today' : 'This day') + ' has its own schedule' + (existing.label ? ' (' + existing.label + ')' : '') }) : null,
          el('span', { text: 'Move a time, cancel a minyan or add one. It applies to ' + (isToday ? 'today' : 'this day') + ' only; the regular schedule stays as it is.' })])]));
      d.tefillos.filter(function (t) { return t.kind !== 'event'; }).forEach(function (tf) {
        var box = el('div', { class: 'col' }), list = dayList(st, tf);
        list.forEach(function (x, i) {
          var t = el('input', { type: 'time', value: hhmm(x.start), 'aria-label': 'Time' });
          t.addEventListener('change', function () { var m = parseHHMM(t.value); if (m == null) return; touch(st, tf)[i].start = m; renderToday(); });
          var roomSel = roomPicker(function () { return (st.quick[tf.id] ? st.quick[tf.id][i] : x).room || ''; }, function (v) { touch(st, tf)[i].room = v; }, 'Room'); /* change the room for that day */
          box.appendChild(el('div', { class: 'mrow-l today-row' }, [t].concat(roomSel, [x.note ? el('span', { class: 'hint', text: x.note }) : null,
            el('button', { type: 'button', class: 'btn small danger', text: 'Cancel', title: 'No such minyan that day', onclick: function () { touch(st, tf).splice(i, 1); renderToday(); } })])));
        });
        if (!list.length) box.appendChild(el('div', { class: 'hint', text: 'No ' + tf.name + ' minyanim ' + (isToday ? 'today' : 'that day') + '.' }));
        var addT = el('input', { type: 'time', 'aria-label': 'New time' }), addRoom = '';
        var picker = roomPicker(function () { return addRoom; }, function (v) { addRoom = v; }, 'Add a room');
        var addB = el('button', { type: 'button', class: 'btn small', text: isToday ? '+ Add for today' : '+ Add for ' + dayName(st.rd), onclick: function () { var m = parseHHMM(addT.value); if (m == null) { toast('Pick a time first'); return; } touch(st, tf).push({ start: m, room: addRoom, note: '' }); renderToday(); } });
        box.appendChild(el('div', { class: 'mrow-l today-add' }, [addT].concat(picker, [addB])));
        tp.appendChild(el('div', { class: 'field card tcard' }, [el('label', { text: tf.name }), box]));
      });
      /* Save writes every day that was touched, each as its own one-date schedule */
      var touched = Object.keys(quickDays).filter(function (k2) { return Object.keys(quickDays[k2].quick).length > 0; });
      var saveT = el('button', { type: 'button', class: 'btn primary', text: isToday ? 'Save today\'s changes' : 'Save the changes for ' + dayName(st.rd), 'data-nodirty': '1', onclick: function () {
        var days = Object.keys(quickDays).filter(function (k2) { return Object.keys(quickDays[k2].quick).length > 0; });
        if (!days.length) { toast('Nothing changed yet'); return; }
        var c = collect();
        days.forEach(function (k2) {
          var s3 = quickDays[k2], ovr = c.overrides.filter(function (o) { return o.date === s3.iso; })[0];
          if (!ovr) { ovr = { date: s3.iso, label: s3.rd === todayRd ? 'שינוי להיום' : 'שינוי', lines: {} }; c.overrides.push(ovr); }
          d.tefillos.forEach(function (tf) { var l = quickLines(s3, tf); if (l != null) ovr.lines[tf.id] = l; });
        });
        saveConfig(c);
      } });
      var row = el('div', { class: 'bar actions' }, [saveT]);
      if (touched.length > 1 || (touched.length === 1 && touched[0] !== st.iso)) row.appendChild(el('span', { class: 'hint', text: 'Also saves: ' + touched.filter(function (k2) { return k2 !== st.iso; }).map(function (k2) { return dayName(quickDays[k2].rd); }).join(', ') }));
      if (existing) row.appendChild(el('button', { type: 'button', class: 'btn', text: 'Back to the regular schedule for ' + (isToday ? 'today' : 'this day'), 'data-nodirty': '1', onclick: function () { var c = collect(); c.overrides = c.overrides.filter(function (o) { return o.date !== st.iso; }); saveConfig(c); } }));
      tp.appendChild(row);
      tp.appendChild(shabbosExtrasCard());
    }
    /* the Shabbos box's small lines: shiurim, אבות ובנים, מלוה מלכה … changed from week to week, saved with the main Save */
    var SX_WHEN = [['fri', 'Friday night'], ['morning', 'Shabbos morning'], ['day', 'After Shacharis'], ['motzash', 'Motzei Shabbos']];
    function shabbosExtrasCard() {
      d.shabbosExtras = d.shabbosExtras || [];
      var c = card('Shabbos box: shiurim and more', 'Small lines in the Shabbos zmanim box on the board (from Thursday night). A line can be for every week or only for this Shabbos. Saved with Save.');
      var list = el('div', { class: 'col sxlist' }), nextSat = todayRd + Cal.mod(6 - Cal.mod(todayRd, 7), 7), satIso = MinyanEngine.isoDate(nextSat);
      function paint() {
        list.textContent = '';
        d.shabbosExtras.forEach(function (x, i) {
          var when = el('select', { 'aria-label': 'When' }, SX_WHEN.map(function (o) { return el('option', { value: o[0], text: o[1] }); })); when.value = x.when || 'fri';
          var nm = el('input', { type: 'text', dir: 'auto', value: x.name || '', placeholder: 'שיעור בפרשת השבוע', 'aria-label': 'Name' });
          var tm = el('input', { type: 'text', dir: 'auto', value: x.time || '', placeholder: '8:45 / אחר התפילה', 'aria-label': 'Time', class: 'sxtime' });
          var dt = el('input', { type: 'text', dir: 'auto', value: x.detail || '', placeholder: 'ע״י … • בחדר …', 'aria-label': 'Details' });
          var wk = el('select', { 'aria-label': 'Which weeks' }, [el('option', { value: 'every', text: 'Every week' }), el('option', { value: satIso, text: 'Only this Shabbos' })]);
          wk.value = x.week && x.week !== 'every' ? (x.week === satIso ? satIso : 'every') : 'every';
          if (x.week && x.week !== 'every' && x.week !== satIso) { wk.appendChild(el('option', { value: x.week, text: 'Only ' + x.week })); wk.value = x.week; }
          when.addEventListener('change', function () { x.when = when.value; });
          nm.addEventListener('input', function () { x.name = nm.value; }); tm.addEventListener('input', function () { x.time = tm.value; }); dt.addEventListener('input', function () { x.detail = dt.value; });
          wk.addEventListener('change', function () { x.week = wk.value; });
          list.appendChild(el('div', { class: 'sxrow' }, [when, nm, tm, dt, wk, el('button', { type: 'button', class: 'btn small danger', text: 'Remove', onclick: function () { d.shabbosExtras.splice(i, 1); paint(); } })]));
        });
        if (!d.shabbosExtras.length) list.appendChild(el('div', { class: 'hint', text: 'No lines yet.' }));
      }
      paint();
      c.body.appendChild(list);
      c.body.appendChild(el('div', null, [el('button', { type: 'button', class: 'btn small', text: '+ Add a line', onclick: function () { d.shabbosExtras.push({ when: 'fri', name: '', time: '', detail: '', week: 'every' }); paint(); } })]));
      return c;
    }
    renderToday();
    pages.today = tp;

    /* overrides */
    var op = el('div', { class: 'col' }), oList = el('div', { class: 'col' });
    function addOverride(o) {
      var id = ++uid, r = { date: inp('o-date-' + id, o.date, { type: 'date' }), label: inp('o-label-' + id, o.label), lines: {} };
      r.when = el('select', { id: 'o-when-' + id }, [el('option', { value: 'date', text: 'One civil date' }), el('option', { value: 'hebrew', text: 'A Hebrew date, every year' }), el('option', { value: 'cal', text: 'A calendar day, every year' })]);
      r.hm = el('select', { id: 'o-hm-' + id }); r.hd = inp('o-hd-' + id, o.hd || '', { type: 'number', min: '1', max: '30', inputmode: 'numeric' }); r.cal = el('select', { id: 'o-cal-' + id });
      [[7, 'תשרי'], [8, 'חשון'], [9, 'כסלו'], [10, 'טבת'], [11, 'שבט'], ['adar', 'אדר (אדר ב׳ בשנה מעוברת)'], ['adar1', 'אדר א׳ (בשנה מעוברת בלבד)'], [1, 'ניסן'], [2, 'אייר'], [3, 'סיון'], [4, 'תמוז'], [5, 'אב'], [6, 'אלול']].forEach(function (m) { r.hm.appendChild(el('option', { value: String(m[0]), text: m[1] })); });
      Cal.LABELS.forEach(function (l) { r.cal.appendChild(el('option', { value: l, text: l })); });
      r.when.value = o.date ? 'date' : (o.hm != null ? 'hebrew' : (o.calLabel ? 'cal' : 'date'));
      if (o.hm != null) r.hm.value = String(o.hm);
      if (o.calLabel) r.cal.value = o.calLabel;
      function showWhen() { var w = r.when.value; r.date.hidden = w !== 'date'; r.hm.hidden = w !== 'hebrew'; r.hd.hidden = w !== 'hebrew'; r.cal.hidden = w !== 'cal'; }
      r.when.addEventListener('change', showWhen); showWhen();
      var row = el('div', { class: 'fields three' });
      function typeOfDate() {
        var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(r.date.value);
        if (r.when.value !== 'date' || !m) return 'weekday';
        return Cal.dayType(Cal.dayInfo(Cal.rdFromGreg(+m[1], +m[2], +m[3]), !!d.israel));
      }
      d.tefillos.forEach(function (tf, i) {
        r.lines[tf.id] = { value: (o.lines && o.lines[tf.id]) || '' };
        var sources = Cal.DAY_TYPES.map(function (t) { return { key: t[0], label: t[3], store: function () { return lines[t[0]][tf.id]; } }; });
        row.appendChild(el('div', { class: 'field tefcard' }, [el('label', { class: 'tefname', text: tf.name + ' (no rows = as usual)' }), minyanEditor(r.lines[tf.id], i, typeOfDate, sources, function () { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(r.date.value); return r.when.value === 'date' && m ? Cal.rdFromGreg(+m[1], +m[2], +m[3]) : null; })]));
      });
      var headO = el('span', { text: o.label || 'Special date' }); r.label.addEventListener('input', function () { headO.textContent = r.label.value.trim() || 'Special date'; });
      r.wrap = el('div', { class: 'ovr' }, [el('div', { class: 'ohead' }, [headO, el('button', { type: 'button', class: 'btn small danger', text: 'Remove', onclick: function () { oRows.splice(oRows.indexOf(r), 1); r.wrap.remove(); } })]),
        el('div', { class: 'mrow-l' }, [r.when, r.date, r.hm, r.hd, r.cal]), el('div', { class: 'fields' }, [field('Label shown on the board (e.g. yahrzeit, wedding, Chol Hamoed)', r.label)]), row]);
      oRows.push(r); oList.appendChild(r.wrap);
    }
    d.overrides.forEach(addOverride);
    var cOvr = card('Dates with their own schedule', 'A schedule that replaces the regular one for the tefillos you fill in: on one civil date (a yahrzeit, a wedding), on a Hebrew date every year, or on a calendar day every year (Chol Hamoed Sukkos, Purim, Tisha B\'Av, Rosh Chodesh…). A civil date wins over a Hebrew date, which wins over a calendar day.');
    var emptyO = el('div', { class: 'hint', text: 'No special dates yet. "+ Date" adds one.' }); emptyO.hidden = oRows.length > 0;
    cOvr.body.appendChild(emptyO); cOvr.body.appendChild(oList);
    cOvr.body.appendChild(el('div', null, [el('button', { type: 'button', class: 'btn', text: '+ Date', onclick: function () { emptyO.hidden = true; addOverride({ date: '', label: '', lines: {} }); } })]));
    op.appendChild(cOvr);
    pages.overrides = op;

    /* publish (self-hosted site / app) */
    var pp = el('div', { class: 'col' }), gh = ghSettings();
    var fRemote = inp('f-remote', d.remoteConfigUrl || '', { dir: 'ltr', placeholder: 'https://.../config.json' });
    var gRepo = inp('gh-repo', gh.repo || d.githubRepo || '', { dir: 'ltr', placeholder: 'username/minyan', autocomplete: 'off' }), gBranch = inp('gh-branch', gh.branch || d.githubBranch || 'main', { dir: 'ltr' }),
      gPath = inp('gh-path', gh.path || d.githubPath || 'docs/config.json', { dir: 'ltr' }), gToken = inp('gh-token', gh.token || '', { type: 'password', dir: 'ltr', autocomplete: 'new-password', spellcheck: 'false' }); /* new-password: keeps the browser from filling a saved password (the PIN) into the token box */
    var ghMsg = el('div', { class: 'hint' });
    function saveGh() {
      var s = { repo: gRepo.value.trim(), branch: gBranch.value.trim() || 'main', path: gPath.value.trim() || 'config.json', token: gToken.value.trim() };
      try { if (s.repo || s.token) localStorage.setItem('minyan-github', JSON.stringify(s)); else localStorage.removeItem('minyan-github'); } catch (e) {}
      return s;
    }
    var connected = ghConfigured(gh);
    var cPub = card('Publishing to the website', 'The website and the app read the schedule from a file called config.json on the website. With a GitHub token here, Publish sends what you saved to everyone within a few minutes.',
      { extra: el('span', { class: 'status ' + (connected ? 'ok' : 'dirty'), text: connected ? 'Connected: ' + gh.repo : 'Not connected on this device' }) });
    cPub.body.appendChild(el('details', { class: 'help' }, [el('summary', { text: 'How to set it up' }), el('div', { class: 'hint' }, [
      el('p', null, ['1. In your GitHub repository: Settings → Pages is enabled.  2. Create a fine-grained token with "Contents: Read and write" for that repository only: ', el('a', { href: 'https://github.com/settings/personal-access-tokens/new', target: '_blank', rel: 'noopener', text: 'github.com/settings/personal-access-tokens/new' }), '.  3. Paste it here. The token stays in this browser only; every device that should publish needs it once.'])])]));
    var tokenToggle = el('button', { type: 'button', class: 'btn small', text: 'Show', 'data-nodirty': '1', onclick: function () { var show = gToken.type === 'password'; gToken.type = show ? 'text' : 'password'; tokenToggle.textContent = show ? 'Hide' : 'Show'; } });
    cPub.body.appendChild(el('div', { class: 'fields' }, [field('Repository (owner/repo)', gRepo), field('Branch', gBranch), field('File path', gPath), field('Token', gToken, tokenToggle)]));
    cPub.body.appendChild(el('div', { class: 'bar actions' }, [el('button', { type: 'button', class: 'btn', text: 'Test connection', 'data-nodirty': '1', onclick: function () {
      var s = saveGh();
      if (!ghConfigured(s)) { ghMsg.textContent = 'Enter the repository and the token'; return; }
      ghMsg.textContent = 'Checking…';
      ghCheck(s).then(function (m) { ghMsg.textContent = m; }, function (e) { ghMsg.textContent = 'Failed: ' + e.message; });
    } }), ghMsg]));
    var cRemote = card('Store app', 'Only for a version of the app installed from an app store.');
    cRemote.body.appendChild(el('div', { class: 'fields' }, [field('Central schedule URL (blank = config.json on this site)', fRemote)]));
    var pubStatus = el('span', { class: 'status' }), cChanges = card('Not yet published', 'Save keeps changes on this device. Publishing sends them to the website and the app, for everyone. Here is what would go out.', { extra: pubStatus });
    function renderChanges() {
      var ch = pendingChanges(), pub = publishedCfg(), conn2 = ghConfigured(ghSettings());
      cChanges.body.textContent = '';
      pubStatus.textContent = ch.length ? ch.length + (ch.length === 1 ? ' change' : ' changes') : 'Everything is published';
      pubStatus.className = 'status ' + (ch.length ? 'dirty' : 'ok');
      if (!ch.length) { cChanges.body.appendChild(el('div', { class: 'hint', text: (pub && pub.savedAt ? 'The website has the version saved ' + new Date(pub.savedAt).toLocaleString() + '. ' : '') + 'Save a change and it is listed here before it goes out.' })); return; }
      cChanges.body.appendChild(el('ul', { class: 'changes' }, ch.map(function (x) { return el('li', { text: x }); })));
      cChanges.body.appendChild(el('div', { class: 'bar actions' }, [
        el('button', { type: 'button', class: 'btn primary', 'data-nodirty': '1', text: 'Publish now', onclick: function () { if (!conn2) { toast('Enter the GitHub token below first'); return; } if (ui.adminDirty) { if (confirm('Save the changes you are making here first, then publish?')) saveConfig(collect(), { publish: true }); return; } publishNow(); } }),
        pub ? el('button', { type: 'button', class: 'btn danger', 'data-nodirty': '1', text: 'Discard: back to the published version', onclick: function () {
          if (!confirm('Throw away the changes saved on this device and go back to what the website has?')) return;
          try { localStorage.removeItem('minyan-config'); } catch (e) {}
          setCfg(pub); ui.adminDirty = false; render(); buildAdmin(pub); toast('Back to the published version');
        } }) : null]));
      if (!conn2) cChanges.body.appendChild(el('div', { class: 'hint', text: 'To publish from this device, enter the GitHub token below once.' }));
    }
    renderChanges();
    pp.appendChild(cChanges); pp.appendChild(cPub); pp.appendChild(cRemote);
    pages.publish = pp;
    function history() { try { return JSON.parse(localStorage.getItem('minyan-history') || '[]'); } catch (e) { return []; } }

    /* send: a notification from the gabbai to every device with reminders on (the service checks the admin PIN) */
    var sp2 = el('div', { class: 'col' });
    if (mode !== 'artifact' && (d.notifyUrl || '').trim()) {
      var bcTitle = inp('bc-title', d.name || ''), bcPin = inp('bc-pin', ui.pinValue || '', { type: 'password', autocomplete: 'new-password', placeholder: 'the admin PIN' });
      var bcText = el('textarea', { id: 'bc-text', dir: 'auto', maxlength: '300', placeholder: 'e.g. Mincha today 1:45 instead of 1:30' }), bcCount = el('span', { class: 'hint', text: '0 / 300' }), bcMsg = el('div', { class: 'hint', id: 'bc-msg' });
      bcText.style.minHeight = '90px';
      var pvT = el('b', { text: d.name || '' }), pvB = el('div', { class: 'npv-b', text: '…' });
      bcTitle.addEventListener('input', function () { pvT.textContent = bcTitle.value || d.name || ''; });
      bcText.addEventListener('input', function () { bcCount.textContent = bcText.value.length + ' / 300'; pvB.textContent = bcText.value || '…'; });
      var pst = pushState();
      function sendBroadcast(test) {
        var text = bcText.value.trim();
        if (!text) { bcMsg.textContent = 'Write the message first.'; return; }
        if (!bcPin.value) { bcMsg.textContent = 'Enter the admin PIN.'; return; }
        bcMsg.textContent = test ? 'Sending to this device…' : 'Sending to everyone…';
        fetch(notifyBase() + '/push/broadcast', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin: bcPin.value, title: bcTitle.value.trim() || d.name, body: text, test: test ? (pst && pst.id) : undefined }) })
          .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || ('service ' + r.status)); return j; }, function () { throw new Error('service ' + r.status); }); })
          .then(function (j) {
            bcMsg.textContent = (test ? 'Test sent' : 'Sent') + ' to ' + j.sent + (j.sent === 1 ? ' device' : ' devices') + (j.failed ? ', ' + j.failed + ' failed' : '') + (j.gone ? ', ' + j.gone + ' no longer subscribed' : '') + '.';
            if (!test) { bcText.value = ''; bcCount.textContent = '0 / 300'; pvB.textContent = '…'; }
          }, function (e) { bcMsg.textContent = 'Could not send: ' + (e && e.message || e); });
      }
      var cSend = card('Send a notification', 'Goes out right now to everyone who turned reminders on in the app. Keep it short: a change for today, a simcha, a word from the gabbai.');
      cSend.body.appendChild(el('div', { class: 'fields' }, [field('Title', bcTitle), field('Admin PIN (the notification service checks it)', bcPin)]));
      cSend.body.appendChild(el('div', { class: 'field' }, [el('label', { for: 'bc-text', text: 'Message' }), bcText, bcCount]));
      cSend.body.appendChild(el('div', { class: 'npv' }, [el('div', { class: 'npv-h' }, [el('span', { text: '🔔' }), el('span', { text: 'How it looks on the phone' })]), pvT, pvB]));
      cSend.body.appendChild(el('div', { class: 'bar actions' }, [
        el('button', { type: 'button', class: 'btn primary', id: 'bc-send', 'data-nodirty': '1', text: 'Send to everyone', onclick: function () { if (confirm('Send this notification to everyone now?')) sendBroadcast(false); } }),
        pst && pst.id ? el('button', { type: 'button', class: 'btn', id: 'bc-test', 'data-nodirty': '1', text: 'Test on this device', onclick: function () { sendBroadcast(true); } }) : el('span', { class: 'hint', text: 'Turn reminders on for this device (Settings on the board) to be able to send yourself a test first.' }),
        bcMsg]));
      sp2.appendChild(cSend);
    } else sp2.appendChild(el('div', { class: 'hint lead', text: 'Enter the notification service address under General → Website and services to be able to send notifications.' }));
    pages.send = sp2;

    /* data */
    var dp = el('div', { class: 'col' }), dataArea = el('textarea', { id: 'data-json', spellcheck: 'false', dir: 'ltr' });
    dataArea.style.minHeight = '260px'; dataArea.style.fontFamily = 'monospace';
    var hist = history(), hBox = el('div', { class: 'col' });
    var cHist = card('Previous versions', 'Each Save made on this device keeps the version before it here, so a wrong save can be undone.');
    if (!hist.length) hBox.appendChild(el('div', { class: 'hint', text: 'No previous versions on this device yet.' }));
    hist.forEach(function (h) {
      var when = new Date(h.at);
      hBox.appendChild(el('div', { class: 'vrow' }, [el('span', { text: 'Saved ' + when.toLocaleString() }), el('button', { type: 'button', class: 'btn small', text: 'Restore', onclick: function () { setCfg(h.cfg); ui.adminDirty = true; closeOverlay(); buildAdmin(); toast('Restored into the editor. Click Save to keep it.', 6000); } })]));
    });
    cHist.body.appendChild(hBox);
    var cText = card('Settings as text', 'All settings as text: copy it as a backup, or paste and load it into another copy of the page.');
    cText.body.appendChild(dataArea);
    cText.body.appendChild(el('div', { class: 'bar actions' }, [
      el('button', { type: 'button', class: 'btn', text: 'Copy', 'data-nodirty': '1', onclick: function () {
        var done = function () { toast('Copied'); }, fail = function () { dataArea.select(); toast('Select the text and copy it manually'); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(dataArea.value).then(done, fail); else fail();
      } }),
      el('button', { type: 'button', class: 'btn danger', text: 'Clear local save', onclick: function () {
        try { localStorage.removeItem('minyan-config'); } catch (e) {}
        location.reload();
      } }),
      el('button', { type: 'button', class: 'btn', text: 'Load from text', onclick: function () {
        try { var c = JSON.parse(dataArea.value); if (!c || typeof c !== 'object') throw new Error('x'); setCfg(c); ui.adminDirty = true; closeOverlay(); buildAdmin(); toast('Loaded. Click Save to keep it.'); }
        catch (e) { toast('That text is not a valid settings file'); }
      } })]));
    dp.appendChild(cHist); dp.appendChild(cText);
    pages.data = dp;

    function collect() {
      var out = clone(d);
      out.name = fName.value.trim();
      out.location = { name: fLocName.value.trim(), lat: parseFloat(fLat.value), lng: parseFloat(fLng.value), tz: fTz.value.trim(), elev: parseFloat(fElev.value) || 0 };
      out.candles = fCandles.value === '' ? 18 : +fCandles.value;
      out.tzeisMinutes = fTzeisMin.value === '' ? 0 : +fTzeisMin.value;
      out.tzeisDeg = +fTzeisDeg.value || 8.5;
      out.minchaGedola = fMinchag.value;
      out.amidahMinutes = fAmidah.value === '' ? 15 : Math.max(0, Math.min(60, +fAmidah.value || 0));
      out.israel = $('#f-israel').checked; out.weeklyEarliest = $('#f-weekly').checked; out.clock24 = $('#f-24').checked; out.showRT = $('#f-rt').checked; out.show60 = $('#f-60').checked; out.showTzeis = $('#f-tzeis').checked;
      delete out.pin;
      out.tefillos = d.tefillos.map(function (t, i) { return liveTefilla(i); });
      out.rooms = fRooms.value.trim();
      out.siteUrl = fSite.value.trim();
      out.notifyUrl = fNotify.value.trim();
      out.sponsorSeconds = Math.max(2, +fSponsorSecs.value || 8);
      out.nowMinutes = fNowMins.value === '' ? 20 : Math.max(0, Math.min(180, +fNowMins.value || 0));
      out.dateFormat = fDateFmt.value;
      out.bigTime = fBig.value;
      out.displayScale = +fDispSize.value || 100;
      out.countdownZmanim = COUNTDOWN_KEYS.filter(function (k) { return $('#cd-' + k).checked; });
      out.palette = fPalette.value;
      out.lang = fLang.value;
      out.logo = fLogo.value.trim();
      out.schedules = {};
      Cal.DAY_TYPES.forEach(function (t) {
        var o = {};
        d.tefillos.forEach(function (tf) { var v = lines[t[0]][tf.id].value; if (v.trim()) o[tf.id] = v.replace(/\r/g, ''); });
        if (Object.keys(o).length) out.schedules[t[0]] = o;
      });
      out.nextTemplate = fNextT.value.trim() === NEXT_TEMPLATE ? '' : fNextT.value;
      out.wallLogo = fWallLogo.value.trim();
      out.wallTopBar = fTopBar.checked;
      out.dayTefilla = clone(dayTef);
      var tefIds = {}; out.tefillos.forEach(function (t) { if (t.kind !== 'event') tefIds[t.id] = 1; }); /* nothing is kept for a tefilla that is no longer there */
      Object.keys(out.dayTefilla).forEach(function (k) { Object.keys(out.dayTefilla[k] || {}).forEach(function (id) { if (!tefIds[id]) delete out.dayTefilla[k][id]; }); if (!Object.keys(out.dayTefilla[k] || {}).length) delete out.dayTefilla[k]; });
      out.nextPanel = fNextPanel.checked; out.nextHold = Math.max(0, Math.min(30, Math.round(+fNextHold.value) || 0));
      out.wallLook = {}; SWATCHES.forEach(function (sw) { if (wall[sw[0]]) out.wallLook[sw[0]] = wall[sw[0]]; });
      out.wallWindow = winNow();
      out.nextMark = fMarkOn.checked ? Math.max(1, Math.min(240, Math.round(+fMark.value) || 15)) : 0;
      out.pageSeconds = Math.max(3, Math.min(60, Math.round(+fPage.value) || 8));
      out.countTo = fCountTo.value;
      out.rolls = rollRows.map(function (r) {
        var dows = r.dows.filter(function (c) { return c.checked; }).map(function (c) { return +c.value; }), ln = {};
        d.tefillos.forEach(function (tf) { if ((r.lines[tf.id].value || '').trim()) ln[tf.id] = r.lines[tf.id].value; });
        return { name: r.name.value.trim(), type: r.type.value, priority: +r.priority.value || 0, active: r.active.checked, dows: dows.length === 7 ? [] : dows, from: r.from.value, to: r.to.value, lines: ln };
      }).filter(function (r) { return r.name || Object.keys(r.lines).length; });
      out.notices = donNotices(); out.donationKinds = clone(kinds);
      out.banner = { text: bText.value.trim(), from: bFrom.value, until: bUntil.value };
      out.overrides = oRows.map(function (r) {
        var lines = {};
        d.tefillos.forEach(function (tf) { if (r.lines[tf.id].value.trim()) lines[tf.id] = r.lines[tf.id].value; });
        var o = { label: r.label.value.trim(), lines: lines };
        if (r.when.value === 'date') o.date = r.date.value;
        else if (r.when.value === 'hebrew') { o.hm = /^\d+$/.test(r.hm.value) ? +r.hm.value : r.hm.value; o.hd = +r.hd.value || 0; }
        else o.calLabel = r.cal.value;
        return o;
      }).filter(function (o) { return o.date || (o.hm != null && o.hd) || o.calLabel; });
      out.remoteConfigUrl = fRemote.value.trim();
      out.smsNumber = fSms.value.trim();
      out.smsLang = fSmsLang.value;
      out.shabbosExtras = (d.shabbosExtras || []).filter(function (x) { return x && String(x.name || "").trim(); });
      out.shere = collectShere();
      /* A save is always newer than anything this page has seen, whatever this device's clock says: boards take the settings
         with the later stamp, so a change saved on a phone whose clock runs behind another's must still come out later. */
      out.savedAt = Math.max(Date.now(), (cfg.savedAt || 0) + 1, (ui.inc || 0) + 1);
      return out;
    }
    function validate(c) {
      if (isNaN(c.location.lat) || isNaN(c.location.lng)) return 'Enter the latitude and longitude';
      try { new Intl.DateTimeFormat('en-US', { timeZone: c.location.tz }); } catch (e) { return 'Invalid time zone'; }
      var miss = null; /* a second time "of its own" with no name would show as nothing: say so instead of saving it that way */
      Object.keys(c.dayTefilla || {}).forEach(function (k) { Object.keys(c.dayTefilla[k] || {}).forEach(function (id) { var o = c.dayTefilla[k][id]; if (!miss && o && o.second === 'own' && !String(o.milestone || '').trim()) miss = [k, id]; }); });
      if (miss) {
        var tfm = (c.tefillos || []).filter(function (x) { return x.id === miss[1]; })[0];
        validate.show = function () { selectTab('schedule'); showType(miss[0]); var bx = document.getElementById('dt-box-' + miss[0] + '-' + miss[1]); if (bx && bx.ask) { bx.ask(); try { bx.scrollIntoView({ block: 'center' }); } catch (e) {} } }; /* take the gabbai to the box that needs him */
        return 'Schedule → ' + (TYPE_EN[miss[0]] || miss[0]) + ' → ' + whole(tfm ? tfm.name : miss[1]) + ': the second time needs a name.';
      }
      return null;
    }
    function saveConfig(c, opts) {
      validate.show = null;
      var err = validate(c);
      if (err) { toast(err); if (validate.show) validate.show(); return; }
      saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
      if (mode !== 'artifact') saveGh();
      var ready = Promise.resolve();
      if (mode !== 'artifact' && fPin.value.trim()) {
        c.pinHash = null;
        ready = (window.crypto && crypto.subtle) ? sha256Hex(fPin.value.trim()).then(function (h) { c.pinHash = h; }) : Promise.resolve().then(function () { c.pin = fPin.value.trim(); delete c.pinHash; });
      }
      try { var hist2 = history(); hist2.unshift({ at: Date.now(), cfg: cfg }); localStorage.setItem('minyan-history', JSON.stringify(hist2.slice(0, 10))); } catch (e) {}
      ready.then(function () { return persist(c); }).then(function (r) {
        setCfg(c);
        if (r.reloads) { toast('Saved. Reloading the page…', 8000); return; }
        ui.adminDirty = false; render(); buildAdmin(c); /* stay in the settings, on the same tab, with the board behind refreshed */
        if (ui.reloadWhenSaved && !(opts && opts.publish)) { toast('Saved. Loading the newer version of this page…', 4000); setTimeout(function () { location.reload(); }, 900); return; }
        var pend = pendingChanges().length;
        if (opts && opts.publish) publishNow();
        else if (r.configured) toast(pend ? 'Saved. ' + pend + (pend === 1 ? ' change is' : ' changes are') + ' not yet published: Publish when you are ready.' : 'Saved. Nothing new to publish.', 6000);
        else toast(remoteUrl() ? 'Saved on this device only. Connect the website on the Publish tab to update everyone.' : 'Saved on this device', 6000);
      }, function (e) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; toast(errorText(e), 6000); });
    }
    var saveBtn = el('button', { type: 'button', class: 'btn primary', text: 'Save', onclick: function () { saveConfig(collect()); } });
    var status = el('span', { class: 'status', text: '' });
    function setDirty(on) {
      ui.adminDirty = on; homeUnsaved.hidden = !on;
      status.textContent = on ? 'Unsaved changes' : (cfg.savedAt ? 'Saved ' + new Date(cfg.savedAt).toLocaleString([], { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
      status.className = 'status' + (on ? ' dirty' : ''); saveBtn.classList.toggle('attn', on);
    }
    var closeBtn = el('button', { type: 'button', class: 'btn closebtn', 'aria-label': 'Close', onclick: function () { if (ui.adminDirty && !confirm('Close without saving? The changes made here will be lost.')) return; ui.adminDirty = false; closeOverlay(); } }, [el('span', { class: 'lbl', text: 'Close' }), svgIcon('x')]);
    var navFoot = el('div', { class: 'navfoot' }, mode === 'artifact' ? [] : [
      el('a', { class: 'btn ghost', href: 'index.html', target: '_blank', rel: 'noopener' }, [svgIcon('open'), el('span', { text: 'View the board' })]),
      el('button', { type: 'button', class: 'btn ghost', id: 'adm-shortcut', 'data-nodirty': '1', onclick: adminShortcut }, [svgIcon('install'), el('span', { text: 'Shortcut on this device' })]),
      el('button', { type: 'button', class: 'btn ghost', 'data-nodirty': '1', onclick: function () { if (ui.adminDirty && !confirm('Lock without saving? The changes made here will be lost.')) return; pinOk = false; try { sessionStorage.removeItem('minyan-pin'); } catch (e) {} ui.adminDirty = false; closeOverlay(); showPin(); } }, [svgIcon('lock'), el('span', { text: 'Lock' })])]);
    var ghNow = mode === 'artifact' ? null : ghSettings();
    var footHint = mode === 'artifact' ? 'Save publishes a new version of this page for everyone who has the link.' : (ghConfigured(ghNow) ? 'Save keeps the changes on this device. Publish sends them to the website and the app.' : 'Save keeps the settings on this device only. Connect the website on the Publish tab to be able to publish.');
    var main = el('div', { class: 'amain' }, [subBar, el('div', { class: 'ptitle' }, [pageTitle, pageDesc]), pages.home, pages.today, pages.general, pages.schedule, pages.donations, pages.rolls, pages.notices, pages.shere, pages.screen, pages.overrides, mode !== 'artifact' ? pages.publish : null, mode !== 'artifact' ? pages.send : null, pages.data,
      el('div', { class: 'bar afoot' }, [el('span', { class: 'hint', text: footHint }), saveBtn.cloneNode(true)])]);
    var pubBar = el('div', { class: 'pubbar' }); pubBar.hidden = true;
    function refreshPubBar() {
      var ch = pendingChanges(), k = ch.length, conn = mode !== 'artifact' && ghConfigured(ghSettings());
      pubBar.textContent = ''; pubBar.hidden = !k;
      if (!k) return;
      pubBar.appendChild(el('span', { class: 'pubmsg', text: k + (k === 1 ? ' change' : ' changes') + ' not yet published' }));
      pubBar.appendChild(el('div', { class: 'bar' }, [el('button', { type: 'button', class: 'btn small', 'data-nodirty': '1', text: 'What changed', onclick: function () { selectTab('publish'); } }),
        el('button', { type: 'button', class: 'btn small gold', 'data-nodirty': '1', text: conn ? 'Publish' : 'Connect to publish', onclick: function () { if (!conn) { selectTab('publish'); return; } if (ui.adminDirty) { if (confirm('Save the changes you are making here first, then publish?')) saveConfig(collect(), { publish: true }); return; } publishNow(); } })]));
    }
    var panel = el('div', { class: 'shell' }, [
      el('header', { class: 'abar' }, [
        el('div', { class: 'brand' }, [el('div', { class: 'bt' }, [el('h2', { text: cfg.name || 'Board settings' }), el('div', { class: 'sub', text: Cal.DAY_NAMES[todayInfo.dow] + ' · ' + engine.fmtDate(todayRd) + ' · ' + Cal.formatHeb(todayInfo.heb) })])]),
        el('div', { class: 'bar' }, [mode !== 'artifact' ? el('a', { class: 'btn toboard', href: 'index.html', target: '_blank', rel: 'noopener', 'aria-label': 'Open the board' }, [el('span', { text: 'Board' }), svgIcon('open')]) : null,
          mode !== 'artifact' ? el('a', { class: 'btn toboard', href: 'tv.html', target: '_blank', rel: 'noopener', 'aria-label': 'See the hallway screen as the TV shows it', title: 'The hallway screen as the TV shows it' }, [el('span', { text: 'TV' }), svgIcon('tv')]) : null, status, saveBtn, closeBtn])]),
      el('div', { class: 'abody' }, [el('nav', { class: 'anav' }, [tabBar, navFoot]), main]), pubBar]);
    overlay(panel);
    refreshPubBar();
    selectTab(draft && ui.adminTab && pages[ui.adminTab] ? ui.adminTab : 'home'); showType('weekday'); markTabs();
    setDirty(!!ui.adminDirty);
    var bottomSave = main.lastChild.lastChild;
    bottomSave.addEventListener('click', function () { saveBtn.click(); });
    /* anything typed or clicked in the pages marks the settings as changed until the next Save */
    function markDirty(ev) {
      if (!ev) { if (!ui.adminDirty) setDirty(true); return; } /* called by hand, by a button that changed something itself */
      var t = ev.target;
      if (t && t.closest && t.closest('[data-nodirty]')) return;
      if (ev.type === 'click' && !(t && t.closest && t.closest('button'))) return;
      if (!ui.adminDirty) setDirty(true);
    }
    main.addEventListener('input', markDirty); main.addEventListener('change', markDirty); main.addEventListener('click', markDirty);
    if (!ui.keysBound) {
      ui.keysBound = true;
      document.addEventListener('keydown', function (ev) {
        if (!ui.adminOpen || !(ev.metaKey || ev.ctrlKey) || (ev.key !== 's' && ev.key !== 'S')) return;
        ev.preventDefault(); var b = $('#overlay .abar .btn.primary'); if (b) b.click();
      });
    }
  }

  /* ---------- persistence ---------- */
  function errorText(e) {
    var code = e && e.code;
    if (code === 'not_writer' || code === 'not_granted') return 'You do not have permission to save this board';
    if (code === 'conflict') return 'Someone else saved in the meantime; the page will reload';
    if (code === 'rate_limited') return 'Too many saves in a row; try again in a moment';
    return 'Save failed' + (e && e.message ? ': ' + e.message : '');
  }
  function skeleton(body) {
    var reset = ':root{color-scheme:light;box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}html{scroll-padding-top:env(safe-area-inset-top,0px)}body{margin:0;padding:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif;background:#fff;color:#000}img{max-width:100%}[hidden]:not([hidden=until-found i]){display:none!important}', st = document.head.querySelector('style');
    if (st && st.textContent) reset = st.textContent;
    return '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>' + reset + '</style></head><body>' + body + '</body></html>';
  }
  function buildHtml(c) {
    var json = JSON.stringify(c, null, 1).replace(/<\//g, '<\\/');
    return fetch('index.html', { cache: 'no-store' }).then(function (r) { return r.ok ? r.text() : null; }, function () { return null; }).then(function (src) {
      var re = /(<script id="config"[^>]*>)[\s\S]*?(<\/script>)/;
      if (src && re.test(src)) {
        src = src.replace(re, function (m, a, b) { return a + json + b; });
        return /^\s*<!doctype/i.test(src) ? src : skeleton(src);
      }
      return skeleton(MinyanTemplate(json));
    });
  }
  function persist(c) {
    if (mode === 'artifact' && artifactNs) {
      try { sessionStorage.setItem('minyan-pending', JSON.stringify(c)); } catch (e) {}
      return buildHtml(c).then(function (html) { return artifactNs.publish(html); }).then(function () { return { reloads: true }; });
    }
    return new Promise(function (res, rej) {
      try { localStorage.setItem('minyan-config', JSON.stringify(c)); localStorage.setItem('minyan-base', String(ui.formBase || ui.inc || 0)); res(); } catch (e) { rej(e); }
    }).then(function () { return { reloads: false, published: false, configured: ghConfigured(ghSettings()) }; }); /* publishing is its own step: the Publish tab lists what changed first */
  }
  /* ---------- publishing: what is saved on this device vs. what the website has ---------- */
  function publishedCfg() { try { return JSON.parse(localStorage.getItem('minyan-remote') || 'null'); } catch (e) { return null; } }
  function localDraft() { try { return JSON.parse(localStorage.getItem('minyan-config') || 'null'); } catch (e) { return null; } }
  function pendingChanges() {
    var pub = publishedCfg(), mine = localDraft();
    if (!mine || mode === 'artifact') return [];
    if (pub && (mine.savedAt || 0) < (pub.savedAt || 0)) return []; /* the website is newer than this device's copy */
    return describeChanges(pub, mine);
  }
  /* a readable list of what differs between two settings files */
  function describeChanges(a, b) {
    if (!b) return [];
    if (!a) return ['Everything (this device has no copy of the published version yet)'];
    a = withDefaults(a); b = withDefaults(b);
    var out = [], names = {}, tfById = {};
    (a.tefillos || []).concat(b.tefillos || []).forEach(function (t) { tfById[t.id] = t; });
    /* a line in its parsed form, so "6:20" and "06:20" (how the editor writes it) are the same line */
    function canonLine(line, id) { var p = MinyanEngine.parseLine(line, tfById[id] || { period: 'am' }); if (!p) return null; return JSON.stringify({ s: p.spec, r: p.room || p.rooms, n: p.note, c: p.cond }); }
    /* the same minyan regardless of its rule or note: time and room(s) only */
    function canonBase(line, id) { var p = MinyanEngine.parseLine(line, tfById[id] || { period: 'am' }); if (!p || !p.spec) return null; return JSON.stringify({ s: p.spec, r: p.room || p.rooms }); }
    function lineMap(text, id) { var m = {}; lines(text).forEach(function (l) { var off = /^#\s*off\s+/i.test(l), body = off ? l.replace(/^#\s*off\s+/i, '') : l, k = canonLine(body, id) || body; if (!m[k]) m[k] = { text: body, off: off, base: canonBase(body, id) }; }); return m; }
    /* blank, missing, false and 0 count as the same; key order does not matter */
    function canon(v) {
      if (v == null || v === '' || v === false || v === 0) return null;
      if (Array.isArray(v)) return v.map(canon);
      if (typeof v === 'object') { var o = {}; Object.keys(v).sort().forEach(function (k) { var c = canon(v[k]); if (c != null) o[k] = c; }); return o; }
      return v;
    }
    function same(x, y) { return JSON.stringify(canon(x)) === JSON.stringify(canon(y)); }
    function lines(t) { return (t || '').split('\n').map(function (l) { return l.trim(); }).filter(Boolean); }
    function few(list) { return list.slice(0, 5).join('; ') + (list.length > 5 ? ' … (' + list.length + ')' : ''); }
    (a.tefillos || []).concat(b.tefillos || []).forEach(function (t) { names[t.id] = t.name; });
    [['name', 'Shul name'], ['rooms', 'Rooms'], ['palette', 'Colors'], ['lang', 'Board labels'], ['bigTime', 'Big number'], ['displayScale', 'Hallway screen size'], ['wallLook', 'Hallway screen colours'], ['nextTemplate', 'Next-minyan panel'], ['wallWindow', 'What the hallway screen lists'], ['nextMark', 'When the next minyan is marked'], ['pageSeconds', 'Seconds on each page'], ['countTo', 'What the countdown runs to'], ['dateFormat', 'Date format'], ['nowMinutes', '"Now" minutes'], ['countdownZmanim', 'Countdown zmanim'],
      ['candles', 'Candle lighting minutes'], ['tzeisMinutes', 'Nightfall minutes'], ['tzeisDeg', 'Nightfall degrees'], ['minchaGedola', 'Mincha gedola'], ['amidahMinutes', 'Minutes from הודו to שמונה עשרה'], ['israel', 'Eretz Yisroel calendar'], ['weeklyEarliest', 'Weekly earliest sunset'], ['clock24', '24-hour clock'],
      ['showTzeis', 'Show צאת הכוכבים'], ['showRT', 'Show Rabbeinu Tam'], ['show60', 'Show 60 minutes'], ['siteUrl', 'Website address'], ['logo', 'Logo'], ['wallLogo', 'Logo on the clock face'], ['wallTopBar', 'Top line of the hallway screen'], ['nextPanel', 'Next-minyan panel on the hallway screen'], ['nextHold', 'Minutes the next-minyan panel stays on a minyan'], ['notifyUrl', 'Notification service'], ['smsNumber', 'SMS number'], ['smsLang', 'Text reply language'],
      ['sponsorSeconds', 'Sponsor seconds'], ['remoteConfigUrl', 'Central schedule URL'], ['location', 'Location'], ['pinHash', 'PIN'], ['pin', 'PIN']].forEach(function (f) {
      if (same(a[f[0]], b[f[0]])) return;
      var v = b[f[0]];
      out.push(f[1] + (f[0] === 'location' || f[0] === 'pinHash' || f[0] === 'pin' || (v && typeof v === 'object') ? ' changed' : ': ' + (v == null || v === '' ? '(blank)' : String(v))));
    });
    /* a tefilla's name and second time on one kind of day (Schedule → the kind of day → "On …"), each in words */
    (function () {
      var da = a.dayTefilla || {}, db = b.dayTefilla || {}, kinds = {};
      Object.keys(da).concat(Object.keys(db)).forEach(function (k) { kinds[k] = 1; });
      Cal.DAY_TYPES.forEach(function (t) {
        if (!kinds[t[0]]) return;
        var ids = {}; Object.keys(da[t[0]] || {}).concat(Object.keys(db[t[0]] || {})).forEach(function (id) { ids[id] = 1; });
        Object.keys(ids).forEach(function (id) {
          var x = (da[t[0]] || {})[id], y = (db[t[0]] || {})[id], parts = [];
          if (same(x, y)) return;
          if (y && String(y.name || '').trim()) parts.push('called \u2068' + String(y.name).trim() + '\u2069');
          if (y && y.second === 'none') parts.push('no second time');
          if (y && y.second === 'own') parts.push('second time \u2068' + (String(y.milestone || '').trim() || '…') + '\u2069, ' + (+y.offset || 0) + ' min after the start');
          out.push(t[3] + ' · \u2068' + (names[id] || id) + '\u2069: ' + (parts.length ? parts.join(' · ') : 'back to the usual name and second time'));
        });
      });
    })();
    if (!same(a.tefillos, b.tefillos)) out.push('Tefillos / categories changed');
    /* extra schedules, by name */
    (function () {
      var ra = a.rolls || [], rb = b.rolls || [], names = {};
      ra.concat(rb).forEach(function (r) { names[(r && r.name) || '(no name)'] = 1; });
      Object.keys(names).forEach(function (n) {
        function pick(l) { return l.filter(function (r) { return ((r && r.name) || '(no name)') === n; })[0]; }
        var x = pick(ra), y = pick(rb);
        if (!x && y) out.push('Extra schedule added: ' + n);
        else if (x && !y) out.push('Extra schedule removed: ' + n);
        else if (x && y && !same(x, y)) out.push('Extra schedule changed: ' + n + (x.active !== y.active ? (y.active ? ' (on)' : ' (off)') : ''));
      });
    })();
    Cal.DAY_TYPES.forEach(function (t) {
      var k = t[0], sa = (a.schedules || {})[k] || {}, sb = (b.schedules || {})[k] || {}, ids = {};
      Object.keys(sa).concat(Object.keys(sb)).forEach(function (id) { ids[id] = 1; });
      Object.keys(ids).forEach(function (id) {
        var ma = lineMap(sa[id], id), mb = lineMap(sb[id], id), added = [], removed = [], changed = [], on = [], offs = [], gone = {};
        Object.keys(ma).forEach(function (k) { if (!mb[k]) gone[k] = ma[k]; });
        Object.keys(mb).forEach(function (k) {
          if (ma[k]) { if (ma[k].off !== mb[k].off) (mb[k].off ? offs : on).push(mb[k].text); return; }
          /* the same minyan with a different rule or note counts as changed, not as removed and added */
          var old = mb[k].base && Object.keys(gone).filter(function (g) { return gone[g].base === mb[k].base; })[0];
          if (old) { changed.push(mb[k].text); delete gone[old]; } else added.push(mb[k].text + (mb[k].off ? ' (off)' : ''));
        });
        Object.keys(gone).forEach(function (k) { removed.push(gone[k].text); });
        if (!added.length && !removed.length && !changed.length && !on.length && !offs.length) return;
        out.push(t[3] + ' · ' + (names[id] || id) + ': ' + [added.length ? 'added ' + few(added) : '', changed.length ? 'changed ' + few(changed) : '', offs.length ? 'switched off ' + few(offs) : '', on.length ? 'switched on ' + few(on) : '', removed.length ? 'removed ' + few(removed) : ''].filter(Boolean).join('; '));
      });
    });
    function okey(o) { return o.date ? o.date : o.hm != null ? 'hebrew ' + o.hm + '/' + o.hd : 'calendar ' + o.calLabel; }
    var oa = {}, ob = {};
    (a.overrides || []).forEach(function (o) { oa[okey(o)] = o; }); (b.overrides || []).forEach(function (o) { ob[okey(o)] = o; });
    Object.keys(ob).forEach(function (k) { if (!oa[k]) out.push('Special date added: ' + k + (ob[k].label ? ' (' + ob[k].label + ')' : '')); else if (!same(oa[k], ob[k])) out.push('Special date changed: ' + k + (ob[k].label ? ' (' + ob[k].label + ')' : '')); });
    Object.keys(oa).forEach(function (k) { if (!ob[k]) out.push('Special date removed: ' + k + (oa[k].label ? ' (' + oa[k].label + ')' : '')); });
    var na = {}, nb = {};
    function donKey(x) { return x.id || (x.title || '') + '|' + (x.name || '') + '|' + (x.from || ''); }
    function donLabel(x) { return ((x.name || '').trim() || (x.body || '').trim().split('\n')[0] || 'a donation') + (x.title ? ' (' + x.title + ')' : ''); }
    function shown(x) { return ((x.name || '') + (x.body || '') + (x.lead || '')).trim() !== ''; } /* an entry with nothing in it was never on the board */
    function board(x) { return { title: x.title, lead: x.lead, name: x.name, body: x.body, size: x.size, logo: x.logo, from: x.from, to: x.to, fromTime: x.fromTime || '', toTime: x.toTime || '' }; } /* what the board reads; the back end's own notes on it are not a change */
    (a.notices || []).filter(shown).forEach(function (x) { na[donKey(x)] = x; }); (b.notices || []).filter(shown).forEach(function (x) { nb[donKey(x)] = x; });
    /* a donation saved before donations had their own marks is the same one once it has them */
    Object.keys(nb).forEach(function (k) { if (na[k]) return; var y = nb[k], old = Object.keys(na).filter(function (j) { return !nb[j] && same(board(na[j]), board(y)); })[0]; if (old) { na[k] = na[old]; delete na[old]; } });
    Object.keys(nb).forEach(function (k) {
      if (!na[k]) { out.push('Donation added: ' + donLabel(nb[k]) + (nb[k].off ? ' (switched off)' : '')); return; }
      if (!same(board(na[k]), board(nb[k]))) out.push('Donation changed: ' + donLabel(nb[k]));
      if (!!na[k].off !== !!nb[k].off) out.push('Donation switched ' + (nb[k].off ? 'off' : 'on') + ': ' + donLabel(nb[k]));
    });
    Object.keys(na).forEach(function (k) { if (!nb[k]) out.push('Donation removed: ' + donLabel(na[k])); });
    if (!same(a.donationKinds, b.donationKinds)) out.push('Kinds of donation changed');
    if (!same(a.banner, b.banner)) out.push(b.banner && b.banner.text ? 'Banner: ' + b.banner.text + (b.banner.from ? ' · from ' + b.banner.from.replace('T', ' ') : '') + (b.banner.until ? ' · until ' + b.banner.until.replace('T', ' ') : '') : 'Banner cleared');
    return out;
  }
  /* the settings the admin form fills in by itself, so a published file that never had them does not look changed */
  function withDefaults(c) {
    var o = clone(c), tz = (o.location || {}).tz || '';
    var d = { palette: 'shul', lang: 'he', bigTime: 'start', dateFormat: /^America\//.test(tz) ? 'mdy' : 'dmy', nowMinutes: 20, sponsorSeconds: 8, tzeisDeg: 8.5, candles: 18, minchaGedola: 'later', displayScale: 100, smsLang: 'auto', amidahMinutes: 15, wallLogo: '', wallTopBar: false, dayTefilla: {}, nextPanel: true, nextHold: 0, nextMark: 0, pageSeconds: 8, countTo: '', donationKinds: DONATION_KINDS, wallLook: {}, wallWindow: { mode: 'day', before: 180, after: 20, neverEmpty: true } };
    Object.keys(d).forEach(function (k) { if (o[k] == null || o[k] === '') o[k] = d[k]; });
    /* settings saved before "by number" existed have no numbers for it: they stand at the usual ones, and are not a change */
    if (o.wallWindow && typeof o.wallWindow === 'object') { if (o.wallWindow.next == null) o.wallWindow.next = 6; if (o.wallWindow.recent == null) o.wallWindow.recent = 2; }
    return o;
  }
  /* send what is saved on this device to the website (GitHub); the board and the app pick it up within minutes */
  /* Two hands on the settings. ui.inc is the savedAt of the newest published settings this page has taken in; the back end's form
     remembers the one it was built on (ui.formBase), and a save on this device writes that down ('minyan-base'), so a publish
     knows which published version its settings grew from. If the website has moved on since — another phone, another tab, an
     older page left open for hours — publishing would quietly undo that work. So it stops, says what would change, and asks. */
  function publishNow(force) {
    var s = ghSettings(), c = localDraft() || cfg;
    if (!ghConfigured(s)) { toast('Connect the website first: Publish tab, GitHub token'); return Promise.resolve(false); }
    toast('Publishing…', 4000);
    var base = 0; try { base = +(localStorage.getItem('minyan-base')) || 0; } catch (e) {}
    return ghPublish(c, s, force ? 0 : base).then(function () {
      try { localStorage.setItem('minyan-remote', JSON.stringify(c)); localStorage.setItem('minyan-published-at', String(Date.now())); localStorage.setItem('minyan-base', String(c.savedAt || 0)); } catch (e) {}
      ui.inc = ui.formBase = c.savedAt || 0;
      toast('Published. Everyone gets the update within a few minutes.', 6000);
      if (backEndShowing()) { ui.adminDirty = false; buildAdmin(cfg); }
      return true;
    }, function (e) {
      if (e && e.newer) { $('#toast') && $('#toast').remove(); askAboutNewer(e.newer, c); return false; }
      toast('Publishing failed: ' + (e && e.message || e), 9000); return false;
    });
  }
  /* the back end is open and unlocked: its own bar is on the page. (ui.adminOpen is also true while only the PIN box is showing.) */
  function backEndShowing() { return !!(ui.adminOpen && (mode === 'artifact' || pinOk) && document.querySelector('#overlay .abar')); }
  function askAboutNewer(theirs, mine) {
    var when = new Date(theirs.savedAt || 0).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    var diff = describeChanges(theirs, mine), list = el('ul', { class: 'ask-list' });
    diff.slice(0, 8).forEach(function (line) { list.appendChild(el('li', { dir: 'auto', text: line })); });
    if (diff.length > 8) list.appendChild(el('li', { text: 'and ' + (diff.length - 8) + ' more' }));
    askBox('The website has newer settings', [
      el('p', { text: 'Settings were published from another phone or another open page on ' + when + ', after this page last took the website\'s settings. Nothing has been published from here yet.' }),
      diff.length ? el('p', { class: 'ask-sub', text: 'If you publish from here, this is what changes on the website, their newer work included:' }) : null,
      diff.length ? list : null,
      el('p', { class: 'ask-sub', text: '"Take the newer settings" loads what the website has; make your change again after that and publish. What was saved on this device is kept under Backup → Previous versions.' })], [
      { text: 'Cancel', id: 'ask-cancel', cancel: true },
      { text: 'Publish mine anyway', kind: 'danger', id: 'ask-mine', act: function () { publishNow(true); } },
      { text: 'Take the newer settings', kind: 'primary', id: 'ask-theirs', act: function () { takeNewer(theirs, mine); } }]);
  }
  function takeNewer(theirs, mine) {
    try {
      var hist = JSON.parse(localStorage.getItem('minyan-history') || '[]'); hist.unshift({ at: Date.now(), cfg: mine }); localStorage.setItem('minyan-history', JSON.stringify(hist.slice(0, 10))); /* what was here is not thrown away */
      localStorage.setItem('minyan-remote', JSON.stringify(theirs)); localStorage.removeItem('minyan-config'); localStorage.setItem('minyan-base', String(theirs.savedAt || 0));
    } catch (e) {}
    setCfg(theirs); ui.inc = ui.formBase = theirs.savedAt || 0;
    if (backEndShowing()) { ui.adminDirty = false; buildAdmin(cfg); } else render();
    toast('The newer settings are loaded. Make your change again, then publish.', 8000);
  }

  /* ---------- central schedule file (self-hosted site and app) ---------- */
  function remoteUrl() {
    if (cfg.remoteConfigUrl && /^https?:\/\//.test(cfg.remoteConfigUrl)) return cfg.remoteConfigUrl;
    if (/^https?:$/.test(location.protocol)) return 'config.json';
    return null;
  }
  function applyIfNewer(c) {
    if (!c || typeof c !== 'object' || !c.schedules) return false;
    if ((c.savedAt || 0) < (cfg.savedAt || 0)) return false;
    setCfg(c);
    return true;
  }
  /* a fresh copy every minute: the address changes by the minute, so the site's CDN (which keeps config.json for up to ten minutes) is passed by */
  function fetchJson(url) {
    return fetch(url + (url.indexOf('?') < 0 ? '?' : '&') + 't=' + Math.floor(Date.now() / 60000), { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }
  function loadRemote() {
    var url = remoteUrl();
    if (!url) return Promise.resolve(false);
    return fetchJson(url).then(function (c) {
      if (c && c.remoteConfigUrl && /^https?:\/\//.test(c.remoteConfigUrl) && c.remoteConfigUrl !== url) return fetchJson(c.remoteConfigUrl).then(function (c2) { return c2 || c; });
      return c;
    }).then(function (c) {
      if (!c) return false;
      try { localStorage.setItem('minyan-remote', JSON.stringify(c)); } catch (e) {}
      var was = cfg.savedAt || 0, changed = applyIfNewer(c), newer = changed && (c.savedAt || 0) > was;
      if (changed) { ui.inc = Math.max(ui.inc || 0, c.savedAt || 0); if (!ui.adminOpen) { try { localStorage.setItem('minyan-base', String(ui.inc)); } catch (e) {} } }
      if (changed && !ui.adminOpen) render();
      if (newer && backEndShowing()) { /* the back end itself, not the PIN box that stands in front of it */
        if (!ui.adminDirty) { /* nothing typed here: the page simply follows the website, on the same tab */
          ui.formBase = ui.inc; try { localStorage.setItem('minyan-base', String(ui.inc)); } catch (e) {}
          buildAdmin(cfg); toast('Newer settings, published from another phone or page, were loaded here.', 7000);
        } else toast('Newer settings were just published from another phone or page. Publishing from here will ask before replacing them.', 9000);
      }
      return changed;
    });
  }
  function ghSettings() { try { return JSON.parse(localStorage.getItem('minyan-github') || 'null') || {}; } catch (e) { return {}; } }
  function ghConfigured(s) { return !!(s && s.repo && s.token); }
  function utf8b64(str) {
    var bytes = new TextEncoder().encode(str), bin = '', i;
    for (i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function ghHeaders(s) { return { 'Authorization': 'Bearer ' + s.token, 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }; }
  function ghApi(s) { return 'https://api.github.com/repos/' + s.repo.replace(/^\/+|\/+$/g, '') + '/contents/' + (s.path || 'config.json').replace(/^\/+/, ''); }
  function ghCheck(s) {
    return fetch(ghApi(s) + '?ref=' + encodeURIComponent(s.branch || 'main'), { headers: ghHeaders(s), cache: 'no-store' }).then(function (r) {
      if (r.status === 404) return 'The file is not there yet; it will be created on the first save';
      if (!r.ok) throw new Error('GitHub ' + r.status);
      return 'Connection OK';
    });
  }
  /* base: the savedAt of the published settings these grew from; when the website holds something newer than that, nothing is
     written and the newer settings are handed back instead (0 = write whatever is there) */
  function ghPublish(c, s, base) {
    var branch = s.branch || 'main', api = ghApi(s), headers = ghHeaders(s);
    headers['Content-Type'] = 'application/json';
    return fetch(api + '?ref=' + encodeURIComponent(branch), { headers: headers, cache: 'no-store' }).then(function (r) {
      if (r.status === 404) return null;
      if (!r.ok) throw new Error('GitHub ' + r.status);
      return r.json();
    }).then(function (existing) {
      if (base && existing && existing.content) {
        var theirs = null;
        try { var bin = atob(String(existing.content).replace(/\s+/g, '')), bytes = new Uint8Array(bin.length), i; for (i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); theirs = JSON.parse(new TextDecoder().decode(bytes)); } catch (e) { theirs = null; }
        if (theirs && theirs.schedules && (theirs.savedAt || 0) > base && (theirs.savedAt || 0) !== (c.savedAt || 0)) { var stop = new Error('The website has newer settings'); stop.newer = theirs; throw stop; }
      }
      var body = { message: 'Update minyan schedule', content: utf8b64(JSON.stringify(c, null, 1)), branch: branch };
      if (existing && existing.sha) body.sha = existing.sha;
      return fetch(api, { method: 'PUT', headers: headers, body: JSON.stringify(body) });
    }).then(function (r) {
      if (r.ok) return true;
      return r.json().then(function (j) { throw new Error('GitHub ' + r.status + (j && j.message ? ': ' + j.message : '')); }, function () { throw new Error('GitHub ' + r.status); });
    });
  }

  /* ---------- installable app ---------- */
  /* ?at=2026-12-05T08:30 shows the board as it will be at that moment by the shul's own clock. Every reading of the time is moved by the
     same amount, so the day, its schedule, its zmanim and its donations are that day's, and the clock goes on running from there.
     It is how the back end's Home page shows the screen on another day. */
  function startPreview() {
    var m = /[?&]at=(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?(?:&|$)/.exec(location.search);
    if (!m) return;
    var y = +m[1], mo = +m[2], dd = +m[3], hh = m[4] == null ? null : +m[4], mm = m[5] == null ? 0 : +m[5];
    if (mo < 1 || mo > 12 || dd < 1 || dd > 31 || (hh != null && (hh > 23 || mm > 59))) return;
    var real = Date.now.bind(Date), base = real(), tz = loc().tz, rd = Cal.rdFromGreg(y, mo, dd);
    var min = hh == null ? Math.floor(Cal.nowInTz(base, tz).min) : hh * 60 + mm;
    var shift = Cal.epochFromWall(rd, min, tz) - base;
    Date.now = function () { return real() + shift; };
    ui.preview = { rd: rd, min: min };
  }
  function isStandalone() { return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true; }
  /* the store app opens this same website in its own window, and marks itself in the browser's name */
  function inStoreApp() { return /MinyanBoardApp/.test(navigator.userAgent || '') || !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform()); }
  function isIOS() { return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }
  function refreshInstallBtn() {
    if (ui.installBtn) ui.installBtn.hidden = !deferredInstall;
    if (ui.iosHint) ui.iosHint.hidden = !(!inArtifact && !isStandalone() && !deferredInstall) || inStoreApp();
    if (ui.installBtn && inStoreApp()) ui.installBtn.hidden = true;
  }
  function registerSW() {
    if (inArtifact || !('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
    var hadController = !!navigator.serviceWorker.controller, reloaded = false;
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then(function (reg) {
      /* look for a new version as soon as the page opens, every 5 minutes after that, and whenever the page comes back into view or
         the connection returns; a new one installs, takes over and reloads the page */
      var check = function () { reg.update().catch(function () {}); };
      check();
      setInterval(check, 5 * 60 * 1000);
      document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') check(); });
      window.addEventListener('online', check);
    }).catch(function () {});
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!hadController || reloaded) return;
      if (!ui.adminOpen || !ui.adminDirty) { reloaded = true; location.reload(); return; } /* an open back end with nothing unsaved is not left running the old page for hours */
      ui.reloadWhenSaved = true; toast('A newer version of this page is ready. It loads by itself after your next Save.', 9000);
    });
  }

  /* The hallway screen in a browser window that still shows its tabs and address bar: a "Full screen" button in the corner takes
     them away. It shows for a few seconds when the page opens and whenever the mouse moves or the screen is touched, and never
     once the screen is full (its own doing, F11, or an installed app). A browser only goes full screen at a press, so the page
     cannot do it by itself. */
  function setupFullScreen() {
    var root = document.documentElement, go = root.requestFullscreen || root.webkitRequestFullscreen;
    if (!go || window.top !== window || currentView().kind !== 'display' || document.getElementById('fs-btn')) return;
    var btn = el('button', { type: 'button', class: 'fs-btn', id: 'fs-btn', 'aria-label': 'Full screen' }, [svgIcon('tv'), el('span', { text: 'מסך מלא · Full screen' })]), timer = null;
    function isFull() {
      return !!(document.fullscreenElement || document.webkitFullscreenElement) || (window.matchMedia && window.matchMedia('(display-mode: fullscreen)').matches) ||
        (window.innerHeight >= screen.height - 1 && window.innerWidth >= screen.width - 1);
    }
    function show(ms) {
      clearTimeout(timer);
      if (isFull()) { btn.classList.remove('show'); root.classList.add('fs-on'); return; }
      root.classList.remove('fs-on'); btn.classList.add('show');
      timer = setTimeout(function () { btn.classList.remove('show'); }, ms || 6000);
    }
    btn.addEventListener('click', function () { try { var p = go.call(root); if (p && p.then) p.then(function () { show(); }, function () {}); } catch (e) {} });
    ['mousemove', 'touchstart', 'keydown'].forEach(function (ev) { window.addEventListener(ev, function () { show(); }, { passive: true }); });
    ['fullscreenchange', 'webkitfullscreenchange'].forEach(function (ev) { document.addEventListener(ev, function () { show(); }); });
    window.addEventListener('resize', function () { show(); });
    document.body.appendChild(btn);
    show(12000);
  }

  /* ---------- boot ---------- */
  function boot() {
    var raw = $('#config');
    var parsed = {};
    try { parsed = JSON.parse(raw ? raw.textContent : '{}'); } catch (e) { parsed = {}; }
    setCfg(parsed);
    inArtifact = !!(window.claude && typeof window.claude.use === 'function');
    if (inArtifact) mode = 'artifact';
    else {
      var bakedAt = cfg.savedAt || 0, remoteAt = 0, usingDraft = false, baseAt = 0;
      try { var r0 = JSON.parse(localStorage.getItem('minyan-remote') || 'null'); if (applyIfNewer(r0)) remoteAt = r0.savedAt || 0; } catch (e) {}
      try { var l0 = JSON.parse(localStorage.getItem('minyan-config') || 'null'); usingDraft = applyIfNewer(l0) && (l0.savedAt || 0) > Math.max(bakedAt, remoteAt); } catch (e) {}
      try { baseAt = +(localStorage.getItem('minyan-base')) || 0; } catch (e) {}
      /* the published settings this page stands on: the newest it holds, or, when a save made on this device is in use, the ones that save grew from */
      ui.inc = usingDraft ? (baseAt || Math.max(bakedAt, remoteAt)) : Math.max(bakedAt, remoteAt);
      try { pinOk = sessionStorage.getItem('minyan-pin') === '1'; } catch (e) {}
      startPreview();
      /* The screen's address on something small: show the picture of the whole screen (the screen as the TV draws it, scaled to
         fit) instead of a squeezed screen. A window too narrow for the three columns, an upright tablet, or one as low as a
         phone on its side always gets the picture, &full=1 or not: the screen cuts off what does not fit there. (&full=1 is for a small TV, whose
         browser may report half its pixels.) What the address asked for — a day to show, a size — goes along. */
      var v0 = currentView();
      var vw0 = window.innerWidth, vh0 = window.innerHeight;
      if (v0.kind === 'display' && window.top === window && (vw0 <= 820 || vh0 < 500 || (vw0 < vh0 && vw0 < 1000) || (!v0.full && Math.max(vw0, vh0) < 1000))) {
        var keep = location.search.replace(/^\?/, '').split('&').filter(function (kv) { return /^(at|size)=/.test(kv); }).join('&');
        location.replace('tv.html' + (keep ? '?' + keep : '')); return;
      }
    }
    render();
    setupFullScreen();
    /* opened by itself, a preview says that it is one, so it is never taken for the board as it is today */
    if (ui.preview && window.top === window) document.body.appendChild(el('div', { class: 'preview-badge', dir: 'rtl', text: S().preview + ' · ' + Cal.formatHeb(Cal.hebFromRD(ui.preview.rd)) + ' · ' + fmtTime(ui.preview.min) }));
    setInterval(tick, 1000);
    if (window.matchMedia) { var mq = window.matchMedia('(max-width: 640px)'); (mq.addEventListener ? mq.addEventListener('change', function () { render(); }) : mq.addListener(function () { render(); })); } /* phone layout follows the width */
    window.addEventListener('hashchange', function () { refreshEditBtn(); if (isAdminPage() && canEditNow() && !ui.adminOpen) openAdmin(); });
    window.addEventListener('resize', function () { clearTimeout(ui.fitTimer); ui.fitTimer = setTimeout(function () { if (document.documentElement.classList.contains('lobby')) render(); }, 200); });
    if (!inArtifact && isAdminPage()) openAdmin();
    if (!inArtifact) {
      loadRemote();
      /* a screen on the wall is always on and has nobody to refresh it: it looks for new settings every minute, so a change made in
         the back end shows there within a minute or two of being published; a phone looks every five */
      var bootKind = currentView().kind;
      setInterval(loadRemote, (bootKind === 'display' || bootKind === 'room' ? 1 : 5) * 60 * 1000);
      document.addEventListener('visibilitychange', function () { if (!document.hidden) loadRemote(); });
      window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferredInstall = e; refreshInstallBtn(); });
      window.addEventListener('appinstalled', function () { deferredInstall = null; refreshInstallBtn(); toast('App installed'); });
      registerSW();
    }
    if (inArtifact) {
      window.claude.use('artifact').then(function (a) { if (a) artifactNs = a; else mode = 'static'; refreshEditBtn(); });
      window.claude.use('user').then(function (u) {
        canEdit = !!(u && typeof u.canEdit === 'function' && u.canEdit());
        refreshEditBtn();
        if (isAdminPage()) { if (canEdit && !ui.adminOpen) openAdmin(); else if (!canEdit) toast('Editing this board is available to its owner only', 6000); }
      });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
