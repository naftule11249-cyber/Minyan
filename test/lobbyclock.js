/* The lobby screen (?view=display): a round clock between the next-minyan and next-zman boxes, and a layout that fits the TV: it scales with
   the screen, never scrolls, shows whole rows of tiles per tefilla and pages through the rest. The board and door displays are untouched.
   Clock frozen Wed 28 Oct 2026 New York: 9:05:30 (three sections), 3:40 PM (two, tomorrow's Shacharis has no room), 10:30 PM (room for it). */
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch(); const errors = []; let fails = 0;
  const ok = (name, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) console.log('ok   ' + name); else { fails++; console.log('FAIL ' + name + ' got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want)); } };
  async function open(path, when, size) {
    const ctx = await browser.newContext({ viewport: size || { width: 1920, height: 1080 }, locale: 'he', timezoneId: 'America/New_York', serviceWorkers: 'block' });
    const fixed = when || Date.UTC(2026, 9, 28, 13, 5, 30);
    await ctx.addInitScript(({ fixed }) => { const real = Date.now; const start = real(); Date.now = () => fixed + (real() - start); }, { fixed });
    const page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message));
    page.on('console', x => { if (x.type() === 'error' && !/ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|ERR_INTERNET|ERR_CONNECTION/.test(x.text())) errors.push(x.text()); });
    await page.goto('http://localhost:8790/index.html' + path, { waitUntil: 'networkidle' }); await page.waitForTimeout(500);
    return { ctx, page };
  }
  const rootPx = async page => parseFloat(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize));
  const clockW = async page => (await page.locator('.aclock svg').boundingBox()).width;
  const fits = page => page.evaluate(() => {
    const H = window.innerHeight, W = window.innerWidth, secs = Array.from(document.querySelectorAll('.secs > .tefilla')).filter(s => !s.hidden);
    const inside = r => r.bottom <= H + 1 && r.right <= W + 1 && r.top >= -1 && r.left >= -1;
    return { noScroll: document.documentElement.scrollHeight <= H && document.documentElement.scrollWidth <= W, sectionsInside: secs.every(s => inside(s.getBoundingClientRect())),
      wholeRows: secs.every(s => { const g = s.querySelector('.grid'); if (!g) return true; const t = Array.from(g.children).filter(x => x.offsetParent !== null); const r = g.getBoundingClientRect(); /* the tiles of the shown page end inside the grid, none is cut in two */
        return t.filter(x => x.getBoundingClientRect().top < r.bottom - 1).every(x => x.getBoundingClientRect().bottom <= r.bottom + 1); }),
      sideInside: inside(document.querySelector('main > .col:last-child').getBoundingClientRect()) };
  });

  /* morning: three sections of today */
  let { ctx, page } = await open('?view=display');
  const deg = async sel => +(/rotate\(([\d.]+)/.exec(await page.locator(sel).getAttribute('transform') || '') || [0, -1])[1];
  ok('lobby: one round clock, in the top row with the next-minyan box', [await page.locator('.disp-top .aclock svg').count(), await page.locator('.disp-top > section.next').count() >= 1], [1, true]);
  const sec0 = Math.round(await deg('.aclock .second'));
  ok('hands point at 9:05 and a half (a second or two after the page opened)', [Math.round(await deg('.aclock .hour')), Math.round(await deg('.aclock .minute')), sec0 >= 180 && sec0 <= 210], [273, 33, true]);
  ok('digital time under the face', /^9:05:3\d$/.test(await page.locator('.aclock .atime').textContent()), true);
  await page.waitForTimeout(1200);
  ok('the second hand moves', Math.round(await deg('.aclock .second')) > sec0, true);
  ok('header digital clock gives way to the round one; the sponsor box sits in the side column', [await page.locator('.top .clock').isVisible(), await page.locator('#app > .sponsors').count(), await page.locator('main > .col:last-child .sponsors').count()], [false, 0, 1]);
  const pxM = await rootPx(page), wM = await clockW(page);
  ok('1920×1080, three sections: the screen scales to the TV (root 16–18.7px; 18.6 is the full size, a little less when three rows must fit)', pxM >= 16 && pxM <= 18.7, true);
  ok('the round clock is 34% of the height, scaled with the rest', Math.abs(wM - 0.34 * 1080 * (pxM / 18.6)) < 8, true);
  ok('everything fits on the screen: no scrolling, sections and side column inside, only whole rows of tiles', await fits(page), { noScroll: true, sectionsInside: true, wholeRows: true, sideInside: true });
  const names = await page.locator('.secs > .tefilla:not([hidden]) h3').allTextContents();
  ok('today\'s three sections, Shacharis first, each one row', [names.length, /שחרית/.test(names[0]), /מעריב/.test(names[2])], [3, true, true]);
  const dots = await page.locator('.secs > .tefilla:nth-child(3) h3 .pg').textContent();
  ok('Maariv (26 minyanim, 8 per row) pages: four dots, the first one filled', dots, '● ○ ○ ○');
  const top0 = await page.locator('.secs > .tefilla:nth-child(3) .grid').evaluate(g => g.scrollTop);
  await page.waitForTimeout(8600);
  ok('after eight seconds the next page: the grid scrolled, the second dot filled', [top0, (await page.locator('.secs > .tefilla:nth-child(3) .grid').evaluate(g => g.scrollTop)) > 50, await page.locator('.secs > .tefilla:nth-child(3) h3 .pg').textContent()], [0, true, '○ ● ○ ○']);
  ok('a later zman strip in the next-zman box (סוף זמן תפילה, חצות, מנחה גדולה after סוף זמן ק"ש)', await page.locator('.disp-top > .zman .soon .room').allTextContents(), ['סוף זמן תפילה', 'חצות', 'מנחה גדולה']);
  ok('the next tile keeps its normal size (the big-time rule is the box\'s only)', await page.locator('.tile.next .time').evaluate(e => getComputedStyle(e).fontSize) === await page.locator('.tile:not(.next) .time').first().evaluate(e => getComputedStyle(e).fontSize), true);
  await page.screenshot({ path: 'test/shot-lobby-clock.png' });
  await ctx.close();

  /* afternoon: Mincha and Maariv; tomorrow's Shacharis is there but hidden for lack of room */
  ({ ctx, page } = await open('?view=display', Date.UTC(2026, 9, 28, 19, 40)));
  ok('3:40 PM: Mincha and Maariv shown, tomorrow\'s Shacharis hidden (no room), Maariv gets the spare rows', [await page.locator('.secs > .tefilla:not([hidden])').count(), await page.locator('.secs > .tefilla.tomo').count(), await page.locator('.secs > .tefilla.tomo').first().isVisible(), await page.locator('.secs > .tefilla:not([hidden]):nth-child(2) .grid').evaluate(g => Math.round(g.clientHeight / g.firstChild.offsetHeight))], [2, 1, false, 2]);
  ok('fits', await fits(page), { noScroll: true, sectionsInside: true, wholeRows: true, sideInside: true });
  await ctx.close();

  /* night: Maariv and tomorrow's Shacharis both fit; full size; Larger makes it larger */
  ({ ctx, page } = await open('?view=display', Date.UTC(2026, 9, 29, 2, 30)));
  ok('10:30 PM: Maariv and tomorrow\'s Shacharis, at the full size', [await page.locator('.secs > .tefilla:not([hidden]) h3').allTextContents().then(t => t.map(x => x.replace(/[●○ ]+$/, ''))), Math.abs(await rootPx(page) - 18.6) < 0.4], [['מניני מעריב', 'מניני שחרית – מחר, יום חמישי'], true]);
  ok('fits', await fits(page), { noScroll: true, sectionsInside: true, wholeRows: true, sideInside: true });
  const pxN = await rootPx(page), wN = await clockW(page);
  await ctx.close();
  ({ ctx, page } = await open('?view=display&size=130', Date.UTC(2026, 9, 29, 2, 30)));
  ok('&size=130 makes everything 30% larger, the clock with it, and it still fits', [Math.abs(await rootPx(page) - pxN * 1.3) < 0.5, (await clockW(page)) > wN * 1.25, (await fits(page)).noScroll], [true, true, true]);
  await ctx.close();
  {
    const r = await open('?view=display', Date.UTC(2026, 9, 29, 2, 30), { width: 3840, height: 2160 });
    ok('a 4K screen at full resolution: twice the size, same layout', [Math.abs(await rootPx(r.page) - pxN * 2) < 0.6, Math.abs(await clockW(r.page) - wN * 2) < 16], [true, true]);
    await r.ctx.close();
  }

  /* the board and the door displays are as they were */
  ({ ctx, page } = await open(''));
  ok('the board has no round clock, keeps its normal size and its sponsor strip under the header', [await page.locator('.aclock').count(), await page.evaluate(() => getComputedStyle(document.documentElement).fontSize), await page.evaluate(() => document.documentElement.classList.contains('lobby')), await page.locator('#app > .sponsors').count()], [0, '16px', false, 1]);
  await ctx.close();
  ({ ctx, page } = await open('?room=' + encodeURIComponent('ברך משה')));
  ok('a door display has none either', [await page.locator('.aclock:visible').count(), await page.locator('.secs').count()], [0, 0]);
  await ctx.close(); await browser.close();
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
  console.log(fails ? fails + ' FAILING' : 'lobbyclock: all good');
  if (fails) process.exit(1);
})().catch(e => { console.log('ERROR', e); process.exit(1); });
