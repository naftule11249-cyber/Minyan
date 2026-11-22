/* edit.js — a gabbai's text that changes one day's minyanim: add one, cancel one, move one to another time or room.
   It does what the back end's "This week" tab does: the day gets a one-date schedule of its own (cfg.overrides) for the tefilla
   that was touched, and the regular schedule stays as it is. Needs cal.js and engine.js.

   MinyanEdit.parse(text)             -> null when the text is not such a command (it is then answered like any other text)
   MinyanEdit.run(cfg, text, nowMs)   -> { reply, lang }                       nothing to change (not understood, not found, …)
                                      -> { reply, lang, cfg, undo, summary }   the changed settings, and what "undo" needs
                                      -> { reply, lang, wantsUndo: true }      the sender asked to take the last change back
   MinyanEdit.undo(cfg, record, lang) -> { reply, cfg }                        the settings with that change taken back

   Who may send these is not decided here: the service checks the sender's number first (sms/worker.js). */
var MinyanEdit = (function () {
  'use strict';
  var ACTIONS = {
    add: ['add', 'לייג צו', 'לייגט צו', 'לייג', 'צולייגן', 'גיב צו', 'הוסף', 'להוסיף'],
    cancel: ['cancel', 'remove', 'delete', 'בטל', 'לבטל', 'אויס', 'נעם אראפ', 'אראפ', 'מחק', 'אפזאגן'],
    move: ['move', 'change', 'edit', 'טויש', 'טוישן', 'רוק', 'ענדער', 'שנה', 'לשנות']
  };
  var UNDO = ['undo', 'צוריק', 'צוריקציען', 'בטל שינוי', 'ציי צוריק'], HELP = ['gabbai', 'גבאי', 'gabai'];
  var FILLER = ['to', 'at', 'on', 'for', 'in', 'the', 'minyan', 'צו', 'אויף', 'פאר', 'אום', 'ביי', 'אין', 'אינעם', 'יום', 'מנין', 'דעם', 'ל', 'ב', '->', '→', '>', '-'];
  var TODAY = ['today', 'היינט', 'היום'], TOMORROW = ['tomorrow', 'מארגן', 'מחר'];
  var DOWS = [['sunday', 'זונטאג', 'ראשון'], ['monday', 'מאנטאג', 'שני'], ['tuesday', 'דינסטאג', 'שלישי'], ['wednesday', 'מיטוואך', 'רביעי'], ['thursday', 'דאנערשטאג', 'חמישי'], ['friday', 'פרייטאג', 'שישי', 'ערש״ק'], ['shabbos', 'shabbat', 'saturday', 'שבת', 'שב״ק']];
  var ROOMWORD = ['room', 'חדר', 'שטוב', 'בחדר'];
  var AM = ['am', 'a', 'אינדערפרי', 'בבוקר', 'צופרי'], PM = ['pm', 'p', 'נאכמיטאג', 'ביינאכט', 'בערב', 'אחהצ', 'אוונט'];
  var TEF = { shacharis: /^(shachar|shachr|שחרית|שחריס)/, mincha: /^(mincha|minha|מנחה)/, maariv: /^(maariv|mariv|arvit|arvis|מעריב|ערבית)/ };
  var YI_DAYS = ['זונטאג', 'מאנטאג', 'דינסטאג', 'מיטוואך', 'דאנערשטאג', 'פרייטאג', 'שבת'], EN_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Shabbos'];
  var EN_TEFILLA = { shacharis: 'Shacharis', mincha: 'Mincha', maariv: 'Maariv' };
  var DAYS_AHEAD = 6; /* today and the next six days, like the This week tab */

  /* the replies: Yiddish to a text in Hebrew letters, English to one in Latin letters */
  var T = {
    yi: {
      added: 'צוגעלייגט', cancelled: 'אראפגענומען', moved: 'געטוישט', undone: 'צוריקגעצויגן', today: 'היינט', tomorrow: 'מארגן',
      soon: 'עס וועט זיין אויפן סקרין אין א מינוט. נאר פאר דעם טאג.', undoHint: 'צוריקצוציען שיקט: צוריק',
      help: 'טוישן א מנין דורך טעקסט (נאר פאר איין טאג):\nלייג צו מנחה 2:15 ברך משה\nבטל מנחה 2:00\nטויש מנחה 2:00 אויף 2:15\nמען קען צושרייבן מארגן אדער א טאג (דינסטאג), און א חדר.\nצוריק = ציט צוריק די לעצטע ענדערונג.',
      needTefilla: 'וועלכע תפילה? שרייבט שחרית, מנחה אדער מעריב. צום ביישפיל: ',
      needTime: 'וועלכע צייט? צום ביישפיל: ', needNew: 'אויף וואס טוישן? שרייבט א נייע צייט אדער א חדר. צום ביישפיל: ',
      what: function (x) { return 'נישט פארשטאנען „' + x + '". שיקט גבאי פאר ביישפילן.'; },
      badDay: 'מען קען טוישן נאר היינט און די קומענדיגע 6 טעג.',
      notFound: function (tf, t, day, list) { return 'נישט געפונען ' + tf + ' ' + t + ' ' + day + '.' + (list ? ' ' + tf + ' ' + day + ': ' + list : ''); },
      noneAt: function (t, day) { return 'נישט געפונען קיין מנין ' + t + ' ' + day + '. שרייבט אויך די תפילה.'; },
      whichRoom: function (t, rooms) { return 'עס זענען דא עטליכע מנינים ' + t + ' (' + rooms + '). שרייבט אויך דעם חדר.'; },
      whichTefilla: function (t) { return 'עס זענען דא מנינים ' + t + ' אין מער ווי איין תפילה. שרייבט אויך די תפילה.'; },
      exists: function (d) { return 'עס איז שוין דא: ' + d; }, same: 'עס איז שוין אזוי. גארנישט געטוישט.',
      noUndo: 'נישטא וואס צוריקצוציען (נאר די לעצטע ענדערונג, ביז 24 שעה).', room: 'חדר', noRoom: 'אן א חדר', rooms: 'חדרים (מען קען שרייבן דעם נומער)',
      notSetUp: 'טוישן דורך טעקסט איז נאכנישט אויפגעשטעלט. גארנישט געטוישט.', failed: 'עס איז נישט געלונגען אפצוהיטן. גארנישט געטוישט; פרובירט נאכאמאל אין א מינוט.'
    },
    en: {
      added: 'Added', cancelled: 'Cancelled', moved: 'Moved', undone: 'Undone', today: 'today', tomorrow: 'tomorrow',
      soon: 'It will be on the screen within a minute. For that day only.', undoHint: 'To take it back, text: undo',
      help: 'Change a minyan by text (for one day only):\nadd mincha 2:15 ברך משה\ncancel mincha 2:00\nmove mincha 2:00 to 2:15\nYou can add tomorrow or a day (tuesday), and a room.\nundo = takes back your last change.',
      needTefilla: 'Which tefilla? Write shacharis, mincha or maariv. For example: ',
      needTime: 'Which time? For example: ', needNew: 'Move it to what? Write a new time or a room. For example: ',
      what: function (x) { return 'I did not understand "' + x + '". Text gabbai for examples.'; },
      badDay: 'Only today and the next 6 days can be changed.',
      notFound: function (tf, t, day, list) { return 'No ' + tf + ' at ' + t + ' ' + day + '.' + (list ? ' ' + tf + ' ' + day + ': ' + list : ''); },
      noneAt: function (t, day) { return 'No minyan at ' + t + ' ' + day + '. Write the tefilla too.'; },
      whichRoom: function (t, rooms) { return 'There is more than one minyan at ' + t + ' (' + rooms + '). Write the room too.'; },
      whichTefilla: function (t) { return 'There are minyanim at ' + t + ' in more than one tefilla. Write the tefilla too.'; },
      exists: function (d) { return 'That one is already there: ' + d; }, same: 'It is already so. Nothing changed.',
      noUndo: 'Nothing to undo (only your last change, for 24 hours).', room: 'room', noRoom: 'no room', rooms: 'Rooms (the number works too)',
      notSetUp: 'Changes by text are not set up yet. Nothing changed.', failed: 'It could not be saved. Nothing changed; try again in a minute.'
    }
  };
  var EX = { add: { yi: 'לייג צו מנחה 2:15 ברך משה', en: 'add mincha 2:15' }, cancel: { yi: 'בטל מנחה 2:00', en: 'cancel mincha 2:00' }, move: { yi: 'טויש מנחה 2:00 אויף 2:15', en: 'move mincha 2:00 to 2:15' } };

  function hasHebrew(s) { return /[֐-׿]/.test(s || ''); }
  /* words compare without their quote marks and in lower case: היכל ביהמ״ד = היכל ביהמ"ד = היכל ביהמד */
  function norm(s) { return String(s || '').toLowerCase().replace(/["'״׳`’“”]/g, '').replace(/\s+/g, ' ').trim(); }
  function words(text) { return String(text || '').replace(/[,;!?]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean); }
  function inList(list, w) { var n = norm(w); return list.some(function (x) { return norm(x) === n; }); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function hhmm(min) { var m = Math.round(min); return pad2(Math.floor(m / 60) % 24) + ':' + pad2(m % 60); }

  /* which kind of command, by its first word or two; null when the text is something else */
  function actionOf(text) {
    var w = words(text), full = norm(w.join(' ')), one = norm(w[0] || ''), two = norm(w.slice(0, 2).join(' ')), k, i;
    if (!w.length) return null;
    if (inList(UNDO, full)) return { action: 'undo', rest: [] };
    if (inList(HELP, full)) return { action: 'help', rest: [] };
    for (k in ACTIONS) for (i = 0; i < ACTIONS[k].length; i++) if (ACTIONS[k][i].indexOf(' ') > 0 && norm(ACTIONS[k][i]) === two) return { action: k, rest: w.slice(2) };
    for (k in ACTIONS) for (i = 0; i < ACTIONS[k].length; i++) if (norm(ACTIONS[k][i]) === one) return { action: k, rest: w.slice(1) };
    return null;
  }
  function parse(text) { var a = actionOf(text); return a && (a.action === 'undo' || a.action === 'help' || a.rest.length) ? a : null; } /* "cancel" alone is the carrier's opt-out word, not ours */

  /* "2:15", "2.15", "215", "2", "2:15pm", "14:15" */
  function timeOf(w) {
    var m = /^(\d{1,2})[:.](\d{2})(am|pm|a|p)?$/i.exec(w) || /^(\d{1,2})()(am|pm|a|p)$/i.exec(w), h, mi, ap;
    if (m) { h = +m[1]; mi = +(m[2] || 0); ap = m[3] ? m[3].charAt(0).toLowerCase() : ''; }
    else if (/^\d{3,4}$/.test(w)) { h = Math.floor(+w / 100); mi = +w % 100; ap = ''; }
    else if (/^\d{1,2}$/.test(w) && +w >= 1 && +w <= 12) { h = +w; mi = 0; ap = ''; }
    else return null;
    if (h > 23 || mi > 59 || (ap && (h < 1 || h > 12))) return null;
    return { h: h, m: mi, ap: ap, exact: !ap && (h > 12 || h === 0) }; /* 14:15 and 0:30 say which half of the day by themselves */
  }
  /* the minute of the day a typed time can mean: both halves of the day when it does not say */
  function minutesOf(t) {
    if (t.exact) return [t.h * 60 + t.m];
    var base = (t.h % 12) * 60 + t.m;
    return t.ap === 'a' ? [base] : t.ap === 'p' ? [base + 720] : [base, base + 720];
  }

  function run(cfg, text, nowMs) {
    var lang = hasHebrew(words(text)[0]) ? 'yi' : 'en', L = T[lang], a = actionOf(text); /* by the command's own word: an English text may still name a room in Hebrew letters */
    function say(reply) { return { reply: reply, lang: lang }; }
    var nums = Object.keys(cfg.roomNumbers || {}).sort(function (p, q) { return p - q; }).map(function (k) { return k + ' ' + cfg.roomNumbers[k]; }).join(', ');
    var help = L.help + (nums ? '\n' + L.rooms + ': ' + nums : '');
    if (!a) return say(help);
    if (a.action === 'help') return say(help);
    if (a.action === 'undo') return { reply: '', lang: lang, wantsUndo: true };
    var engine = MinyanEngine(cfg), tz = engine.loc().tz, todayRd = Cal.nowInTz(nowMs, tz).rd, todayDow = Cal.dayInfo(todayRd, !!cfg.israel).dow;
    var tefillos = engine.tefillos().filter(function (t) { return t.kind !== 'event'; });
    var rd = todayRd, tf = null, times = [], left = [], i, w, t, codes = cfg.roomNumbers || {}, coded = null, roomWord = false;
    /* sort the words: a day, a tefilla, times (with אינדערפרי / pm after them), little words; what is left is the room */
    for (i = 0; i < a.rest.length; i++) {
      w = a.rest[i];
      if (inList(TODAY, w)) { rd = todayRd; continue; }
      if (inList(TOMORROW, w)) { rd = todayRd + 1; continue; }
      var dow = -1; DOWS.forEach(function (names, d) { if (inList(names, w)) dow = d; });
      if (dow >= 0 && !(dow === 6 && left.length && tf)) { rd = todayRd + ((dow - todayDow) + 7) % 7; continue; }
      var hit = null; tefillos.forEach(function (x) { if (norm(x.name) === norm(w) || (TEF[x.id] && TEF[x.id].test(norm(w)))) hit = x; });
      if (hit && !tf) { tf = hit; continue; }
      /* a room by its number (Send → Changes by text): after "room" / "חדר" / "#", or a bare number once the time has been said */
      if (inList(ROOMWORD, w)) { roomWord = true; continue; }
      var num = /^#?(\d{1,2})$/.exec(w);
      if (num && codes[String(+num[1])] && (roomWord || w.charAt(0) === '#' || times.length)) { coded = codes[String(+num[1])]; roomWord = false; continue; }
      t = timeOf(w);
      if (t) { times.push(t); continue; }
      if (times.length && inList(AM, w)) { t = times[times.length - 1]; if (!t.exact) t.ap = 'a'; continue; }
      if (times.length && inList(PM, w)) { t = times[times.length - 1]; if (!t.exact) t.ap = 'p'; continue; }
      if (inList(FILLER, w)) continue;
      left.push(w);
    }
    if (rd < todayRd || rd > todayRd + DAYS_AHEAD) return say(L.badDay);
    var sched = engine.scheduleFor(rd), iso = MinyanEngine.isoDate(rd), info = sched.info;
    var dayWord = rd === todayRd ? L.today : rd === todayRd + 1 ? L.tomorrow : (lang === 'yi' ? YI_DAYS : EN_DAYS)[info.dow];
    function tName(x) { return lang === 'en' && EN_TEFILLA[x.id] ? EN_TEFILLA[x.id] : x.name; }
    function listOf(x) { return (sched.byTefilla[x.id] || []).map(function (e) { return { start: e.start, room: e.room || '', note: e.note || '' }; }); }
    function describe(x, e) { return tName(x) + ' ' + engine.fmtTime(e.start) + (e.room ? ' ' + e.room : ''); }
    /* the room: one of the shul's rooms (General → Rooms, and any room in that day's lists), by its name or the start of it */
    var room = coded;
    if (left.length) {
      var known = {}, typed = norm(left.join(' '));
      String(cfg.rooms || '').split(',').forEach(function (r) { if (r.trim()) known[r.trim()] = 1; });
      tefillos.forEach(function (x) { listOf(x).forEach(function (e) { if (e.room) known[e.room] = 1; }); });
      var names = Object.keys(known), exact = names.filter(function (r) { return norm(r) === typed; }), part = names.filter(function (r) { return norm(r).indexOf(typed) >= 0; });
      if (exact.length === 1) room = exact[0]; else if (part.length === 1) room = part[0];
      else return say(L.what(left.join(' ')) + (names.length ? ' ' + L.room + ': ' + names.join(', ') : ''));
    }
    if (!times.length) return say(L.needTime + EX[a.action][lang]);

    /* the minyan a cancel or a move is about: by its time, within the tefilla when one is named, and by its room when two share the time */
    function find(time) {
      var mins = minutesOf(time), pool = [], shown = engine.fmtTime((time.h % 12 || 12) * 60 + time.m);
      (tf ? [tf] : tefillos).forEach(function (x) { listOf(x).forEach(function (e, idx) { if (mins.indexOf(e.start % 1440) >= 0) pool.push({ tf: x, e: e, idx: idx }); }); });
      var movingRoom = a.action === 'move' && times.length === 1; /* "move mincha 2:00 לב אהרן": the room is where it goes, not which one it is */
      if (room && !movingRoom && pool.some(function (p) { return p.e.room === room; })) pool = pool.filter(function (p) { return p.e.room === room; });
      if (!pool.length) return { error: tf ? L.notFound(tName(tf), shown, dayWord, listOf(tf).map(function (e) { return engine.fmtTime(e.start) + (e.room ? ' ' + e.room : ''); }).join(', ')) : L.noneAt(shown, dayWord) };
      var tfs = pool.map(function (p) { return p.tf.id; }).filter(function (v, k, arr) { return arr.indexOf(v) === k; });
      if (tfs.length > 1) return { error: L.whichTefilla(shown) };
      var rooms = pool.map(function (p) { return p.e.room || L.noRoom; }).filter(function (v, k, arr) { return arr.indexOf(v) === k; });
      if (rooms.length > 1) return { error: L.whichRoom(shown, rooms.join(', ')) };
      return pool[0]; /* the same minyan listed twice counts as one */
    }
    /* a new time for a tefilla, when it does not say which half of the day: nearest to the minyan it replaces; for an added one, the
       morning for a morning tefilla, the afternoon and evening otherwise (12:xx at night is after midnight, as the lists have it) */
    function placeNew(time, x, near) {
      var mins = minutesOf(time), list = listOf(x), night = list.length ? list[Math.floor(list.length / 2)].start >= 16 * 60 : x.id === 'maariv';
      if (mins.length === 1) return mins[0] < 6 * 60 && x.period === 'pm' && night ? mins[0] + 1440 : mins[0];
      var opts = [mins[0], mins[1], mins[0] + 1440];
      if (near != null) return opts.sort(function (p, q) { return Math.abs(p - near) - Math.abs(q - near); })[0];
      if (x.period !== 'pm') return time.h === 12 ? mins[1] : mins[0];
      return time.h === 12 ? (night ? mins[0] + 1440 : mins[1]) : mins[1];
    }

    var target = tf, list, found, entry, desc, before, op = null; /* op: what was done, so that undo can do the opposite */
    if (a.action === 'add') {
      if (!tf) return say(L.needTefilla + EX.add[lang]);
      list = listOf(tf); entry = { start: placeNew(times[0], tf, null), room: room || '', note: '' };
      if (list.some(function (e) { return e.start === entry.start && e.room === entry.room; })) return say(L.exists(describe(tf, entry) + ', ' + dayWord));
      list.push(entry); desc = L.added + ': ' + describe(tf, entry); op = { kind: 'add', now: { start: entry.start, room: entry.room } };
    } else {
      found = find(times[0]);
      if (found.error) return say(found.error);
      target = found.tf; list = listOf(target); entry = list[found.idx]; before = describe(target, entry);
      /* the same minyan listed twice (two runs that meet) is one minyan: both lines go */
      var twins = list.filter(function (e) { return e !== entry && e.start === entry.start && e.room === entry.room; });
      list = list.filter(function (e) { return twins.indexOf(e) < 0; });
      if (a.action === 'cancel') { list.splice(list.indexOf(entry), 1); desc = L.cancelled + ': ' + before; op = { kind: 'cancel', was: { start: entry.start, room: entry.room, note: entry.note }, twins: twins.length }; }
      else {
        if (times.length < 2 && !room) return say(L.needNew + EX.move[lang]);
        var was = { start: entry.start, room: entry.room };
        if (times.length > 1) entry.start = placeNew(times[1], target, entry.start);
        if (room) entry.room = room;
        if (entry.start === was.start && entry.room === was.room) return say(L.same);
        desc = L.moved + ': ' + before + ' → ' + engine.fmtTime(entry.start) + (entry.room ? ' ' + entry.room : '');
        op = { kind: 'move', was: was, now: { start: entry.start, room: entry.room }, twins: twins.length };
      }
    }
    var out = writeDay(cfg, rd, todayRd, target, list, nowMs);
    var summary = desc + ', ' + dayWord + (rd > todayRd + 1 ? '' : ' (' + (lang === 'yi' ? YI_DAYS : EN_DAYS)[info.dow] + ')');
    return { reply: summary + '.\n' + L.soon + '\n' + L.undoHint, lang: lang, cfg: out, summary: summary,
      undo: { iso: iso, rd: rd, tefilla: target.id, op: op, summary: summary, at: nowMs } };
  }

  function lineOf(list) { return list.length ? list.slice().sort(function (p, q) { return p.start - q.start; }).map(function (e) { return hhmm(e.start) + (e.room ? ' ' + e.room : '') + (e.note ? ' // ' + e.note : ''); }).join('\n') : '# בוטל להיום'; }
  function sameList(p, q) { var k = function (l) { return l.map(function (e) { return e.start + '|' + (e.room || ''); }).sort().join(','); }; return k(p) === k(q); }
  /* Write a tefilla's list for one day, exactly as the This week tab does: the day gets a one-date schedule holding that tefilla's
     list. When the list is the regular one again (a change taken back), the line goes, and with the last line the day's own schedule. */
  function writeDay(cfg, rd, todayRd, tf, list, nowMs) {
    var out = JSON.parse(JSON.stringify(cfg)), iso = MinyanEngine.isoDate(rd);
    out.overrides = out.overrides || [];
    var ovr = out.overrides.filter(function (o) { return o.date === iso; })[0];
    if (!ovr) { ovr = { date: iso, label: rd === todayRd ? 'שינוי להיום' : 'שינוי', lines: {} }; out.overrides.push(ovr); }
    ovr.lines = ovr.lines || {};
    delete ovr.lines[tf.id];
    var regular = (MinyanEngine(out).scheduleFor(rd).byTefilla[tf.id] || []).map(function (e) { return { start: e.start, room: e.room || '' }; }); /* what that day has without a list of its own */
    if (!sameList(regular, list)) ovr.lines[tf.id] = lineOf(list);
    if (!Object.keys(ovr.lines).length) out.overrides = out.overrides.filter(function (o) { return o !== ovr; });
    out.savedAt = Math.max(nowMs, (cfg.savedAt || 0) + 1);
    return out;
  }

  /* Take one change back by doing its opposite on the day as it is now, so that changes made since (by another gabbai, or in the
     back end) stay: an added minyan is removed, a cancelled one put back, a moved one moved back. */
  function undo(cfg, rec, lang, nowMs) {
    var L = T[lang === 'yi' ? 'yi' : 'en'];
    if (!rec || !rec.iso || !rec.tefilla || !rec.op) return { reply: L.noUndo };
    var engine = MinyanEngine(cfg), now = nowMs || Date.now(), todayRd = Cal.nowInTz(now, engine.loc().tz).rd, rd = rec.rd;
    var tf = engine.tefillos().filter(function (t) { return t.id === rec.tefilla; })[0];
    if (!tf || rd < todayRd) return { reply: L.noUndo };
    var list = (engine.scheduleFor(rd).byTefilla[tf.id] || []).map(function (e) { return { start: e.start, room: e.room || '', note: e.note || '' }; }), op = rec.op, i;
    function at(x) { for (var k = 0; k < list.length; k++) if (list[k].start === x.start && list[k].room === (x.room || '')) return k; return -1; }
    if (op.kind === 'add') { i = at(op.now); if (i < 0) return { reply: L.noUndo }; list.splice(i, 1); }
    else if (op.kind === 'cancel') { if (at(op.was) >= 0) return { reply: L.noUndo }; for (i = 0; i <= (op.twins || 0); i++) list.push({ start: op.was.start, room: op.was.room || '', note: op.was.note || '' }); }
    else { i = at(op.now); if (i < 0) return { reply: L.noUndo }; list[i].start = op.was.start; list[i].room = op.was.room || ''; for (i = 0; i < (op.twins || 0); i++) list.push({ start: op.was.start, room: op.was.room || '', note: '' }); }
    return { reply: L.undone + ': ' + rec.summary + '.\n' + L.soon.split('.')[0] + '.', cfg: writeDay(cfg, rd, todayRd, tf, list, now) };
  }

  return { parse: parse, run: run, undo: undo, T: T };
})();
if (typeof module !== 'undefined') module.exports = MinyanEdit;
