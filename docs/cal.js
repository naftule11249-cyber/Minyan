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
  /* Mincha gedola: half a proportional hour after chatzos ('zmanis'), 30 clock minutes after chatzos ('fixed30'), or the later of the two ('later', the default) */
  function minchaGedola(chatzos, shaah, mode) {
    var z = chatzos + shaah / 2, f = chatzos + 30;
    return mode === 'zmanis' ? z : mode === 'fixed30' ? f : Math.max(z, f);
  }
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
      chatzos: sunrise + 6 * shaah, minchag: minchaGedola(sunrise + 6 * shaah, shaah, loc.minchaGedola), plag: sunrise + 10.75 * shaah,
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
if (typeof module !== 'undefined') module.exports = Cal;
