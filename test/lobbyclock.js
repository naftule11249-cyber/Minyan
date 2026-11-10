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
  ok('the running time, with seconds, is in the top bar', [/^7:50$/.test(await page.locator('.top .clock .hm').textContent()), /^0\d$/.test(await page.locator('.top .clock .ss').textContent()), await page.locator('.aclock .atime').count()], [true, true, 0]);
  await page.waitForTimeout(1200);
  ok('the second hand moves', Math.round(await deg('.aclock .second')) > sec0, true);
  ok('the header carries the day, the date and the label, not the shul\'s name again', [await page.locator('.top .shul').count(), await page.locator('.top .dayline').textContent(), await page.locator('.top .chip').first().textContent()], [0, 'יום שלישי פרשת תולדות', 'ראש חודש כסלו']);
  ok('everything fits: no scrolling, no column overflowing, every card and tile on the screen', await fits(page), { noScroll: true, columnsFit: true, cardsInside: true, tilesInside: true, columns: 3 });
  const titles = await page.locator('main.wall section.tefilla h3').allTextContents();
  ok('one frame for the first tefilla, one for the rest of the day, one for the zmanim', [titles, await page.locator('.wall .sub').allTextContents()], [['מניני שחרית', 'מניני מנחה מעריב', 'זמני היום'], ['מנחה', 'מעריב']]);
  const shacharis = page.locator('main.wall > .wcol').first().locator('section.tefilla').first();
  ok('shacharis stands alone in the first column, the whole day on the screen from the first minyan', [await shacharis.locator('h3').textContent(), await shacharis.locator('.tile').count() >= 18, await shacharis.locator('.tile .time').first().textContent()], ['מניני שחרית', true, '6:20']);
  ok('a tile reads its state: the earlier ones light, the one davening now, the next one', [await shacharis.locator('.tile.past').count(), await shacharis.locator('.tile.now .time').textContent(), await shacharis.locator('.tile.next .time').textContent()], [4, '7:45', '8:00']);
  ok('nothing is paged away', await page.locator('.pg').count(), 0);
  const runs = await page.locator('.wall .runline .num').allTextContents();
  ok('maariv\'s repeating lines are written as runs over the whole run, not as a tile each', [runs.length, runs[0]], [3, 'כל 10 דק׳ · 6:05–7:55']);
  ok('the next minyan is marked and its הודו reads on the tile', [await page.locator('.wall .tile.next .time').textContent(), await page.locator('.wall .tile.next .ms').textContent(), await page.locator('.wall .tile.next .ms').evaluate(e => getComputedStyle(e).color)], ['8:00', 'הודו 8:10', 'rgb(251, 238, 219)']);
  ok('the last minyan that still reaches שמונה עשרה before סוף זמן תפילה is marked, and the last before חצות', (await page.locator('.wall .tile.marked').evaluateAll(ts => ts.map(t => t.querySelector('.time').textContent + ' ' + t.querySelector('.mark').textContent))), ['9:30 אחרון לתפילה', '11:09 אחרון לחצות']);
  ok('the next-minyan panel is drawn from its template: tefilla, room, time, הודו, countdown', [await page.locator('.wall > .wcol > section.next').evaluate(e => Array.from(e.children).map(c => c.className.replace(' num', ''))), await page.locator('.wall > .wcol > section.next > .rm').textContent(), parseFloat(await page.locator('.wall > .wcol > section.next > .rm').evaluate(e => getComputedStyle(e).fontSize)) > parseFloat(await page.locator('.wall > .wcol > section.next > .tf').evaluate(e => getComputedStyle(e).fontSize)) * 1.6], [['', 'tf', 'rm', 'time', 'ms', 'count'], 'דברי יואל', true]);
  ok('a part-full last row of tiles sits in the middle', await page.evaluate(() => { const g = document.querySelectorAll('.wall .grid')[1], last = g.lastElementChild.getBoundingClientRect(), box = g.getBoundingClientRect(); return Math.abs((last.left - box.left) - (box.right - last.right)) < 4; }), true);
  ok('only the sponsor frames that have something in them', [await page.locator('.wall .sponsor').count(), await page.locator('.wall .sponsor .t').first().textContent()], [1, 'פרנס החודש']);
  ok('only the next three zmanim, large, the first of them counting down', [await page.locator('.wall .ztile .room').allTextContents(), /^\d{2}:\d{2}:\d{2}$/.test(await page.locator('.wall .ztile.now .count').textContent()), await page.locator('.wall .ztile.now .room').textContent()], [['סוף זמן ק״ש', 'סוף זמן תפילה', 'חצות'], true, 'סוף זמן ק״ש']);
  ok('a zman already passed is not among them', await page.locator('.wall .ztile.past').count(), 0);
  await page.screenshot({ path: 'test/shot-lobby-clock.png' });
  await ctx.close();

  /* afternoon and night */
  ({ ctx, page } = await open('?view=display', Date.UTC(2026, 10, 10, 19, 20)));
  ok('2:20 PM: shacharis keeps its frame and names tomorrow, mincha and maariv share the other, nothing clipped', [(await page.locator('main.wall section.tefilla h3').allTextContents()).map(t => t.replace(/[●○ ]+$/, '')), (await fits(page)).columnsFit], [['מניני שחרית – מחר, יום רביעי', 'מניני מנחה מעריב', 'זמני היום'], true]);
  ok('the minyan that went last carries its own colour, apart from the earlier ones', [await page.locator('.wall .tile.last').count(), await page.locator('.wall .tile.last .time').textContent(), await page.locator('.wall .tile.past').count() >= 1], [1, '2:00', true]);
  await ctx.close();
  ({ ctx, page } = await open('?view=display', Date.UTC(2026, 10, 11, 2, 10)));
  ok('9:10 PM: the zmanim card turns to tomorrow and still counts down', [await page.locator('.zcard h3').textContent(), await page.locator('.wall .ztile.now').count()], ['זמני מחר', 1]);
  ok('fits', (await fits(page)).columnsFit, true);
  const px = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize)), clock = (await page.locator('.aclock svg').boundingBox()).width;
  await ctx.close();
  ({ ctx, page } = await open('?view=display&size=80', Date.UTC(2026, 10, 11, 2, 10)));
  ok('the size setting caps the screen: 80 makes it smaller (the screen already fills the TV on its own)', [(await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize))) < px, (await fits(page)).noScroll], [true, true]);
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
  await ctx.close(); await browser.close();
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
  console.log(fails ? fails + ' FAILING' : 'lobbyclock: all good');
  if (fails) process.exit(1);
})().catch(e => { console.log('ERROR', e); process.exit(1); });
