/* A gabbai's text that changes one day's minyanim (src/edit.js), against the shul's own settings. Clock: Sunday 22 Nov 2026, 10:00. */
global.Cal = require('../src/cal.js'); global.MinyanEngine = require('../src/engine.js');
const MinyanEdit = require('../src/edit.js');
const cfg = JSON.parse(JSON.stringify(require('../config.default.json'))); cfg.overrides = []; cfg.roomNumbers = {}; /* the room numbers have their own checks below */
let fails = 0;
const same = (g, w) => w instanceof RegExp ? w.test(String(g)) : Array.isArray(w) ? Array.isArray(g) && g.length === w.length && w.every((x, i) => same(g[i], x)) : JSON.stringify(g === undefined ? null : g) === JSON.stringify(w === undefined ? null : w);
const ok = (name, got, want) => { const pass = same(got, want); if (!pass) fails++; console.log((pass ? 'ok   ' : 'FAIL ') + name + (pass ? '' : ' got ' + JSON.stringify(got) + ' want ' + (Array.isArray(want) ? want.map(String).join(' , ') : want))); };
const now = Cal.epochFromWall(Cal.rdFromGreg(2026, 11, 22), 10 * 60, 'America/New_York');
const run = (t, c) => MinyanEdit.run(c || cfg, t, now);
const times = (c, iso, tf) => { const e = MinyanEngine(c), m = /(\d+)-(\d+)-(\d+)/.exec(iso), s = e.scheduleFor(Cal.rdFromGreg(+m[1], +m[2], +m[3])); return (s.byTefilla[tf] || []).map(x => e.fmtTime(x.start) + (x.room ? ' ' + x.room : '')); };
const base = times(cfg, '2026-11-22', 'mincha');

/* what is and is not a command */
ok('an ordinary text is not a command', [MinyanEdit.parse('מנחה'), MinyanEdit.parse('next'), MinyanEdit.parse('שערן'), MinyanEdit.parse('cancel'), MinyanEdit.parse('')], [null, null, null, null, null]);
ok('the first word makes it one', ['add mincha 2:15', 'לייג צו מנחה 2:15', 'בטל מנחה 2:00', 'טויש מנחה 2:00 אויף 2:15', 'undo', 'צוריק', 'גבאי'].map(t => MinyanEdit.parse(t).action), ['add', 'add', 'cancel', 'move', 'undo', 'undo', 'help']);

/* add */
let r = run('לייג צו מנחה 2:15 לב אהרן');
ok('add in Yiddish: said back, for today', r.reply, /^צוגעלייגט: מנחה 2:15 לב אהרן, היינט \(זונטאג\)\.\n.*סקרין.*\nצוריקצוציען שיקט: צוריק$/);
ok('add: the day gets its own mincha list with the new minyan in its place, 2:15 in the afternoon', [times(r.cfg, '2026-11-22', 'mincha').includes('2:15 לב אהרן'), times(r.cfg, '2026-11-22', 'mincha').length, r.cfg.overrides[0].date, /\n14:15 לב אהרן\n/.test(r.cfg.overrides[0].lines.mincha)], [true, base.length + 1, '2026-11-22', true]);
ok('add: the other tefillos and the other days are untouched', [times(r.cfg, '2026-11-22', 'shacharis'), times(r.cfg, '2026-11-22', 'maariv'), times(r.cfg, '2026-11-23', 'mincha'), Object.keys(r.cfg.overrides[0].lines)], [times(cfg, '2026-11-22', 'shacharis'), times(cfg, '2026-11-22', 'maariv'), times(cfg, '2026-11-23', 'mincha'), ['mincha']]);
ok('add: the settings are stamped newer, the original is not changed', [r.cfg.savedAt > (cfg.savedAt || 0), cfg.overrides.length], [true, 0]);
ok('add in English, tomorrow, no room', run('add maariv 9:15 tomorrow').reply, /^Added: Maariv 9:15, tomorrow \(Monday\)\./);
ok('add shacharis 7:20 is in the morning; maariv 12:30 is after midnight', [/\n07:20\n|^07:20\n/.test(run('add shacharis 7:20').cfg.overrides[0].lines.shacharis), /\n00:30$/.test(run('add maariv 12:30').cfg.overrides[0].lines.maariv)], [true, true]);
ok('add by a day name: Tuesday', [run('לייג צו מעריב 9:15 דינסטאג ברך משה').reply.split('\n')[0], run('לייג צו מעריב 9:15 דינסטאג ברך משה').cfg.overrides[0].date], ['צוגעלייגט: מעריב 9:15 ברך משה, דינסטאג.', '2026-11-24']);
ok('add: one that is already there', run('add mincha 2:00 ברך משה').reply, /^That one is already there: Mincha 2:00 ברך משה, today$/);
ok('add needs a tefilla and a time', [run('add 2:15').reply, run('לייג צו מנחה').reply], [/^Which tefilla\?/, /^וועלכע צייט\?/]);
ok('a room the shul does not have is not written in', [run('add mincha 2:15 xyz').reply, run('add mincha 2:15 xyz').cfg], [/^I did not understand "xyz".*room: ברך משה/, undefined]);
ok('a room by the start of its name, with or without the marks', [run('add mincha 2:15 היכל ביהמד').cfg.overrides[0].lines.mincha.includes('14:15 היכל ביהמ״ד'), run('add mincha 2:15 לב').cfg.overrides[0].lines.mincha.includes('14:15 לב אהרן')], [true, true]);

/* cancel */
r = run('בטל מנחה 2:00');
ok('cancel: said back with its room, gone from that day only', [r.reply.split('\n')[0], times(r.cfg, '2026-11-22', 'mincha').includes('2:00 ברך משה'), times(r.cfg, '2026-11-23', 'mincha').includes('2:00 ברך משה')], ['אראפגענומען: מנחה 2:00 ברך משה, היינט (זונטאג).', false, true]);
ok('cancel without the tefilla, when only one minyan is at that time', run('cancel 3:15').reply, /^Cancelled: Mincha 3:15 היכל ביהמ״ד, today/);
ok('cancel: not found, with what there is', run('cancel mincha 2:07').reply, /^No Mincha at 2:07 today\. Mincha today: 12:12 ברך משה, 2:00 ברך משה/);
ok('cancel: a time that two tefillos share asks which', run('cancel 5:33').reply, /^There are minyanim at 5:33 in more than one tefilla\. Write the tefilla too\.$/);
(() => { const c = JSON.parse(JSON.stringify(cfg)); c.overrides = [{ date: '2026-11-22', label: 'x', lines: { maariv: '21:00 ברך משה\n21:00 לב אהרן' } }];
  ok('cancel: two rooms at one time asks for the room, and the room settles it', [MinyanEdit.run(c, 'cancel maariv 9:00', now).reply, MinyanEdit.run(c, 'cancel maariv 9:00 לב אהרן', now).reply.split('\n')[0]], [/more than one minyan at 9:00 \(ברך משה, לב אהרן\)\. Write the room too\./, 'Cancelled: Maariv 9:00 לב אהרן, today (Sunday).']); })();
ok('cancel: a minyan the lists carry twice goes altogether', (() => { const before = times(cfg, '2026-11-22', 'maariv').filter(x => x === '10:30 דברי יואל').length, x = run('cancel maariv 10:30'); return [before, times(x.cfg, '2026-11-22', 'maariv').filter(y => y === '10:30 דברי יואל').length]; })(), [2, 0]);
ok('cancel the only minyan of a tefilla: the day says so instead of falling back to the regular list', (() => { const c = JSON.parse(JSON.stringify(cfg)); c.overrides = [{ date: '2026-11-22', label: 'x', lines: { mincha: '14:00 ברך משה' } }]; const x = MinyanEdit.run(c, 'cancel mincha 2:00', now); return [x.cfg.overrides[0].lines.mincha, times(x.cfg, '2026-11-22', 'mincha')]; })(), ['# בוטל להיום', []]);

/* move */
r = run('טויש מנחה 2:00 אויף 2:15');
ok('move: said back, the old time gone and the new one there, same room', [r.reply.split('\n')[0], times(r.cfg, '2026-11-22', 'mincha').includes('2:00 ברך משה'), times(r.cfg, '2026-11-22', 'mincha').includes('2:15 ברך משה')], ['געטוישט: מנחה 2:00 ברך משה → 2:15 ברך משה, היינט (זונטאג).', false, true]);
ok('move to another room, and to another time and room', [run('move mincha 2:00 לב אהרן').reply.split('\n')[0], run('move mincha 2:00 to 2:30 לב אהרן').reply.split('\n')[0]], ['Moved: Mincha 2:00 ברך משה → 2:00 לב אהרן, today (Sunday).', 'Moved: Mincha 2:00 ברך משה → 2:30 לב אהרן, today (Sunday).']);
ok('move shacharis 11:00 to 12:00 stays by day: noon, not midnight', run('move shacharis 11:00 to 12:00').cfg.overrides[0].lines.shacharis.includes('12:00 דברי יואל'), true);
ok('move needs somewhere to go; the same place changes nothing', [run('move mincha 2:00').reply, run('move mincha 2:00 to 2:00').reply], [/^Move it to what\?/, 'It is already so. Nothing changed.']);

/* a second change the same day builds on the first; undo takes back one */
const a1 = run('add mincha 2:15 לב אהרן'), a2 = MinyanEdit.run(a1.cfg, 'cancel mincha 2:00', now);
ok('two changes: both hold', [times(a2.cfg, '2026-11-22', 'mincha').includes('2:15 לב אהרן'), times(a2.cfg, '2026-11-22', 'mincha').includes('2:00 ברך משה'), a2.cfg.overrides.length], [true, false, 1]);
const u2 = MinyanEdit.undo(a2.cfg, a2.undo, 'yi', now), u1 = MinyanEdit.undo(u2.cfg, a1.undo, 'en', now);
ok('undo the second: the first stays', [u2.reply.split('\n')[0], times(u2.cfg, '2026-11-22', 'mincha').includes('2:00 ברך משה'), times(u2.cfg, '2026-11-22', 'mincha').includes('2:15 לב אהרן')], ['צוריקגעצויגן: Cancelled: Mincha 2:00 ברך משה, today (Sunday).', true, true]);
ok('undo the first too: the day is back on the regular schedule', [u1.cfg.overrides.length, times(u1.cfg, '2026-11-22', 'mincha')], [0, base]);
ok('undo with nothing to undo', [MinyanEdit.undo(cfg, null, 'en', now).reply, MinyanEdit.undo(cfg, a1.undo, 'en', now).cfg], [/^Nothing to undo/, undefined]);
ok('"undo" asks the service for the sender\'s last change', [run('undo').wantsUndo, run('צוריק').wantsUndo], [true, true]);

/* a day that already has a change from the back end keeps its other tefillos */
(() => { const c = JSON.parse(JSON.stringify(cfg)); c.overrides = [{ date: '2026-11-22', label: 'שינוי להיום', lines: { shacharis: '08:00 ברך משה' } }]; const x = MinyanEdit.run(c, 'add mincha 2:15', now), u = MinyanEdit.undo(x.cfg, x.undo, 'en', now);
  ok('a day the back end already changed: its lines stay, and undo leaves them', [x.cfg.overrides.length, x.cfg.overrides[0].lines.shacharis, Object.keys(u.cfg.overrides[0].lines)], [1, '08:00 ברך משה', ['shacharis']]); })();

/* rooms by number */
(() => { const c = JSON.parse(JSON.stringify(cfg)); c.roomNumbers = { 1: 'דברי יואל', 2: 'ברך משה', 4: 'לב אהרן' };
  const g = t => MinyanEdit.run(c, t, now);
  ok('a number after the time is the room', [g('add mincha 2:15 4').reply.split('\n')[0], g('לייג צו מנחה 2:15 חדר 1').reply.split('\n')[0], g('add mincha 2:15 #2').reply.split('\n')[0]], ['Added: Mincha 2:15 לב אהרן, today (Sunday).', 'צוגעלייגט: מנחה 2:15 דברי יואל, היינט (זונטאג).', 'Added: Mincha 2:15 ברך משה, today (Sunday).']);
  ok('the first number is still the time; a number no room has is a time too', [g('cancel mincha 2').reply.split('\n')[0], g('move mincha 2:00 to 3').reply.split('\n')[0]], ['Cancelled: Mincha 2:00 ברך משה, today (Sunday).', 'Moved: Mincha 2:00 ברך משה → 3:00 ברך משה, today (Sunday).']);
  ok('move to a room by its number; pick between two by its number', [g('move mincha 2:00 4').reply.split('\n')[0], g('move mincha 2:00 to 2:30 1').reply.split('\n')[0]], ['Moved: Mincha 2:00 ברך משה → 2:00 לב אהרן, today (Sunday).', 'Moved: Mincha 2:00 ברך משה → 2:30 דברי יואל, today (Sunday).']);
  ok('the examples list the numbers', g('gabbai').reply, /Rooms \(the number works too\): 1 דברי יואל, 2 ברך משה, 4 לב אהרן$/); })();
ok('without room numbers a second number is a time, as before', run('move mincha 2:00 to 3').reply.split('\n')[0], 'Moved: Mincha 2:00 ברך משה → 3:00 ברך משה, today (Sunday).');

/* limits */
ok('only today and the next six days', [run('add mincha 2:15 saturday').cfg.overrides[0].date, run('add mincha 2:15 sunday').cfg.overrides[0].date], ['2026-11-28', '2026-11-22']);
ok('help lists the texts', [run('גבאי').reply, run('gabbai').reply], [/^טוישן א מנין דורך טעקסט/, /^Change a minyan by text/]);
console.log(fails ? fails + ' FAILING' : 'edit: all good'); process.exit(fails ? 1 : 0);
