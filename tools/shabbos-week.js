#!/usr/bin/env node
/* tools/shabbos-week.js — the coming Shabbos's times from the board, for the weekly zmanim sheet (week.json).
   The board is the one place the times are set; the sheet takes them from here.

   Usage:
     node tools/shabbos-week.js                      this week, from docs/config.json (the published board)
     node tools/shabbos-week.js --date 2026-11-14    the Shabbos of that week
     node tools/shabbos-week.js --config https://minyan.cascadeshul.org/config.json
     node tools/shabbos-week.js > week.json

   Prints: parsha, hadlakah, szks (מג״א), motzash (72), minchaErev, minchaShabbos,
   shacharis / hodu, and every Friday and Shabbos minyan as the board lists them. */
const fs = require('fs'), path = require('path');
global.Cal = require('../src/cal.js');
const MinyanEngine = require('../src/engine.js');
const args = process.argv.slice(2), arg = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };

(async () => {
  const src = arg('--config') || path.join(__dirname, '..', 'docs', 'config.json');
  const cfg = /^https?:/.test(src) ? await (await fetch(src + (src.includes('?') ? '&' : '?') + 't=' + Date.now())).json() : JSON.parse(fs.readFileSync(src, 'utf8'));
  const e = MinyanEngine(cfg), tz = e.loc().tz;
  let rd = Cal.nowInTz(Date.now(), tz).rd;
  if (arg('--date')) { const [y, m, d] = arg('--date').split('-').map(Number); rd = Cal.rdFromGreg(y, m, d); }
  const sat = rd + Cal.mod(6 - Cal.mod(rd, 7), 7), fri = sat - 1;
  const t = m => (m == null || isNaN(m) ? '' : e.fmtTime(m));
  const zf = e.zmanimFor(fri), zs = e.zmanimFor(sat), fs_ = e.scheduleFor(fri), ss = e.scheduleFor(sat);
  const list = (s, id) => (s.byTefilla[id] || []).map(x => ({ name: ((s.tefillos || {})[id] || x.tefilla).name, time: t(x.start), second: x.tefilla.milestone && x.milestone != null ? x.tefilla.milestone + ' ' + t(x.milestone) : '', room: x.room || '' }));
  const first = (s, id) => (s.byTefilla[id] || [])[0];
  const mE = first(fs_, 'mincha'), mS = first(ss, 'mincha'), sh = first(ss, 'shacharis'), p = Cal.parshaForShabbos(sat, !!cfg.israel);
  const out = {
    shabbos: MinyanEngine.isoDate(sat),
    parsha: p ? 'פרשת ' + p.map(i => Cal.PARSHIOS[i]).join('-') : (Cal.dayInfo(sat, !!cfg.israel).labels[0] || ''),
    hebDate: Cal.formatHeb(Cal.hebFromRD(sat)),
    hadlakah: t(zf.candles),
    szks: t(zs.shemaMGA),
    motzash: t(Math.ceil(zs.tzeis72)), /* rounded up, as the weekly sheet has it */
    minchaErev: mE ? t(mE.start) : '',
    shacharis: sh ? t(sh.start) : '',
    hodu: sh && sh.milestone != null ? t(sh.milestone) : '',
    minchaShabbos: mS ? t(mS.start) : '',
    friday: { mincha: list(fs_, 'mincha'), maariv: list(fs_, 'maariv') },
    shabbosDay: { shacharis: list(ss, 'shacharis'), mincha: list(ss, 'mincha'), maariv: list(ss, 'maariv') }
  };
  process.stdout.write(JSON.stringify(out, null, 1) + '\n');
})().catch(err => { console.error('Could not read the board: ' + err.message); process.exit(1); });
