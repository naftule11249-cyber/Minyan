/* The clock gives up room for the donations. On the hallway screen the clock stands over the donation panels. A day with one donation
   more than usual (a פרנס היום) must not make the minyanim smaller: the clock gets smaller instead, down to a floor, and the day
   after it is back at its full size by itself. Only when the clock is at its floor and the column still does not fit does the whole
   screen shrink. Every kind of donation starts at the large size, so that it reads from the hallway.
   The schedule and the donations here are the check's own. Clock frozen Wed 18 Nov 2026, 11:15 AM New York. */
const { chromium } = require('playwright');
const BASE = 'http://localhost:8790/';
const at = (d, h, m) => Date.UTC(2026, 10, d, h + 5, m);
const MONTH = { title: 'פרנס חודש כסלו', lead: 'רון שיר ושבח למע״כ הרבני הנכבד והמרום כש״ת', name: 'מו״ה יעקב יואל פריעדמאן הי״ו', body: 'מחשובי מתפללי ולומדי בית מדרשינו\nלעילוי נשמת זקנתו מרת רבקה רחל בת ר׳ חיים ע״ה\nיארצייט ד׳ כסלו', size: 'big', logo: '', from: '2026-11-11', to: '2026-12-10' };
const NER = { title: 'נר למאור לחודש כסלו', lead: 'נתנדב לעילוי נשמת', name: 'ר׳ דוד ב״ר משה אלי׳ עסטרייכער ע״ה', body: 'נפטר כ״ז כסלו תשפ״ד · ג׳ דחנוכה · ת.נ.צ.ב.ה.', size: 'big', logo: '', from: '2026-11-11', to: '2026-12-10' };
const DAY = { title: 'פרנס היום', lead: '', name: 'מו״ה אפרים אליעזר פריעדמאן הי״ו', body: 'לרגל נישואי בתו\nהיום באולם פרדס פיגא', size: 'big', logo: '', from: '2026-11-18', to: '2026-11-18' };
const WEEK = { title: 'פרנס השבוע', lead: '', name: 'מו״ה חיים יוסף ווייס הי״ו', body: 'לרגל שמחת הבר מצוה של בנו', size: 'big', logo: '', from: '2026-11-15', to: '2026-11-21' };
(async () => {
  const browser = await chromium.launch(); const errors = []; let fails = 0;
  const ok = (name, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) console.log('ok   ' + name); else { fails++; console.log('FAIL ' + name + ' got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want)); } };
  async function look(when, notices, viewport) {
    const ctx = await browser.newContext({ viewport: viewport || { width: 1920, height: 1080 }, locale: 'he', timezoneId: 'America/New_York', serviceWorkers: 'block' });
    await ctx.addInitScript(({ fixed }) => { const real = Date.now; const start = real(); Date.now = () => fixed + (real() - start); }, { fixed: when });
    await ctx.route('**/config.json*', async route => {
      const res = await route.fetch(); const c = JSON.parse(await res.text());
      c.schedules = { weekday: { shacharis: '06:20 ברך משה\n06:50 דברי יואל\n07:10 ברך משה\n07:30 שלמה יודא\n07:45 לב אהרן\n08:00 דברי יואל\n08:15 ברך משה\n08:30 שלמה יודא\n08:45 היכל אדל\n09:00 לב אהרן\n09:15 דברי יואל\n09:30 ברך משה\n09:45 שלמה יודא\n10:00 היכל אדל\n10:20 לב אהרן\n10:40 דברי יואל\n11:00 ברך משה\n11:10 ברך משה',
        mincha: '12:11 ברך משה\n14:00 ברך משה\n15:15 היכל ביהמ״ד\n17:00 דברי יואל\n17:15 ברך משה\n17:30 לב אהרן', maariv: '17:41 היכל אדל\n17:53 דברי יואל\n18:05 ברך משה\nevery 10 from 18:05 to 22:25 rooms ברך משה, דברי יואל, לב אהרן\n22:30 ברך משה' } };
      c.tefillos = [{ id: 'shacharis', name: 'שחרית', milestone: 'הודו', offset: 10, startLabel: 'ברכות', period: 'am', kind: 'minyan' }, { id: 'mincha', name: 'מנחה', milestone: '', offset: 0, startLabel: '', period: 'pm', kind: 'minyan' }, { id: 'maariv', name: 'מעריב', milestone: '', offset: 0, startLabel: '', period: 'pm', kind: 'minyan' }];
      c.rolls = []; c.overrides = []; c.banner = { text: '', from: '', until: '' }; c.notices = JSON.parse(JSON.stringify(notices)); c.palette = 'hallway'; c.displayScale = 100; c.nextTemplate = ''; c.lang = 'he'; c.bigTime = 'start';
      ['wallLook', 'wallTopBar', 'wallWindow', 'nextPanel', 'nextHold', 'nextMark', 'countTo', 'donationKinds', 'dayTefilla'].forEach(k => delete c[k]);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(c) });
    });
    const page = await ctx.newPage(); page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/ERR_|Failed to load resource|favicon/.test(m.text())) errors.push(m.text()); });
    await page.goto(BASE + 'index.html?view=display&full=1', { waitUntil: 'networkidle' }); await page.locator('.aclock svg').waitFor({ timeout: 15000 }); await page.waitForTimeout(700);
    const r = await page.evaluate(() => {
      const html = document.documentElement, scale = +getComputedStyle(html).getPropertyValue('--lobby-scale'), a = document.querySelector('.aclock'), col = a.parentElement, cr = col.getBoundingClientRect(), ar = a.getBoundingClientRect(), face = a.querySelector('.face').getBoundingClientRect();
      const px = (e, q) => e && e.querySelector(q) ? parseFloat(getComputedStyle(e.querySelector(q)).fontSize) : 0, panels = Array.from(document.querySelectorAll('.wall .sponsor')), kids = Array.from(col.children).map(k => k.getBoundingClientRect());
      return { scale, tile: px(document, '.wall .tile .time'), clock: ar.height, dial: face.height, round: Math.abs(face.width - face.height) < 1.5, dialInBox: face.top >= ar.top - 1 && face.bottom <= ar.bottom + 1 && face.left >= cr.left - 1 && face.right <= cr.right + 1,
        full: Math.min(cr.width, 0.62 * window.innerHeight * scale), floor: 0.44 * window.innerHeight * scale, titles: panels.map(p => p.querySelector('.t').textContent), name: px(panels[0], '.n .nm'), line: px(panels[0], '.b .bl'),
        whole: panels.every(p => { const r = p.getBoundingClientRect(); return r.top >= cr.top - 1 && r.bottom <= cr.bottom + 1 && p.scrollHeight <= p.clientHeight + 1 && p.scrollWidth <= p.clientWidth + 1; }),
        apart: kids.every((k, i) => !i || k.top >= kids[i - 1].bottom - 1), spare: cr.bottom - kids[kids.length - 1].bottom,
        fits: Array.from(document.querySelectorAll('main.wall > .wcol')).every(c => c.scrollHeight - c.clientHeight <= 1) && html.scrollHeight <= window.innerHeight && html.scrollWidth <= window.innerWidth, paged: document.querySelectorAll('.wall .pg').length };
    });
    return { ctx, page, r };
  }
  const near = (a, b, tol) => Math.abs(a - b) <= (tol == null ? 2 : tol);

  /* the usual day: the month's two donations */
  let { ctx, page, r } = await look(at(18, 11, 15), [MONTH, NER]); const two = r;
  ok('with the month\'s two donations the clock is at its full size, round, inside its place, and everything fits', [two.titles, two.dial >= 0.9 * two.full, two.round, two.dialInBox, two.whole, two.apart, two.fits], [['פרנס חודש כסלו', 'נר למאור לחודש כסלו'], true, true, true, true, true, true]);
  await ctx.close();

  /* a פרנס היום on top of them */
  ({ ctx, page, r } = await look(at(18, 11, 15), [MONTH, NER, DAY])); const three = r;
  ok('a פרנס היום on top of them: all three panels are there, whole, one under the other, and everything fits with nothing paged', [three.titles, three.whole, three.apart, three.fits, three.paged], [['פרנס חודש כסלו', 'נר למאור לחודש כסלו', 'פרנס היום'], true, true, true, 0]);
  ok('it is the clock that made the room: clearly smaller than on the usual day, still round and inside its place, and not below its floor', [three.clock < 0.85 * two.clock, three.round, three.dialInBox, three.clock >= three.floor - 2], [true, true, true, true]);
  ok('the minyanim kept their size to within a tenth, and so did the donations\' lettering', [three.tile >= 0.9 * two.tile, three.name >= 0.9 * two.name, three.line >= 0.9 * two.line], [true, true, true]);
  ok('(without the rule the same day shrank everything by a fifth: the minyanim here are larger than that)', three.scale > 0.82 * two.scale, true);
  await page.screenshot({ path: 'test/shot-clockroom.png' });
  await ctx.close();

  /* the day after: the פרנס היום is over */
  ({ ctx, page, r } = await look(at(19, 11, 15), [MONTH, NER, DAY]));
  ok('the day after, with the פרנס היום over, the clock is back at its full size by itself', [r.titles, near(r.dial, two.dial, 3), near(r.scale, two.scale, 0.01), r.fits], [['פרנס חודש כסלו', 'נר למאור לחודש כסלו'], true, true, true]);
  await ctx.close();

  /* nothing at all, and a great deal */
  ({ ctx, page, r } = await look(at(18, 11, 15), []));
  ok('with no donations the clock is simply at its full size', [r.titles, near(r.clock, r.full, 2), r.fits], [[], true, true]);
  await ctx.close();
  ({ ctx, page, r } = await look(at(18, 11, 15), [MONTH, NER, WEEK, DAY]));
  ok('four large donations: the clock is at its floor, and only then does the whole screen give a little; all four are whole and it fits', [r.titles.length, near(r.clock, r.floor, 3), r.scale < three.scale, r.whole, r.apart, r.round, r.fits], [4, true, true, true, true, true, true]);
  await ctx.close();

  /* other TVs */
  for (const [w, h] of [[1280, 720], [3840, 2160], [1366, 768]]) {
    ({ ctx, page, r } = await look(at(18, 11, 15), [MONTH, NER, DAY], { width: w, height: h }));
    ok('on a ' + w + ' × ' + h + ' TV the three donations and the clock fit, the clock round and inside its place', [r.titles.length, r.whole, r.apart, r.round, r.dialInBox, r.fits], [3, true, true, true, true, true]);
    await ctx.close();
  }

  /* the picture page shows the same thing */
  {
    const c2 = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US', timezoneId: 'America/New_York', serviceWorkers: 'block' });
    await c2.addInitScript(({ fixed }) => { const real = Date.now; const start = real(); Date.now = () => fixed + (real() - start); }, { fixed: at(18, 11, 15) });
    const p2 = await c2.newPage(); p2.on('pageerror', e => errors.push('pageerror: ' + e.message));
    await p2.goto(BASE + 'tv.html', { waitUntil: 'networkidle' }); const f = p2.frameLocator('#tv'); await f.locator('.aclock svg').waitFor({ timeout: 15000 }); await p2.waitForTimeout(600);
    ok('the picture of the screen (the TV page) draws the clock round as well', await f.locator('.aclock .face').evaluate(e => { const r = e.getBoundingClientRect(); return Math.abs(r.width - r.height) < 1.5 && r.width > 100; }), true);
    await c2.close();
  }

  await browser.close();
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
  console.log(fails ? fails + ' FAILED' : 'all ok');
  process.exit(fails || errors.length ? 1 : 0);
})().catch(e => { console.log('ERROR', e.message); process.exit(1); });
