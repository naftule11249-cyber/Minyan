/* shere.js — the barber's (שערן) hours for the week, answered in Yiddish to anyone who texts "שערן". Needs cal.js and engine.js.
   Settings live in cfg.shere (edited on the admin page's Shere tab):
     on: answer the words below          words: 'שערן, שערען, ...' (comma separated)
     week: [Sunday .. Friday] of { open, from, until ('' = automatic, before the zman), kids }; a time is 'HH:MM' or a zman like 'sunset-30'
     zman: 'candles' | 'sunset'           before: minutes before the zman Erev Shabbos / Erev Yom Tov closes      round: round down to N minutes
     days: { 'YYYY-MM-DD': { closed, from, until, kids:'yes'|'no', note } }  one day different from the regular hours
     note: a line added at the end of every answer
   MinyanShere.reply(cfg, text, nowMs) -> the answer, or null when the text is not one of the words. */
var MinyanShere = (function () {
  'use strict';
  var DEFAULT_WEEK = [
    { open: true, from: '10:00', until: '20:00', kids: true }, { open: true, from: '10:00', until: '20:00', kids: true },
    { open: true, from: '10:00', until: '20:00', kids: true }, { open: true, from: '10:00', until: '20:00', kids: true },
    { open: true, from: '10:00', until: '21:00', kids: true }, { open: true, from: '08:00', until: '', kids: false }];
  var DEFAULTS = { on: false, words: 'שערן, שערען, שער, shere, sheren', week: DEFAULT_WEEK, zman: 'candles', before: 60, round: 5, days: {}, note: '' };
  var Y_DAYS = ['זונטאג', 'מאנטאג', 'דינסטאג', 'מיטוואך', 'דאנערשטאג', 'פרייטאג', 'שבת'];
  function settings(cfg) {
    var s = cfg && cfg.shere ? cfg.shere : {}, out = {}, k;
    for (k in DEFAULTS) out[k] = s[k] == null ? DEFAULTS[k] : s[k];
    out.week = DEFAULT_WEEK.map(function (w, i) { var o = {}, x = (s.week || [])[i] || {}, j; for (j in w) o[j] = x[j] == null ? w[j] : x[j]; return o; });
    out.days = s.days || {};
    return out;
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  /* a time is a clock time ('10:00') or a zman with minutes before or after it ('sunset-30', 'chatzos', 'tzeis+10') */
  var ZMANIM = ['alos', 'sunrise', 'shema', 'tefilla', 'chatzos', 'minchag', 'minchak', 'plag', 'candles', 'sunset', 'tzeis', 'tzeis72'];
  function parse(t) {
    t = String(t || '').trim();
    var m = /^(\d{1,2}):(\d{2})$/.exec(t);
    if (m) return { min: +m[1] * 60 + +m[2] };
    m = /^([a-z0-9]+)\s*(?:([+-])\s*(\d+))?$/i.exec(t);
    if (m && ZMANIM.indexOf(m[1]) >= 0) return { zman: m[1], off: m[2] ? (m[2] === '-' ? -1 : 1) * +m[3] : 0 };
    return null;
  }
  function valid(t) { return !!parse(t); }
  /* minutes after midnight on that day; a zman time is rounded to the shere's rounding (a start up, an end down) */
  function resolve(cfg, rd, t, up) {
    var p = parse(t), r = Math.max(1, +settings(cfg).round || 1);
    if (!p) return null;
    if (p.min != null) return p.min;
    var z = MinyanEngine(cfg).zmanimFor(rd)[p.zman];
    if (!isFinite(z)) return null;
    var v = Math.round(z) + p.off;
    return up ? Math.ceil(v / r) * r : Math.floor(v / r) * r;
  }
  function iso(rd) { var g = Cal.gregFromRD(rd); return g.y + '-' + pad2(g.m) + '-' + pad2(g.d); }
  function hebDate(rd) { var h = Cal.hebFromRD(rd); return Cal.gematria(h.d) + ' ' + Cal.monthName(h.y, h.m); }
  /* what the evening brings in, for a day whose candles are lit before sunset */
  function erevName(info, next) {
    var own = info.labels.filter(function (l) { return /^ערב /.test(l) || /הושענא/.test(l); })[0];
    if (own) return own;
    if (info.heb.m === 1 && info.heb.d === 20) return 'ערב שביעי של פסח';
    return next.labels[0] ? 'ערב ' + next.labels[0] : 'ערב יום טוב';
  }
  /* one day: null on Shabbos and Yom Tov, otherwise its hours (useDay false = the regular hours, without that day's change) */
  function day(cfg, rd, useDay) {
    var s = settings(cfg), israel = !!cfg.israel, info = Cal.dayInfo(rd, israel), next = Cal.dayInfo(rd + 1, israel), dow = info.dow;
    if (info.shabbos || info.yomtov) return null;
    var erev = info.candles === 'day', label = Y_DAYS[dow];
    if (dow === 5) {
      if (next.yomtov) label = 'ערב שבת, ' + erevName(info, next);
      else if (next.cholHamoed) label = 'ערב שבת חול המועד';
      else { var p = Cal.parshaForShabbos(rd + 1, israel); label = 'ערב שבת' + (p ? ' פרשת ' + p.map(function (i) { return Cal.PARSHIOS[i]; }).join('-') : ''); }
    } else if (erev) label = Y_DAYS[dow] + ', ' + erevName(info, next);
    var engine = MinyanEngine(cfg), z = engine.zmanimFor(rd), zm = s.zman === 'sunset' ? z.sunset : z.candles, r = Math.max(1, +s.round || 1);
    var auto = isFinite(zm) ? Math.floor((Math.floor(zm) - (+s.before || 0)) / r) * r : null;
    var w = s.week[dow], base = w.open ? w : s.week[5]; /* an Erev Yom Tov on a day that is normally closed opens with Friday's hours */
    var fromSpec = valid(base.from) ? base.from : '10:00', untilSpec = (erev && !(dow === 5 && valid(w.until))) || !valid(w.until) ? '' : w.until;
    var o = { rd: rd, date: iso(rd), dow: dow, label: label, heb: hebDate(rd), erev: erev, open: w.open || erev, auto: auto,
      fromSpec: fromSpec, untilSpec: untilSpec, from: resolve(cfg, rd, fromSpec, true), until: untilSpec ? resolve(cfg, rd, untilSpec, false) : auto,
      kids: !!base.kids, note: '', changed: false };
    var c = useDay === false ? null : s.days[o.date];
    if (c) {
      o.changed = true;
      if (valid(c.from)) { o.fromSpec = c.from; o.from = resolve(cfg, rd, c.from, true); }
      if (valid(c.until)) { o.untilSpec = c.until; o.until = resolve(cfg, rd, c.until, false); }
      if (c.kids === 'yes') o.kids = true; else if (c.kids === 'no') o.kids = false;
      if (c.closed) o.open = false; else if (c.from || c.until) o.open = true;
      o.note = c.note || '';
    }
    return o;
  }
  /* the days left this week: today while it is still open, through Friday */
  function week(cfg, nowMs) {
    var tz = MinyanEngine(cfg).loc().tz, now = Cal.nowInTz(nowMs, tz), rd = now.rd, t = day(cfg, rd), out = [];
    if (!t || !t.open || t.until == null || now.min >= t.until) rd++;
    for (var i = 0; i < 8; i++, rd++) {
      var x = day(cfg, rd);
      if (x && (x.open || x.changed)) out.push(x);
      if (Cal.mod(rd, 7) === 5) break;
    }
    return { today: now.rd, days: out };
  }
  function text(cfg, nowMs) {
    var s = settings(cfg), w = week(cfg, nowMs), engine = MinyanEngine(cfg), lines = [], i, j;
    function hours(x) { return 'פון ' + engine.fmtTime(x.from) + ' ביז ' + engine.fmtTime(x.until) + ', ' + (x.kids ? 'אויך קינדער' : 'נישט פאר קינדער'); }
    function name(x) { return (x.rd === w.today ? 'היינט, ' : '') + x.label + (x.erev ? ' (' + x.heb + ')' : ''); }
    for (i = 0; i < w.days.length; i++) {
      var x = w.days[i];
      if (!x.open) { lines.push(name(x) + ': נישטא קיין שערן' + (x.note ? '. ' + x.note : '')); continue; }
      if (x.from == null || x.until == null || x.from >= x.until) continue;
      j = i; /* plain weekdays in a row with the same hours: "זונטאג ביז מיטוואך" */
      if (!x.erev && !x.note) while (w.days[j + 1] && !w.days[j + 1].erev && !w.days[j + 1].note && w.days[j + 1].open && w.days[j + 1].rd === w.days[j].rd + 1 && hours(w.days[j + 1]) === hours(x)) j++;
      lines.push((j > i ? name(x) + ' ביז ' + w.days[j].label : name(x)) + ': ' + hours(x) + (x.note ? '. ' + x.note : ''));
      i = j;
    }
    var out = lines.length ? 'שערן די וואך:\n' + lines.join('\n') : 'די וואך איז נישטא מער קיין שערן.';
    if (String(s.note || '').trim()) out += '\n' + String(s.note).trim();
    return out;
  }
  function norm(t) { return String(t || '').toLowerCase().replace(/[.!?,'"״׳:;\-]/g, '').replace(/\s+/g, ' ').trim(); }
  function wants(cfg, body) {
    var s = settings(cfg);
    if (!s.on) return false;
    var b = norm(body);
    return !!b && String(s.words || '').split(',').map(norm).filter(Boolean).indexOf(b) >= 0;
  }
  function reply(cfg, body, nowMs) { return wants(cfg, body) ? text(cfg, nowMs) : null; }
  return { DEFAULTS: DEFAULTS, ZMANIM: ZMANIM, parse: parse, valid: valid, resolve: resolve, settings: settings, day: day, week: week, text: text, wants: wants, reply: reply, iso: iso };
})();
if (typeof module !== 'undefined') module.exports = MinyanShere;
