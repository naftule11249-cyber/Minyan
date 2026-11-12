/* shere.js — the barber's (שערן) hours for the week, answered in Yiddish to anyone who texts "שערן". Needs cal.js and engine.js.
   Settings live in cfg.shere (edited on the admin page's Shere tab):
     on: answer the words below          words: 'שערן, שערען, ...' (comma separated)
     week: [Sunday .. Friday] of { open, ranges: [{ from, until, kids }] } — one or more sets of hours a day (Friday morning and afternoon);
       a time is 'HH:MM' or a zman like 'sunset-30'; an "until" of '' is automatic: the Erev Shabbos rule below
     zman: 'candles' | 'sunset'           before: minutes before the zman Erev Shabbos / Erev Yom Tov closes      round: zman times round to N minutes
     days: { 'YYYY-MM-DD': { closed, ranges, note } }  one day different from the regular hours
     prices: { adult, kid, ytAdult, ytKid, ytDays } — the price goes up from ytDays before Yom Tov through Erev Yom Tov; a day can have price: { adult, kid }
     note: a line added at the end of every answer
   MinyanShere.reply(cfg, text, nowMs) -> the answer, or null when the text is not one of the words. */
var MinyanShere = (function () {
  'use strict';
  function wk(from, until, kids) { return { open: true, ranges: [{ from: from, until: until, kids: kids }] }; }
  var DEFAULT_WEEK = [wk('10:00', '20:00', true), wk('10:00', '20:00', true), wk('10:00', '20:00', true), wk('10:00', '20:00', true), wk('10:00', '21:00', true),
    { open: true, ranges: [{ from: '09:00', until: '10:00', kids: false }, { from: '12:30', until: '', kids: false }] }]; /* Friday as on the shere sheet: morning, and afternoon until 1:15 before candle lighting */
  var DEFAULTS = { prices: { adult: '', kid: '', ytAdult: '', ytKid: '', ytDays: 0 }, on: false, words: 'שערן, שערען, שער, shere, sheren', week: DEFAULT_WEEK, zman: 'candles', before: 75, round: 1, days: {}, note: '' };
  var Y_DAYS = ['זונטאג', 'מאנטאג', 'דינסטאג', 'מיטוואך', 'דאנערשטאג', 'פרייטאג', 'שבת'];
  function copyRanges(list) { return list.map(function (r) { return { from: r.from || '', until: r.until == null ? '' : r.until, kids: !!r.kids }; }); }
  /* the sets of hours of a week day or a changed day; an older single { from, until, kids } is read as one set */
  function rangesOf(x, fallback) {
    if (x && x.ranges) return copyRanges(x.ranges);
    if (x && (x.from || x.until || (x.kids != null && x.kids !== ''))) {
      var f = (fallback && fallback[0]) || {}, k = x.kids === 'yes' ? true : x.kids === 'no' ? false : x.kids == null || x.kids === '' ? !!f.kids : !!x.kids;
      return [{ from: x.from || f.from || '10:00', until: x.until || (fallback && fallback.length ? fallback[fallback.length - 1].until : '') || '', kids: k }];
    }
    return fallback ? copyRanges(fallback) : [];
  }
  function settings(cfg) {
    var s = cfg && cfg.shere ? cfg.shere : {}, out = {}, k;
    for (k in DEFAULTS) out[k] = s[k] == null ? DEFAULTS[k] : s[k];
    out.week = DEFAULT_WEEK.map(function (w, i) { var x = (s.week || [])[i]; return { open: x && x.open != null ? !!x.open : w.open, ranges: rangesOf(x, w.ranges) }; });
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
  /* one day: null on Shabbos and Yom Tov, otherwise its sets of hours (useDay false = the regular hours, without that day's change) */
  function day(cfg, rd, useDay) {
    var s = settings(cfg), israel = !!cfg.israel, info = Cal.dayInfo(rd, israel), next = Cal.dayInfo(rd + 1, israel), dow = info.dow;
    if (info.shabbos || info.yomtov) return null;
    var erev = info.candles === 'day', label = Y_DAYS[dow];
    if (dow === 5) {
      if (next.yomtov) label = 'ערב שבת, ' + erevName(info, next);
      else if (next.cholHamoed) label = 'ערב שבת חול המועד';
      else { var p = Cal.parshaForShabbos(rd + 1, israel); label = 'ערב שבת' + (p ? ' פרשת ' + p.map(function (i) { return Cal.PARSHIOS[i]; }).join('-') : ''); }
    } else if (erev) label = Y_DAYS[dow] + ', ' + erevName(info, next);
    var z = MinyanEngine(cfg).zmanimFor(rd), zm = s.zman === 'sunset' ? z.sunset : z.candles, r = Math.max(1, +s.round || 1);
    var auto = isFinite(zm) ? Math.floor((Math.floor(zm) - (+s.before || 0)) / r) * r : null;
    var w = s.week[dow], base = w.open ? w : s.week[5]; /* an Erev Yom Tov on a day that is normally closed opens with Friday's hours */
    var specs = rangesOf(base);
    if (erev && dow !== 5 && specs.length) specs[specs.length - 1].until = ''; /* a weekday Erev Yom Tov ends before the zman, like Friday */
    var o = { rd: rd, date: iso(rd), dow: dow, label: label, heb: hebDate(rd), erev: erev, open: w.open || erev, auto: auto, note: '', changed: false };
    var c = useDay === false ? null : s.days[o.date];
    if (c) {
      o.changed = true;
      var own = rangesOf(c, null);
      if (own.length) { specs = rangesOf(c, specs); if (!c.closed) o.open = true; }
      if (c.closed) o.open = false;
      o.note = c.note || '';
    }
    o.specs = specs;
    o.ranges = specs.map(function (sp) { return { fromSpec: sp.from, untilSpec: sp.until, from: resolve(cfg, rd, sp.from, true), until: sp.until ? resolve(cfg, rd, sp.until, false) : auto, kids: !!sp.kids }; })
      .filter(function (x) { return x.from != null && x.until != null && x.from < x.until; })
      .sort(function (a, b) { return a.from - b.from; });
    o.end = o.ranges.length ? o.ranges[o.ranges.length - 1].until : null;
    return o;
  }
  /* the price on a day: its own, the before-Yom-Tov price (ytDays before a Yom Tov through Erev Yom Tov), or the regular one */
  function price(cfg, rd) {
    var s = settings(cfg), p = s.prices || {}, israel = !!cfg.israel, yt = false, n = Math.max(0, Math.min(30, +p.ytDays || 0)), k;
    if (!Cal.dayInfo(rd, israel).yomtov) for (k = 1; k <= n + 1; k++) if (Cal.dayInfo(rd + k, israel).yomtov) { yt = true; break; }
    var own = (s.days[iso(rd)] || {}).price || {};
    var adult = own.adult || (yt && p.ytAdult) || p.adult || '', kid = own.kid || (yt && p.ytKid) || p.kid || '';
    return { adult: String(adult).trim(), kid: String(kid).trim(), yt: yt && !!(p.ytAdult || p.ytKid) };
  }
  function money(v) { v = String(v || '').trim(); return /^\d+(\.\d{1,2})?$/.test(v) ? '$' + v : v; }
  function priceText(pr, kidsAny) {
    if (!pr.adult && !pr.kid) return '';
    return 'פרייז: ' + (pr.adult ? money(pr.adult) : '') + (pr.kid && kidsAny ? (pr.adult ? ', ' : '') + 'קינדער ' + money(pr.kid) : '');
  }
  /* the days left this week: today while it is still open, through Friday */
  function week(cfg, nowMs) {
    var tz = MinyanEngine(cfg).loc().tz, now = Cal.nowInTz(nowMs, tz), rd = now.rd, t = day(cfg, rd), out = [];
    if (!t || !t.open || t.end == null || now.min >= t.end) rd++;
    for (var i = 0; i < 8; i++, rd++) {
      var x = day(cfg, rd);
      if (x && ((x.open && x.ranges.length) || x.changed)) out.push(x);
      if (Cal.mod(rd, 7) === 5) break;
    }
    return { today: now.rd, days: out };
  }
  /* "פון 8:00 ביז 12:00 און פון 1:30 ביז 3:15, נישט פאר קינדער" — or each set with its own kids when they differ */
  function hoursText(cfg, x) {
    var e = MinyanEngine(cfg), rs = x.ranges;
    function one(r) { return 'פון ' + e.fmtTime(r.from) + ' ביז ' + e.fmtTime(r.until); }
    function kids(k) { return k ? 'אויך קינדער' : 'נישט פאר קינדער'; }
    if (rs.every(function (r) { return r.kids === rs[0].kids; })) return rs.map(one).join(' און ') + ', ' + kids(rs[0].kids);
    return rs.map(function (r) { return one(r) + ', ' + kids(r.kids); }).join('; ');
  }
  function text(cfg, nowMs) {
    var s = settings(cfg), w = week(cfg, nowMs), lines = [], i, j;
    function name(x) { return (x.rd === w.today ? 'היינט, ' : '') + x.label + (x.erev ? ' (' + x.heb + ')' : ''); }
    function plain(x) { return x && !x.erev && !x.note && x.open && x.ranges.length; }
    w.days.forEach(function (x) { var pr = price(cfg, x.rd); x.priceKey = pr.adult + '|' + pr.kid; x.priceText = priceText(pr, x.ranges.some(function (r) { return r.kids; })); });
    var open = w.days.filter(function (x) { return x.open && x.ranges.length; }), samePrice = open.every(function (x) { return x.priceKey === open[0].priceKey; });
    var kidsAny = open.some(function (x) { return x.ranges.some(function (r) { return r.kids; }); });
    function pt(x) { return !samePrice && x.priceText ? ' · ' + x.priceText : ''; }
    for (i = 0; i < w.days.length; i++) {
      var x = w.days[i];
      if (!x.open || !x.ranges.length) { lines.push(name(x) + ': נישטא קיין שערן' + (x.note ? '. ' + x.note : '')); continue; }
      j = i; /* plain weekdays in a row with the same hours: "זונטאג ביז מיטוואך" */
      if (plain(x)) while (plain(w.days[j + 1]) && w.days[j + 1].rd === w.days[j].rd + 1 && hoursText(cfg, w.days[j + 1]) === hoursText(cfg, x) && w.days[j + 1].priceKey === x.priceKey) j++;
      lines.push((j > i ? name(x) + ' ביז ' + w.days[j].label : name(x)) + ': ' + hoursText(cfg, x) + pt(x) + (x.note ? '. ' + x.note : ''));
      i = j;
    }
    var out = lines.length ? 'שערן די וואך:\n' + lines.join('\n') : 'די וואך איז נישטא מער קיין שערן.';
    if (lines.length && samePrice && open.length) { var t = priceText(price(cfg, open[0].rd), kidsAny); if (t) out += '\n' + t; }
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
  return { DEFAULTS: DEFAULTS, ZMANIM: ZMANIM, parse: parse, valid: valid, resolve: resolve, rangesOf: rangesOf, settings: settings, price: price, day: day, week: week, text: text, wants: wants, reply: reply, iso: iso };
})();
if (typeof module !== 'undefined') module.exports = MinyanShere;
