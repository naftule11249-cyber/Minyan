/* The shul's own schedule in config.default.json: Sunday Shacharis as on the lobby board, fallbacks, and zman rounding. */
global.Cal = require('../src/cal.js');
const E = require('../src/engine.js');
const cfg = require('../config.default.json');
const eng = (E.MinyanEngine || E)(cfg);
let fails = 0;
function ok(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) console.log('ok   ' + name); else { fails++; console.log('FAIL ' + name + '\n   got  ' + g + '\n   want ' + w); }
}
const sunRd = Cal.rdFromGreg(2026, 10, 25), sun = eng.scheduleFor(sunRd); // Sunday, 14 Cheshvan 5787
ok('sunday day type', sun.type, 'sunday');
const sh = sun.byTefilla.shacharis.map(e => eng.fmtTime(e.start) + ' ' + e.room);
ok('sunday shacharis: 19 minyanim like the board', sh.length, 19);
ok('sunday first and last', [sh[0], sh[18]], ['7:30 לב אהרן', '12:10 ברך משה']);
ok('sunday rooms take turns from 8:00', sh.slice(1, 7), ['8:00 דברי יואל', '8:15 ברך משה', '8:30 שלמה יודא', '8:45 לב אהרן', '9:00 דברי יואל', '9:15 ברך משה']);
ok('sunday 11:15-12:00', sh.slice(14, 18), ['11:15 ברך משה', '11:30 היכל אדל', '11:45 לב אהרן', '12:00 דברי יואל']);
ok('hodu 10 minutes after the start', eng.fmtTime(sun.byTefilla.shacharis[0].milestone), '7:40');
const mon = eng.scheduleFor(Cal.rdFromGreg(2026, 10, 26));
ok('monday is a weekday with its own list (18 minyanim or more)', [mon.type, mon.byTefilla.shacharis.length >= 18], ['weekday', true]);
ok('sunday mincha and maariv follow the weekday lists', [sun.byTefilla.mincha.length, sun.byTefilla.maariv.length], [mon.byTefilla.mincha.length, mon.byTefilla.maariv.length]);
/* zman-based times start from the zman as the zmanim list shows it (to the minute): chatzos 12:40 -> chatzos-30 is 12:10, not 12:09 */
const z = Cal.zmanim(sunRd, cfg.location);
ok('chatzos shown as 12:40', eng.fmtTime(z.chatzos), '12:40');
ok('chatzos-30 = shown chatzos minus 30', eng.fmtTime(sun.byTefilla.shacharis[18].start), eng.fmtTime(Math.round(z.chatzos) - 30));
ok('~5 still rounds down to 5 minutes', eng.fmtTime((E.MinyanEngine || E)(Object.assign({}, cfg, { schedules: { weekday: { shacharis: 'chatzos-30~5 ברך משה' } } })).scheduleFor(sunRd).byTefilla.shacharis[0].start), '12:10');
ok('new room is in the room list', cfg.rooms.split(',').map(s => s.trim()).indexOf('היכל אדל') >= 0, true);
ok('now window setting', cfg.nowMinutes, 20);
/* "until <zman>": a minyan is listed only while it starts before that zman on that day; "after <zman>": only from that zman on */
function withLines(lines) { return (E.MinyanEngine || E)(Object.assign({}, cfg, { schedules: { weekday: lines } })); }
const octRd = Cal.rdFromGreg(2026, 10, 26), junRd = Cal.rdFromGreg(2026, 6, 22); /* Monday in late October, Monday in June */
const zOct = Cal.zmanim(octRd, cfg.location), zJun = Cal.zmanim(junRd, cfg.location);
ok('sof zman tefilla is later in October than in June', [Math.round(zOct.tefilla) > 645, Math.round(zJun.tefilla) < 645], [true, true]);
const lateSh = withLines({ shacharis: '10:45 ברך משה until tefilla' });
ok('10:45 until tefilla: shown in October, gone in June', [lateSh.scheduleFor(octRd).byTefilla.shacharis.length, lateSh.scheduleFor(junRd).byTefilla.shacharis.length], [1, 0]);
const run = withLines({ shacharis: 'every 15 from 9:00 to 11:00 rooms ברך משה, דברי יואל until tefilla-5' });
const runOct = run.scheduleFor(octRd).byTefilla.shacharis.map(e => e.start), runJun = run.scheduleFor(junRd).byTefilla.shacharis.map(e => e.start);
ok('a run shortens by itself: every start is before sof zman tefilla minus 5', [runOct.every(m => m < Math.round(zOct.tefilla) - 5), runJun.every(m => m < Math.round(zJun.tefilla) - 5), runOct.length > runJun.length, runOct[0]], [true, true, true, 540]);
ok('"after minchag": a 1:00 PM Mincha is listed only once mincha gedola is earlier than that', withLines({ mincha: '1:00 ברך משה after minchag' }).scheduleFor(octRd).byTefilla.mincha.length, 13 * 60 >= Math.round(zOct.minchag) ? 1 : 0);
ok('Hebrew keyword עד works the same', withLines({ shacharis: '10:45 ברך משה עד tefilla' }).scheduleFor(junRd).byTefilla.shacharis.length, 0);
ok('the condition survives the parse (room and note intact)', (() => { const p = E.parseLine('10:45 ברך משה until tefilla-10 // late', { period: 'am' }); return [p.room, p.note, p.cond.op, p.cond.spec.zman, p.cond.spec.offset]; })(), ['ברך משה', 'late', 'until', 'tefilla', -10]);
ok('condLimit gives the zman the line is measured against', eng.fmtTime(withLines({ shacharis: '10:45 ברך משה until tefilla' }).condLimit(E.parseLine('10:45 x until tefilla', { period: 'am' }), octRd, 'weekday')), eng.fmtTime(Math.round(zOct.tefilla)));
/* Mincha gedola: by default the later of 30 clock minutes after chatzos and half a proportional hour; the setting picks one */
{
  const loc = cfg.location, winter = Cal.rdFromGreg(2026, 12, 20), summer = Cal.rdFromGreg(2027, 6, 20);
  const w = Cal.zmanim(winter, loc), s = Cal.zmanim(summer, loc), fix = Cal.zmanim(winter, Object.assign({}, loc, { minchaGedola: 'fixed30' })), zm = Cal.zmanim(summer, Object.assign({}, loc, { minchaGedola: 'zmanis' })), fixS = Cal.zmanim(summer, Object.assign({}, loc, { minchaGedola: 'fixed30' }));
  ok('winter: half a proportional hour is under 30 minutes, so the default is chatzos + 30', [Math.round(w.minchag - w.chatzos), Math.round(fix.minchag - fix.chatzos)], [30, 30]);
  ok('summer: half a proportional hour is over 30 minutes, so the default is the proportional one', [Math.round(s.minchag - s.chatzos) > 30, Math.round(s.minchag) === Math.round(zm.minchag), Math.round(fixS.minchag - fixS.chatzos)], [true, true, 30]);
  const mgaS = Cal.zmanim(summer, Object.assign({}, loc, { minchaGedola: 'mga' }));
  ok('Magen Avraham: half a proportional hour of a day that is 72 minutes longer at each end', Math.round(mgaS.minchag - mgaS.chatzos), Math.round((s.sunset - s.sunrise + 144) / 24));
  ok('the engine passes the setting through', eng.fmtTime(require('../src/engine.js')(Object.assign({}, cfg, { minchaGedola: 'fixed30' })).zmanimFor(summer).minchag), eng.fmtTime(fixS.minchag));
}
/* Rosh Chodesh on a Sunday follows the Sunday list; on a weekday it still follows the weekday list */
{
  const rcSun = Cal.rdFromGreg(2027, 6, 6), plainSun = Cal.rdFromGreg(2027, 6, 13), infoRc = Cal.dayInfo(rcSun, false);
  ok('June 6 2027 is a Sunday Rosh Chodesh', [infoRc.dow, infoRc.roshChodesh, Cal.dayType(infoRc)], [0, true, 'rosh_chodesh']);
  const sameAs = rd => eng.scheduleFor(rd).byTefilla.shacharis.map(e => eng.fmtTime(e.start) + ' ' + e.room);
  const noRc = (E.MinyanEngine || E)(Object.assign({}, cfg, { schedules: Object.assign({}, cfg.schedules, { rosh_chodesh: {} }) })), sameAsNo = rd => noRc.scheduleFor(rd).byTefilla.shacharis.map(e => eng.fmtTime(e.start) + ' ' + e.room);
  ok('with no Rosh Chodesh list of its own, its Shacharis list is the Sunday list (all but the chatzos-based last row, which moves with the day)', [noRc.dayTexts(rcSun, infoRc).texts.shacharis.source, sameAsNo(rcSun).slice(0, -1)], ['sunday', sameAsNo(plainSun).slice(0, -1)]);
  ok('with the shul\'s Rosh Chodesh list, a Sunday Rosh Chodesh uses it', [eng.dayTexts(rcSun, infoRc).texts.shacharis.source, sameAs(rcSun)[0]], ['rosh_chodesh', '6:20 ברך משה']);
  let rd = Cal.rdFromGreg(2026, 11, 1), inf; while (!((inf = Cal.dayInfo(rd, false)).roshChodesh && inf.dow >= 1 && inf.dow <= 4)) rd++;
  ok('a midweek Rosh Chodesh uses the Rosh Chodesh list; without one it follows the weekday list', [eng.dayTexts(rd, inf).texts.shacharis.source, noRc.dayTexts(rd, inf).texts.shacharis.source], ['rosh_chodesh', 'weekday']);
}
ok('a switched-off line (#off …) is ignored by the board', withLines({ shacharis: '#off 6:20 ברך משה\n7:00 דברי יואל' }).scheduleFor(octRd).byTefilla.shacharis.map(e => eng.fmtTime(e.start)), ['7:00']);
/* rooms in the gabbai's order break ties at the same time */
const tie = withLines({ maariv: '7:00 לב אהרן\n7:00 ברך משה\n7:00 דברי יואל' }).scheduleFor(octRd).byTefilla.maariv.map(e => e.room);
ok('same time: rooms in the order of the rooms list', tie, ['ברך משה', 'דברי יואל', 'לב אהרן']);
if (fails) { console.log(fails + ' FAILING'); process.exit(1); } else console.log('schedule: all good');
ok('civil date in US format', eng.fmtDate(sunRd), '10/25/2026');
ok('civil date d.m.y when asked', (E.MinyanEngine || E)(Object.assign({}, cfg, { dateFormat: 'dmy' })).fmtDate(sunRd), '25.10.2026');

/* ---- after midnight: a Maariv at 00:30 is still last night ---- */
const mkE = c => (E.MinyanEngine || E)(c), monRd = Cal.rdFromGreg(2026, 10, 26);
const nightCfg = Object.assign({}, cfg, { schedules: { weekday: { maariv: '21:00 דברי יואל\n00:30 ברך משה\n01:15 לב אהרן\n04:00 שלמה יודא' } } });
const ne = mkE(nightCfg), mv = ne.scheduleFor(monRd).byTefilla.maariv;
ok('after-midnight maariv sorts last; 4:00 is morning', mv.map(e => ne.fmtTime(e.start) + ' ' + e.room), ['4:00 שלמה יודא', '9:00 דברי יואל', '12:30 ברך משה', '1:15 לב אהרן']);
ok('its moment is after midnight of the next civil day', new Date(mv[2].ms).toISOString(), '2026-10-27T04:30:00.000Z');
const u = ne.upcoming(Cal.epochFromWall(monRd + 1, 10, 'America/New_York'), monRd + 1);
ok("at 00:10 the next minyan is last night's 12:30 Maariv", [ne.fmtTime(u.entry.start), u.daysAhead], ['12:30', -1]);
ok('mincha 1:30 still means 1:30 PM', ne.fmtTime(mkE(Object.assign({}, cfg, { schedules: { weekday: { mincha: '1:30 ברך משה' } } })).scheduleFor(monRd).byTefilla.mincha[0].start), '1:30');
ok('night cut-off per tefilla (2:00): 1:15 is night, 2:30 is morning', mkE(Object.assign({}, nightCfg, { tefillos: cfg.tefillos.map(t => t.id === 'maariv' ? Object.assign({}, t, { nightUntil: 2 }) : t), schedules: { weekday: { maariv: '01:15 לב אהרן\n02:30 שלמה יודא' } } })).scheduleFor(monRd).byTefilla.maariv.map(e => ne.fmtTime(e.start)), ['2:30', '1:15']);
if (fails) { console.log(fails + ' FAILING'); process.exit(1); } else console.log('schedule (night): all good');
/* a repeating run whose end comes before its start: past midnight when short, otherwise it does not take place that day */
{
  const mkR = (lines) => (E.MinyanEngine || E)(Object.assign({}, cfg, { schedules: { weekday: { maariv: lines } } }));
  const junRd = Cal.rdFromGreg(2027, 6, 7), jun = mkR('every 10 from rt+14~5 to 20:00 rooms ברך משה, דברי יואל').scheduleFor(junRd);
  ok('summer: "from rt+14 to 20:00" (rt+14 is 9:50 PM) gives no run, not a day-long one', jun.byTefilla.maariv.length, 0);
  const win = mkR('every 10 from rt+14~5 to 20:00 rooms ברך משה, דברי יואל').scheduleFor(Cal.rdFromGreg(2026, 12, 7));
  ok('winter: the same line runs from rt+14 to 8:00 PM', [win.byTefilla.maariv.length > 5, eng.fmtTime(win.byTefilla.maariv[win.byTefilla.maariv.length - 1].start)], [true, '8:00']);
  ok('a short run past midnight still works: 22:15 to 00:15 every 30', mkR('every 30 from 22:15 to 00:15 rooms ברך משה').scheduleFor(junRd).byTefilla.maariv.map(e => eng.fmtTime(e.start)), ['10:15', '10:45', '11:15', '11:45', '12:15']);
  ok('the shul\'s own June weekday has a sane Maariv list', mkR(cfg.schedules.weekday.maariv).scheduleFor(junRd).byTefilla.maariv.length < 40, true);
}
/* extra schedules: a named list that takes over for the days it covers, by priority */
{
  const roll = (rolls) => (E.MinyanEngine || E)(Object.assign({}, cfg, { rolls: rolls }));
  const thu = Cal.rdFromGreg(2026, 11, 12), mon = Cal.rdFromGreg(2026, 11, 16), jul = Cal.rdFromGreg(2027, 7, 8);
  const times = (e, rd) => e.scheduleFor(rd).byTefilla.shacharis.map(x => e.fmtTime(x.start)).join(' ');
  const base = roll([]).scheduleFor(thu).byTefilla.shacharis.length;
  ok('with no extra schedules nothing changes', [base >= 18, roll([]).scheduleFor(thu).roll], [true, null]);
  const one = roll([{ name: 'זומער', type: 'weekday', priority: 1, active: true, lines: { shacharis: '5:30 ברך משה\n6:15 דברי יואל' } }]);
  ok('an extra schedule takes over the tefilla it lists, and the rest of the day stays as it was', [times(one, thu), one.scheduleFor(thu).byTefilla.mincha.length, one.scheduleFor(thu).roll.name], ['5:30 6:15', 9, 'זומער']);
  ok('the one with the higher priority wins', times(roll([{ name: 'low', type: 'weekday', priority: 1, active: true, lines: { shacharis: '6:30 ברך משה' } }, { name: 'high', type: 'weekday', priority: 5, active: true, lines: { shacharis: '5:55 לב אהרן' } }]), thu), '5:55');
  const dated = roll([{ name: 'summer', type: 'weekday', priority: 9, active: true, from: '2027-06-01', to: '2027-08-31', lines: { shacharis: '5:30 ברך משה' } }]);
  ok('its dates hold it back and let it through', [dated.scheduleFor(thu).byTefilla.shacharis.length, times(dated, jul)], [base, '5:30']);
  const dows = roll([{ name: 'monday', type: 'weekday', priority: 9, active: true, dows: [1], lines: { shacharis: '6:45 ברך משה' } }]);
  ok('only on the days of the week it names', [dows.scheduleFor(thu).byTefilla.shacharis.length, times(dows, mon)], [base, '6:45']);
  ok('switched off, it does nothing', roll([{ name: 'off', type: 'weekday', priority: 9, active: false, lines: { shacharis: '4:00 ברך משה' } }]).scheduleFor(thu).byTefilla.shacharis.length, base);
  ok('a special date still beats it', (function () {
    const e = (E.MinyanEngine || E)(Object.assign({}, cfg, { rolls: [{ name: 'r', type: 'weekday', priority: 9, active: true, lines: { shacharis: '5:30 ברך משה' } }], overrides: [{ date: E.isoDate(thu), label: 'אסיפה', lines: { shacharis: '7:07 לב אהרן' } }] }));
    return e.scheduleFor(thu).byTefilla.shacharis.map(x => e.fmtTime(x.start)).join(' ');
  })(), '7:07');
  ok('a schedule for any kind of day covers Shabbos too', times(roll([{ name: 'all', type: 'any', priority: 2, active: true, lines: { shacharis: '8:08 ברך משה' } }]), Cal.rdFromGreg(2026, 11, 14)), '8:08');
}
/* the temporary banner: from / until, shul time */
{
  const mk = b => (E.MinyanEngine || E)(Object.assign({}, cfg, { banner: b }));
  const at = (y, mo, d, h, mi) => Cal.epochFromWall(Cal.rdFromGreg(y, mo, d), h * 60 + mi, cfg.location.tz);
  const b = { text: 'אלע זמנים זענען מיט א שעה פריער', from: '2026-10-31T19:00', until: '2026-11-05T01:30' };
  ok('banner with a start time: not before it', mk(b).activeBanner(at(2026, 10, 31, 18, 59)), null);
  ok('banner: shown from the start time', (mk(b).activeBanner(at(2026, 10, 31, 19, 0)) || {}).text, b.text);
  ok('banner: shown until the end time, then gone', [(mk(b).activeBanner(at(2026, 11, 5, 1, 29)) || {}).text === b.text, mk(b).activeBanner(at(2026, 11, 5, 1, 30))], [true, null]);
  ok('banner with only an end time: shown right away', (mk({ text: 'x', until: '2026-11-05T01:30' }).activeBanner(at(2026, 1, 1, 0, 0)) || {}).text, 'x');
  ok('banner with only a start time: stays once it starts', [mk({ text: 'x', from: '2026-10-31T19:00' }).activeBanner(at(2026, 10, 31, 18, 0)), (mk({ text: 'x', from: '2026-10-31T19:00' }).activeBanner(at(2027, 10, 31, 18, 0)) || {}).text], [null, 'x']);
}
{
  /* donations: on within their dates, and never while switched off */
  const day = Cal.rdFromGreg(2026, 11, 18), mkN = ns => (E.MinyanEngine || E)(Object.assign({}, cfg, { notices: ns }));
  const N = [{ title: 'פרנס חודש כסלו', name: 'א', from: '2026-11-11', to: '2026-12-10' }, { title: 'נר למאור', name: 'ב', from: '2026-11-11', to: '2026-12-10', off: true }, { title: 'פרנס היום', name: 'ג', from: '2026-12-01', to: '2026-12-01' }, { title: 'empty', name: '', body: '' }];
  ok('a donation switched off is not on the board whatever its dates; one outside its dates or with nothing in it is not either', mkN(N).activeNotices(day).map(n => n.name), ['א']);
  ok('switched on again it is back', mkN(N.map(n => Object.assign({}, n, { off: false }))).activeNotices(day).map(n => n.name), ['א', 'ב']);
  ok('on its own day the one-day donation joins them', mkN(N).activeNotices(Cal.rdFromGreg(2026, 12, 1)).map(n => n.name), ['א', 'ג']);
  /* part of a day: from a time on the first day until a time on the last */
  const H = [{ title: 'פרנס היום', name: 'בוקר', from: '2026-11-18', to: '2026-11-18', fromTime: '10:00', toTime: '12:30' }, { title: 'פרנס השבוע', name: 'שבוע', from: '2026-11-17', to: '2026-11-19', fromTime: '18:00', toTime: '09:00' },
    { title: 'x', name: 'סוף', to: '2026-11-18', toTime: '08:00' }, { title: 'y', name: 'bad', from: '2026-11-18', to: '2026-11-18', fromTime: '25:99', toTime: 'noon' }];
  const on = (rd, min) => mkN(H).activeNotices(rd, min).map(n => n.name), d17 = Cal.rdFromGreg(2026, 11, 17), d19 = Cal.rdFromGreg(2026, 11, 19);
  ok('a donation for part of a day is on from its start time and off at its end time, to the minute', [on(day, 9 * 60 + 59).indexOf('בוקר') >= 0, on(day, 10 * 60).indexOf('בוקר') >= 0, on(day, 12 * 60 + 29).indexOf('בוקר') >= 0, on(day, 12 * 60 + 30).indexOf('בוקר') >= 0], [false, true, true, false]);
  ok('over several days the first time is on the first day and the second on the last: the days between are whole', [on(d17, 17 * 60 + 59).indexOf('שבוע') >= 0, on(d17, 18 * 60).indexOf('שבוע') >= 0, on(day, 3 * 60).indexOf('שבוע') >= 0, on(d19, 8 * 60 + 59).indexOf('שבוע') >= 0, on(d19, 9 * 60).indexOf('שבוע') >= 0], [false, true, true, true, false]);
  ok('an end time with no first day still ends it; times that are not times are ignored, not obeyed', [on(day, 7 * 60 + 59).indexOf('סוף') >= 0, on(day, 8 * 60).indexOf('סוף') >= 0, on(day, 5).indexOf('bad') >= 0], [true, false, true]);
  ok('asked about a day with no time of day, the whole day counts', mkN(H).activeNotices(day).map(n => n.name), ['בוקר', 'שבוע', 'סוף', 'bad']);
}
/* Shabbos and Yom Tov: a tefilla's name and second time by the kind of day, and Yom Tov on a Friday */
{
  const base = JSON.parse(JSON.stringify(cfg));
  base.rolls = []; base.overrides = [];
  base.schedules.friday = Object.assign({}, base.schedules.friday, { mincha: 'candles+10 ברך משה', maariv: 'candles+45~5 ברך משה' });
  base.schedules.shabbos = { shacharis: '08:30 לב אהרן\n09:30 דברי יואל', mincha: 'sunset-40~5 דברי יואל', maariv: 'sunset+50~5 דברי יואל' };
  delete base.schedules.yomtov; delete base.schedules.erev_yomtov;
  const mk = dayTefilla => (E.MinyanEngine || E)(Object.assign({}, base, dayTefilla ? { dayTefilla } : {}));
  const D = { fri: Cal.rdFromGreg(2026, 11, 13), shab: Cal.rdFromGreg(2026, 11, 14), mon: Cal.rdFromGreg(2026, 11, 16), erevPesach: Cal.rdFromGreg(2027, 4, 21), pesach1: Cal.rdFromGreg(2027, 4, 22), pesach2Fri: Cal.rdFromGreg(2027, 4, 23), shavuosFri: Cal.rdFromGreg(2027, 6, 11) };
  const second = (e, rd, id) => { const s = e.scheduleFor(rd).byTefilla[id][0]; return [s.tefilla.name, s.tefilla.milestone, e.fmtTime(s.start), e.fmtTime(s.milestone)]; };
  const plain = mk();
  ok('with nothing set, Shabbos שחרית is the tefilla as it is every day: הודו ten minutes on', second(plain, D.shab, 'shacharis'), ['שחרית', 'הודו', '8:30', '8:40']);
  const e1 = mk({ shabbos: { shacharis: { second: 'own', milestone: 'נשמת', offset: 30 } }, friday: { maariv: { name: 'קבלת שבת' } } });
  ok('Shabbos given a second time of its own: נשמת, half an hour on', second(e1, D.shab, 'shacharis'), ['שחרית', 'נשמת', '8:30', '9:00']);
  ok('a weekday is untouched by it', second(e1, D.mon, 'shacharis').slice(0, 2), ['שחרית', 'הודו']);
  ok('Yom Tov follows Shabbos for the second time', second(e1, D.pesach1, 'shacharis'), ['שחרית', 'נשמת', '8:30', '9:00']);
  ok('Friday\'s מעריב called קבלת שבת', second(e1, D.fri, 'maariv').slice(0, 1), ['קבלת שבת']);
  ok('the name is Friday\'s alone: Erev Yom Tov borrows Friday\'s times, not its name', [e1.scheduleFor(D.erevPesach).type, second(e1, D.erevPesach, 'maariv')[0], second(e1, D.erevPesach, 'maariv')[2] !== ''], ['erev_yomtov', 'מעריב', true]);
  const e2 = mk({ shabbos: { shacharis: { second: 'none' } }, yomtov: { shacharis: { second: 'own', milestone: 'הלל', offset: 45 }, maariv: { name: 'מעריב יום טוב' } } });
  ok('"None" on Shabbos: no second time there', second(e2, D.shab, 'shacharis'), ['שחרית', '', '8:30', '8:30']);
  ok('Yom Tov with its own setting does not follow Shabbos', second(e2, D.pesach1, 'shacharis'), ['שחרית', 'הלל', '8:30', '9:15']);
  ok('a name given to Yom Tov shows on Yom Tov and not on Shabbos', [second(e2, D.pesach1, 'maariv')[0], second(e2, D.shab, 'maariv')[0]], ['מעריב יום טוב', 'מעריב']);
  ok('"its own" with no name written is no second time, not a nameless one', second(mk({ shabbos: { shacharis: { second: 'own', milestone: '  ', offset: 30 } } }), D.shab, 'shacharis'), ['שחרית', '', '8:30', '8:30']);
  ok('a day tells each tefilla as it has it, also one with no minyanim that day', [e1.scheduleFor(D.fri).tefillos.maariv.name, e1.scheduleFor(D.mon).tefillos.maariv.name, (E.MinyanEngine || E)(Object.assign({}, base, { dayTefilla: { friday: { maariv: { name: 'קבלת שבת' } } }, schedules: Object.assign({}, base.schedules, { friday: { mincha: 'candles+10 ברך משה', maariv: '#off 19:00 ברך משה' } }) })).scheduleFor(D.fri).tefillos.maariv.name], ['קבלת שבת', 'מעריב', 'קבלת שבת']);
  /* Yom Tov on a Friday: the morning is Yom Tov's, the afternoon and evening are Erev Shabbos's */
  const fri = plain.scheduleFor(D.fri), yf = plain.scheduleFor(D.pesach2Fri), sf = plain.scheduleFor(D.shavuosFri), y1 = plain.scheduleFor(D.pesach1);
  const zF = plain.zmanimFor(D.pesach2Fri), rel = (s, id) => Math.round(s.byTefilla[id][0].start - Math.round(plain.zmanimFor(s.rd).candles)); /* minutes after candle lighting, as the zmanim list shows it */
  ok('the second day of Pesach on a Friday is Yom Tov', [yf.type, yf.info.dow], ['yomtov', 5]);
  ok('its שחרית is the Shabbos and Yom Tov one', yf.byTefilla.shacharis.map(e => plain.fmtTime(e.start)), ['8:30', '9:30']);
  ok('its מנחה goes by candle lighting, as on any Friday', [rel(yf, 'mincha'), rel(fri, 'mincha')], [10, 10]);
  ok('and so does its מעריב, which is קבלת שבת', [yf.byTefilla.maariv[0].start < zF.sunset + 45, e1.scheduleFor(D.pesach2Fri).byTefilla.maariv[0].tefilla.name], [true, 'קבלת שבת']);
  ok('Shavuos on a Friday the same', [sf.type, rel(sf, 'mincha')], ['yomtov', 10]);
  ok('a Yom Tov that is not a Friday keeps the Shabbos afternoon and evening', [y1.type, Math.round(y1.byTefilla.maariv[0].start - plain.zmanimFor(D.pesach1).sunset) >= 45], ['yomtov', true]);
  /* a Yom Tov list of its own for מנחה does not displace Friday's on a Friday */
  const e3 = (E.MinyanEngine || E)(Object.assign({}, base, { schedules: Object.assign({}, base.schedules, { yomtov: { mincha: '17:00 לב אהרן' } }) }));
  ok('with a מנחה list of its own, Yom Tov uses it on a Thursday and Friday\'s on a Friday', [e3.scheduleFor(D.pesach1).byTefilla.mincha.map(e => e3.fmtTime(e.start)), rel(e3.scheduleFor(D.pesach2Fri), 'mincha')], [['5:00'], 10]);
}
{
  /* a minyan remembers the zman its line goes by, so the screen can name it */
  const m0 = mon.byTefilla.mincha[0], fixed = mon.byTefilla.mincha.filter(e => eng.fmtTime(e.start) === '2:00')[0];
  ok('the weekday מנחה at מנחה גדולה knows that it goes by that zman; a fixed-time one goes by none', [m0.zman, m0.zoff, eng.fmtTime(m0.start) === eng.fmtTime(Math.round(eng.zmanimFor(mon.rd).minchag)), fixed && fixed.zman], ['minchag', 0, true, '']);
  ok('a minyan in a run goes by no zman of its own', mon.byTefilla.maariv.filter(e => e.series).every(e => e.zman === ''), true);
}
ok('צאת (60) is 60 minutes after sunset', Math.round(Cal.zmanim(sunRd, cfg.location).tzeis60 - Cal.zmanim(sunRd, cfg.location).sunset), 60);
