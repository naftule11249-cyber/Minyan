/* sms.js — builds the text-message reply for "when is the next minyan". Needs cal.js and engine.js.
   MinyanSms.buildReply(cfg, incomingText, nowMs) -> { text, lang, keyword } */
var MinyanSms = (function () {
  'use strict';
  var T = {
    he: { next: 'המנין הבא', then: 'אחריו', in_: 'בעוד', min: 'דק׳', hr: 'שע׳', today: 'היום', tomorrow: 'מחר', none: 'לא רשומים מנינים בימים הקרובים.',
      left: 'נותרו', noneToday: 'אין עוד מנינים היום', zmanim: 'זמני היום', more: 'ועוד',
      help: 'שלחו אחת מהמילים: מנין, שחרית, מנחה, מעריב, היום, מחר, זמנים. להפסקה שלחו STOP.' },
    en: { next: 'Next minyan', then: 'Then', in_: 'in', min: 'min', hr: 'hr', today: 'Today', tomorrow: 'Tomorrow', none: 'No minyanim are listed for the coming days.',
      left: 'left', noneToday: 'No more minyanim today', zmanim: "Today's zmanim", more: 'more',
      help: 'Text one of: next, shacharis, mincha, maariv, today, tomorrow, zmanim. Reply STOP to opt out, HELP for help. Msg and data rates may apply.' }
  };
  var EN_TEFILLA = { shacharis: 'Shacharis', mincha: 'Mincha', maariv: 'Maariv' };
  var EN_MILESTONE = { 'הודו': 'Hodu', 'שמונה עשרה': 'Shemoneh Esrei', 'ברכו': 'Borchu', 'ישתבח': 'Yishtabach', 'נשמת': 'Nishmas' };
  var EN_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Shabbos'];
  var EN_ZMANIM = { alos: 'Alos', sunrise: 'Sunrise', shema: 'Shema', tefilla: 'Tefilla', chatzos: 'Chatzos', minchag: 'Mincha gedola', plag: 'Plag', candles: 'Candles', sunset: 'Sunset', tzeis: 'Tzeis', tzeis72: 'R"T' };
  var MAX_LIST = 15;
  function hasHebrew(s) { return /[֐-׿]/.test(s); }
  function keyword(text) {
    var t = (text || '').trim().toLowerCase().replace(/[.!?'"״׳,]/g, '');
    if (!t) return 'next';
    if (/^(stop|stopall|unsubscribe|cancel|end|quit|start|unstop|yes)$/.test(t)) return 'carrier';
    if (/^(help|עזרה|\?|info|menu)$/.test(t)) return 'help';
    if (/^(zmanim|zman|times|זמנים|זמני היום)$/.test(t)) return 'zmanim';
    if (/^(today|היום|all|הכל|list|schedule|לוח)$/.test(t)) return 'today';
    if (/^(tomorrow|מחר)$/.test(t)) return 'tomorrow';
    if (/(shachar|shachr|שחרית|morning)/.test(t)) return 'shacharis';
    if (/(mincha|minha|מנחה)/.test(t)) return 'mincha';
    if (/(maariv|mariv|arvit|arvis|מעריב|ערבית)/.test(t)) return 'maariv';
    return 'next';
  }
  function buildReply(cfg, text, nowMs) {
    var engine = MinyanEngine(cfg), lang = hasHebrew(text || '') ? 'he' : 'en', L = T[lang];
    var rd = Cal.nowInTz(nowMs, engine.loc().tz).rd, k = keyword(text), tf = null, raw = (text || '').trim();
    engine.tefillos().forEach(function (t) { if (raw === t.name || k === t.id) tf = t; });
    function tName(t) { return lang === 'en' && EN_TEFILLA[t.id] ? EN_TEFILLA[t.id] : t.name; }
    function msName(t) { return lang === 'en' && EN_MILESTONE[t.milestone] ? EN_MILESTONE[t.milestone] : t.milestone; }
    function dayPrefix(item) {
      if (item.daysAhead === 0) return L.today;
      if (item.daysAhead === 1) return L.tomorrow;
      return lang === 'he' ? Cal.DAY_NAMES[item.sched.info.dow] : EN_DAYS[item.sched.info.dow];
    }
    function rel(ms) {
      var m = Math.ceil((ms - nowMs) / 60000);
      if (m < 1 || m >= 12 * 60) return '';
      if (m < 60) return L.in_ + ' ' + m + ' ' + L.min;
      var h = Math.floor(m / 60), mm = m % 60;
      return L.in_ + ' ' + h + ' ' + L.hr + (mm ? (lang === 'he' ? ' ו-' : ' ') + mm + ' ' + L.min : '');
    }
    function entry(e, withTefilla) {
      var s = (withTefilla ? tName(e.tefilla) + ' – ' : '') + (e.room ? e.room + ' ' : '') + engine.fmtTime(e.start);
      if (e.tefilla.milestone) s += ' (' + msName(e.tefilla) + ' ' + engine.fmtTime(e.milestone) + ')';
      return s;
    }
    function shortList(list) {
      var parts = list.slice(0, MAX_LIST).map(function (x) { var e = x.entry || x; return engine.fmtTime(e.start) + (e.room ? ' ' + e.room : ''); });
      if (list.length > MAX_LIST) parts.push(L.more + ' ' + (list.length - MAX_LIST));
      return parts.join(', ');
    }
    function dayHeader(d) {
      var s = engine.scheduleFor(d), info = s.info;
      if (lang === 'he') return engine.dayLine(info, d) + ', ' + Cal.formatHeb(info.heb);
      var parsha = Cal.parshaOfWeek(d, !!cfg.israel);
      return EN_DAYS[info.dow] + (parsha ? ' (' + parsha + ')' : '');
    }
    var out = '', list, first, second, i;
    if (k === 'carrier') return { text: '', lang: lang, keyword: k };
    if (k === 'help') out = L.help;
    else if (k === 'zmanim') {
      var z = engine.zmanimFor(rd), info = Cal.dayInfo(rd, !!cfg.israel), keys = ['sunrise', 'shema', 'chatzos', 'plag', 'candles', 'sunset', 'tzeis'], parts = [];
      keys.forEach(function (key) {
        if (key === 'candles' && !(info.dow === 5 || info.erevYT)) return;
        parts.push((lang === 'he' ? Cal.ZMAN_NAMES[key] : EN_ZMANIM[key]) + ' ' + engine.fmtTime(z[key]));
      });
      out = L.zmanim + ' (' + dayHeader(rd) + '): ' + parts.join(', ');
    }
    else if (k === 'today' || k === 'tomorrow') {
      var d = k === 'today' ? rd : rd + 1, sched = engine.scheduleFor(d), lines = [];
      engine.tefillos().forEach(function (t) {
        var items = (sched.byTefilla[t.id] || []).filter(function (e) { return e.ms > nowMs; });
        if (items.length) lines.push(tName(t) + ': ' + shortList(items));
      });
      if (lines.length) out = (k === 'today' ? L.today : L.tomorrow) + ' – ' + dayHeader(d) + '\n' + lines.join('\n');
      else if (k === 'today') { list = engine.after(nowMs, rd, 10); out = L.noneToday + '.' + (list.length ? ' ' + L.next + ': ' + dayPrefix(list[0]) + ', ' + entry(list[0].entry, true) + '.' : ''); }
      else out = L.tomorrow + ' – ' + dayHeader(d) + ': ' + L.none;
    }
    else if (tf) {
      list = engine.after(nowMs, rd, 1, tf.id);
      if (list.length) out = tName(tf) + ' ' + L.today + ' (' + list.length + ' ' + L.left + '): ' + shortList(list);
      else {
        list = engine.after(nowMs, rd, 10, tf.id);
        if (!list.length) out = tName(tf) + ': ' + L.none;
        else {
          var items = []; for (i = 0; i < list.length && list[i].daysAhead === list[0].daysAhead; i++) items.push(list[i]);
          out = tName(tf) + ' ' + dayPrefix(list[0]) + ' (' + dayHeader(rd + list[0].daysAhead) + '): ' + shortList(items);
        }
      }
    }
    else {
      list = engine.after(nowMs, rd, 10);
      if (!list.length) out = L.none;
      else {
        first = list[0]; second = list[1];
        var r = first.daysAhead === 0 ? rel(first.entry.ms) : '';
        out = L.next + ': ' + (first.daysAhead ? dayPrefix(first) + ', ' : '') + entry(first.entry, true) + (r ? ', ' + r : '') + '.';
        if (second) out += '\n' + L.then + ': ' + (second.daysAhead !== first.daysAhead ? dayPrefix(second) + ', ' : '') + entry(second.entry, second.entry.tefilla.id !== first.entry.tefilla.id) + '.';
      }
    }
    var banner = (k === 'next' || k === 'today' || tf) ? engine.activeBanner(nowMs) : null;
    if (banner) out = (lang === 'he' ? 'שימו לב: ' : 'Note: ') + banner.text.trim() + '\n' + out;
    return { text: out, lang: lang, keyword: k };
  }
  return { buildReply: buildReply, keyword: keyword, hasHebrew: hasHebrew };
})();
if (typeof module !== 'undefined') module.exports = MinyanSms;
