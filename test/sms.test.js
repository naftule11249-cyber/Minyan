global.Cal = require('../src/cal.js'); global.MinyanEngine = require('../src/engine.js');
const MinyanSms = require('../src/sms.js'); const cfg = JSON.parse(JSON.stringify(require('../config.default.json')));
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
check('he next', R('מנין', at(10, 59)), /^המנין הבא: שחרית – דברי יואל 11:00 \(הודו 11:10\), בעוד 1 דק׳\.\nאחריו: ברך משה 11:20/);
check('en next', R('next', at(10, 45)), /^Next minyan: Shacharis – דברי יואל 11:00 \(Hodu 11:10\), in 15 min\./);
check('empty = next', R('', at(10, 30)), /^Next minyan/);
check('en hours', R('when', at(4, 0)), /ברך משה 6:20 \(Hodu 6:30\), in 2 hr 20 min\./);
check('he mincha list', R('מנחה', at(10, 0)), /^מנחה היום \(3 נותרו\): 1:10 ברך משה, 5:45 דברי יואל, 6:03 ברך משה$/);
check('en shacharis list', R('Shacharis', at(11, 30)), /^Shacharis Today \(3 left\): 11:40 שלמה יודא, 12:00 דברי יואל, 12:\d\d ברך משה$/);
check('shacharis after last -> tomorrow', R('shacharis', at(13, 0)), /^Shacharis Tomorrow \(Wednesday \(לך לך\)\): 6:20 ברך משה, .*more 5$/);
check('he today', R('היום', at(11, 30)), /^היום – יום שלישי פרשת לך לך, ט׳ חשון תשפ״ז\nשחרית: 11:40 שלמה יודא, 12:00 דברי יואל, 12:\d\d ברך משה\nמנחה: .*\nמעריב: /);
check('late night -> none today', R('today', at(23, 30)), /^No more minyanim today\. Next minyan: Tomorrow, Shacharis – ברך משה 6:20/);
check('tomorrow', R('tomorrow', at(11, 0)), /^Tomorrow – Wednesday \(לך לך\)\nShacharis: 6:20 ברך משה/);
check('zmanim he', R('זמנים', at(11, 0)), /^זמני היום \(יום שלישי פרשת לך לך, ט׳ חשון תשפ״ז\): נץ החמה 7:12, סוף זמן ק״ש 9:56, חצות 12:40, פלג המנחה 5:00, שקיעה 6:08, צאת הכוכבים 7:20$/);
check('friday candles', R('zmanim', at(11, 0, 23)), /Candles 5:4\d, Sunset/);
check('help', R('עזרה', at(11, 0)), /^שלחו אחת מהמילים/);
check('next on friday night -> shabbos', R('next', at(20, 0, 23)), /^Next minyan: Tomorrow, Shacharis – ברך משה 8:00/);
check('keyword punctuation', MinyanSms.keyword('Mincha?'), /^mincha$/);
console.log(fails ? fails + ' FAILURES' : 'ALL PASS');
