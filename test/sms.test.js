global.Cal = require('../src/cal.js'); global.MinyanEngine = require('../src/engine.js');
const MinyanSms = require('../src/sms.js'); const cfg = JSON.parse(JSON.stringify(require('../config.default.json'))); cfg.banner = null; cfg.smsLang = 'auto'; /* this shul answers in לשון קודש always; the base checks exercise the sender's-language mode */ /* a banner the shul happens to have published would prefix every reply */
cfg.location = { name: 'x', lat: 40.6975, lng: -73.9512, tz: 'America/New_York', elev: 0 }; cfg.candles = 15; cfg.tzeisMinutes = 72;
cfg.tefillos = [{ id: 'shacharis', name: 'שחרית', milestone: 'הודו', offset: 10, period: 'am' }, { id: 'mincha', name: 'מנחה', milestone: 'שמונה עשרה', offset: 8, period: 'pm' }, { id: 'maariv', name: 'מעריב', milestone: 'שמונה עשרה', offset: 5, period: 'pm' }];
cfg.schedules = { weekday: { shacharis: '6:20 ברך משה\n6:50 דברי יואל\n7:15 ברך משה\n7:40 לב אהרן\n8:00 דברי יואל\n8:15 ברך משה\n8:30 שלמה יודא\n8:45 לב אהרן\n9:00 דברי יואל\n9:15 ברך משה\n9:30 שלמה יודא\n9:45 לב אהרן\n10:00 דברי יואל\n10:20 ברך משה\n10:40 שלמה יודא\n11:00 דברי יואל\n11:20 ברך משה\n11:40 שלמה יודא\n12:00 דברי יואל\nchatzos-30 ברך משה',
  mincha: 'chatzos+30~5 ברך משה\nsunset-20~5 דברי יואל\nsunset-5 ברך משה', maariv: 'tzeis+0 ברך משה\n9:00 דברי יואל\n10:00 ברך משה' },
  friday: { mincha: 'chatzos+30~5 ברך משה\ncandles דברי יואל\ncandles+10 ברך משה', maariv: 'candles+20 ברך משה\nsunset+15 דברי יואל' },
  shabbos: { shacharis: '8:00 ברך משה\n9:00 דברי יואל\n9:30 לב אהרן\n10:00 שלמה יודא', mincha: 'sunset-60~5 ברך משה\nsunset-25~5 דברי יואל', maariv: 'tzeis+0 ברך משה\ntzeis+15 דברי יואל' } };
cfg.overrides = [];
let fails = 0;
function check(name, text, re) { const ok = re.test(text); if (!ok) fails++; console.log((ok ? 'ok   ' : 'FAIL ') + name + ': ' + text.replace(/\n/g, ' | ')); }
const at = (h, m, d) => Cal.epochFromWall(Cal.rdFromGreg(2026, 10, d || 20), h * 60 + m, 'America/New_York');
const R = (t, now) => MinyanSms.buildReply(cfg, t, now).text;
check('he next', R('מנין', at(10, 59)), /^מנין הבא: שחרית – דברי יואל 11:00 \(הודו 11:10\), בעוד 1 דק׳\.\nאחריו: ברך משה 11:20/);
check('en next, with the minyan that began 5 minutes ago still worth running for (Hodu 10:50)', R('next', at(10, 45)), /^Last minyan: Shacharis – .* 10:40 \(Hodu 10:50\)\.\nNext minyan: Shacharis – דברי יואל 11:00 \(Hodu 11:10\), in 15 min\.\nThen: /);
/* the "last minyan" rule: a minyan that began leads the reply until 3 minutes before its הודו, then drops out */
check('he: 10:40 minyan leads as מנין העבר at 10:41', R('מנין', at(10, 41)), /^מנין העבר: שחרית – .* 10:40 \(הודו 10:50\)\.\nמנין הבא: שחרית – דברי יואל 11:00/);
check('still at 10:47 (3 minutes before Hodu)', R('מנין', at(10, 47)), /^מנין העבר: /);
check('gone at 10:48 (less than 3 minutes before Hodu)', R('מנין', at(10, 48)), /^מנין הבא: /);
check('tefilla reply leads with it too, without the tefilla name', R('שחרית', at(10, 41)), /^מנין העבר: .* 10:40 \(הודו 10:50\)\.\nשחרית היום \(\d+ נותרו\): 11:00 דברי יואל/);
check('mincha (Shemoneh Esrei 8 minutes in): 1:10 minyan leads at 1:12', R('mincha', at(13, 12)), /^Last minyan: ברך משה 1:10 \(Shemoneh Esrei 1:18\)\.\nMincha Today/);
check('empty = next', R('', at(10, 30)), /^Next minyan/);
check('en hours', R('when', at(4, 0)), /ברך משה 6:20 \(Hodu 6:30\), in 2 hr 20 min\./);
check('he mincha list', R('מנחה', at(10, 0)), /^מנחה היום \(3 נותרו\): 1:10 ברך משה, 5:45 דברי יואל, 6:03 ברך משה$/);
check('en shacharis list', R('Shacharis', at(11, 30)), /^Shacharis Today \(3 left\): 11:40 שלמה יודא, 12:00 דברי יואל, 12:\d\d ברך משה$/);
check('shacharis after last -> tomorrow', R('shacharis', at(13, 0)), /^Shacharis Tomorrow \(Wednesday \(לך לך\)\): 6:20 ברך משה, .*more 5$/);
check('he today', R('היום', at(11, 30)), /^היום – יום שלישי פרשת לך לך, ט׳ חשון תשפ״ז\nשחרית: 11:40 שלמה יודא, 12:00 דברי יואל, 12:\d\d ברך משה\nמנחה: .*\nמעריב: /);
check('late night -> none today', R('today', at(23, 30)), /^No more minyanim today\. Next minyan: Tomorrow, Shacharis – ברך משה 6:20/);
check('tomorrow', R('tomorrow', at(11, 0)), /^Tomorrow – Wednesday \(לך לך\)\nShacharis: 6:20 ברך משה/);
check('zmanim he', R('זמנים', at(11, 0)), /^זמני היום \(יום שלישי פרשת לך לך, ט׳ חשון תשפ״ז\): הנץ החמה 7:12, סוזק״ש \(גר״א\) 9:56, חצות היום 12:40, מנחה קטנה 4:33, שקיעה 6:08, צאת הכוכבים 7:20$/);
check('friday candles', R('zmanim', at(11, 0, 23)), /Candles 5:4\d, Sunset/);
check('help', R('עזרה', at(11, 0)), /^שלחו אחת מהמילים/);
check('next on friday night -> shabbos', R('next', at(20, 0, 23)), /^Next minyan: Tomorrow, Shacharis – ברך משה 8:00/);
check('keyword punctuation', MinyanSms.keyword('Mincha?'), /^mincha$/);
/* the reply language setting */
{
  const he = JSON.parse(JSON.stringify(cfg)); he.smsLang = 'he';
  const H = (t, now) => MinyanSms.buildReply(he, t, now).text;
  check('לשון קודש always: an English "mincha" is answered in Hebrew', H('mincha', at(10, 0)), /^מנחה היום \(3 נותרו\): 1:10 ברך משה/);
  check('לשון קודש always: "next" too', H('next', at(10, 45)), /^מנין העבר: שחרית – .* 10:40 \(הודו 10:50\)\.\nמנין הבא: שחרית – דברי יואל 11:00 \(הודו 11:10\), בעוד 15 דק׳\./);
  check('…but HELP keeps the sender\'s language for the carrier wording', H('help', at(10, 0)), /^Text one of: next, shacharis/);
  check('…and a Hebrew עזרה gets the Hebrew help', H('עזרה', at(10, 0)), /^שלחו אחת מהמילים/);
  const en = JSON.parse(JSON.stringify(cfg)); en.smsLang = 'en';
  check('English always: a Hebrew מנחה is answered in English', MinyanSms.buildReply(en, 'מנחה', at(10, 0)).text, /^Mincha Today \(3 left\)/);
}
/* Shabbos and Yom Tov: the name and the second time a tefilla has on that kind of day reach the texts too */
{
  const c = JSON.parse(JSON.stringify(cfg)); c.smsLang = 'he';
  c.dayTefilla = { friday: { maariv: { name: 'קבלת שבת' } }, shabbos: { shacharis: { second: 'own', milestone: 'נשמת', offset: 30 } } };
  const on = (y, m, d, h, min) => Cal.epochFromWall(Cal.rdFromGreg(y, m, d), h * 60 + min, 'America/New_York'), A = (t, now) => MinyanSms.buildReply(c, t, now).text;
  check('Friday\'s list names מעריב as the gabbai does on a Friday', A('היום', on(2026, 11, 13, 12, 0)), /\nקבלת שבת: /);
  check('a weekday\'s list keeps the everyday name', A('היום', on(2026, 11, 16, 12, 0)), /\nמעריב: /);
  check('Shabbos morning: the next minyan with Shabbos\'s own second time', A('מנין', on(2026, 11, 14, 8, 40)), /^מנין הבא: שחרית – דברי יואל 9:00 \(נשמת 9:30\)/);
  check('and the one that has begun still leads, because נשמת is half an hour on', A('מנין', on(2026, 11, 14, 8, 10)), /^מנין העבר: שחרית – ברך משה 8:00 \(נשמת 8:30\)/);
  check('zmanim on the first day of Pesach: no "candle lighting before sunset" line, since tonight\'s is after nightfall', A('זמנים', on(2027, 4, 22, 10, 0)), /^(?!.*הדלקת נרות)/s);
  check('zmanim on the second day, a Friday: candle lighting is there', A('זמנים', on(2027, 4, 23, 10, 0)), /הדלקת נרות/);
}
/* שערן: the barber's hours for the week, in Yiddish, from the Shere tab's settings */
{
  global.MinyanShere = require('../src/shere.js');
  const sc = JSON.parse(JSON.stringify(cfg)); sc.smsLang = 'he';
  const on = (y, mo, d, h, mi) => Cal.epochFromWall(Cal.rdFromGreg(y, mo, d), h * 60 + mi, 'America/New_York');
  check('shere is off until the tab turns it on: שערן is an ordinary text', MinyanSms.buildReply(sc, 'שערן', on(2026, 11, 15, 10, 0)).keyword, /^next$/);
  sc.shere = { on: true };
  const S = (t, now) => MinyanSms.buildReply(sc, t, now).text;
  check('שערן on a Sunday: the whole week, weekdays with the same hours together', S('שערן', on(2026, 11, 15, 10, 0)), /^שערן די וואך:\nהיינט, זונטאג ביז מיטוואך: פון 10:00 ביז 8:00, אויך קינדער\nדאנערשטאג: פון 10:00 ביז 9:00, אויך קינדער\nערב שבת פרשת ויצא \(י׳ כסלו\): פון 8:00 ביז \d:\d\d, נישט פאר קינדער$/);
  check('with spaces and a "!" too, and in English letters', S(' שערן! ', on(2026, 11, 15, 10, 0)) + S('Shere', on(2026, 11, 15, 10, 0)), /^שערן די וואך.*שערן די וואך/s);
  check('other texts still get the minyan', S('מנין', on(2026, 11, 15, 10, 0)), /מנין הבא: שחרית/);
  check('after Friday closes: next week', S('שערן', on(2026, 11, 13, 17, 0)), /^שערן די וואך:\nזונטאג ביז/);
  check('Erev Pesach on a Wednesday closes before candle lighting; Yom Tov is left out', S('שערן', on(2027, 4, 18, 10, 0)), /\nמיטוואך, ערב פסח \(י״ד ניסן\): פון 10:00 ביז \d:\d\d, אויך קינדער$/);
  check('Erev Shvi\'i shel Pesach', S('שערן', on(2027, 4, 25, 10, 0)), /דינסטאג, ערב שביעי של פסח \(כ׳ ניסן\)/);
  check('Hoshana Rabbah on a Friday', S('שערן', on(2026, 9, 27, 10, 0)), /ערב שבת, הושענא רבה/);
  { const z = JSON.parse(JSON.stringify(sc)); z.shere = { on: true, week: [{ from: 'sunrise+20', until: 'sunset-30' }], days: { '2026-11-17': { from: 'plag', until: '21:00' } } };
    const t = MinyanSms.buildReply(z, 'שערן', on(2026, 11, 15, 10, 0)).text;
    check('times by the zman: Sunday from sunrise+20 until shkiah-30, rounded to 5 (a start up, an end down)', t, /היינט, זונטאג: פון 7:05 ביז 4:05/);
    check('one day from plag until 9:00', t, /דינסטאג: פון 3:3\d ביז 9:00/); }
  sc.shere.days = { '2026-11-17': { closed: true, note: 'אויף א חתונה' }, '2026-11-19': { until: '18:00', kids: 'no' } };
  check('one day closed, one day changed', S('שערן', on(2026, 11, 15, 10, 0)), /מאנטאג: .*\nדינסטאג: נישטא קיין שערן\. אויף א חתונה\nמיטוואך: .*\nדאנערשטאג: פון 10:00 ביז 6:00, נישט פאר קינדער/);
}
console.log(fails ? fails + ' FAILURES' : 'ALL PASS');
