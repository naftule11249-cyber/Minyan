/* engine.js — the schedule engine shared by the website, the app and the SMS responder.
   MinyanEngine(cfg) returns functions that turn the config into minyanim for any date. Needs cal.js. */
var MinyanEngine = (function () {
  'use strict';
  var TEFILLA_DEFAULTS = [
    { id: 'shacharis', name: 'שחרית', milestone: 'הודו', offset: 10, period: 'am' },
    { id: 'mincha', name: 'מנחה', milestone: 'שמונה עשרה', offset: 8, period: 'pm' },
    { id: 'maariv', name: 'מעריב', milestone: 'שמונה עשרה', offset: 5, period: 'pm' }];
  var FALLBACK = {}, TYPE_NAME = {}, TYPE_NAME_EN = {};
  Cal.DAY_TYPES.forEach(function (t) { FALLBACK[t[0]] = t[2]; TYPE_NAME[t[0]] = t[1]; TYPE_NAME_EN[t[0]] = t[3]; });
  var ZMAN_ALIAS = { 'שקיעה': 'sunset', 'sunset': 'sunset', 'נץ': 'sunrise', 'sunrise': 'sunrise', 'הדלקה': 'candles', 'candles': 'candles',
    'צאת': 'tzeis', 'tzeis': 'tzeis', 'פלג': 'plag', 'plag': 'plag', 'חצות': 'chatzos', 'chatzos': 'chatzos', 'עלות': 'alos', 'alos': 'alos',
    'ר״ת': 'tzeis72', 'ר"ת': 'tzeis72', 'rt': 'tzeis72', 'tzeis60': 'tzeis60', 'צאת60': 'tzeis60', 'minchag': 'minchag', 'מנחה־גדולה': 'minchag', 'שמע': 'shema', 'shema': 'shema', 'tefilla': 'tefilla', 'תפילה': 'tefilla' };
  var WEEKLY_TYPES = { weekday: 1, sunday: 1, rosh_chodesh: 1, fast: 1, chanukah: 1, purim: 1, chol_hamoed: 1 };
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function isoDate(rd) { var g = Cal.gregFromRD(rd); return g.y + '-' + pad2(g.m) + '-' + pad2(g.d); }
  function gregStr(rd) { var g = Cal.gregFromRD(rd); return g.d + '.' + g.m + '.' + g.y; }
  function sameEntry(a, b) { return !!(a && b && a.rd === b.rd && a.tefilla.id === b.tefilla.id && a.start === b.start && a.room === b.room); }

  function parseSpec(tok, tefilla) {
    var m = /^(\d{1,2})[:.](\d{2})$/.exec(tok);
    if (m) {
      var h = +m[1], mi = +m[2], exact = m[1].length === 2 && m[1].charAt(0) === '0'; /* "01:00" is a 24-hour time, as the time picker writes it */
      if (h > 24 || mi > 59) return null;
      if (tefilla.period === 'pm' && !exact && h >= 1 && h < 12) h += 12; /* 6:45 means 6:45 PM for Mincha/Maariv */
      /* a Maariv at 00:30 is still last night: before the night cut-off (4:00 unless the tefilla says otherwise) it sorts at the end of the day's list and happens after midnight */
      if (tefilla.period === 'pm' && h < (tefilla.nightUntil == null || tefilla.nightUntil === '' ? 4 : +tefilla.nightUntil)) h += 24;
      return { kind: 'fixed', min: h * 60 + mi };
    }
    m = /^([^+\-~]+?)\s*(?:([+-])\s*(\d+))?\s*(?:~(\d+))?$/.exec(tok);
    if (!m) return null;
    var z = ZMAN_ALIAS[m[1].trim()];
    if (!z) return null;
    return { kind: 'zman', zman: z, offset: m[2] ? (+m[3]) * (m[2] === '-' ? -1 : 1) : 0, round: m[4] ? +m[4] : 0 };
  }
  /* "6:20 ברך משה // הערה" -> {spec, room, note}. A trailing "until <zman>" / "after <zman>" (עד / אחרי) is a condition:
     the minyan is listed only while it starts before (or from) that zman on that day, so a late Shacharis drops away in summer by itself. */
  function parseLine(line, tefilla) {
    var s = line.trim();
    if (!s || s.charAt(0) === '#') return null;
    var note = '', i = s.indexOf('//');
    if (i >= 0) { note = s.slice(i + 2).trim(); s = s.slice(0, i).trim(); }
    var cond = null, cm = /^(.*?)\s+(until|after|עד|אחרי)\s+(\S+)$/i.exec(s);
    if (cm) { var cs = parseSpec(cm[3], tefilla); if (cs && cs.kind === 'zman') { cond = { op: /^(until|עד)$/i.test(cm[2]) ? 'until' : 'after', spec: cs }; s = cm[1].trim(); } }
    var m = /^every\s+(\d+)\s+from\s+(\S+)\s+(?:to\s+(\S+)|count\s+(\d+))(?:\s+rooms\s+(.*))?$/i.exec(s);
    if (m) {
      var start = parseSpec(m[2], tefilla), end = m[3] ? parseSpec(m[3], tefilla) : null;
      var rooms = (m[5] || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
      var ok = !!start && +m[1] > 0 && (m[3] ? !!end : +m[4] > 0);
      return { raw: line, tok: s, series: true, spec: ok ? { kind: 'series', every: +m[1], start: start, end: end, count: m[4] ? +m[4] : 0 } : null, room: '', rooms: rooms, note: note, cond: cond };
    }
    var parts = s.split(/\s*\|\s*|\s+/), tok = parts.shift();
    return { raw: line, tok: tok, spec: parseSpec(tok, tefilla), room: parts.join(' '), note: note, cond: cond };
  }

  function create(cfg) {
    cfg = cfg || {};
    var zCache = {};
    function loc() {
      var L = cfg.location || {};
      return { lat: +L.lat || 0, lng: +L.lng || 0, tz: L.tz || 'America/New_York', elev: +L.elev || 0,
        candles: cfg.candles == null || cfg.candles === '' ? 18 : +cfg.candles,
        tzeisMinutes: cfg.tzeisMinutes ? +cfg.tzeisMinutes : 0, tzeisDeg: cfg.tzeisDeg ? +cfg.tzeisDeg : 8.5, minchaGedola: cfg.minchaGedola || 'later' };
    }
    function zmanimFor(rd) { if (!zCache[rd]) zCache[rd] = Cal.zmanim(rd, loc()); return zCache[rd]; }
    function weeklyBase(rd, zman) {
      var start = rd - Cal.mod(rd, 7), best = Infinity, i, v;
      for (i = 0; i < 5; i++) { v = zmanimFor(start + i)[zman]; if (!isNaN(v) && v < best) best = v; }
      return best;
    }
    function resolveMin(spec, rd, type) {
      if (spec.kind === 'fixed') return spec.min;
      var base = (cfg.weeklyEarliest && WEEKLY_TYPES[type]) ? weeklyBase(rd, spec.zman) : zmanimFor(rd)[spec.zman];
      if (isNaN(base) || !isFinite(base)) return NaN;
      var v = Math.round(base) + spec.offset; /* start from the zman as the zmanim list shows it (to the minute), then add the offset */
      return spec.round ? Math.floor(v / spec.round) * spec.round : v;
    }
    /* the zman a line's "until"/"after" condition resolves to on day rd (NaN when the line has none) */
    function condLimit(p, rd, type) { return p && p.cond ? resolveMin(p.cond.spec, rd, type) : NaN; }
    function applyCond(p, list, rd, type) {
      if (!p || !p.cond || !list.length) return list;
      var lim = condLimit(p, rd, type);
      if (isNaN(lim)) return list;
      return list.filter(function (e) { return p.cond.op === 'until' ? e.start < lim : e.start >= lim; });
    }
    /* A parsed line -> the minyanim it produces on day rd: [{start, room, note}] (a repeating line gives many). */
    function expand(p, rd, type) { return applyCond(p, expandAll(p, rd, type), rd, type); }
    function expandAll(p, rd, type) {
      if (!p || !p.spec) return [];
      if (p.spec.kind !== 'series') { var st = resolveMin(p.spec, rd, type); return isNaN(st) ? [] : [{ start: st, room: p.room, note: p.note }]; }
      var out = [], start = resolveMin(p.spec.start, rd, type);
      if (isNaN(start)) return out;
      var end = p.spec.end ? resolveMin(p.spec.end, rd, type) : NaN;
      if (p.spec.end && isNaN(end)) return out;
      if (p.spec.end && end < start) end += 1440; /* "until 00:15" after a 22:15 start runs past midnight */
      var n = 0, m = start, limit = p.spec.count || 500, rnd = p.spec.start.round || 0, t;
      while (n < limit && n < 500 && (!p.spec.end || m <= end)) {
        t = rnd ? Math.floor(m / rnd) * rnd : m;
        if (!out.length || out[out.length - 1].start !== t) out.push({ start: t, room: p.rooms.length ? p.rooms[out.length % p.rooms.length] : '', note: p.note });
        m += p.spec.every; n++;
      }
      return out;
    }
    function tefillos() { return (cfg.tefillos && cfg.tefillos.length) ? cfg.tefillos : TEFILLA_DEFAULTS; }
    /* sponsor notices that are on today: non-empty body, and inside their from/to dates when set */
    function activeNotices(rd) {
      var iso = isoDate(rd);
      return (cfg.notices || []).filter(function (n) {
        if (!(n.body || '').trim()) return false;
        if (n.from && iso < n.from) return false;
        if (n.to && iso > n.to) return false;
        return true;
      });
    }
    /* the temporary banner, or null once it has expired (until = "YYYY-MM-DDTHH:MM" in the shul's time zone) */
    function activeBanner(nowMs) {
      var b = cfg.banner;
      if (!b || !(b.text || '').trim()) return null;
      var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(b.until || '');
      if (m && nowMs >= Cal.epochFromWall(Cal.rdFromGreg(+m[1], +m[2], +m[3]), +m[4] * 60 + +m[5], loc().tz)) return null;
      return b;
    }
    /* Does an override apply to this day? date (one civil day) > hebrew date (every year) > calendar day name (every year). */
    function overrideMatches(o, rd, info) {
      if (o.date) return o.date === isoDate(rd);
      if (o.hm != null && o.hd) {
        var h = info.heb, leap = Cal.hebLeap(h.y), m = o.hm === 'adar' ? (leap ? 13 : 12) : o.hm === 'adar1' ? (leap ? 12 : -1) : +o.hm;
        return h.m === m && h.d === +o.hd;
      }
      if (o.calLabel) return info.labels.some(function (l) { return l === o.calLabel || l.indexOf(o.calLabel) === 0; });
      return false;
    }
    function pickOverride(rd, info) {
      var list = (cfg.overrides || []).filter(function (o) { return overrideMatches(o, rd, info); });
      list.sort(function (a, b) { return (a.date ? 0 : a.hm != null ? 1 : 2) - (b.date ? 0 : b.hm != null ? 1 : 2); });
      return list[0] || null;
    }
    /* a day type with no list of its own follows a more general one; Rosh Chodesh, Chanukah, a fast, Purim or Chol Hamoed that lands on a Sunday follows the Sunday list, not the weekday one */
    function fallbackFor(k, info) { var f = FALLBACK[k]; return f === 'weekday' && info.dow === 0 && k !== 'sunday' ? 'sunday' : f; }
    function dayTexts(rd, info) {
      var type = Cal.dayType(info), iso = isoDate(rd);
      var ovr = pickOverride(rd, info);
      var out = { type: type, override: ovr, texts: {} };
      tefillos().forEach(function (t) {
        var text = null, src = null, k = type, s;
        if (ovr && ovr.lines && ovr.lines[t.id] && ovr.lines[t.id].trim()) { text = ovr.lines[t.id]; src = 'override'; }
        while (text == null && k) {
          s = cfg.schedules && cfg.schedules[k];
          if (s && s[t.id] && s[t.id].trim()) { text = s[t.id]; src = k; } else k = fallbackFor(k, info);
        }
        out.texts[t.id] = { text: text || '', source: src };
      });
      return out;
    }
    function roomRank() {
      var m = {}; (cfg.rooms || '').split(',').forEach(function (x, i) { x = x.trim(); if (x && m[x] == null) m[x] = i; });
      return function (room) { return m[room] == null ? 1e6 : m[room]; };
    }
    function scheduleFor(rd) {
      var info = Cal.dayInfo(rd, !!cfg.israel), dt = dayTexts(rd, info), tz = loc().tz, byT = {}, all = [], rank = roomRank();
      tefillos().forEach(function (t) {
        var list = [];
        var offset = (t.offset == null || t.offset === '') ? 0 : +t.offset;
        dt.texts[t.id].text.split('\n').forEach(function (line) {
          expand(parseLine(line, t), rd, dt.type).forEach(function (x) {
            list.push({ tefilla: t, room: x.room, note: x.note, start: x.start, ms: Cal.epochFromWall(rd, x.start, tz), milestone: x.start + offset, rd: rd });
          });
        });
        list.sort(function (a, b) { return a.start - b.start || rank(a.room) - rank(b.room); });
        byT[t.id] = list; all = all.concat(list);
      });
      all.sort(function (a, b) { return a.start - b.start || rank(a.room) - rank(b.room); });
      return { rd: rd, info: info, type: dt.type, override: dt.override, byTefilla: byT, all: all };
    }
    /* All minyanim after nowMs within the next `days` days, in order. */
    function after(nowMs, nowRd, days, tefillaId) {
      var out = [], i, j, s, list;
      for (i = -1; i < (days || 10); i++) { /* from yesterday: a Maariv after midnight is still ahead */
        s = scheduleFor(nowRd + i);
        list = tefillaId ? (s.byTefilla[tefillaId] || []) : s.all;
        for (j = 0; j < list.length; j++) if (list[j].ms > nowMs && (tefillaId || list[j].tefilla.kind !== 'event')) out.push({ entry: list[j], sched: s, daysAhead: i });
      }
      return out;
    }
    function upcoming(nowMs, nowRd) {
      var i, j, s;
      for (i = -1; i < 10; i++) { /* from yesterday: a Maariv after midnight is still ahead */
        s = scheduleFor(nowRd + i);
        for (j = 0; j < s.all.length; j++) if (s.all[j].ms > nowMs && s.all[j].tefilla.kind !== 'event') return { entry: s.all[j], sched: s, daysAhead: i };
      }
      return null;
    }
    function fmtTime(min) {
      if (isNaN(min) || !isFinite(min)) return '—';
      var m = Math.round(min), h = Math.floor(m / 60) % 24, mm = m % 60;
      if (cfg.clock24) return pad2(h) + ':' + pad2(mm);
      return (h % 12 || 12) + ':' + pad2(mm);
    }
    function fmtCountdown(ms) {
      var s = Math.max(0, Math.floor(ms / 1000)), d = Math.floor(s / 86400);
      s -= d * 86400;
      var core = pad2(Math.floor(s / 3600)) + ':' + pad2(Math.floor((s % 3600) / 60)) + ':' + pad2(s % 60);
      return d ? d + (d === 1 ? ' יום ' : ' ימים ') + core : core;
    }
    /* the civil date as people here write it: cfg.dateFormat 'mdy' (10/25/2026), 'dmy' (25.10.2026) or 'iso'; US time zones default to mdy */
    function fmtDate(rd) {
      var g = Cal.gregFromRD(rd), f = cfg.dateFormat || (/^America\//.test(loc().tz) ? 'mdy' : 'dmy');
      return f === 'mdy' ? g.m + '/' + g.d + '/' + g.y : f === 'iso' ? isoDate(rd) : g.d + '.' + g.m + '.' + g.y;
    }
    function dayLine(info, rd) {
      var parsha = Cal.parshaOfWeek(rd, !!cfg.israel);
      return Cal.DAY_NAMES[info.dow] + (parsha ? ' פרשת ' + parsha : '');
    }
    function typeLabel(s) {
      if (s.override) return 'לוח מיוחד' + (s.override.label ? ': ' + s.override.label : '');
      return 'לוח ' + (TYPE_NAME[s.type] || s.type);
    }
    return { cfg: cfg, loc: loc, zmanimFor: zmanimFor, resolveMin: resolveMin, expand: expand, condLimit: condLimit, tefillos: tefillos, activeNotices: activeNotices, activeBanner: activeBanner, dayTexts: dayTexts, scheduleFor: scheduleFor, fmtDate: fmtDate,
      after: after, upcoming: upcoming, fmtTime: fmtTime, fmtCountdown: fmtCountdown, dayLine: dayLine, typeLabel: typeLabel, parseLine: parseLine };
  }
  create.parseLine = parseLine; create.parseSpec = parseSpec; create.sameEntry = sameEntry; create.gregStr = gregStr; create.isoDate = isoDate;
  create.TEFILLA_DEFAULTS = TEFILLA_DEFAULTS; create.FALLBACK = FALLBACK; create.TYPE_NAME = TYPE_NAME; create.TYPE_NAME_EN = TYPE_NAME_EN;
  return create;
})();
if (typeof module !== 'undefined') module.exports = MinyanEngine;
