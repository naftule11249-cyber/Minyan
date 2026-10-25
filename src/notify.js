/* notify.js — reminder subscriptions by text message and app notification. Pure logic, no platform code.
   Needs cal.js, engine.js and sms.js.
   Commands (SMS/WhatsApp):  REMIND MINCHA [5:45] [15] [TODAY]  ·  REMIND SHACHARIS LAST  ·  REMIND SHACHARIS BEFORE CHATZOS  ·  DAILY [6:30]  ·  REMIND LIST  ·  REMIND OFF
   A subscription: { lang, reminders: [{tefilla, time: minutes|null, pick: 'first'|'last'|'before:<zman>' (when time is null), lead, once: 'YYYY-MM-DD' (today only)}],
                     daily: minutes|null, channel: 'sms'|'whatsapp'|'push', to, push } */
var MinyanNotify = (function () {
  'use strict';
  var T = {
    he: { set: 'תזכורת נקבעה: ', before: ' דק׳ לפני ', first: 'המנין הראשון של ', last: 'המנין האחרון של ', beforeZman: ' לפני ', at: ' של ', today: ' (היום בלבד)', daily: 'הלוח היומי יישלח כל בוקר ב-', none: 'אין תזכורות פעילות.', list: 'התזכורות שלך:', off: 'כל התזכורות בוטלו.',
      unknown: 'לא זיהיתי את הבקשה. דוגמאות: תזכורת מנחה 5:45 15 (15 דקות לפני מנחה של 5:45) · תזכורת שחרית אחרון · תזכורת שחרית לפני חצות · תזכורת שחרית לפני סוף זמן תפילה · תזכורת מנחה לפני שקיעה · תזכורת מנחה 5:45 היום (היום בלבד) · תזכורת שקיעה 20 · תזכורת סוף זמן ק״ש 15 · יומי 6:30', remind: 'תזכורת', inMin: 'בעוד', min: 'דק׳', notAvail: 'תזכורות אינן זמינות במספר הזה.' },
    en: { set: 'Reminder set: ', before: ' min before ', first: 'the first ', last: 'the last ', beforeZman: ' before ', at: ' at ', today: ' (today only)', daily: 'Daily schedule every morning at ', none: 'No active reminders.', list: 'Your reminders:', off: 'All reminders cancelled.',
      unknown: 'Not recognized. Examples: REMIND MINCHA 5:45 15 (15 min before the 5:45 Mincha) · REMIND SHACHARIS LAST · REMIND SHACHARIS BEFORE CHATZOS · REMIND SHACHARIS BEFORE TEFILLA (sof zman tefilla) · REMIND MINCHA BEFORE SUNSET · REMIND MINCHA 5:45 TODAY (today only) · REMIND SHKIA 20 · REMIND SHEMA 15 (zmanim) · DAILY 6:30', remind: 'Reminder', inMin: 'in', min: 'min', notAvail: 'Reminders are not available on this number.' }
  };
  var EN_TEFILLA = { shacharis: 'Shacharis', mincha: 'Mincha', maariv: 'Maariv' };
  /* "before <zman>" words people may text; the keys are zmanim from cal.js */
  var ZMAN_WORDS = { chatzos: ['chatzos', 'chatzot', 'חצות'], tefilla: ['tefilla', 'tefila', 'tefillah', 'תפילה', 'תפלה'], shema: ['shema', 'shma', 'שמע', 'קש'],
    sunset: ['sunset', 'shkia', 'shkiah', 'shkiya', 'שקיעה'], tzeis: ['tzeis', 'tzais', 'tzet', 'nightfall', 'maariv', 'מעריב', 'צאת'], plag: ['plag', 'פלג'], minchag: ['minchag', 'gedola', 'גדולה'],
    alos: ['alos', 'alot', 'dawn', 'עלות'], sunrise: ['sunrise', 'netz', 'neitz', 'נץ', 'הנץ'], candles: ['candles', 'candle', 'licht', 'הדלקה', 'הדלקת'], tzeis60: ['tzeis60', 'צאת60', 'sixty'], tzeis72: ['rt', 'rabbeinu', 'רת', 'רבינו'] };
  /* zmanim people can be reminded of directly ("REMIND SHKIA 20"), in the board's order */
  var ZMAN_KEYS = ['alos', 'sunrise', 'shema', 'tefilla', 'chatzos', 'minchag', 'plag', 'candles', 'sunset', 'tzeis', 'tzeis60', 'tzeis72'];
  var ZMAN_EN = { alos: 'alos hashachar', sunrise: 'netz (sunrise)', shema: 'sof zman Shema', tefilla: 'sof zman tefilla', chatzos: 'chatzos', minchag: 'mincha gedola', plag: 'plag hamincha', candles: 'candle lighting', sunset: 'shkia (sunset)', tzeis: 'tzeis (nightfall)', tzeis60: 'tzeis (60)', tzeis72: 'Rabbeinu Tam (72)' };
  function zmanName(k, lang) { return lang === 'en' ? (ZMAN_EN[k] || k) : ((typeof Cal !== 'undefined' && Cal.ZMAN_NAMES && Cal.ZMAN_NAMES[k]) || k); }
  var ZMAN_LABEL = { he: { chatzos: 'חצות', tefilla: 'סוף זמן תפילה', shema: 'סוף זמן ק״ש', sunset: 'שקיעה', tzeis: 'זמן מעריב', plag: 'פלג המנחה', minchag: 'מנחה גדולה' },
    en: { chatzos: 'chatzos', tefilla: 'sof zman tefilla', shema: 'sof zman Shema', sunset: 'sunset', tzeis: 'zman Maariv', plag: 'plag hamincha', minchag: 'mincha gedola' } };
  function zmanWord(w) { var k; for (k in ZMAN_WORDS) if (ZMAN_WORDS[k].indexOf(w) >= 0) return k; return null; }
  function hasHebrew(s) { return /[֐-׿]/.test(s); }
  function norm(text) { return (text || '').trim().toLowerCase().replace(/[.!?'"״׳,]/g, '').replace(/\s+/g, ' '); }
  function isCommand(text) { var t = norm(text); return /^(remind|reminder|reminders|תזכורת|תזכורות|daily|יומי|ביטול)(\s|$)/.test(t); }
  function tefillaFrom(word, cfg) {
    var k = MinyanSms.keyword(word), t = null;
    (cfg.tefillos || []).forEach(function (x) { if (x.id === k || x.name === word) t = x; });
    return t;
  }
  function parseClock(tok, pm) {
    var m = /^(\d{1,2})(?::(\d{2}))?$/.exec(tok || ''); if (!m) return null;
    var h = +m[1], mi = +(m[2] || 0); if (h > 23 || mi > 59) return null;
    if (pm && h >= 1 && h < 12) h += 12;
    return h * 60 + mi;
  }
  function fmt(cfg, min) { return MinyanEngine(cfg).fmtTime(min); }
  function todayIso(cfg, nowMs) { return MinyanEngine.isoDate(Cal.nowInTz(nowMs || Date.now(), MinyanEngine(cfg).loc().tz).rd); }
  /* Parse a command. Returns {action: 'add'|'daily'|'list'|'off'|'help', ...} or null when it is not a command. nowMs is only needed for TODAY. */
  function parseCommand(text, cfg, nowMs) {
    var t = norm(text); if (!isCommand(t)) return null;
    var lang = hasHebrew(text) ? 'he' : 'en', w = t.split(' ');
    if (/^(daily|יומי)$/.test(w[0])) { var at = w[1] ? parseClock(w[1], false) : 6 * 60; return at == null ? { action: 'help', lang: lang } : { action: 'daily', at: at, lang: lang }; }
    if (w[0] === 'ביטול' || /^(off|stop|cancel|none|ביטול|בטל)$/.test(w[1] || '')) return { action: 'off', lang: lang };
    if (/^(list|רשימה|status)$/.test(w[1] || '')) return { action: 'list', lang: lang };
    if (!w[1]) return { action: 'help', lang: lang };
    var tf = tefillaFrom(w[1], cfg), time = null, lead = 10, pick = null, once = null, ref = null, i, j, z, zk = null, from = 2;
    if (!tf) {
      /* a zman instead of a tefilla: "remind shkia 20", "תזכורת סוף זמן קריאת שמע 15" (the zman word may be a few words in) */
      for (j = 1; j < w.length && j <= 4 && !zk; j++) { zk = zmanWord(w[j]); if (zk) from = j + 1; }
      if (!zk) return { action: 'help', lang: lang };
      for (i = from; i < w.length; i++) {
        if (/^\d{1,3}$/.test(w[i])) lead = Math.min(180, Math.max(1, +w[i]));
        else if (/^(today|היום)$/.test(w[i])) once = todayIso(cfg, nowMs);
      }
      var zc = { action: 'add', zman: zk, lead: lead, lang: lang };
      if (once) zc.once = once;
      return zc;
    }
    for (i = 2; i < w.length; i++) {
      if (/^\d{1,2}:\d{2}$/.test(w[i])) time = parseClock(w[i], tf.period === 'pm');
      else if (/^\d{1,3}$/.test(w[i])) { if (time == null && +w[i] <= 12 && i === 2 && w[i + 1] && /^\d{1,3}$/.test(w[i + 1])) time = parseClock(w[i], tf.period === 'pm'); else lead = Math.min(180, Math.max(1, +w[i])); }
      else if (/^(last|אחרון|אחרונה|האחרון)$/.test(w[i])) pick = 'last';
      else if (/^(first|ראשון|הראשון)$/.test(w[i])) pick = 'first';
      else if (/^(today|היום)$/.test(w[i])) once = todayIso(cfg, nowMs);
      else if (/^(hodu|milestone|הודו)$/.test(w[i]) || (tf.milestone && w[i] === norm(tf.milestone))) ref = 'milestone'; /* count to הודו instead of the start */
      else if (/^(start|ברכות)$/.test(w[i])) ref = 'start';
      else if (/^(before|לפני)$/.test(w[i])) {
        /* "before chatzos", "before sof zman tefilla", "לפני זמן מעריב": the zman word may come a word or two later */
        z = null;
        for (j = i + 1; j < w.length && j <= i + 3 && !z; j++) { z = zmanWord(w[j]); if (z) i = j; }
        if (!z) return { action: 'help', lang: lang };
        pick = 'before:' + z;
      }
    }
    var cmd = { action: 'add', tefilla: tf.id, time: time, lead: lead, lang: lang };
    if (pick && time == null) cmd.pick = pick;
    if (once) cmd.once = once;
    if (ref === 'milestone' && tf.milestone) cmd.ref = 'milestone';
    return cmd;
  }
  function describe(cfg, r, lang) {
    var L = T[lang], tdef = cfg.tefillos.filter(function (x) { return x.id === r.tefilla; })[0] || {}, name = lang === 'en' && EN_TEFILLA[r.tefilla] ? EN_TEFILLA[r.tefilla] : tdef.name || r.tefilla, what;
    if (r.zman) what = zmanName(r.zman, lang);
    else if (r.time != null) what = name + L.at + fmt(cfg, r.time);
    else if (r.pick === 'last') what = L.last + name;
    else if (r.pick && r.pick.indexOf('before:') === 0) what = L.last + name + L.beforeZman + (ZMAN_LABEL[lang][r.pick.slice(7)] || r.pick.slice(7));
    else what = L.first + name;
    return r.lead + L.before + what + (r.ref === 'milestone' && tdef.milestone ? ' (' + tdef.milestone + ')' : '') + (r.once ? L.today : '');
  }
  function sameTarget(a, b) { if (a.zman || b.zman) return a.zman === b.zman; return a.tefilla === b.tefilla && (a.time == null ? b.time == null && (a.pick || 'first') === (b.pick || 'first') : a.time === b.time); }
  /* Apply a parsed command to a subscription object (mutated). Returns the reply text. */
  function apply(cmd, sub, cfg) {
    var L = T[cmd.lang];
    sub.lang = cmd.lang; sub.reminders = sub.reminders || [];
    if (cmd.action === 'help') return L.unknown;
    if (cmd.action === 'off') { sub.reminders = []; sub.daily = null; return L.off; }
    if (cmd.action === 'list') {
      var lines = sub.reminders.map(function (r) { return '• ' + describe(cfg, r, cmd.lang); });
      if (sub.daily != null) lines.push('• ' + L.daily + fmt(cfg, sub.daily));
      return lines.length ? L.list + '\n' + lines.join('\n') : L.none;
    }
    if (cmd.action === 'daily') { sub.daily = cmd.at; return L.daily + fmt(cfg, cmd.at) + '.'; }
    var r = cmd.zman ? { zman: cmd.zman, lead: cmd.lead } : { tefilla: cmd.tefilla, time: cmd.time, lead: cmd.lead };
    if (cmd.pick) r.pick = cmd.pick;
    if (cmd.ref) r.ref = cmd.ref;
    if (cmd.once) r.once = cmd.once;
    sub.reminders = sub.reminders.filter(function (x) { return !sameTarget(x, r); });
    sub.reminders.push(r);
    return L.set + describe(cfg, r, cmd.lang) + '.';
  }
  /* The minyan a reminder means on a given day: a set time (nearest, within 45 minutes), the first, the last, or the last that starts before a zman. */
  function targetFor(list, r, zmanim) {
    if (!list || !list.length) return null;
    if (r.time != null) {
      var best = null, bestD = 1e9;
      list.forEach(function (e) { var d = Math.abs(e.start - r.time); if (d < bestD) { bestD = d; best = e; } });
      return bestD > 45 ? null : best;
    }
    var p = r.pick || 'first';
    if (p === 'last') return list[list.length - 1];
    if (p.indexOf('before:') === 0) {
      var lim = zmanim ? zmanim[p.slice(7)] : NaN, c;
      if (lim == null || isNaN(lim)) return null;
      c = list.filter(function (e) { return e.start < lim; });
      return c.length ? c[c.length - 1] : null;
    }
    return list[0];
  }
  /* Drop "today only" reminders whose day has passed. Returns true when something was removed. */
  function prune(cfg, sub, nowMs) {
    var iso = todayIso(cfg, nowMs), before = (sub.reminders || []).length;
    sub.reminders = (sub.reminders || []).filter(function (r) { return !r.once || r.once >= iso; });
    return sub.reminders.length !== before;
  }
  /* Which messages are due in [nowMs, nowMs + windowMin). Each: {key, text, title, minyan} — the caller sends and remembers `key`. */
  function due(cfg, sub, nowMs, windowMin) {
    var engine = MinyanEngine(cfg), tz = engine.loc().tz, now = Cal.nowInTz(nowMs, tz), rd = now.rd, sched = engine.scheduleFor(rd), zmanim = engine.zmanimFor(rd), out = [];
    var win = (windowMin || 5) * 60000, lang = sub.lang || 'he', L = T[lang], iso = MinyanEngine.isoDate(rd);
    (sub.reminders || []).forEach(function (r) {
      if (r.once && r.once !== iso) return;
      if (r.zman) {
        /* a zman of the day; candle lighting only on a day that has it */
        if (r.zman === 'candles' && !(sched.info.dow === 5 || sched.info.erevYT)) return;
        var zm = zmanim[r.zman];
        if (zm == null || isNaN(zm)) return;
        var zMs = Cal.epochFromWall(rd, Math.round(zm), tz), zFire = zMs - r.lead * 60000;
        if (zFire < nowMs || zFire >= nowMs + win) return;
        var zMins = Math.max(1, Math.round((zMs - nowMs) / 60000)), zn = zmanName(r.zman, lang);
        out.push({ key: 'z:' + iso + ':' + r.zman, title: L.remind + ': ' + zn, text: (lang === 'he' ? 'תזכורת: ' : 'Reminder: ') + zn + ' ' + engine.fmtTime(zm) + ', ' + L.inMin + ' ' + zMins + ' ' + L.min });
        return;
      }
      var target = targetFor(sched.byTefilla[r.tefilla] || [], r, zmanim);
      if (!target) return;
      /* count to the start, or to the milestone (הודו) when the reminder says so */
      var toMs = r.ref === 'milestone' && target.tefilla.milestone, at = toMs ? target.ms + (+target.tefilla.offset || 0) * 60000 : target.ms;
      var fireAt = at - r.lead * 60000;
      if (fireAt < nowMs || fireAt >= nowMs + win) return;
      var mins = Math.max(1, Math.round((at - nowMs) / 60000));
      var name = lang === 'en' && EN_TEFILLA[r.tefilla] ? EN_TEFILLA[r.tefilla] : target.tefilla.name;
      var times = toMs ? target.tefilla.milestone + ' ' + engine.fmtTime(target.milestone) + ' (' + (target.tefilla.startLabel || (lang === 'en' ? 'start' : 'התחלה')) + ' ' + engine.fmtTime(target.start) + ')'
        : engine.fmtTime(target.start) + (target.tefilla.milestone ? ' (' + target.tefilla.milestone + ' ' + engine.fmtTime(target.milestone) + ')' : '');
      var text = name + (target.room ? ' – ' + target.room : '') + ' ' + times + ', ' + L.inMin + ' ' + mins + ' ' + L.min;
      out.push({ key: 'r:' + iso + ':' + r.tefilla + ':' + target.start, title: L.remind + ': ' + name, text: (lang === 'he' ? 'תזכורת: ' : 'Reminder: ') + text, minyan: target });
    });
    if (sub.daily != null) {
      var dailyMs = Cal.epochFromWall(rd, sub.daily, tz);
      if (dailyMs >= nowMs && dailyMs < nowMs + win) out.push({ key: 'd:' + iso, title: lang === 'he' ? 'הלוח להיום' : "Today's minyanim", text: MinyanSms.buildReply(cfg, lang === 'he' ? 'היום' : 'today', nowMs).text });
    }
    return out;
  }
  return { isCommand: isCommand, parseCommand: parseCommand, apply: apply, due: due, prune: prune, targetFor: targetFor, describe: describe, T: T, ZMAN_LABEL: ZMAN_LABEL, ZMAN_KEYS: ZMAN_KEYS, ZMAN_EN: ZMAN_EN };
})();
if (typeof module !== 'undefined') module.exports = MinyanNotify;
