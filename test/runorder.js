/* A frame on the hallway screen reads in the order of the clock. A run ("every 10 minutes, 6:05–10:25") is written as one box
   under the tiles; a minyan that starts after the runs have ended (a 12:00 Maariv) used to stand above those boxes and now stands
   under them. The run boxes wear the minyan tiles' colour, since they are minyanim too, and follow it when the gabbai changes it;
   they read "יעדע 10 מינוט · פון 6:05 ביז 10:25", the gabbai's words. And the minyan set at מנחה גדולה says so on a tab, like the
   tabs for סוף זמן תפילה and חצות. The schedule here is the check's own. Clock frozen Wed 18 Nov 2026, New York. */
const { chromium } = require('playwright');
const BASE = 'http://localhost:8790/';
const at = (h, m) => Date.UTC(2026, 10, 18, h + 5, m);
const MAARIV = '17:41 היכל אדל\n17:53 דברי יואל\nevery 10 from 18:05 to 22:25 rooms ברך משה, דברי יואל, לב אהרן\nevery 15 from 22:30 to 23:30 rooms ברך משה, דברי יואל\n00:00 היכל ביהמ״ד';
(async () => {
  const browser = await chromium.launch(); const errors = []; let fails = 0;
  const ok = (name, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) console.log('ok   ' + name); else { fails++; console.log('FAIL ' + name + ' got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want)); } };
  async function look(when, maariv, more, viewport) {
    const ctx = await browser.newContext({ viewport: viewport || { width: 1920, height: 1080 }, locale: 'he', timezoneId: 'America/New_York', serviceWorkers: 'block' });
    await ctx.addInitScript(({ fixed }) => { const real = Date.now; const start = real(); Date.now = () => fixed + (real() - start); }, { fixed: when });
    await ctx.route('**/config.json*', async route => {
      const res = await route.fetch(); const c = JSON.parse(await res.text());
      c.schedules = { weekday: { shacharis: '07:00 לב אהרן\n08:00 דברי יואל\n09:00 ברך משה', mincha: '13:30 ברך משה\n16:15 דברי יואל', maariv } };
      c.tefillos = [{ id: 'shacharis', name: 'שחרית', milestone: 'הודו', offset: 10, startLabel: 'ברכות', period: 'am', kind: 'minyan' }, { id: 'mincha', name: 'מנחה', milestone: '', offset: 0, startLabel: '', period: 'pm', kind: 'minyan' }, { id: 'maariv', name: 'מעריב', milestone: '', offset: 0, startLabel: '', period: 'pm', kind: 'minyan' }];
      c.rolls = []; c.overrides = []; c.notices = []; c.banner = { text: '', from: '', until: '' }; c.palette = 'hallway'; c.displayScale = 100; c.nextTemplate = ''; c.lang = 'he'; c.bigTime = 'start'; c.nowMinutes = 20;
      ['wallLook', 'wallTopBar', 'wallWindow', 'nextPanel', 'nextHold', 'nextMark', 'countTo', 'donationKinds', 'dayTefilla'].forEach(k => delete c[k]);
      Object.assign(c, more || {});
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(c) });
    });
    const page = await ctx.newPage(); page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/ERR_|Failed to load resource|favicon/.test(m.text())) errors.push(m.text()); });
    await page.goto(BASE + 'index.html?view=display&full=1', { waitUntil: 'networkidle' }); await page.locator('.aclock svg').waitFor({ timeout: 15000 }); await page.waitForTimeout(700);
    const r = await page.evaluate(() => {
      const card = Array.from(document.querySelectorAll('.wall section.tefilla:not(.zcard)')).filter(c => Array.from(c.querySelectorAll('.sub')).some(s => /מעריב/.test(s.textContent)))[0]; if (!card) return null;
      /* the Maariv part of the frame: everything after its sub-heading, top to bottom */
      const all = Array.from(card.querySelectorAll('.sub, .tile, .runline')), from = all.findIndex(n => n.classList.contains('sub') && /מעריב/.test(n.textContent)), part = all.slice(from + 1);
      const lum = c => { const m = /rgba?\((\d+), (\d+), (\d+)/.exec(c), f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(+m[1]) + 0.7152 * f(+m[2]) + 0.0722 * f(+m[3]); };
      const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }, firstRgb = s => (/rgba?\([^)]*\)/.exec(s) || [''])[0];
      const plain = card.querySelector('.tile:not(.next):not(.prev):not(.past):not(.next-quiet)'), line = card.querySelector('.runline'), cs = e => getComputedStyle(e);
      const base = line ? (cs(line).backgroundImage !== 'none' ? firstRgb(cs(line).backgroundImage) : cs(line).backgroundColor) : '';
      return { seq: part.map(n => n.classList.contains('runline') ? 'LINE ' + Array.from(n.querySelectorAll('.hrs .h')).map(h => h.textContent).join('–') : n.querySelector('.time').textContent), tops: part.map(n => Math.round(n.getBoundingClientRect().top)), bottoms: part.map(n => Math.round(n.getBoundingClientRect().bottom)),
        words: Array.from(card.querySelectorAll('.runline')).map(l => [l.querySelector('.num').textContent, (l.querySelector('.rooms') || {}).textContent]), wordSizes: line ? [parseFloat(cs(line.querySelector('.hrs .h')).fontSize) >= 0.95 * parseFloat(cs(card.querySelector('.tile .time')).fontSize), parseFloat(cs(line.querySelector('.hrs .w')).fontSize) < parseFloat(cs(line.querySelector('.hrs .h')).fontSize), line.scrollWidth <= line.clientWidth + 1] : null,
        marks: Array.from(document.querySelectorAll('.wall .tile .mark')).map(m => [m.parentElement.querySelector('.room').textContent, m.parentElement.querySelector('.time').textContent, m.textContent]),
        marksInside: Array.from(document.querySelectorAll('.wall .tile .mark')).every(m => { const r = m.getBoundingClientRect(), c = m.closest('.wcol').getBoundingClientRect(); return r.left >= c.left && r.right <= c.right && r.bottom <= c.bottom; }),
        kinds: part.map(n => n.classList.contains('runline') ? 'L' : 'T'), states: part.map(n => n.className.replace(/^(tile|runline)\s*/, '')), after: card.querySelectorAll('.grid.after-runs').length,
        sameBg: line && plain ? cs(line).backgroundImage === cs(plain).backgroundImage && cs(line).backgroundColor === cs(plain).backgroundColor : null, sameInk: line && plain ? cs(line).color === cs(plain).color : null,
        contrast: line ? [contrast(cs(line.querySelector('.hrs')).color, base) >= 4.5, contrast(cs(line.querySelector('.ev')).color, base) >= 4.5, contrast(cs(line.querySelector('.rooms')).color, base) >= 4.5] : null,
        lineOpacity: line ? cs(line).opacity : null, pastTileOpacity: card.querySelector('.tile.past') ? cs(card.querySelector('.tile.past')).opacity : null, lineBase: base,
        inside: part.every(n => { const r = n.getBoundingClientRect(), c = card.getBoundingClientRect(); return r.left >= c.left - 1 && r.right <= c.right + 1 && r.top >= c.top - 1 && r.bottom <= c.bottom + 1; }),
        fits: Array.from(document.querySelectorAll('main.wall > .wcol')).every(c => c.scrollHeight - c.clientHeight <= 1) && document.documentElement.scrollHeight <= window.innerHeight };
    });
    return { ctx, page, r };
  }
  /* every tile above the first box, or below the last one: nothing beside or between */
  const order = r => { const L = r.kinds.map((k, i) => k === 'L' ? i : -1).filter(i => i >= 0), firstTop = r.tops[L[0]], lastBottom = r.bottoms[L[L.length - 1]]; return r.kinds.map((k, i) => k === 'L' ? 'L' : r.bottoms[i] <= firstTop + 1 ? 'above' : r.tops[i] >= lastBottom - 1 ? 'below' : 'beside'); };

  /* the morning: everything still to come */
  let { ctx, page, r } = await look(at(9, 30), MAARIV);
  ok('the Maariv part reads in the order of the clock: the tiles, the two runs as boxes, and the 12:00 last', r.seq, ['5:41', '5:53', '6:05', '10:30', 'LINE 6:05–10:25', 'LINE 10:30–11:30', '12:00']);
  ok('on the screen too: the earlier tiles stand above the boxes and the 12:00 under them', [order(r), r.after, r.inside, r.fits], [['above', 'above', 'above', 'above', 'L', 'L', 'below'], 1, true, true]);
  ok('the boxes wear the minyan tiles\' colour and ink, and every line in them reads clearly on it', [r.sameBg, r.sameInk, r.contrast], [true, true, [true, true, true]]);
  ok('each box says how often and from when to when in the gabbai\'s words, with the rooms under it', r.words, [['יעדע 10 מינוט · פון 6:05 ביז 10:25', 'ברך משה · דברי יואל · לב אהרן'], ['יעדע 15 מינוט · פון 10:30 ביז 11:30', 'ברך משה · דברי יואל']]);
  ok('the two times stand as large as a tile\'s time, "פון" and "ביז" small beside them, all on the box', r.wordSizes, [true, true, true]);
  await page.screenshot({ path: 'test/shot-runorder.png' });
  await ctx.close();

  /* the minyan set at מנחה גדולה */
  const MG = { weekday: { shacharis: '07:00 לב אהרן', mincha: 'minchag ברך משה\nminchag+5 לב אהרן\nminchag+40 שלמה יודא\n14:00 דברי יואל\n16:15 דברי יואל', maariv: MAARIV } };
  ({ ctx, page, r } = await look(at(9, 30), MAARIV, { schedules: MG }));
  const mgTabs = r.marks.filter(m => m[2] === 'מנחה גדולה');
  ok('a minyan the schedule sets at מנחה גדולה carries a tab saying so; one a few minutes after it too; one long after it, or at a fixed time, does not', [mgTabs.map(m => m[0]), mgTabs.length, r.marks.filter(m => m[1] === '2:00' || m[0] === 'שלמה יודא').length, r.marksInside, r.fits], [['ברך משה', 'לב אהרן'], 2, 0, true, true]);
  await ctx.close();
  ({ ctx, page, r } = await look(at(9, 30), MAARIV, { schedules: MG, lang: 'yi' }));
  ok('with Yiddish labels the boxes and the tab read the same words', [r.words[0][0], r.marks.filter(m => m[2] === 'מנחה גדולה').length], ['יעדע 10 מינוט · פון 6:05 ביז 10:25', 2]);
  await ctx.close();
  /* Shabbos: the weekday "last minyan" tabs are not shown, this one is */
  ({ ctx, page, r } = await look(Date.UTC(2026, 10, 21, 9 + 5, 30), MAARIV, { schedules: { weekday: MG.weekday, shabbos: { shacharis: '08:30 לב אהרן\n09:30 דברי יואל', mincha: 'minchag ברך משה\nsunset-40~5 דברי יואל', maariv: 'sunset+50~5 דברי יואל' } } }));
  ok('on Shabbos the tab for מנחה גדולה is there, and the weekday tabs for סוף זמן תפילה and חצות are not', [r ? r.marks.map(m => m[2]) : null], [['מנחה גדולה']]);
  await ctx.close();

  /* a single minyan in the middle of a run stays with the tiles; one after the runs goes under them */
  ({ ctx, page, r } = await look(at(9, 30), MAARIV + '\n21:00 שלמה יודא'));
  ok('a single minyan in the middle of a run stays above the boxes, in its place among the tiles', [r.seq, order(r)], [['5:41', '5:53', '6:05', '9:00', '10:30', 'LINE 6:05–10:25', 'LINE 10:30–11:30', '12:00'], ['above', 'above', 'above', 'above', 'above', 'L', 'L', 'below']]);
  await ctx.close();
  ({ ctx, page, r } = await look(at(9, 30), '17:41 היכל אדל\nevery 10 from 18:05 to 22:25 rooms ברך משה, דברי יואל'));
  ok('with nothing after the run there is no second group of tiles', [r.seq, r.after, r.fits], [['5:41', '6:05', 'LINE 6:05–10:25'], 0, true]);
  await ctx.close();
  ({ ctx, page, r } = await look(at(9, 30), '17:41 היכל אדל\n18:05 ברך משה\n00:00 היכל ביהמ״ד'));
  ok('with no run at all the frame is as it always was: one group of tiles', [r.seq, r.after, r.kinds.indexOf('L')], [['5:41', '6:05', '12:00'], 0, -1]);
  await ctx.close();

  /* late at night: the runs are over, the 12:00 is next */
  ({ ctx, page, r } = await look(at(23, 40), MAARIV));
  ok('at 11:40 at night the 12:00 is the next minyan, green, under the boxes', [r.seq[r.seq.length - 1], r.states[r.states.length - 1], order(r)[r.seq.length - 1]], ['12:00', 'next', 'below']);
  ok('and the runs, both over, are faded the way a tile that has passed is', [r.states.filter((s, i) => r.kinds[i] === 'L' && /past/.test(s)).length, r.lineOpacity, r.pastTileOpacity], [2, '0.42', '0.42']);
  await ctx.close();

  /* the gabbai's own tile colour */
  ({ ctx, page, r } = await look(at(9, 30), MAARIV, { wallLook: { tileBg: '#1f3a68', tileInk: '#ffffff' } }));
  ok('when the gabbai gives the tiles a colour of his own, the boxes follow it', [r.sameBg, r.sameInk, r.lineBase], [true, true, 'rgb(31, 58, 104)']);
  await ctx.close();

  /* the other looks, and a small TV */
  for (const look2 of ['shul', 'classic', 'contrast']) {
    ({ ctx, page, r } = await look(at(9, 30), MAARIV, { palette: look2 }));
    ok('in the ' + look2 + ' look: tile colour on the boxes, every line readable, the order kept', [r.sameBg, r.contrast, order(r).join(' ')], [true, [true, true, true], 'above above above above L L below']);
    await ctx.close();
  }
  ({ ctx, page, r } = await look(at(9, 30), MAARIV, null, { width: 1280, height: 720 }));
  ok('on a 1280 × 720 TV the order holds and everything fits', [order(r).join(' '), r.inside, r.fits], ['above above above above L L below', true, true]);
  await ctx.close();

  await browser.close();
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
  console.log(fails ? fails + ' FAILED' : 'all ok');
  process.exit(fails || errors.length ? 1 : 0);
})().catch(e => { console.log('ERROR', e.message); process.exit(1); });
