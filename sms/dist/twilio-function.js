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
  /* A day, and what its evening is. Candle lighting and the end of Shabbos or Yom Tov depend on the day after:
       candles: 'day'   lit before sunset — an ordinary day, or a Yom Tov, whose night brings Shabbos or Yom Tov in (Friday, Erev
                        Yom Tov, a Yom Tov that falls on Friday)
                'night' lit after nightfall — Shabbos going into Yom Tov, or the first day of Yom Tov going into the second
                ''      no candles that evening
       motzaei: 'shabbos' | 'yomtov' when this day's nightfall ends it, '' when it runs on into another holy day or is an ordinary day */
  function dayInfo(rd, israel) {
    var o = baseInfo(rd, israel), t = baseInfo(rd + 1, israel), holy = o.shabbos || o.yomtov, holyNext = t.shabbos || t.yomtov;
    o.candles = !holyNext ? '' : (o.shabbos || (o.yomtov && !t.shabbos)) ? 'night' : 'day';
    o.motzaei = holy && !holyNext ? (o.shabbos ? 'shabbos' : 'yomtov') : '';
    return o;
  }
  function baseInfo(rd, israel) {
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
  /* Mincha gedola after chatzos: half a proportional hour of sunrise-to-sunset ('zmanis'), 30 clock minutes ('fixed30'), the later of those two ('later', the default),
     or half a proportional hour of the Magen Avraham day, dawn to nightfall at 72 minutes each side ('mga': (12 * shaah + 144) / 24 = shaah / 2 + 6) */
  function minchaGedola(chatzos, shaah, mode) {
    var z = chatzos + shaah / 2, f = chatzos + 30;
    return mode === 'mga' ? chatzos + shaah / 2 + 6 : mode === 'zmanis' ? z : mode === 'fixed30' ? f : Math.max(z, f);
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
    var alos = sunrise - 72; /* dawn by the Magen Avraham, 72 minutes before sunrise: the day the shul's own zmanim board reckons by */
    var tzeisDeg = wall(sunUTC(rd, lat, lng, 90 + (loc.tzeisDeg || 8.5), false));
    var shaah = (sunset - sunrise) / 12;
    var tzeis = loc.tzeisMinutes ? sunset + loc.tzeisMinutes : tzeisDeg;
    return {
      alos: alos, sunrise: sunrise, shema: sunrise + 3 * shaah, tefilla: sunrise + 4 * shaah,
      /* by the Magen Avraham, the day from 72 minutes before sunrise to 72 after sunset; a latest time is told to the minute before, never the minute after */
      shemaMGA: Math.floor((sunrise - 72) + 3 * ((sunset - sunrise + 144) / 12)), tefillaMGA: Math.floor((sunrise - 72) + 4 * ((sunset - sunrise + 144) / 12)),
      chatzos: sunrise + 6 * shaah, minchag: minchaGedola(sunrise + 6 * shaah, shaah, loc.minchaGedola), plag: sunrise + 10.75 * shaah,
      /* מנחה קטנה by the Magen Avraham: nine and a half proportional hours of the day from dawn to nightfall, 72 minutes before sunrise and after sunset */
      minchak: (sunrise - 72) + 9.5 * ((sunset - sunrise + 144) / 12),
      candles: sunset - (loc.candles == null ? 18 : loc.candles), sunset: sunset, tzeis: tzeis, tzeis60: sunset + 60, tzeis72: sunset + 72,
      chatzosNight: sunrise + 6 * shaah + 720 /* twelve hours after the day's חצות */
    };
  }
  var ZMAN_NAMES = { alos: 'עלות השחר', sunrise: 'הנץ החמה', shemaMGA: 'סוזק״ש (מג״א)', shema: 'סוזק״ש (גר״א)', tefillaMGA: 'סוז״ת (מג״א)', tefilla: 'סוז״ת (גר״א)', chatzos: 'חצות היום',
    minchag: 'מנחה גדולה', minchak: 'מנחה קטנה', plag: 'פלג המנחה', candles: 'הדלקת הנרות', sunset: 'שקיעה', tzeis: 'צאת הכוכבים', tzeis60: '60 מינוט אחר השקיעה', tzeis72: 'ר״ת (72)', chatzosNight: 'חצות לילה' };

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
  var ZMAN_ALIAS = { 'הדלקה־ערש״ק': 'fricandles', 'הדלקה_ערש"ק': 'fricandles', 'fricandles': 'fricandles', 'שקיעה': 'sunset', 'sunset': 'sunset', 'נץ': 'sunrise', 'sunrise': 'sunrise', 'הדלקה': 'candles', 'candles': 'candles',
    'צאת': 'tzeis', 'tzeis': 'tzeis', 'פלג': 'plag', 'plag': 'plag', 'חצות': 'chatzos', 'chatzos': 'chatzos', 'עלות': 'alos', 'alos': 'alos',
    'ר״ת': 'tzeis72', 'ר"ת': 'tzeis72', 'rt': 'tzeis72', 'tzeis60': 'tzeis60', 'צאת60': 'tzeis60', 'minchag': 'minchag', 'מנחה־גדולה': 'minchag', 'minchak': 'minchak', 'מנחה־קטנה': 'minchak', 'שמע': 'shema', 'shema': 'shema', 'tefilla': 'tefilla', 'תפילה': 'tefilla' };
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
    /* "sunset-20~5" rounds down to 5 minutes, "sunset-20^5" rounds up */
    m = /^([^+\-~^]+?)\s*(?:([+-])\s*(\d+))?\s*(?:([~^])(\d+))?$/.exec(tok);
    if (!m) return null;
    var z = ZMAN_ALIAS[m[1].trim()];
    if (!z) return null;
    return { kind: 'zman', zman: z, offset: m[2] ? (+m[3]) * (m[2] === '-' ? -1 : 1) : 0, round: m[5] ? +m[5] : 0, roundUp: m[4] === '^' };
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
      /* fricandles: this week's Friday candle lighting, so a Shabbos Mincha written as fricandles+35 matches the weekly sheet */
      var base = spec.zman === 'fricandles' ? zmanimFor(rd - Cal.mod(Cal.mod(rd, 7) - 5, 7)).candles : (cfg.weeklyEarliest && WEEKLY_TYPES[type]) ? weeklyBase(rd, spec.zman) : zmanimFor(rd)[spec.zman];
      if (isNaN(base) || !isFinite(base)) return NaN;
      var v = Math.round(base) + spec.offset; /* start from the zman as the zmanim list shows it (to the minute), then add the offset */
      return spec.round ? (spec.roundUp ? Math.ceil(v / spec.round) : Math.floor(v / spec.round)) * spec.round : v;
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
      /* "until 00:15" after a 22:15 start runs past midnight; but a run whose end has passed before it starts (summer: "from rt+14 to 20:00"
         when rt+14 is already 9:50 PM) simply does not take place that day, instead of running on for a day */
      if (p.spec.end && end < start) { if (end + 1440 - start <= 6 * 60) end += 1440; else return out; }
      var n = 0, m = start, limit = p.spec.count || 500, rnd = p.spec.start.round || 0, rUp = !!p.spec.start.roundUp, t;
      while (n < limit && n < 500 && (!p.spec.end || m <= end)) {
        t = rnd ? (rUp ? Math.ceil(m / rnd) : Math.floor(m / rnd)) * rnd : m;
        if (!out.length || out[out.length - 1].start !== t) out.push({ start: t, room: p.rooms.length ? p.rooms[out.length % p.rooms.length] : '', note: p.note });
        m += p.spec.every; n++;
      }
      return out;
    }
    function tefillos() { return (cfg.tefillos && cfg.tefillos.length) ? cfg.tefillos : TEFILLA_DEFAULTS; }
    /* sponsor notices that are on today: non-empty body, and inside their from/to dates when set */
    /* The donations on the board on a day. With `min` (minutes since midnight by the shul's clock) a donation for part of a day is
       held to its hours: from fromTime on its first day until toTime on its last. Without it, the whole day counts. */
    function clockMin(v) { var m = /^(\d{1,2}):(\d{2})$/.exec(v || ''); return m && +m[1] < 24 && +m[2] < 60 ? +m[1] * 60 + +m[2] : null; }
    function activeNotices(rd, min) {
      var iso = isoDate(rd);
      return (cfg.notices || []).filter(function (n) {
        if (n.off) return false; /* switched off in the back end: kept, not shown */
        if (!((n.body || '') + (n.name || '') + (n.lead || '')).trim()) return false; /* a name on its own is a sponsor too */
        if (n.from && iso < n.from) return false;
        if (n.to && iso > n.to) return false;
        if (min != null) {
          var a = clockMin(n.fromTime), b = clockMin(n.toTime);
          if (a != null && n.from && iso === n.from && min < a) return false;
          if (b != null && n.to && iso === n.to && min >= b) return false;
        }
        return true;
      });
    }
    /* the temporary banner, or null before its start or after its end (from / until = "YYYY-MM-DDTHH:MM" in the shul's time zone) */
    function wallMs(v) { var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v || ''); return m ? Cal.epochFromWall(Cal.rdFromGreg(+m[1], +m[2], +m[3]), +m[4] * 60 + +m[5], loc().tz) : null; }
    function activeBanner(nowMs) {
      var b = cfg.banner;
      if (!b || !(b.text || '').trim()) return null;
      var from = wallMs(b.from), until = wallMs(b.until);
      if (from != null && nowMs < from) return null;
      if (until != null && nowMs >= until) return null;
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
    /* An extra schedule: a named list that takes over for the days it covers. The one with the highest priority wins; a special date
       still beats them all, and a tefilla the schedule says nothing about falls back to the day type's own list. */
    function pickRoll(rd, info, type) {
      var list = cfg.rolls || [], iso = isoDate(rd), best = null, i, r;
      for (i = 0; i < list.length; i++) {
        r = list[i];
        if (!r || r.active === false) continue;
        if (r.type && r.type !== 'any' && r.type !== type) continue;
        if (r.from && iso < r.from) continue;
        if (r.to && iso > r.to) continue;
        if (r.dows && r.dows.length && r.dows.indexOf(info.dow) < 0) continue;
        if (!r.lines || !Object.keys(r.lines).some(function (k) { return (r.lines[k] || '').trim(); })) continue;
        if (!best || (+r.priority || 0) >= (+best.priority || 0)) best = r;
      }
      return best;
    }
    /* The kind of day one tefilla goes by. Yom Tov on a Friday: Shabbos comes in that evening, so its afternoon and evening
       tefillos are Erev Shabbos's, not the Yom Tov's own (whose Maariv is a night-after-Yom-Tov Maariv, long after candle lighting). */
    function kindFor(type, info, t) { return type === 'yomtov' && info.dow === 5 && t.period === 'pm' ? 'friday' : type; }
    /* What a tefilla is called, and what its second time is, can differ by the kind of day (Schedule → a kind of day → a tefilla →
       "On …"): on Shabbos שחרית may have another second time or none, Friday's מעריב may be called קבלת שבת.
       The second time: a kind of day that sets nothing follows the one it follows for its lists (Yom Tov → Shabbos; Rosh Chodesh on a
       Sunday → Sunday), and in the end the tefilla as it is every day. The name belongs to its own kind of day only: קבלת שבת is
       Friday's, and must not turn up on Erev Yom Tov because that day borrows Friday's times. */
    function tefillaOn(t, kind, info) {
      var set = cfg.dayTefilla || {}, k = kind, name = null, second = null, o = set[kind] && set[kind][t.id], d = null;
      if (o && o.name != null && String(o.name).trim()) name = String(o.name).trim();
      while (k && second == null) {
        o = set[k] && set[k][t.id];
        if (o && (o.second === 'none' || o.second === 'own')) second = o;
        k = fallbackFor(k, info);
      }
      if (name == null && second == null) return t;
      d = {}; Object.keys(t).forEach(function (key) { d[key] = t[key]; });
      if (name != null) d.name = name;
      if (second) {
        var label = second.second === 'own' ? String(second.milestone == null ? '' : second.milestone).trim() : '';
        d.milestone = label; d.offset = label ? Math.max(0, +second.offset || 0) : 0; /* "its own" with no name given is no second time, not a nameless one */
      }
      return d;
    }
    function dayTexts(rd, info) {
      var type = Cal.dayType(info), iso = isoDate(rd);
      var ovr = pickOverride(rd, info), roll = pickRoll(rd, info, type);
      var out = { type: type, override: ovr, roll: roll, texts: {} };
      tefillos().forEach(function (t) {
        var text = null, src = null, k = kindFor(type, info, t), s;
        if (ovr && ovr.lines && ovr.lines[t.id] && ovr.lines[t.id].trim()) { text = ovr.lines[t.id]; src = 'override'; }
        if (text == null && roll && roll.lines && (roll.lines[t.id] || '').trim()) { text = roll.lines[t.id]; src = 'roll'; }
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
      var info = Cal.dayInfo(rd, !!cfg.israel), dt = dayTexts(rd, info), tz = loc().tz, byT = {}, tefOf = {}, all = [], rank = roomRank();
      tefillos().forEach(function (t0) {
        var list = [], t = tefillaOn(t0, kindFor(dt.type, info, t0), info); /* the tefilla as it is on this kind of day */
        var offset = (t.offset == null || t.offset === '') ? 0 : +t.offset;
        dt.texts[t.id].text.split('\n').forEach(function (line, li) {
          var p = parseLine(line, t), items = expand(p, rd, dt.type);
          /* a repeating line ("every 10 from … to …") marks its minyanim, so a screen can write the run as one line instead of a tile each */
          var run = p && p.spec && p.spec.kind === 'series' && items.length ? { id: t.id + ':' + li, every: p.spec.every, rooms: p.rooms || [], from: items[0].start, to: items[items.length - 1].start, count: items.length } : null;
          items.forEach(function (x) {
            list.push({ tefilla: t, room: x.room, note: x.note, start: x.start, ms: Cal.epochFromWall(rd, x.start, tz), milestone: x.start + offset, rd: rd, series: run,
              zman: p.spec.kind === 'zman' ? p.spec.zman : '', zoff: p.spec.kind === 'zman' ? p.spec.offset : 0 }); /* the zman a single minyan goes by ("minchag", "sunset" …), for a screen that names it */
          });
        });
        list.sort(function (a, b) { return a.start - b.start || rank(a.room) - rank(b.room); });
        byT[t.id] = list; tefOf[t.id] = t; all = all.concat(list);
      });
      all.sort(function (a, b) { return a.start - b.start || rank(a.room) - rank(b.room); });
      return { rd: rd, info: info, type: dt.type, override: dt.override, roll: dt.roll, byTefilla: byT, tefillos: tefOf, all: all }; /* tefillos: each tefilla as this day has it (name, second time) */
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
  /* One-day changes that were texted in (src/edit.js) are kept by the text service, not in the published settings. This lays them
     over the settings: days = { '2026-11-22': { mincha: { line, base, at } } }, where line is that tefilla's list for that day as a
     special date writes it (null: no list of its own), and base is the line the settings themselves had for it when the text came.
     A change holds only while the settings still have that same line: once the back end has given the day another list for that
     tefilla, the back end's stands. The settings object itself is never altered. */
  function withDayLines(cfg, days) {
    var isos = Object.keys(days || {}), touched = false;
    if (!isos.length) return cfg;
    var list = (cfg.overrides || []).map(function (o) { var c = {}, k; for (k in o) c[k] = o[k]; c.lines = {}; for (k in (o.lines || {})) c.lines[k] = o.lines[k]; return c; }), emptied = [];
    isos.forEach(function (iso) {
      Object.keys(days[iso] || {}).forEach(function (tef) {
        var e = days[iso][tef]; if (!e) return;
        var ovr = list.filter(function (o) { return o.date === iso; })[0], own = ovr && Object.prototype.hasOwnProperty.call(ovr.lines, tef) ? ovr.lines[tef] : null;
        if (own !== (e.base == null ? null : e.base)) return;
        if (e.line == null) { if (own != null) { delete ovr.lines[tef]; if (!Object.keys(ovr.lines).length) emptied.push(ovr); touched = true; } return; }
        if (!ovr) { ovr = { date: iso, label: 'שינוי', lines: {} }; list.push(ovr); }
        ovr.lines[tef] = e.line; touched = true;
      });
    });
    if (!touched) return cfg;
    var out = {}, k; for (k in cfg) out[k] = cfg[k];
    out.overrides = list.filter(function (o) { return emptied.indexOf(o) < 0 || Object.keys(o.lines).length; });
    return out;
  }
  create.withDayLines = withDayLines;
  create.parseLine = parseLine; create.parseSpec = parseSpec; create.sameEntry = sameEntry; create.gregStr = gregStr; create.isoDate = isoDate;
  create.TEFILLA_DEFAULTS = TEFILLA_DEFAULTS; create.FALLBACK = FALLBACK; create.TYPE_NAME = TYPE_NAME; create.TYPE_NAME_EN = TYPE_NAME_EN;
  return create;
})();


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
  /* "פון 8:00 ביז 12:00 און פון 1:30 ביז 3:15, נישט פאר קינדער" — or each set with its own kids when they differ; open to kids says nothing */
  function hoursText(cfg, x) {
    var e = MinyanEngine(cfg), rs = x.ranges;
    /* the time of day after each time: אינדערפרי before noon, נאכמיטאג until 6, ביינאכט from 6 */
    function part(m) { m = ((m % 1440) + 1440) % 1440; return m < 720 ? ' אינדערפרי' : m < 1080 ? ' נאכמיטאג' : ' ביינאכט'; }
    function at(m) { return e.fmtTime(m) + (cfg.clock24 ? '' : part(m)); }
    function one(r) { /* "פון 1:00 ביז 3:04 נאכמיטאג": the word once when both times are in the same part of the day */
      if (!cfg.clock24 && part(r.from) === part(r.until)) return 'פון ' + e.fmtTime(r.from) + ' ביז ' + e.fmtTime(r.until) + part(r.until);
      return 'פון ' + at(r.from) + ' ביז ' + at(r.until);
    }
    function kids(k) { return k ? '' : ', נישט פאר קינדער'; } /* kids are said only when they are not taken */
    if (rs.every(function (r) { return r.kids === rs[0].kids; })) return rs.map(one).join(' און ') + kids(rs[0].kids);
    return rs.map(function (r) { return one(r) + kids(r.kids); }).join('; ');
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


/* sms.js — builds the text-message reply for "when is the next minyan". Needs cal.js and engine.js.
   MinyanSms.buildReply(cfg, incomingText, nowMs) -> { text, lang, keyword } */
var MinyanSms = (function () {
  'use strict';
  var T = {
    he: { next: 'מנין הבא', last: 'מנין העבר', then: 'אחריו', in_: 'בעוד', min: 'דק׳', hr: 'שע׳', today: 'היום', tomorrow: 'מחר', none: 'לא רשומים מנינים בימים הקרובים.',
      left: 'נותרו', noneToday: 'אין עוד מנינים היום', zmanim: 'זמני היום', more: 'ועוד',
      help: 'שלחו אחת מהמילים: מנין, שחרית, מנחה, מעריב, היום, מחר, זמנים. להפסקה שלחו STOP.' },
    en: { next: 'Next minyan', last: 'Last minyan', then: 'Then', in_: 'in', min: 'min', hr: 'hr', today: 'Today', tomorrow: 'Tomorrow', none: 'No minyanim are listed for the coming days.',
      left: 'left', noneToday: 'No more minyanim today', zmanim: "Today's zmanim", more: 'more',
      help: 'Text one of: next, shacharis, mincha, maariv, today, tomorrow, zmanim. Reply STOP to opt out, HELP for help. Msg and data rates may apply.' }
  };
  var EN_TEFILLA = { shacharis: 'Shacharis', mincha: 'Mincha', maariv: 'Maariv' };
  var EN_MILESTONE = { 'הודו': 'Hodu', 'שמונה עשרה': 'Shemoneh Esrei', 'ברכו': 'Borchu', 'ישתבח': 'Yishtabach', 'נשמת': 'Nishmas' };
  var EN_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Shabbos'];
  var EN_ZMANIM = { alos: 'Alos', sunrise: 'Sunrise', shema: 'Shema', tefilla: 'Tefilla', chatzos: 'Chatzos', minchag: 'Mincha gedola', minchak: 'Mincha ketana', plag: 'Plag', candles: 'Candles', sunset: 'Sunset', tzeis: 'Tzeis', tzeis60: 'Tzeis 60', tzeis72: 'R"T' };
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
    /* reply language: General → "Text replies" (לשון קודש always, English always, or the sender's language); HELP always answers in the sender's language */
    var engine = MinyanEngine(cfg), senderLang = hasHebrew(text || '') ? 'he' : 'en', lang = cfg.smsLang === 'he' || cfg.smsLang === 'en' ? cfg.smsLang : senderLang, L = T[lang];
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
    /* a minyan that has begun but whose הודו (the tefilla's milestone) is still 3 minutes or more away can still be caught: it leads the
       reply as "מנין העבר", ahead of the next two. Tefillos without a milestone have no such window. */
    function justStarted(tefillaId) {
      var best = null, tz = engine.loc().tz;
      [rd - 1, rd].forEach(function (d) {
        var s = engine.scheduleFor(d);
        engine.tefillos().forEach(function (t) {
          if (t.kind === 'event' || (tefillaId && t.id !== tefillaId)) return;
          (s.byTefilla[t.id] || []).forEach(function (e) {
            if (!e.tefilla.milestone) return; /* the tefilla as that day has it: Shabbos may have another second time, or none */
            if (e.ms <= nowMs && Cal.epochFromWall(d, e.milestone, tz) - nowMs >= 3 * 60000 && (!best || e.ms > best.ms)) best = e;
          });
        });
      });
      return best;
    }
    var out = '', list, first, second, i, last;
    if (k === 'carrier') return { text: '', lang: lang, keyword: k };
    /* "שערן" and the other words set on the admin page's Shere tab: the barber's hours this week, in Yiddish */
    var shere = typeof MinyanShere !== 'undefined' ? MinyanShere.reply(cfg, text, nowMs) : null;
    if (shere) return { text: shere, lang: 'yi', keyword: 'shere' };
    if (k === 'help') out = T[senderLang].help;
    else if (k === 'zmanim') {
      var z = engine.zmanimFor(rd), info = Cal.dayInfo(rd, !!cfg.israel), keys = ['sunrise', 'shema', 'chatzos', 'minchak', 'candles', 'sunset', 'tzeis'], parts = [];
      keys.forEach(function (key) {
        if (key === 'candles' && info.candles !== 'day') return;
        parts.push((lang === 'he' ? Cal.ZMAN_NAMES[key] : EN_ZMANIM[key]) + ' ' + engine.fmtTime(z[key]));
      });
      out = L.zmanim + ' (' + dayHeader(rd) + '): ' + parts.join(', ');
    }
    else if (k === 'today' || k === 'tomorrow') {
      var d = k === 'today' ? rd : rd + 1, sched = engine.scheduleFor(d), lines = [];
      engine.tefillos().forEach(function (t) {
        var items = (sched.byTefilla[t.id] || []).filter(function (e) { return e.ms > nowMs; });
        if (items.length) lines.push(tName(items[0].tefilla) + ': ' + shortList(items)); /* by the name it has on that day (קבלת שבת on a Friday night, if the gabbai calls it so) */
      });
      if (lines.length) out = (k === 'today' ? L.today : L.tomorrow) + ' – ' + dayHeader(d) + '\n' + lines.join('\n');
      else if (k === 'today') { list = engine.after(nowMs, rd, 10); out = L.noneToday + '.' + (list.length ? ' ' + L.next + ': ' + dayPrefix(list[0]) + ', ' + entry(list[0].entry, true) + '.' : ''); }
      else out = L.tomorrow + ' – ' + dayHeader(d) + ': ' + L.none;
    }
    else if (tf) {
      list = engine.after(nowMs, rd, 1, tf.id); last = justStarted(tf.id);
      if (list.length) out = (last ? L.last + ': ' + entry(last, false) + '.\n' : '') + tName(tf) + ' ' + L.today + ' (' + list.length + ' ' + L.left + '): ' + shortList(list);
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
        first = list[0]; second = list[1]; last = justStarted(null);
        var r = first.daysAhead === 0 ? rel(first.entry.ms) : '';
        out = (last ? L.last + ': ' + entry(last, true) + '.\n' : '') + L.next + ': ' + (first.daysAhead ? dayPrefix(first) + ', ' : '') + entry(first.entry, true) + (r ? ', ' + r : '') + '.';
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
    sunset: ['sunset', 'shkia', 'shkiah', 'shkiya', 'שקיעה'], tzeis: ['tzeis', 'tzais', 'tzet', 'nightfall', 'maariv', 'מעריב', 'צאת'], plag: ['plag', 'פלג'], minchak: ['minchak', 'ketana', 'קטנה'], minchag: ['minchag', 'gedola', 'גדולה'],
    alos: ['alos', 'alot', 'dawn', 'עלות'], sunrise: ['sunrise', 'netz', 'neitz', 'נץ', 'הנץ'], candles: ['candles', 'candle', 'licht', 'הדלקה', 'הדלקת'], tzeis60: ['tzeis60', 'צאת60', 'sixty'], tzeis72: ['rt', 'rabbeinu', 'רת', 'רבינו'] };
  /* zmanim people can be reminded of directly ("REMIND SHKIA 20"), in the board's order */
  var ZMAN_KEYS = ['alos', 'sunrise', 'shemaMGA', 'shema', 'tefillaMGA', 'tefilla', 'chatzos', 'minchag', 'minchak', 'candles', 'sunset', 'tzeis', 'tzeis60', 'tzeis72'];
  var ZMAN_EN = { alos: 'alos hashachar', sunrise: 'netz (sunrise)', shemaMGA: 'sof zman Shema (MGA)', shema: 'sof zman Shema', tefillaMGA: 'sof zman tefilla (MGA)', tefilla: 'sof zman tefilla', chatzos: 'chatzos', minchag: 'mincha gedola', minchak: 'mincha ketana', plag: 'plag hamincha', candles: 'candle lighting', sunset: 'shkia (sunset)', tzeis: 'tzeis (nightfall)', tzeis60: 'tzeis (60)', tzeis72: 'Rabbeinu Tam (72)' };
  function zmanName(k, lang) { return lang === 'en' ? (ZMAN_EN[k] || k) : ((typeof Cal !== 'undefined' && Cal.ZMAN_NAMES && Cal.ZMAN_NAMES[k]) || k); }
  var ZMAN_LABEL = { he: { chatzos: 'חצות', tefilla: 'סוף זמן תפילה', shema: 'סוף זמן ק״ש', sunset: 'שקיעה', tzeis: 'זמן מעריב', plag: 'פלג המנחה', minchak: 'מנחה קטנה', minchag: 'מנחה גדולה' },
    en: { chatzos: 'chatzos', tefilla: 'sof zman tefilla', shema: 'sof zman Shema', sunset: 'sunset', tzeis: 'zman Maariv', plag: 'plag hamincha', minchak: 'mincha ketana', minchag: 'mincha gedola' } };
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
  /* The minyan a reminder means on a given day: a set time (nearest, within 45 minutes), the first, the last, or the last before a zman.
     "Before sof zman Shema", "before sof zman tefilla" and "before chatzos" bound the davening itself, so the minyan must reach it in time:
     its milestone (הודו) has to be cfg.amidahMinutes (15) before the zman. Sunset and nightfall bound the start. */
  function amidahMinutes(cfg) { var m = cfg && cfg.amidahMinutes; return m == null || m === '' || isNaN(+m) ? 15 : Math.max(0, +m); }
  function targetFor(list, r, zmanim, cfg) {
    if (!list || !list.length) return null;
    if (r.time != null) {
      var best = null, bestD = 1e9;
      list.forEach(function (e) { var d = Math.abs(e.start - r.time); if (d < bestD) { bestD = d; best = e; } });
      return bestD > 45 ? null : best;
    }
    var p = r.pick || 'first';
    if (p === 'last') return list[list.length - 1];
    if (p.indexOf('before:') === 0) {
      var key = p.slice(7), lim = zmanim ? zmanim[key] : NaN, c, am = amidahMinutes(cfg);
      if (lim == null || isNaN(lim)) return null;
      c = list.filter(function (e) { return key === 'shema' || key === 'tefilla' || key === 'chatzos' ? (e.milestone != null ? e.milestone : e.start) + am <= lim : e.start < lim; });
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
  /* Shabbos or Yom Tov in effect at nowMs: from candle lighting until nightfall at its end. Nothing is sent then. */
  function holyNow(cfg, nowMs) {
    var engine = MinyanEngine(cfg), now = Cal.nowInTz(nowMs, engine.loc().tz), info = Cal.dayInfo(now.rd, !!cfg.israel), z = engine.zmanimFor(now.rd);
    if ((info.shabbos || info.yomtov) && !(info.motzaei && now.min >= z.tzeis)) return true;
    return info.candles === 'day' && now.min >= z.candles;
  }
  function due(cfg, sub, nowMs, windowMin) {
    if (holyNow(cfg, nowMs)) return []; /* no reminders on Shabbos and Yom Tov */
    var engine = MinyanEngine(cfg), tz = engine.loc().tz, now = Cal.nowInTz(nowMs, tz), rd = now.rd, sched = engine.scheduleFor(rd), zmanim = engine.zmanimFor(rd), out = [];
    var win = (windowMin || 5) * 60000, lang = sub.lang || 'he', L = T[lang], iso = MinyanEngine.isoDate(rd);
    (sub.reminders || []).forEach(function (r) {
      if (r.once && r.once !== iso) return;
      if (r.zman) {
        /* a zman of the day; candle lighting only on a day that has it */
        if (r.zman === 'candles' && sched.info.candles !== 'day') return;
        var zm = zmanim[r.zman];
        if (zm == null || isNaN(zm)) return;
        var zMs = Cal.epochFromWall(rd, Math.round(zm), tz), zFire = zMs - r.lead * 60000;
        if (zFire < nowMs || zFire >= nowMs + win) return;
        var zMins = Math.max(1, Math.round((zMs - nowMs) / 60000)), zn = zmanName(r.zman, lang);
        out.push({ key: 'z:' + iso + ':' + r.zman, title: L.remind + ': ' + zn, text: (lang === 'he' ? 'תזכורת: ' : 'Reminder: ') + zn + ' ' + engine.fmtTime(zm) + ', ' + L.inMin + ' ' + zMins + ' ' + L.min });
        return;
      }
      var target = targetFor(sched.byTefilla[r.tefilla] || [], r, zmanim, cfg);
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
  return { isCommand: isCommand, parseCommand: parseCommand, apply: apply, due: due, holyNow: holyNow, prune: prune, targetFor: targetFor, describe: describe, T: T, ZMAN_LABEL: ZMAN_LABEL, ZMAN_KEYS: ZMAN_KEYS, ZMAN_EN: ZMAN_EN };
})();


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
  var FILLER = ['to', 'at', 'on', 'for', 'in', 'the', 'a', 'an', 'please', 'pls', 'minyan', 'די', 'דער', 'דאס', 'א', 'אן', 'ביטע', 'בבקשה', 'צו', 'אויף', 'פאר', 'אום', 'ביי', 'אין', 'אינעם', 'יום', 'מנין', 'דעם', 'ל', 'ב', '->', '→', '>', '-'];
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
      help: 'טוישן א מנין דורך טעקסט (נאר פאר איין טאג):\nלייג צו מנחה 2:15 ברך משה\nבטל מנחה 2:00\nטויש מנחה 2:00 אויף 2:15\nמען קען צושרייבן מארגן אדער א טאג (דינסטאג), און א חדר.\nצוריק = ציט צוריק די לעצטע ענדערונג.\nמען קען עס אויך שרייבן מיט אייגענע ווערטער.',
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
      help: 'Change a minyan by text (for one day only):\nadd mincha 2:15 ברך משה\ncancel mincha 2:00\nmove mincha 2:00 to 2:15\nYou can add tomorrow or a day (tuesday), and a room.\nundo = takes back your last change.\nYou can also say it in your own words.',
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

  function run(cfg, text, nowMs, replyLang) { /* replyLang: when the command was worked out from a text in the sender's own words, the language that text was in */
    var lang = replyLang === 'yi' || replyLang === 'en' ? replyLang : hasHebrew(words(text)[0]) ? 'yi' : 'en', L = T[lang], a = actionOf(text); /* by the command's own word: an English text may still name a room in Hebrew letters */
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

  return { parse: parse, run: run, undo: undo, T: T, hasHebrew: hasHebrew };
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
