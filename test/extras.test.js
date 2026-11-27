/* Rooms by the clock on a repeating run ("@clock"), donations that come back every year, and the back end's Quick change. */
global.Cal = require('../src/cal.js');
const E = require('../src/engine.js');
const M = E.MinyanEngine || E;
const base = require('../config.default.json');
let fails = 0;
function ok(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) console.log('ok   ' + name); else { fails++; console.log('FAIL ' + name + '\n   got  ' + g + '\n   want ' + w); }
}
const copy = o => JSON.parse(JSON.stringify(o));
const G = (y, m, d) => Cal.rdFromGreg(y, m, d);

/* ---- rooms by the clock ---- */
const tf = { id: 'maariv', period: 'pm' };
const p = M.parseLine('every 10 from tzeis+10 to 23:00 rooms A, B, C @clock until chatzos // note', tf);
ok('@clock is read, and is not a room', [p.byClock, p.rooms, p.note, !!p.cond], [true, ['A', 'B', 'C'], 'note', true]);
ok('a run without it is as before', M.parseLine('every 10 from 20:00 to 22:30 rooms A, B', tf).byClock, false);
function slots(line) {
  const c = copy(base); c.overrides = []; c.rolls = []; c.schedules.weekday.maariv = line;
  const e = M(c), seen = {}; let days = 0;
  for (let i = 0; i < 200; i++) {
    const s = e.scheduleFor(G(2026, 11, 1) + i);
    if (s.type !== 'weekday') continue;
    days++;
    s.byTefilla.maariv.forEach(x => { const k = Math.floor(x.start / 10); (seen[k] = seen[k] || new Set()).add(x.room); });
  }
  return { days, most: Math.max(...Object.values(seen).map(s => s.size)) };
}
const withClock = slots('every 10 from tzeis+10 to 23:00 rooms A, B, C @clock'), without = slots('every 10 from tzeis+10 to 23:00 rooms A, B, C');
ok('by the clock: a ten-minute slot has one room all winter', [withClock.days > 80, withClock.most], [true, 1]);
ok('by the count: the rooms shift as the zman moves', without.most > 1, true);
{
  const c = copy(base); c.overrides = []; c.rolls = []; c.schedules.weekday.maariv = 'every 10 from 20:00 to 20:40 rooms A, B, C @clock';
  const r = M(c).scheduleFor(G(2026, 12, 1)).byTefilla.maariv.map(x => x.room);
  ok('by the clock the rooms still take turns', [r.length, new Set(r.slice(0, 3)).size, r[3] === r[0]], [5, 3, true]);
}

/* ---- a donation every year ---- */
const heb = iso => { const m = iso.split('-').map(Number); return Cal.formatHeb(Cal.hebFromRD(G(m[0], m[1], m[2]))); };
const month = { from: '2026-11-11', to: '2026-12-10', yearly: true, name: 'x' }; /* 1 to 30 Kislev 5787 */
let sp = M.noticeSpan(month, G(2026, 11, 27));
ok('this year: its own dates', [sp.from, sp.to], ['2026-11-11', '2026-12-10']);
sp = M.noticeSpan(month, G(2027, 6, 1));
ok('between rounds: the next Kislev', [heb(sp.from).split(' ').slice(0, 2).join(' '), heb(sp.to).split(' ').slice(0, 2).join(' ')], ['א׳ כסלו', 'ל׳ כסלו']);
ok('without "yearly" the dates stay as written', M.noticeSpan({ from: '2026-11-11', to: '2026-12-10' }, G(2027, 12, 5)), { from: '2026-11-11', to: '2026-12-10' });
{
  const c = copy(base); c.notices = [{ from: '2026-11-22', to: '2026-11-22', yearly: true, name: 'yearly' }, { from: '2026-11-22', to: '2026-11-22', name: 'once' }];
  const e = M(c), on = [];
  for (let i = 0; i < 800; i++) { const rd = G(2026, 11, 1) + i, n = e.activeNotices(rd).map(x => x.name).join('+'); if (n) on.push(M.isoDate(rd) + ' ' + n); }
  ok('a one-day yearly donation is on once a year, on 12 Kislev', on, ['2026-11-22 yearly+once', '2027-12-12 yearly', '2028-11-30 yearly']);
}
{
  const adar = { from: '2027-03-01', to: '2027-03-01', yearly: true, name: 'a' }; /* 22 Adar I 5787, a leap year */
  ok('Adar I in a plain year is Adar; in the next leap year Adar I again', [heb(M.noticeSpan(adar, G(2028, 1, 1)).from), heb(M.noticeSpan(adar, G(2030, 1, 1)).from)], ['כ״ב אדר תשפ״ח', 'כ״ב אדר א׳ תש״צ']);
}

/* ---- Quick change: the worker does a back-end text as it does a gabbai's ---- */
(async () => {
  const worker = (await import('../sms/dist/worker.js')).default;
  const cfg = copy(base); cfg.pin = '1234'; delete cfg.pinHash;
  const store = new Map();
  const SUBS = { get: async (k, t) => { const v = store.get(k); return v == null ? null : t === 'json' ? JSON.parse(v) : v; }, put: async (k, v) => { store.set(k, v); }, delete: async k => { store.delete(k); },
    list: async () => ({ keys: [...store.keys()].map(name => ({ name })), list_complete: true }) };
  const env = { SUBS, CONFIG_URL: 'https://minyan.example/config.json', ALLOWED_ORIGIN: 'https://minyan.example' };
  global.fetch = async url => { if (String(url).split('?')[0] === env.CONFIG_URL) return new Response(JSON.stringify(cfg), { headers: { 'content-type': 'application/json' } }); throw new Error('unexpected fetch ' + url); };
  const call = async body => (await worker.fetch(new Request('https://w.example/editors', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), env)).json();
  const no = await call({ pin: '0000', doText: 'add mincha 2:15 ברך משה' });
  ok('a wrong PIN changes nothing', [no.error, store.has('textdays')], ['wrong PIN', false]);
  const yes = await call({ pin: '1234', doText: 'add mincha 2:15 ברך משה' });
  const days = JSON.parse(store.get('textdays') || '{}'), iso = Object.keys(days)[0];
  ok('the right PIN adds it, for one day, and it can be undone', [yes.done && yes.done.ok, yes.done && yes.done.canUndo, Object.keys(days).length, !!(iso && days[iso].mincha && /14:15 ברך משה/.test(days[iso].mincha.line))], [true, true, 1, true]);
  ok('it is in the log as the back end\'s', (yes.log[0] || {}).who, 'Back end');
  const back = await call({ pin: '1234', doText: 'undo' });
  ok('undo takes it back', [back.done && back.done.ok, Object.keys(JSON.parse(store.get('textdays') || '{}')).length], [true, 0]);
  const other = await call({ pin: '1234', doText: 'put up a poster' });
  ok('something it cannot do changes nothing', [other.done && other.done.ok, store.get('textdays')], [false, '{}']);
  console.log(fails ? fails + ' FAILED' : 'all ok');
  process.exit(fails ? 1 : 0);
})();
