const Cal = require('../src/cal.js');
let fails = 0;
function eq(name, got, want) { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log((ok ? 'ok   ' : 'FAIL ') + name + ' -> ' + JSON.stringify(got) + (ok ? '' : ' (want ' + JSON.stringify(want) + ')')); }
const rd = (y, m, d) => Cal.rdFromGreg(y, m, d);
const P = (y, m, d, isr) => { const p = Cal.parshaForShabbos(rd(y, m, d), !!isr); return p; };
// Hebrew dates
eq('RH 5787 = 2026-09-12', Cal.hebFromRD(rd(2026, 9, 12)), { y: 5787, m: 7, d: 1 });
eq('2026-10-20 heb', Cal.formatHeb(Cal.hebFromRD(rd(2026, 10, 20))), 'ט׳ חשון תשפ״ז');
eq('RH 5786 = 2025-09-23', Cal.gregFromRD(Cal.rdFromHeb(5786, 7, 1)), { y: 2025, m: 9, d: 23 });
eq('Pesach 5785 = 2025-04-13', Cal.gregFromRD(Cal.rdFromHeb(5785, 1, 15)), { y: 2025, m: 4, d: 13 });
eq('Pesach 5774 = 2014-04-15', Cal.gregFromRD(Cal.rdFromHeb(5774, 1, 15)), { y: 2014, m: 4, d: 15 });
eq('dow 2026-10-20 = Tue', Cal.mod(rd(2026, 10, 20), 7), 2);
// Parshios
eq('2026-10-24 Lech Lecha', P(2026, 10, 24), [2]);
eq('2025-05-24 Israel Behar-Bechukosai (in sync)', P(2025, 5, 24, true), [31, 32]);
eq('2025-05-24 diaspora Behar-Bechukosai', P(2025, 5, 24), [31, 32]);
eq('2025-07-26 Matos-Masei', P(2025, 7, 26), [41, 42]);
eq('2025-08-02 Devarim', P(2025, 8, 2), [43]);
eq('2023-07-01 diaspora Chukas-Balak', P(2023, 7, 1), [38, 39]);
eq('2023-07-01 Israel Balak', P(2023, 7, 1, true), [39]);
eq('2023-07-15 Matos-Masei', P(2023, 7, 15), [41, 42]);
eq('2014-05-31 Naso', P(2014, 5, 31), [34]);
eq('2014-07-19 Matos', P(2014, 7, 19), [41]);
eq('2014-07-26 Masei', P(2014, 7, 26), [42]);
eq('2014-04-12 Acharei', P(2014, 4, 12), [28]);
eq('2003-07-12 diaspora Chukas-Balak', P(2003, 7, 12), [38, 39]);
eq('2003-07-05 diaspora Korach', P(2003, 7, 5), [37]);
eq('2003-07-05 Israel Chukas', P(2003, 7, 5, true), [38]);
eq('2022-07-23 diaspora Pinchas', P(2022, 7, 23), [40]);
eq('2022-07-23 Israel Matos', P(2022, 7, 23, true), [41]);
eq('2022-07-30 diaspora Matos-Masei', P(2022, 7, 30), [41, 42]);
eq('2026-09-19 Haazinu', P(2026, 9, 19), [52]);
eq('2025-09-27 Vayeilech', P(2025, 9, 27), [51]);
eq('2025-10-04 Haazinu', P(2025, 10, 4), [52]);
eq('2025-09-20 Nitzavim', P(2025, 9, 20), [50]);
eq('2026-09-05 Nitzavim-Vayeilech', P(2026, 9, 5), [50, 51]);
eq('2026-04-04 Pesach shabbos none', P(2026, 4, 4), null);
eq('2026-03-14 Vayakhel-Pekudei? (5786 nonleap)', P(2026, 3, 14), [21, 22]);
eq('parsha of week 2026-10-20', Cal.parshaOfWeek(rd(2026, 10, 20), false), 'לך לך');
// every Shabbos of several years: parsha present unless Yom Tov / Chol HaMoed; sequence continuous from Bereishis to Nitzavim
for (const y of [5780, 5781, 5782, 5783, 5784, 5785, 5786, 5787, 5788, 5790, 5795, 5800, 5810, 5820]) {
  for (const isr of [false, true]) {
    let last = null, bad = []; const start = Cal.hebNewYear(y), end = Cal.hebNewYear(y + 1);
    for (let s = start + Cal.mod(6 - Cal.mod(start, 7), 7); s < end; s += 7) {
      const p = Cal.parshaForShabbos(s, isr); const info = Cal.dayInfo(s, isr); const g = Cal.gregFromRD(s);
      if (!p) { if (!info.yomtov && !info.cholHamoed) bad.push('none@' + g.y + '-' + g.m + '-' + g.d); continue; }
      if (p[0] >= 51) { if (last !== null) bad.push('tishrei@' + g.y + '-' + g.m + '-' + g.d); continue; }
      if (last === null) { if (p[0] !== 0) bad.push('start@' + p[0]); }
      else if (p[0] !== last + 1) bad.push('gap@' + g.y + '-' + g.m + '-' + g.d + ':' + last + '->' + p[0]);
      last = p[p.length - 1];
    }
    if (last !== 50 && last !== 51) bad.push('end@' + last);
    eq('year ' + y + (isr ? ' IL' : ' D') + ' continuity', bad, []);
  }
}
// Day info
eq('2026-10-20 type', Cal.dayType(Cal.dayInfo(rd(2026, 10, 20), false)), 'weekday');
eq('2026-10-23 friday', Cal.dayType(Cal.dayInfo(rd(2026, 10, 23), false)), 'friday');
eq('2026-10-24 shabbos', Cal.dayType(Cal.dayInfo(rd(2026, 10, 24), false)), 'shabbos');
eq('2026-10-11 Rosh Chodesh Cheshvan (30 Tishrei)', Cal.dayInfo(rd(2026, 10, 11), false).labels, ['ראש חודש חשון']);
eq('2026-10-03 Shemini Atzeres', Cal.dayInfo(rd(2026, 10, 3), false).labels, ['שמיני עצרת']);
eq('2026-10-04 Simchas Torah', Cal.dayInfo(rd(2026, 10, 4), false).labels, ['שמחת תורה']);
eq('2026-09-21 YK', Cal.dayType(Cal.dayInfo(rd(2026, 9, 21), false)), 'yomkippur');
eq('2026-12-05 Chanukah day 1 (25 Kislev)', Cal.dayInfo(rd(2026, 12, 5), false).chanukah, true);
eq('2027-03-23 Purim', Cal.dayInfo(rd(2027, 3, 23), false).labels, ['פורים']);
eq('2025-08-03 Tisha BAv postponed', Cal.dayInfo(rd(2025, 8, 3), false).fast, true);
// Zmanim Brooklyn 2026-10-20
const z = Cal.zmanim(rd(2026, 10, 20), { lat: 40.6329, lng: -73.9934, tz: 'America/New_York' });
const hm = m => Math.floor(m / 60) + ':' + String(Math.floor(m % 60)).padStart(2, '0');
console.log('zmanim', Object.fromEntries(Object.entries(z).map(([k, v]) => [k, hm(v)])));
eq('sunrise ~7:13', Math.abs(z.sunrise - (7 * 60 + 13)) <= 2, true);
eq('sunset ~18:07', Math.abs(z.sunset - (18 * 60 + 7)) <= 3, true);
const e = Cal.epochFromWall(rd(2026, 10, 20), 11 * 60, 'America/New_York');
eq('epochFromWall 11:00 EDT', new Date(e).toISOString(), '2026-10-20T15:00:00.000Z');
eq('nowInTz', Cal.nowInTz(e, 'America/New_York').min, 660);
console.log(fails ? fails + ' FAILURES' : 'ALL PASS');
