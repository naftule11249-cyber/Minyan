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
    'ר״ת': 'tzeis72', 'ר"ת': 'tzeis72', 'rt': 'tzeis72', 'minchag': 'minchag', 'מנחה־גדולה': 'minchag', 'שמע': 'shema', 'shema': 'shema' };
  var WEEKLY_TYPES = { weekday: 1, sunday: 1, rosh_chodesh: 1, fast: 1, chanukah: 1, purim: 1, chol_hamoed: 1 };
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function isoDate(rd) { var g = Cal.gregFromRD(rd); return g.y + '-' + pad2(g.m) + '-' + pad2(g.d); }
  function gregStr(rd) { var g = Cal.gregFromRD(rd); return g.d + '.' + g.m + '.' + g.y; }
  function sameEntry(a, b) { return !!(a && b && a.rd === b.rd && a.tefilla.id === b.tefilla.id && a.start === b.start && a.room === b.room); }

  function parseSpec(tok, tefilla) {
    var m = /^(\d{1,2})[:.](\d{2})$/.exec(tok);
    if (m) {
      var h = +m[1], mi = +m[2];
      if (h > 24 || mi > 59) return null;
      if (tefilla.period === 'pm' && h >= 1 && h < 12) h += 12; /* 6:45 means 6:45 PM for Mincha/Maariv; 00:15 stays after midnight */
      return { kind: 'fixed', min: h * 60 + mi };
    }
    m = /^([^+\-~]+?)\s*(?:([+-])\s*(\d+))?\s*(?:~(\d+))?$/.exec(tok);
    if (!m) return null;
    var z = ZMAN_ALIAS[m[1].trim()];
    if (!z) return null;
    return { kind: 'zman', zman: z, offset: m[2] ? (+m[3]) * (m[2] === '-' ? -1 : 1) : 0, round: m[4] ? +m[4] : 0 };
  }
  /* "6:20 ברך משה // הערה" -> {spec, room, note} */
  function parseLine(line, tefilla) {
    var s = line.trim();
    if (!s || s.charAt(0) === '#') return null;
    var note = '', i = s.indexOf('//');
    if (i >= 0) { note = s.slice(i + 2).trim(); s = s.slice(0, i).trim(); }
    var m = /^every\s+(\d+)\s+from\s+(\S+)\s+(?:to\s+(\S+)|count\s+(\d+))(?:\s+rooms\s+(.*))?$/i.exec(s);
    if (m) {
      var start = parseSpec(m[2], tefilla), end = m[3] ? parseSpec(m[3], tefilla) : null;
      var rooms = (m[5] || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
      var ok = !!start && +m[1] > 0 && (m[3] ? !!end : +m[4] > 0);
      return { raw: line, tok: s, series: true, spec: ok ? { kind: 'series', every: +m[1], start: start, end: end, count: m[4] ? +m[4] : 0 } : null, room: '', rooms: rooms, note: note };
    }
    var parts = s.split(/\s*\|\s*|\s+/), tok = parts.shift();
    return { raw: line, tok: tok, spec: parseSpec(tok, tefilla), room: parts.join(' '), note: note };
  }

  function create(cfg) {
    cfg = cfg || {};
    var zCache = {};
    function loc() {
      var L = cfg.location || {};
      return { lat: +L.lat || 0, lng: +L.lng || 0, tz: L.tz || 'America/New_York', elev: +L.elev || 0,
        candles: cfg.candles == null || cfg.candles === '' ? 18 : +cfg.candles,
        tzeisMinutes: cfg.tzeisMinutes ? +cfg.tzeisMinutes : 0, tzeisDeg: cfg.tzeisDeg ? +cfg.tzeisDeg : 8.5 };
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
      var v = base + spec.offset;
      return spec.round ? Math.floor(v / spec.round) * spec.round : Math.floor(v);
    }
    /* A parsed line -> the minyanim it produces on day rd: [{start, room, note}] (a repeating line gives many). */
    function expand(p, rd, type) {
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
    function dayTexts(rd, info) {
      var type = Cal.dayType(info), iso = isoDate(rd);
      var ovr = (cfg.overrides || []).filter(function (o) { return o.date === iso; })[0] || null;
      var out = { type: type, override: ovr, texts: {} };
      tefillos().forEach(function (t) {
        var text = null, src = null, k = type, s;
        if (ovr && ovr.lines && ovr.lines[t.id] && ovr.lines[t.id].trim()) { text = ovr.lines[t.id]; src = 'override'; }
        while (text == null && k) {
          s = cfg.schedules && cfg.schedules[k];
          if (s && s[t.id] && s[t.id].trim()) { text = s[t.id]; src = k; } else k = FALLBACK[k];
        }
        out.texts[t.id] = { text: text || '', source: src };
      });
      return out;
    }
    function scheduleFor(rd) {
      var info = Cal.dayInfo(rd, !!cfg.israel), dt = dayTexts(rd, info), tz = loc().tz, byT = {}, all = [];
      tefillos().forEach(function (t) {
        var list = [];
        var offset = (t.offset == null || t.offset === '') ? 0 : +t.offset;
        dt.texts[t.id].text.split('\n').forEach(function (line) {
          expand(parseLine(line, t), rd, dt.type).forEach(function (x) {
            list.push({ tefilla: t, room: x.room, note: x.note, start: x.start, ms: Cal.epochFromWall(rd, x.start, tz), milestone: x.start + offset, rd: rd });
          });
        });
        list.sort(function (a, b) { return a.start - b.start; });
        byT[t.id] = list; all = all.concat(list);
      });
      all.sort(function (a, b) { return a.start - b.start; });
      return { rd: rd, info: info, type: dt.type, override: dt.override, byTefilla: byT, all: all };
    }
    /* All minyanim after nowMs within the next `days` days, in order. */
    function after(nowMs, nowRd, days, tefillaId) {
      var out = [], i, j, s, list;
      for (i = 0; i < (days || 10); i++) {
        s = scheduleFor(nowRd + i);
        list = tefillaId ? (s.byTefilla[tefillaId] || []) : s.all;
        for (j = 0; j < list.length; j++) if (list[j].ms > nowMs) out.push({ entry: list[j], sched: s, daysAhead: i });
      }
      return out;
    }
    function upcoming(nowMs, nowRd) {
      var i, j, s;
      for (i = 0; i < 10; i++) {
        s = scheduleFor(nowRd + i);
        for (j = 0; j < s.all.length; j++) if (s.all[j].ms > nowMs) return { entry: s.all[j], sched: s, daysAhead: i };
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
    function dayLine(info, rd) {
      var parsha = Cal.parshaOfWeek(rd, !!cfg.israel);
      return Cal.DAY_NAMES[info.dow] + (parsha ? ' פרשת ' + parsha : '');
    }
    function typeLabel(s) {
      if (s.override) return 'לוח מיוחד' + (s.override.label ? ': ' + s.override.label : '');
      return 'לוח ' + (TYPE_NAME[s.type] || s.type);
    }
    return { cfg: cfg, loc: loc, zmanimFor: zmanimFor, resolveMin: resolveMin, expand: expand, tefillos: tefillos, dayTexts: dayTexts, scheduleFor: scheduleFor,
      after: after, upcoming: upcoming, fmtTime: fmtTime, fmtCountdown: fmtCountdown, dayLine: dayLine, typeLabel: typeLabel, parseLine: parseLine };
  }
  create.parseLine = parseLine; create.parseSpec = parseSpec; create.sameEntry = sameEntry; create.gregStr = gregStr; create.isoDate = isoDate;
  create.TEFILLA_DEFAULTS = TEFILLA_DEFAULTS; create.FALLBACK = FALLBACK; create.TYPE_NAME = TYPE_NAME; create.TYPE_NAME_EN = TYPE_NAME_EN;
  return create;
})();
if (typeof module !== 'undefined') module.exports = MinyanEngine;
