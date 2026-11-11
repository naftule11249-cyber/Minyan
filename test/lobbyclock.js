/* The hallway screen (?view=display): three columns — the first tefilla, the middle (round clock, next minyan, zmanim tiles) and the rest of
   the day — with every minyan in view, a repeating run written as one line, and nothing clipped or scrolled. The board and the door displays
   keep their own layout. Clock frozen Tue 10 Nov 2026 New York (Rosh Chodesh): 7:50 AM, 2:20 PM and 9:10 PM. */
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch(); const errors = []; let fails = 0;
  const ok = (name, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) console.log('ok   ' + name); else { fails++; console.log('FAIL ' + name + ' got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want)); } };
  async function open(path, when, size) {
    const ctx = await browser.newContext({ viewport: size || { width: 1920, height: 1080 }, locale: 'he', timezoneId: 'America/New_York', serviceWorkers: 'block' });
    await ctx.addInitScript(({ fixed }) => { const real = Date.now; const start = real(); Date.now = () => fixed + (real() - start); }, { fixed: when || Date.UTC(2026, 10, 10, 12, 50, 1) });
    const page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message));
    page.on('console', x => { if (x.type() === 'error' && !/ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|ERR_INTERNET|ERR_CONNECTION/.test(x.text())) errors.push(x.text()); });
    await page.goto('http://localhost:8790/index.html' + path, { waitUntil: 'networkidle' }); await page.waitForTimeout(600);
    return { ctx, page };
  }
  const fits = page => page.evaluate(() => {
    const W = window.innerWidth, H = window.innerHeight, main = document.querySelector('main.wall');
    const cols = Array.from(main.children);
    const inside = e => { const r = e.getBoundingClientRect(); return r.bottom <= H + 1 && r.top >= -1 && r.left >= -1 && r.right <= W + 1; };
    return { noScroll: document.documentElement.scrollHeight <= H && document.documentElement.scrollWidth <= W,
      columnsFit: cols.every(c => c.scrollHeight - c.clientHeight <= 1), cardsInside: Array.from(main.querySelectorAll('section.tefilla')).every(inside),
      tilesInside: Array.from(main.querySelectorAll('.tile, .ztile')).every(inside), columns: cols.length };
  });

  /* morning */
  let { ctx, page } = await open('?view=display');
  const deg = async sel => +(/rotate\(([\d.]+)/.exec(await page.locator(sel).getAttribute('transform') || '') || [0, -1])[1];
  ok('three columns: the round clock and the sponsor frames down the middle, the next-minyan panel under the first tefilla', [await page.locator('main.wall > .wcol').count(), await page.locator('.wall .wcol.mid .aclock svg').count(), await page.locator('.wall .wcol.mid .sponsor').count(), await page.locator('main.wall > .wcol').first().locator('> section.next').count()], [3, 1, 1, 1]);
  const sec0 = Math.round(await deg('.aclock .second'));
  ok('hands point at 7:50 (a second or two after the page opened)', [Math.round(await deg('.aclock .hour')), Math.round(await deg('.aclock .minute')), sec0 >= 0 && sec0 <= 40], [235, 300, true]);
  ok('the time with seconds runs inside the clock face; there is no line across the top', [/^7:50:0\d$/.test(await page.locator('.aclock .dig').textContent()), await page.locator('header.top').count(), await page.locator('#app').getAttribute('data-day')], [true, 0, '2026-11-10']);
  await page.waitForTimeout(1200);
  ok('the second hand moves', Math.round(await deg('.aclock .second')) > sec0, true);
  ok('the name plaque of each frame shows whole: none is cut off by the edge of its column or of the screen', await page.evaluate(() => Array.from(document.querySelectorAll('.wall section.tefilla > h3')).map(h => { const r = h.getBoundingClientRect(), c = h.closest('.wcol').getBoundingClientRect(); return r.top >= c.top && r.top >= 0 && r.height > 20; })), [true, true, true]);
  ok('everything fits: no scrolling, no column overflowing, every card and tile on the screen', await fits(page), { noScroll: true, columnsFit: true, cardsInside: true, tilesInside: true, columns: 3 });
  const titles = await page.locator('main.wall section.tefilla h3').allTextContents();
  ok('one frame for the first tefilla, one for the rest of the day, one for the zmanim', [titles, await page.locator('.wall .sub').allTextContents()], [['מניני שחרית', 'מניני מנחה מעריב', 'זמני היום'], ['מנחה', 'מעריב']]);
  const shacharis = page.locator('main.wall > .wcol').first().locator('section.tefilla').first();
  ok('shacharis stands alone in the first column, the whole day on the screen from the first minyan', [await shacharis.locator('h3').textContent(), await shacharis.locator('.tile').count() >= 18, await shacharis.locator('.tile .time').first().textContent()], ['מניני שחרית', true, '6:20']);
  ok('a tile reads its state: the next one green, the one before it light green, the earlier ones light', [await shacharis.locator('.tile.past').count(), await shacharis.locator('.tile.prev .time').textContent(), await shacharis.locator('.tile.next .time').textContent()], [4, '7:45', '8:00']);
  ok('nothing is paged away', await page.locator('.pg').count(), 0);
  const runs = await page.locator('.wall .runline .num').allTextContents();
  /* which runs there are is the gabbai's schedule, and it changes; that each is written as one line over its whole span is the board's doing */
  ok('maariv\'s repeating lines are written as runs over the whole run, not as a tile each', [runs.length >= 1, runs.every(r => /^יעדע \d+ מינוט · פון \d{1,2}:\d{2} ביז \d{1,2}:\d{2}$/.test(r))], [true, true]);
  ok('the next minyan is marked and its הודו reads on the tile', [await page.locator('.wall .tile.next .time').textContent(), await page.locator('.wall .tile.next .ms').textContent(), await page.locator('.wall .tile.next .ms').evaluate(e => getComputedStyle(e).color)], ['8:00', 'הודו 8:10', 'rgb(248, 241, 229)']);
  ok('the last minyan that still reaches שמונה עשרה before סוף זמן תפילה is marked, and the last before חצות; the minyan at מנחה גדולה says so too', (await page.locator('.wall .tile.marked').evaluateAll(ts => ts.map(t => t.querySelector('.time').textContent + ' ' + t.querySelector('.mark').textContent))), ['9:30 סוף זמן תפילה', '11:09 אחרון לחצות', '12:11 מנחה גדולה']);
  ok('the next-minyan panel is drawn from its template: tefilla, room, time, הודו, countdown', [await page.locator('.wall > .wcol > section.next').evaluate(e => Array.from(e.children).map(c => c.className.replace(' num', ''))), await page.locator('.wall > .wcol > section.next > .rm').textContent(), parseFloat(await page.locator('.wall > .wcol > section.next > .rm').evaluate(e => getComputedStyle(e).fontSize)) > parseFloat(await page.locator('.wall > .wcol > section.next > .tf').evaluate(e => getComputedStyle(e).fontSize)) * 1.6], [['', 'tf', 'rm', 'time', 'ms', 'count'], 'דברי יואל', true]);
  ok('a part-full last row of tiles sits in the middle', await page.evaluate(() => { const g = document.querySelectorAll('.wall .grid')[1], last = g.lastElementChild.getBoundingClientRect(), box = g.getBoundingClientRect(); return Math.abs((last.left - box.left) - (box.right - last.right)) < 4; }), true);
  ok('only the sponsor frames that have something in them', [await page.locator('.wall .sponsor').count(), await page.locator('.wall .sponsor .t').first().textContent()], [1, 'פרנס החודש']);
  ok('the zman being counted to leads, with the one just gone and the one after it beside it', [await page.locator('.wall .ztile .room').allTextContents(), await page.locator('.wall .ztile.now .room').textContent(), /^\d{2}:\d{2}:\d{2}$/.test(await page.locator('.wall .ztile.now .count').textContent())], [['הנץ החמה', 'סוזק״ש (מג״א)', 'סוזק״ש (גר״א)'], 'סוזק״ש (מג״א)', true]);
  ok('the one just gone is the only passed one; the two at the sides are smaller than the middle one yet large enough to read, and each holds its lines in the middle of its tile', await page.evaluate(() => {
    const past = document.querySelectorAll('.wall .ztile.past'), fs = e => parseFloat(getComputedStyle(e).fontSize);
    const big = fs(document.querySelector('.wall .ztile.now .time')), root = fs(document.documentElement), sides = Array.from(document.querySelectorAll('.wall .ztile.zsm'));
    const small = Math.max.apply(null, sides.map(t => fs(t.querySelector('.time'))));
    const centred = sides.every(t => { const r = t.getBoundingClientRect(), a = t.firstElementChild.getBoundingClientRect(), b = t.lastElementChild.getBoundingClientRect(); return Math.abs((a.top - r.top) - (r.bottom - b.bottom)) <= 3 && a.top - r.top > 6; });
    return [past.length, past[0].classList.contains('zsm'), big > small * 1.2, small >= root * 1.8, sides.length, centred];
  }), [1, true, true, true, 2, true]);
  ok('a repeating run reads from across the hallway: its hours as large as a tile\'s time, how often and the rooms not far behind, the rooms in full ink', await page.evaluate(() => {
    const fs = e => parseFloat(getComputedStyle(e).fontSize), r = document.querySelector('.wall .runline'), tile = fs(document.querySelector('.wall .tile .time'));
    return [fs(r.querySelector('.hrs')) >= tile * 0.95, fs(r.querySelector('.ev')) >= tile * 0.65, fs(r.querySelector('.rooms')) >= tile * 0.55, getComputedStyle(r.querySelector('.rooms')).color === getComputedStyle(r.querySelector('.hrs')).color,
      r.getBoundingClientRect().right <= r.parentElement.getBoundingClientRect().right + 1 && r.scrollWidth <= r.clientWidth + 1];
  }), [true, true, true, true, true]);
  await page.screenshot({ path: 'test/shot-lobby-clock.png' });
  await ctx.close();

  /* afternoon and night */
  ({ ctx, page } = await open('?view=display', Date.UTC(2026, 10, 10, 19, 20)));
  ok('2:20 PM: shacharis keeps its frame and names tomorrow, mincha and maariv share the other, nothing clipped', [(await page.locator('main.wall section.tefilla h3').allTextContents()).map(t => t.replace(/[●○ ]+$/, '')), (await fits(page)).columnsFit], [['מניני שחרית – מחר, יום רביעי', 'מניני מנחה מעריב', 'זמני היום'], true]);
  ok('one tile before the next one is light green, the earlier ones are not', [await page.locator('.wall .tile.prev').count(), await page.locator('.wall .tile.prev .time').textContent(), await page.locator('.wall .tile.past').count() >= 1], [1, '2:00', true]);
  await ctx.close();
  ({ ctx, page } = await open('?view=display', Date.UTC(2026, 10, 11, 2, 10)));
  ok('9:10 PM: the zmanim card is still today's, counting down to חצות לילה', [await page.locator('.zcard h3').textContent(), await page.locator('.wall .ztile.now').count()], ['זמני היום', 1]);
  ok('fits', (await fits(page)).columnsFit, true);
  const px = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize)), clock = (await page.locator('.aclock svg').boundingBox()).width;
  await ctx.close();
  ({ ctx, page } = await open('?view=display&size=80', Date.UTC(2026, 10, 11, 2, 10)));
  ok('the size setting never lets the screen grow past what fits', [(await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize))) <= px * 1.01, (await fits(page)).noScroll], [true, true]); /* at a crowded hour the fit binds below the setting, and the search lands within a step of the same size either way */
  await ctx.close();
  /* at a quieter hour the fit is not the binding constraint, so the setting itself shows */
  ({ ctx, page } = await open('?view=display', Date.UTC(2026, 10, 10, 19, 20)));
  const pxQuiet = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
  await ctx.close();
  ({ ctx, page } = await open('?view=display&size=80', Date.UTC(2026, 10, 10, 19, 20)));
  ok('the size setting caps the screen: 80 makes it smaller', [(await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize))) < pxQuiet, (await fits(page)).noScroll], [true, true]);
  await ctx.close();
  {
    const r = await open('?view=display', Date.UTC(2026, 10, 11, 2, 10), { width: 3840, height: 2160 });
    const r4 = (await r.page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize))) / px, c4 = (await r.page.locator('.aclock svg').boundingBox()).width / clock;
    ok('a 4K screen at full resolution: twice the size, same layout, still fits', [r4 > 1.9 && r4 < 2.2, c4 > 1.9 && c4 < 2.2, (await fits(r.page)).columnsFit], [true, true, true]);
    await r.ctx.close();
  }

  /* the board and the door displays are as they were */
  ({ ctx, page } = await open(''));
  ok('the board has no round clock and no wall layout, and keeps its shul name', [await page.locator('.aclock').count(), await page.locator('main.wall').count(), await page.locator('.top .shul').count()], [0, 0, 1]);
  await ctx.close();
  ({ ctx, page } = await open('?room=' + encodeURIComponent('ברך משה')));
  ok('a door display has neither', [await page.locator('.aclock:visible').count(), await page.locator('main.wall').count()], [0, 0]);
  await ctx.close();

  /* the look the gabbai publishes, and a logo on the dial when one is set */
  ({ ctx, page } = await open('?view=display'));
  ok('the hallway screen wears the hallway look: limestone, brass and bronze', await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    return [document.documentElement.getAttribute('data-palette'), cs.getPropertyValue('--bg').trim(), cs.getPropertyValue('--gold').trim()];
  }), ['hallway', '#baaf9b', '#a98541']);
  ok('on the screen the page is the stone of the wall and every box a lighter cut of it, tinted, not white; the clock face is the lightest thing on it', await page.evaluate(() => {
    const lum = c => { const m = /(\d+), (\d+), (\d+)/.exec(c); return Math.round(0.2126 * m[1] + 0.7152 * m[2] + 0.0722 * m[3]); }, bg = s => getComputedStyle(document.querySelector(s)).backgroundColor;
    const page = lum(bg('body')), box = lum(bg('.wall section.tefilla')), next = lum(bg('.wall > .wcol > section.next')), face = lum(getComputedStyle(document.querySelector('.aclock .face')).fill);
    return [bg('body'), bg('.wall section.tefilla'), next === box, page < box && box < face, box < 225, page > 150];
  }), ['rgb(186, 175, 155)', 'rgb(221, 213, 196)', true, true, true, true]);
  ok('the shul\'s own logo stands on the dial', [await page.locator('.aclock .dial-logo').count(), await page.locator('.aclock .dial-logo').getAttribute('href')], [1, 'logo-name.png']);
  await ctx.close();
  {
    const c2 = await browser.newContext({ viewport: { width: 1920, height: 1080 }, locale: 'he', timezoneId: 'America/New_York', serviceWorkers: 'block' });
    await c2.addInitScript(({ fixed }) => { const real = Date.now; const start = real(); Date.now = () => fixed + (real() - start); }, { fixed: Date.UTC(2026, 10, 10, 12, 50, 1) });
    await c2.route('**/config.json*', async route => {
      const res = await route.fetch(); const cfg = JSON.parse(await res.text());
      cfg.wallLogo = 'favicon.png';
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cfg) });
    });
    const p2 = await c2.newPage(); p2.on('pageerror', e => errors.push(e.message));
    await p2.goto('http://localhost:8790/index.html?view=display', { waitUntil: 'networkidle' }); await p2.waitForTimeout(800);
    ok('with a logo set it sits on the dial, above the hands and below the 12', await p2.evaluate(() => {
      const g = document.querySelector('.aclock .dial-logo'); if (!g) return 'missing';
      const svg = g.ownerSVGElement, kids = Array.from(svg.children).map(n => n.getAttribute('class') || n.tagName);
      return [g.getAttribute('href'), +g.getAttribute('y') > 27 && +g.getAttribute('y') < 100, kids.indexOf('dial-logo') < kids.indexOf('hand minute')];
    }), ['favicon.png', true, true]);
    await c2.close();
  }
  /* the line across the top, when Hallway screen → "The top line" asks for it */
  {
    const c3 = await browser.newContext({ viewport: { width: 1920, height: 1080 }, locale: 'he', timezoneId: 'America/New_York', serviceWorkers: 'block' });
    await c3.addInitScript(({ fixed }) => { const real = Date.now; const start = real(); Date.now = () => fixed + (real() - start); }, { fixed: Date.UTC(2026, 10, 10, 12, 50, 1) });
    await c3.route('**/config.json*', async route => {
      const res = await route.fetch(); const cfg = JSON.parse(await res.text());
      cfg.wallTopBar = true;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cfg) });
    });
    const p3 = await c3.newPage(); p3.on('pageerror', e => errors.push(e.message));
    await p3.goto('http://localhost:8790/index.html?view=display', { waitUntil: 'networkidle' }); await p3.waitForTimeout(800);
    ok('asked for, the top line carries the day, the date and the label, not the shul\'s name again, and the time with seconds', [await p3.locator('.top .shul').count(), await p3.locator('.top .dayline').textContent(), await p3.locator('.top .chip').first().textContent(),
      /^7:50$/.test(await p3.locator('.top .clock .hm').textContent()), /^0\d$/.test(await p3.locator('.top .clock .ss').textContent())], [0, 'יום שלישי פרשת תולדות', 'ראש חודש כסלו', true, true]);
    ok('with the top line the screen still fits, and the plaques still show whole under it', [await fits(p3), await p3.evaluate(() => { const bar = document.querySelector('header.top').getBoundingClientRect(); return Array.from(document.querySelectorAll('.wall section.tefilla > h3')).every(h => h.getBoundingClientRect().top >= bar.bottom - 1); })],
      [{ noScroll: true, columnsFit: true, cardsInside: true, tilesInside: true, columns: 3 }, true]);
    await c3.close();
  }
  await browser.close();
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
  console.log(fails ? fails + ' FAILING' : 'lobbyclock: all good');
  if (fails) process.exit(1);
})().catch(e => { console.log('ERROR', e); process.exit(1); });
