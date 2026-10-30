/* The lobby screen shows a round clock between the next-minyan and next-zman boxes; the board and door displays do not. Clock frozen Wed 28 Oct 2026 9:05:30 New York. */
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch(); const errors = []; let fails = 0;
  const ok = (name, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) console.log('ok   ' + name); else { fails++; console.log('FAIL ' + name + ' got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want)); } };
  async function open(path) {
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, locale: 'he', timezoneId: 'America/New_York', serviceWorkers: 'block' });
    const fixed = Date.UTC(2026, 9, 28, 13, 5, 30);
    await ctx.addInitScript(({ fixed }) => { const real = Date.now; const start = real(); Date.now = () => fixed + (real() - start); }, { fixed });
    const page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message));
    page.on('console', x => { if (x.type() === 'error' && !/ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|ERR_INTERNET|ERR_CONNECTION/.test(x.text())) errors.push(x.text()); });
    await page.goto('http://localhost:8790/index.html' + path, { waitUntil: 'networkidle' }); await page.waitForTimeout(500);
    return { ctx, page };
  }
  let { ctx, page } = await open('?view=display');
  const deg = async sel => +(/rotate\(([\d.]+)/.exec(await page.locator(sel).getAttribute('transform') || '') || [0, -1])[1];
  ok('lobby: one round clock, in the top row with the next-minyan box', [await page.locator('.disp-top .aclock svg').count(), await page.locator('.disp-top > section.next').count() >= 1], [1, true]);
  const sec0 = Math.round(await deg('.aclock .second'));
  ok('hands point at 9:05 and a half (a second or two after the page opened)', [Math.round(await deg('.aclock .hour')), Math.round(await deg('.aclock .minute')), sec0 >= 180 && sec0 <= 210], [273, 33, true]);
  ok('digital time under the face', /^9:05:3\d$/.test(await page.locator('.aclock .atime').textContent()), true);
  await page.waitForTimeout(1200);
  ok('the second hand moves', Math.round(await deg('.aclock .second')) > sec0, true);
  await page.screenshot({ path: 'test/shot-lobby-clock.png', clip: { x: 0, y: 0, width: 1920, height: 760 } });
  await ctx.close();
  ({ ctx, page } = await open(''));
  ok('the board has no round clock', await page.locator('.aclock').count(), 0);
  await ctx.close();
  ({ ctx, page } = await open('?room=' + encodeURIComponent('ברך משה')));
  ok('a door display has none either', await page.locator('.aclock:visible').count(), 0);
  await ctx.close(); await browser.close();
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
  console.log(fails ? fails + ' FAILING' : 'lobbyclock: all good');
  if (fails) process.exit(1);
})().catch(e => { console.log('ERROR', e); process.exit(1); });
