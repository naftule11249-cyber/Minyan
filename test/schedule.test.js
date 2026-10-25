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
ok('monday is a weekday with its own 20 minyanim', [mon.type, mon.byTefilla.shacharis.length], ['weekday', 20]);
ok('sunday mincha and maariv follow the weekday lists', [sun.byTefilla.mincha.length, sun.byTefilla.maariv.length], [mon.byTefilla.mincha.length, mon.byTefilla.maariv.length]);
/* zman-based times start from the zman as the zmanim list shows it (to the minute): chatzos 12:40 -> chatzos-30 is 12:10, not 12:09 */
const z = Cal.zmanim(sunRd, cfg.location);
ok('chatzos shown as 12:40', eng.fmtTime(z.chatzos), '12:40');
ok('chatzos-30 = shown chatzos minus 30', eng.fmtTime(sun.byTefilla.shacharis[18].start), eng.fmtTime(Math.round(z.chatzos) - 30));
ok('~5 still rounds down to 5 minutes', eng.fmtTime((E.MinyanEngine || E)(Object.assign({}, cfg, { schedules: { weekday: { shacharis: 'chatzos-30~5 ברך משה' } } })).scheduleFor(sunRd).byTefilla.shacharis[0].start), '12:10');
ok('new room is in the room list', cfg.rooms.split(',').map(s => s.trim()).indexOf('היכל אדל') >= 0, true);
ok('now window setting', cfg.nowMinutes, 20);
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
ok('צאת (60) is 60 minutes after sunset', Math.round(Cal.zmanim(sunRd, cfg.location).tzeis60 - Cal.zmanim(sunRd, cfg.location).sunset), 60);
