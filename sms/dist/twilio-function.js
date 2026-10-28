/* cal.js — Hebrew calendar, weekly parsha, holidays and zmanim.
   Pure functions, no DOM. Dates are R.D. (fixed day numbers): RD 1 = 1 Jan 1 CE. */
var Cal = (function () {
  'use strict';
  var floor = Math.floor;
  function mod(a, b) { return ((a % b) + b) % b; }

  /* ---------- Gregorian <-> RD ---------- */
  function gregLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
  function rdFromGreg(y, m, d) {
    return 365 * (y - 1) + floor((y - 1) / 4) - floor((y - 1) / 100) + floor((y - 1) / 400) +
      floor((367 * m - 362) / 12) + (m <= 2 ? 0 : (gregLeap(y) ? -1 : -2)) + d;
  }
  function gregFromRD(rd) {
    var d0 = rd - 1, n400 = floor(d0 / 146097), d1 = mod(d0, 146097), n100 = floor(d1 / 36524),
      d2 = mod(d1, 36524), n4 = floor(d2 / 1461), d3 = mod(d2, 1461), n1 = floor(d3 / 365);
    var year = 400 * n400 + 100 * n100 + 4 * n4 + n1;
    if (!(n100 === 4 || n1 === 4)) year += 1;
    var prior = rd - rdFromGreg(year, 1, 1);
    var corr = rd < rdFromGreg(year, 3, 1) ? 0 : (gregLeap(year) ? 1 : 2);
    var month = floor((12 * (prior + corr) + 373) / 367);
    var day = rd - rdFromGreg(year, month, 1) + 1;
    return { y: year, m: month, d: day };
  }
  var RD_EPOCH_MS = 719163; /* RD of 1970-01-01 */
  function rdFromEpochDay(y, m, d) { return rdFromGreg(y, m, d); }

  /* ---------- Hebrew calendar (months: 1=Nisan ... 7=Tishrei ... 12=Adar/Adar I, 13=Adar II) ---------- */
  var HEBREW_EPOCH = -1373427;
  function hebLeap(y) { return mod(7 * y + 1, 19) < 7; }
  function hebElapsedDays(y) {
    var months = floor((235 * y - 234) / 19);
    var parts = 12084 + 13753 * months;
    var day = months * 29 + floor(parts / 25920);
    if (mod(3 * (day + 1), 7) < 3) day += 1;
    return day;
  }
  function hebDelay(y) {
    var a = hebElapsedDays(y - 1), b = hebElapsedDays(y), c = hebElapsedDays(y + 1);
    return (c - b === 356) ? 2 : ((b - a === 382) ? 1 : 0);
  }
  var nyCache = {};
  function hebNewYear(y) { if (!(y in nyCache)) nyCache[y] = HEBREW_EPOCH + hebElapsedDays(y) + hebDelay(y); return nyCache[y]; }
  function hebYearLength(y) { return hebNewYear(y + 1) - hebNewYear(y); }
  function hebLastMonth(y) { return hebLeap(y) ? 13 : 12; }
  function hebMonthLength(y, m) {
    if (m === 2 || m === 4 || m === 6 || m === 10 || m === 13) return 29;
    if (m === 12 && !hebLeap(y)) return 29;
    if (m === 8 && mod(hebYearLength(y), 10) !== 5) return 29;
    if (m === 9 && mod(hebYearLength(y), 10) === 3) return 29;
    return 30;
  }
  function rdFromHeb(y, m, d) {
    var rd = hebNewYear(y) + d - 1, k;
    if (m < 7) {
      for (k = 7; k <= hebLastMonth(y); k++) rd += hebMonthLength(y, k);
      for (k = 1; k < m; k++) rd += hebMonthLength(y, k);
    } else {
      for (k = 7; k < m; k++) rd += hebMonthLength(y, k);
    }
    return rd;
  }
  function hebFromRD(rd) {
    var y = floor((rd - HEBREW_EPOCH) / (35975351 / 98496)) - 1;
    while (hebNewYear(y + 1) <= rd) y++;
    while (hebNewYear(y) > rd) y--;
    var m = rd < rdFromHeb(y, 1, 1) ? 7 : 1;
    while (rd > rdFromHeb(y, m, hebMonthLength(y, m))) m++;
    var d = rd - rdFromHeb(y, m, 1) + 1;
    return { y: y, m: m, d: d };
  }

  /* ---------- Hebrew formatting ---------- */
  function gematria(n) {
    var ones = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'], tens = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'],
      hundreds = ['', 'ק', 'ר', 'ש', 'ת'];
    var s = '', h = floor(n / 100); n = n % 100;
    while (h > 4) { s += 'ת'; h -= 4; }
    s += hundreds[h];
    if (n === 15) s += 'טו'; else if (n === 16) s += 'טז'; else { s += tens[floor(n / 10)]; s += ones[n % 10]; }
    if (s.length === 1) return s + '׳';
    return s.slice(0, -1) + '״' + s.slice(-1);
  }
  function monthName(y, m) {
    var names = ['', 'ניסן', 'אייר', 'סיון', 'תמוז', 'אב', 'אלול', 'תשרי', 'חשון', 'כסלו', 'טבת', 'שבט', 'אדר', 'אדר ב׳'];
    if (m === 12 && hebLeap(y)) return 'אדר א׳';
    return names[m];
  }
  function formatHeb(h) { return gematria(h.d) + ' ' + monthName(h.y, h.m) + ' ' + gematria(h.y % 1000); }
  var DAY_NAMES = ['יום ראשון', 'יום שני', 'יום שלישי', 'יום רביעי', 'יום חמישי', 'יום שישי', 'שבת קודש'];
  var DAY_SHORT = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש״ק'];

  /* ---------- Parshios ---------- */
  var PARSHIOS = ['בראשית', 'נח', 'לך לך', 'וירא', 'חיי שרה', 'תולדות', 'ויצא', 'וישלח', 'וישב', 'מקץ', 'ויגש', 'ויחי',
    'שמות', 'וארא', 'בא', 'בשלח', 'יתרו', 'משפטים', 'תרומה', 'תצוה', 'כי תשא', 'ויקהל', 'פקודי',
    'ויקרא', 'צו', 'שמיני', 'תזריע', 'מצורע', 'אחרי מות', 'קדושים', 'אמור', 'בהר', 'בחוקותי',
    'במדבר', 'נשא', 'בהעלותך', 'שלח', 'קרח', 'חוקת', 'בלק', 'פינחס', 'מטות', 'מסעי',
    'דברים', 'ואתחנן', 'עקב', 'ראה', 'שופטים', 'כי תצא', 'כי תבוא', 'נצבים', 'וילך', 'האזינו', 'וזאת הברכה'];
  var parshaCache = {};
  /* Map of every Shabbos (RD) in Hebrew year y -> array of parsha indices. */
  function yearParshios(y, israel) {
    var key = y + (israel ? 'i' : 'd');
    if (parshaCache[key]) return parshaCache[key];
    var map = {};
    var rh = hebNewYear(y), rhNext = hebNewYear(y + 1), rhDow = mod(rh, 7), leap = hebLeap(y);
    var firstShabbos = rh + mod(6 - rhDow, 7);
    var t22 = rdFromHeb(y, 7, 22);
    var bereishis = t22 + 1 + mod(6 - mod(t22 + 1, 7), 7); /* first Shabbos after 22 Tishrei */
    var s, t;
    for (s = firstShabbos; s < bereishis; s += 7) {
      t = s - rh + 1;
      if (t === 1 || t === 10 || t >= 15) continue;
      map[s] = ((rhDow === 1 || rhDow === 2) && t < 8) ? [51] : [52];
    }
    var pesach = rdFromHeb(y, 1, 15), shavuos = rdFromHeb(y, 3, 6), av9 = rdFromHeb(y, 5, 9);
    var devarim = av9 - mod(mod(av9, 7) + 1, 7);
    function isYT(s) {
      var dp = s - pesach, ds = s - shavuos;
      return (dp >= 0 && dp <= (israel ? 6 : 7)) || (ds >= 0 && ds <= (israel ? 0 : 1));
    }
    var A = [], B1 = [], B2 = [], C = [];
    for (s = bereishis; s < rhNext; s += 7) {
      if (isYT(s)) continue;
      if (s < pesach) A.push(s); else if (s < shavuos) B1.push(s); else if (s < devarim) B2.push(s); else C.push(s);
    }
    var next = 0;
    function place(slots, endIdx, priority) {
      var count = endIdx - next + 1, n = slots.length;
      var combos = Math.max(0, Math.min(count - n, priority.length));
      var comb = {}, i;
      for (i = 0; i < combos; i++) comb[priority[i]] = true;
      for (i = 0; i < slots.length; i++) {
        if (comb[next]) { map[slots[i]] = [next, next + 1]; next += 2; }
        else { map[slots[i]] = [next]; next += 1; }
      }
    }
    place(A, leap ? 27 : 24, leap ? [] : [21]);
    place(B1, 33, leap ? [] : [26, 28, 31]);
    place(B2, 42, [41, 38]);
    var nextDow = mod(rhNext, 7);
    if (nextDow === 4 || nextDow === 6) place(C, 51, [50]); else place(C, 50, []);
    parshaCache[key] = map;
    return map;
  }
  function parshaForShabbos(rd, israel) {
    var h = hebFromRD(rd);
    var map = yearParshios(h.y, israel);
    return map[rd] || null;
  }
  /* Parsha of the week containing rd (the upcoming Shabbos, or rd itself when it is Shabbos). */
  function parshaOfWeek(rd, israel) {
    var sh = rd + mod(6 - mod(rd, 7), 7);
    var p = parshaForShabbos(sh, israel);
    if (!p) return null;
    return p.map(function (i) { return PARSHIOS[i]; }).join('־');
  }

  /* ---------- Holidays / day info ---------- */
  function dayInfo(rd, israel) {
    var h = hebFromRD(rd), y = h.y, m = h.m, d = h.d, dow = mod(rd, 7);
    var o = { rd: rd, heb: h, dow: dow, shabbos: dow === 6, yomtov: false, yomKippur: false, cholHamoed: false,
      erevYT: false, fast: false, roshChodesh: false, chanukah: false, purim: false, labels: [] };
    function yt(l) { o.yomtov = true; o.labels.push(l); }
    function lbl(l) { o.labels.push(l); }
    if (d === 1 && m !== 7) o.roshChodesh = true;
    if (d === 30) o.roshChodesh = true;
    if (m === 7) {
      if (d === 1 || d === 2) yt('ראש השנה');
      if (d === 3 && dow !== 6) { o.fast = true; lbl('צום גדליה'); }
      if (d === 4 && dow === 0) { o.fast = true; lbl('צום גדליה'); }
      if (d === 9) { o.erevYT = true; lbl('ערב יום כיפור'); }
      if (d === 10) { yt('יום הכיפורים'); o.yomKippur = true; }
      if (d === 14) { o.erevYT = true; lbl('ערב סוכות'); }
      if (d === 15 || (d === 16 && !israel)) yt('סוכות');
      if ((d >= 17 || (d === 16 && israel)) && d <= 20) { o.cholHamoed = true; lbl('חול המועד סוכות'); }
      if (d === 21) { o.cholHamoed = true; o.erevYT = true; lbl('הושענא רבה'); }
      if (d === 22) yt(israel ? 'שמיני עצרת ושמחת תורה' : 'שמיני עצרת');
      if (d === 23 && !israel) yt('שמחת תורה');
    }
    if (m === 9 && d >= 25) { o.chanukah = true; lbl('חנוכה'); }
    if (m === 10) {
      var kislevLen = hebMonthLength(y, 9);
      var chanukahEnd = kislevLen === 30 ? 2 : 3;
      if (d <= chanukahEnd) { o.chanukah = true; lbl('חנוכה'); }
      if (d === 10) { o.fast = true; lbl('עשרה בטבת'); }
    }
    if (m === 11 && d === 15) lbl('ט״ו בשבט');
    var adar = hebLeap(y) ? 13 : 12;
    if (m === 12 && hebLeap(y) && d === 14) lbl('פורים קטן');
    if (m === adar) {
      if (d === 13 && dow !== 6) { o.fast = true; lbl('תענית אסתר'); }
      if (d === 11 && dow === 4 && mod(rd + 2, 7) === 6) { o.fast = true; lbl('תענית אסתר'); }
      if (d === 14) { o.purim = true; lbl('פורים'); }
      if (d === 15) lbl('שושן פורים');
    }
    if (m === 1) {
      if (d === 14) { o.erevYT = true; lbl('ערב פסח'); }
      if (d === 15 || (d === 16 && !israel)) yt('פסח');
      if ((d >= 17 || (d === 16 && israel)) && d <= 20) { o.cholHamoed = true; lbl('חול המועד פסח'); }
      if (d === 20) o.erevYT = true;
      if (d === 21) yt('שביעי של פסח');
      if (d === 22 && !israel) yt('אחרון של פסח');
      if (d === 22 && israel) lbl('אסרו חג');
    }
    if (m === 2 && d === 14) lbl('פסח שני');
    if (m === 2 && d === 18) lbl('ל״ג בעומר');
    if (m === 3) {
      if (d === 5) { o.erevYT = true; lbl('ערב שבועות'); }
      if (d === 6 || (d === 7 && !israel)) yt('שבועות');
      if (d === 7 && israel) lbl('אסרו חג');
    }
    if (m === 4) {
      if (d === 17 && dow !== 6) { o.fast = true; lbl('שבעה עשר בתמוז'); }
      if (d === 18 && dow === 0) { o.fast = true; lbl('שבעה עשר בתמוז'); }
    }
    if (m === 5) {
      if (d === 9 && dow !== 6) { o.fast = true; lbl('תשעה באב'); }
      if (d === 10 && dow === 0) { o.fast = true; lbl('תשעה באב'); }
      if (d === 15) lbl('ט״ו באב');
    }
    if (m === 6 && d === 29) { o.erevYT = true; lbl('ערב ראש השנה'); }
    if (o.roshChodesh) {
      var rcMonth = d === 30 ? (m === hebLastMonth(y) ? 1 : m + 1) : m;
      var rcYear = (d === 30 && m === 6) ? y + 1 : y;
      o.labels.push('ראש חודש ' + monthName(rcYear, rcMonth));
    }
    return o;
  }
  /* Which schedule key applies. */
  function dayType(info) {
    if (info.yomKippur) return 'yomkippur';
    if (info.yomtov) return 'yomtov';
    if (info.shabbos) return 'shabbos';
    if (info.erevYT) return 'erev_yomtov';
    if (info.dow === 5) return 'friday';
    if (info.cholHamoed) return 'chol_hamoed';
    if (info.fast) return 'fast';
    if (info.roshChodesh) return 'rosh_chodesh';
    if (info.chanukah) return 'chanukah';
    if (info.purim) return 'purim';
    if (info.dow === 0) return 'sunday';
    return 'weekday';
  }
  var LABELS = ['ראש השנה', 'צום גדליה', 'ערב יום כיפור', 'יום הכיפורים', 'ערב סוכות', 'סוכות', 'חול המועד סוכות', 'הושענא רבה', 'שמיני עצרת', 'שמחת תורה',
    'חנוכה', 'עשרה בטבת', 'ט״ו בשבט', 'פורים קטן', 'תענית אסתר', 'פורים', 'שושן פורים', 'ערב פסח', 'פסח', 'חול המועד פסח', 'שביעי של פסח', 'אחרון של פסח',
    'אסרו חג', 'פסח שני', 'ל״ג בעומר', 'ערב שבועות', 'שבועות', 'שבעה עשר בתמוז', 'תשעה באב', 'ט״ו באב', 'ערב ראש השנה', 'ראש חודש'];
  /* [key, Hebrew name (board), fallback key, English name (settings)] */
  var DAY_TYPES = [
    ['weekday', 'ימי חול', null, 'Weekdays'], ['sunday', 'יום ראשון', 'weekday', 'Sunday'], ['friday', 'ערב שבת', 'weekday', 'Erev Shabbos (Friday)'],
    ['shabbos', 'שבת קודש', null, 'Shabbos'], ['yomtov', 'יום טוב', 'shabbos', 'Yom Tov'], ['erev_yomtov', 'ערב יום טוב', 'friday', 'Erev Yom Tov'],
    ['chol_hamoed', 'חול המועד', 'weekday', 'Chol Hamoed'], ['rosh_chodesh', 'ראש חודש', 'weekday', 'Rosh Chodesh'], ['fast', 'תענית ציבור', 'weekday', 'Fast day'],
    ['chanukah', 'חנוכה', 'weekday', 'Chanukah'], ['purim', 'פורים', 'weekday', 'Purim'], ['yomkippur', 'יום כיפור', 'yomtov', 'Yom Kippur']];

  /* ---------- Sun (NOAA) ---------- */
  function rad(x) { return x * Math.PI / 180; }
  function deg(x) { return x * 180 / Math.PI; }
  function jcent(jd) { return (jd - 2451545.0) / 36525.0; }
  function geomMeanLong(t) { return mod(280.46646 + t * (36000.76983 + t * 0.0003032), 360); }
  function geomMeanAnom(t) { return 357.52911 + t * (35999.05029 - 0.0001537 * t); }
  function eccEarth(t) { return 0.016708634 - t * (0.000042037 + 0.0000001267 * t); }
  function eqCenter(t) { var m = rad(geomMeanAnom(t)); return Math.sin(m) * (1.914602 - t * (0.004817 + 0.000014 * t)) + Math.sin(2 * m) * (0.019993 - 0.000101 * t) + Math.sin(3 * m) * 0.000289; }
  function appLong(t) { var o = geomMeanLong(t) + eqCenter(t); return o - 0.00569 - 0.00478 * Math.sin(rad(125.04 - 1934.136 * t)); }
  function obliq(t) { var s = 21.448 - t * (46.815 + t * (0.00059 - t * 0.001813)); var e0 = 23 + (26 + s / 60) / 60; return e0 + 0.00256 * Math.cos(rad(125.04 - 1934.136 * t)); }
  function declination(t) { return deg(Math.asin(Math.sin(rad(obliq(t))) * Math.sin(rad(appLong(t))))); }
  function eqTime(t) {
    var eps = rad(obliq(t)), l0 = rad(geomMeanLong(t)), e = eccEarth(t), m = rad(geomMeanAnom(t));
    var y = Math.tan(eps / 2); y *= y;
    var E = y * Math.sin(2 * l0) - 2 * e * Math.sin(m) + 4 * e * y * Math.sin(m) * Math.cos(2 * l0) - 0.5 * y * y * Math.sin(4 * l0) - 1.25 * e * e * Math.sin(2 * m);
    return deg(E) * 4;
  }
  function hourAngle(lat, decl, zenith) {
    var cosHA = Math.cos(rad(zenith)) / (Math.cos(rad(lat)) * Math.cos(rad(decl))) - Math.tan(rad(lat)) * Math.tan(rad(decl));
    if (cosHA > 1 || cosHA < -1) return NaN;
    return deg(Math.acos(cosHA));
  }
  /* Minutes after 0:00 UTC of the civil date rd (approx. local day) for the sun reaching `zenith`. */
  function sunUTC(rd, lat, lng, zenith, rising) {
    var jd = rd + 1721424.5;
    var t = jcent(jd - lng / 360);
    var time = 720, i;
    for (i = 0; i < 3; i++) {
      var ha = hourAngle(lat, declination(t), zenith);
      if (isNaN(ha)) return NaN;
      time = 720 - 4 * (lng + (rising ? ha : -ha)) - eqTime(t);
      t = jcent(jd + time / 1440);
    }
    return time;
  }
  /* Zmanim as wall-clock minutes in tz for the civil date rd. */
  function zmanim(rd, loc) {
    var lat = loc.lat, lng = loc.lng, tz = loc.tz, elev = loc.elev || 0;
    var elevAdj = elev > 0 ? 0.0347 * Math.sqrt(elev) : 0;
    function wall(utcMin) {
      if (isNaN(utcMin)) return NaN;
      var ms = (rd - RD_EPOCH_MS) * 86400000 + utcMin * 60000;
      return utcMin + tzOffsetMin(ms, tz);
    }
    var sunrise = wall(sunUTC(rd, lat, lng, 90.833 + elevAdj, true));
    var sunset = wall(sunUTC(rd, lat, lng, 90.833 + elevAdj, false));
    var alos = wall(sunUTC(rd, lat, lng, 106.1, true));
    var tzeisDeg = wall(sunUTC(rd, lat, lng, 90 + (loc.tzeisDeg || 8.5), false));
    var shaah = (sunset - sunrise) / 12;
    var tzeis = loc.tzeisMinutes ? sunset + loc.tzeisMinutes : tzeisDeg;
    return {
      alos: alos, sunrise: sunrise, shema: sunrise + 3 * shaah, tefilla: sunrise + 4 * shaah,
      chatzos: sunrise + 6 * shaah, minchag: sunrise + 6.5 * shaah, plag: sunrise + 10.75 * shaah,
      candles: sunset - (loc.candles == null ? 18 : loc.candles), sunset: sunset, tzeis: tzeis, tzeis60: sunset + 60, tzeis72: sunset + 72
    };
  }
  var ZMAN_NAMES = { alos: 'עלות השחר', sunrise: 'נץ החמה', shema: 'סוף זמן ק״ש', tefilla: 'סוף זמן תפילה', chatzos: 'חצות',
    minchag: 'מנחה גדולה', plag: 'פלג המנחה', candles: 'הדלקת נרות', sunset: 'שקיעה', tzeis: 'צאת הכוכבים', tzeis60: '60 מינוט אחר השקיעה', tzeis72: 'ר״ת (72)' };

  /* ---------- Time zone helpers ---------- */
  var fmtCache = {};
  function tzFmt(tz) {
    if (!fmtCache[tz]) fmtCache[tz] = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
    return fmtCache[tz];
  }
  function tzParts(ms, tz) {
    var p = {}, parts = tzFmt(tz).formatToParts(new Date(ms)), i;
    for (i = 0; i < parts.length; i++) p[parts[i].type] = parts[i].value;
    return { y: +p.year, m: +p.month, d: +p.day, hh: (+p.hour) % 24, mm: +p.minute, ss: +p.second };
  }
  function tzOffsetMin(ms, tz) {
    var p = tzParts(ms, tz);
    return (Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss) - Math.floor(ms / 1000) * 1000) / 60000;
  }
  /* Epoch ms of wall-clock minute `min` (may exceed 1440) on civil date rd in tz. */
  function epochFromWall(rd, min, tz) {
    var g = gregFromRD(rd);
    var guess = Date.UTC(g.y, g.m - 1, g.d, 0, 0) + min * 60000;
    var off = tzOffsetMin(guess, tz);
    var e = guess - off * 60000;
    off = tzOffsetMin(e, tz);
    return guess - off * 60000;
  }
  function nowInTz(ms, tz) {
    var p = tzParts(ms, tz);
    var rd = rdFromGreg(p.y, p.m, p.d);
    return { rd: rd, min: p.hh * 60 + p.mm + p.ss / 60, parts: p, ms: ms };
  }

  return {
    mod: mod, rdFromGreg: rdFromGreg, gregFromRD: gregFromRD, rdFromHeb: rdFromHeb, hebFromRD: hebFromRD, hebLeap: hebLeap,
    hebMonthLength: hebMonthLength, hebNewYear: hebNewYear, gematria: gematria, monthName: monthName, formatHeb: formatHeb,
    DAY_NAMES: DAY_NAMES, DAY_SHORT: DAY_SHORT, PARSHIOS: PARSHIOS, LABELS: LABELS, parshaForShabbos: parshaForShabbos, parshaOfWeek: parshaOfWeek,
    dayInfo: dayInfo, dayType: dayType, DAY_TYPES: DAY_TYPES, zmanim: zmanim, ZMAN_NAMES: ZMAN_NAMES,
    tzParts: tzParts, tzOffsetMin: tzOffsetMin, epochFromWall: epochFromWall, nowInTz: nowInTz
  };
})();


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
    function dayTexts(rd, info) {
      var type = Cal.dayType(info), iso = isoDate(rd);
      var ovr = pickOverride(rd, info);
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
  var EN_ZMANIM = { alos: 'Alos', sunrise: 'Sunrise', shema: 'Shema', tefilla: 'Tefilla', chatzos: 'Chatzos', minchag: 'Mincha gedola', plag: 'Plag', candles: 'Candles', sunset: 'Sunset', tzeis: 'Tzeis', tzeis60: 'Tzeis 60', tzeis72: 'R"T' };
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



/* ---- Twilio Function (Node 18+). Add an Environment Variable CONFIG_URL = https://YOUR-SITE/config.json
   and point your number's "A message comes in" webhook at this function. ---- */
exports.handler = async function (context, event, callback) {
  var twiml = new Twilio.twiml.MessagingResponse();
  try {
    var res = await fetch(context.CONFIG_URL, { cache: 'no-store' });
    var cfg = await res.json();
    var cmd = MinyanNotify.parseCommand(event.Body || '', cfg);
    var reply = cmd ? MinyanNotify.T[cmd.lang].notAvail : MinyanSms.buildReply(cfg, event.Body || '', Date.now()).text;
    if (reply) twiml.message(reply);
  } catch (e) {
    twiml.message('Sorry, the schedule is unavailable right now. / הלוח אינו זמין כרגע');
  }
  return callback(null, twiml);
};
