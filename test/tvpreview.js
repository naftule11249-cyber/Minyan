/* tv.html shows the hallway screen as the TV renders it (a 1920×1080 frame scaled to the device; clock frozen Wed 28 Oct 2026 3:40 PM); a phone opening the lobby address lands there;
   &full=1 keeps the lobby itself; the service worker serves every page under its own name (sign.html is never the board). */
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch(); const errors = []; let fails = 0;
  const ok = (name, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) console.log('ok   ' + name); else { fails++; console.log('FAIL ' + name + ' got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want)); } };
  async function open(path, viewport, sw) {
    const ctx = await browser.newContext({ viewport, locale: 'he', timezoneId: 'America/New_York', serviceWorkers: sw ? 'allow' : 'block' });
    await ctx.addInitScript(({ fixed }) => { const real = Date.now; const start = real(); Date.now = () => fixed + (real() - start); }, { fixed: Date.UTC(2026, 9, 28, 19, 40) }); /* Wed 28 Oct 2026 3:40 PM New York: Mincha and Maariv ahead */
    const page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message));
    page.on('console', x => { if (x.type() === 'error' && !/ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|ERR_INTERNET|ERR_CONNECTION/.test(x.text())) errors.push(x.text()); });
    await page.goto('http://localhost:8790/' + path, { waitUntil: 'networkidle' }); await page.waitForTimeout(600);
    return { ctx, page };
  }
  /* a phone, sideways */
  let { ctx, page } = await open('index.html?view=display', { width: 844, height: 390 });
  ok('a phone opening the lobby address lands on the preview page', /\/tv\.html$/.test(page.url()), true);
  const frame = page.frameLocator('#tv');
  await frame.locator('.aclock svg').waitFor({ timeout: 10000 });
  const geo = await page.evaluate(() => { const f = document.getElementById('tv'), s = document.getElementById('stage').getBoundingClientRect(); return { w: +f.width, h: +f.height, scale: +(/scale\(([\d.]+)\)/.exec(f.style.transform) || [0, 0])[1], stageW: Math.round(s.width), fits: s.right <= window.innerWidth + 1 }; });
  ok('the frame is a 1920×1080 TV scaled to the phone\'s width (about 42%), inside the screen', [geo.w, geo.h, geo.scale > 0.38 && geo.scale < 0.46, geo.fits], [1920, 1080, true, true]);
  ok('inside the frame the lobby renders at TV size: the round clock and the sections, no redirect loop', [await frame.locator('.aclock svg').count(), await frame.locator('.secs > .tefilla').count() >= 2, await frame.locator('html').evaluate(h => h.classList.contains('lobby'))], [1, true, true]);
  ok('digital time runs inside the frame', /^\d{1,2}:\d{2}:\d{2}$/.test((await frame.locator('.aclock .atime').textContent()).trim()), true);
  await page.selectOption('#size', '3840x2160'); await page.waitForTimeout(300);
  ok('4K choice: the frame becomes 3840×2160, still fits', await page.evaluate(() => { const f = document.getElementById('tv'), s = document.getElementById('stage').getBoundingClientRect(); return [+f.width, +f.height, s.right <= window.innerWidth + 1]; }), [3840, 2160, true]);
  await page.screenshot({ path: 'test/shot-tv-preview.png' });
  await ctx.close();
  /* the lobby itself on a phone when asked for */
  ({ ctx, page } = await open('index.html?view=display&full=1', { width: 844, height: 390 }));
  ok('&full=1 keeps the lobby page on a phone', [/index\.html/.test(page.url()), await page.locator('.aclock svg').count()], [true, 1]);
  await ctx.close();
  /* a laptop keeps the lobby (no redirect), the admin header links to the preview */
  ({ ctx, page } = await open('index.html?view=display', { width: 1366, height: 768 }));
  ok('a laptop or TV keeps the lobby page', [/index\.html/.test(page.url()), await page.locator('.aclock svg').count()], [true, 1]);
  await ctx.close();
  ({ ctx, page } = await open('admin.html', { width: 1100, height: 800 }));
  await page.fill('#pin-input', '1234'); await page.press('#pin-input', 'Enter'); await page.waitForSelector('#tab-notices');
  ok('the admin header has a TV link to the preview', await page.locator('.abar a[href="tv.html"]').count(), 1);
  await page.click('#tab-notices');
  ok('the banner card has a start time beside the end time', [await page.locator('#banner-from').getAttribute('type'), await page.locator('#banner-until').getAttribute('type')], ['datetime-local', 'datetime-local']);
  await ctx.close();
  /* the service worker: once installed, every page is served as itself */
  ({ ctx, page } = await open('index.html', { width: 1000, height: 800 }, true));
  await page.evaluate(() => navigator.serviceWorker.ready); await page.waitForTimeout(800);
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(500);
  ok('service worker controls the page', await page.evaluate(() => !!navigator.serviceWorker.controller), true);
  const titles = {};
  for (const p of ['sign.html', 'sms.html', 'tv.html', 'admin.html', 'index.html']) { await page.goto('http://localhost:8790/' + p, { waitUntil: 'networkidle' }); await page.waitForTimeout(200); titles[p] = (await page.title()).replace(/Cascade Zmanim/, 'SHUL'); }
  ok('with the worker installed, each page is itself (not the page visited before it)', [/שלט/.test(titles['sign.html']), /טקסט/.test(titles['sms.html']), titles['tv.html'], /Admin/.test(titles['admin.html']), titles['index.html']], [true, true, 'Hallway screen preview', true, 'SHUL']);
  await ctx.close(); await browser.close();
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
  console.log(fails ? fails + ' FAILING' : 'tvpreview: all good');
  if (fails) process.exit(1);
})().catch(e => { console.log('ERROR', e); process.exit(1); });
