/* notify.js — reminder subscriptions by text message and app notification. Pure logic, no platform code.
   Needs cal.js, engine.js and sms.js.
   Commands (SMS/WhatsApp):  REMIND MINCHA [5:45] [15]  ·  DAILY [6:30]  ·  REMIND LIST  ·  REMIND OFF
   A subscription: { lang, reminders: [{tefilla, time: minutes|null, lead}], daily: minutes|null, channel: 'sms'|'whatsapp'|'push', to, push } */
var MinyanNotify = (function () {
  'use strict';
  var T = {
    he: { set: 'תזכורת נקבעה: ', before: ' דק׳ לפני ', first: 'המנין הראשון של ', at: ' של ', daily: 'הלוח היומי יישלח כל בוקר ב-', none: 'אין תזכורות פעילות.', list: 'התזכורות שלך:', off: 'כל התזכורות בוטלו.',
      unknown: 'לא זיהיתי את התפילה. שלחו למשל: תזכורת מנחה 5:45 15 (15 דקות לפני מנחה של 5:45), או: יומי 6:30', remind: 'תזכורת', inMin: 'בעוד', min: 'דק׳', notAvail: 'תזכורות אינן זמינות במספר הזה.' },
    en: { set: 'Reminder set: ', before: ' min before ', first: 'the first ', at: ' at ', daily: 'Daily schedule every morning at ', none: 'No active reminders.', list: 'Your reminders:', off: 'All reminders cancelled.',
      unknown: 'Tefilla not recognized. Examples: REMIND MINCHA 5:45 15 (15 min before the 5:45 Mincha), REMIND SHACHARIS (first Shacharis), DAILY 6:30', remind: 'Reminder', inMin: 'in', min: 'min', notAvail: 'Reminders are not available on this number.' }
  };
  var EN_TEFILLA = { shacharis: 'Shacharis', mincha: 'Mincha', maariv: 'Maariv' };
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
  /* Parse a command. Returns {action: 'add'|'daily'|'list'|'off'|'help', ...} or null when it is not a command. */
  function parseCommand(text, cfg) {
    var t = norm(text); if (!isCommand(t)) return null;
    var lang = hasHebrew(text) ? 'he' : 'en', w = t.split(' ');
    if (/^(daily|יומי)$/.test(w[0])) { var at = w[1] ? parseClock(w[1], false) : 6 * 60; return at == null ? { action: 'help', lang: lang } : { action: 'daily', at: at, lang: lang }; }
    if (w[0] === 'ביטול' || /^(off|stop|cancel|none|ביטול|בטל)$/.test(w[1] || '')) return { action: 'off', lang: lang };
    if (/^(list|רשימה|status)$/.test(w[1] || '')) return { action: 'list', lang: lang };
    if (!w[1]) return { action: 'help', lang: lang };
    var tf = tefillaFrom(w[1], cfg); if (!tf) return { action: 'help', lang: lang };
    var time = null, lead = 10, i;
    for (i = 2; i < w.length; i++) {
      if (/^\d{1,2}:\d{2}$/.test(w[i])) time = parseClock(w[i], tf.period === 'pm');
      else if (/^\d{1,3}$/.test(w[i])) { if (time == null && +w[i] <= 12 && i === 2 && w[i + 1] && /^\d{1,3}$/.test(w[i + 1])) time = parseClock(w[i], tf.period === 'pm'); else lead = Math.min(180, Math.max(1, +w[i])); }
    }
    return { action: 'add', tefilla: tf.id, time: time, lead: lead, lang: lang };
  }
  function describe(cfg, r, lang) {
    var L = T[lang], name = lang === 'en' && EN_TEFILLA[r.tefilla] ? EN_TEFILLA[r.tefilla] : (cfg.tefillos.filter(function (x) { return x.id === r.tefilla; })[0] || {}).name || r.tefilla;
    return r.lead + L.before + (r.time == null ? L.first + name : name + L.at + fmt(cfg, r.time));
  }
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
    sub.reminders = sub.reminders.filter(function (r) { return !(r.tefilla === cmd.tefilla && r.time === cmd.time); });
    sub.reminders.push({ tefilla: cmd.tefilla, time: cmd.time, lead: cmd.lead });
    return L.set + describe(cfg, sub.reminders[sub.reminders.length - 1], cmd.lang) + '.';
  }
  /* Which messages are due in [nowMs, nowMs + windowMin). Each: {key, text, title, minyan} — the caller sends and remembers `key`. */
  function due(cfg, sub, nowMs, windowMin) {
    var engine = MinyanEngine(cfg), tz = engine.loc().tz, now = Cal.nowInTz(nowMs, tz), rd = now.rd, sched = engine.scheduleFor(rd), out = [];
    var win = (windowMin || 5) * 60000, lang = sub.lang || 'he', L = T[lang], iso = MinyanEngine.isoDate(rd);
    (sub.reminders || []).forEach(function (r) {
      var list = sched.byTefilla[r.tefilla] || [];
      if (!list.length) return;
      var target = list[0];
      if (r.time != null) {
        var best = null, bestD = 1e9;
        list.forEach(function (e) { var d = Math.abs(e.start - r.time); if (d < bestD) { bestD = d; best = e; } });
        if (!best || bestD > 45) return;
        target = best;
      }
      var fireAt = target.ms - r.lead * 60000;
      if (fireAt < nowMs || fireAt >= nowMs + win) return;
      var mins = Math.max(1, Math.round((target.ms - nowMs) / 60000));
      var name = lang === 'en' && EN_TEFILLA[r.tefilla] ? EN_TEFILLA[r.tefilla] : target.tefilla.name;
      var text = name + (target.room ? ' – ' + target.room : '') + ' ' + engine.fmtTime(target.start) + (target.tefilla.milestone ? ' (' + target.tefilla.milestone + ' ' + engine.fmtTime(target.milestone) + ')' : '') + ', ' + L.inMin + ' ' + mins + ' ' + L.min;
      out.push({ key: 'r:' + iso + ':' + r.tefilla + ':' + target.start, title: L.remind + ': ' + name, text: (lang === 'he' ? 'תזכורת: ' : 'Reminder: ') + text, minyan: target });
    });
    if (sub.daily != null) {
      var dailyMs = Cal.epochFromWall(rd, sub.daily, tz);
      if (dailyMs >= nowMs && dailyMs < nowMs + win) out.push({ key: 'd:' + iso, title: lang === 'he' ? 'הלוח להיום' : "Today's minyanim", text: MinyanSms.buildReply(cfg, lang === 'he' ? 'היום' : 'today', nowMs).text });
    }
    return out;
  }
  return { isCommand: isCommand, parseCommand: parseCommand, apply: apply, due: due, T: T };
})();
if (typeof module !== 'undefined') module.exports = MinyanNotify;
