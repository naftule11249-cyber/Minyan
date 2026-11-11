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
  /* a phone, sideways: nothing but the picture, the whole of it */
  const stageOf = page => page.evaluate(() => { const f = document.getElementById('tv'), s = document.getElementById('stage').getBoundingClientRect();
    return { w: +f.width, h: +f.height, scale: +(/scale\(([\d.]+)\)/.exec(f.style.transform) || [0, 0])[1], whole: s.left >= 0 && s.top >= 0 && s.right <= window.innerWidth + 1 && s.bottom <= window.innerHeight + 1,
      fills: Math.max(s.width / window.innerWidth, s.height / window.innerHeight) > 0.97, bare: document.body.classList.contains('bare'), turned: document.getElementById('stage').getAttribute('data-turned'),
      scrolls: document.documentElement.scrollHeight > window.innerHeight + 1 || document.documentElement.scrollWidth > window.innerWidth + 1 }; });
  let { ctx, page } = await open('index.html?view=display', { width: 844, height: 390 });
  ok('a phone opening the screen\'s address lands on the picture of it', /\/tv\.html$/.test(page.url()), true);
  const frame = page.frameLocator('#tv');
  await frame.locator('.aclock svg').waitFor({ timeout: 10000 });
  let geo = await stageOf(page);
  ok('held sideways, the phone shows the whole 1920×1080 screen and nothing else: all of it in view, as large as the phone allows, nothing to scroll', [geo.w, geo.h, geo.scale > 0.34 && geo.scale < 0.38, geo.whole, geo.fills, geo.bare, geo.scrolls], [1920, 1080, true, true, true, true, false]);
  ok('inside the frame the lobby renders at TV size: the round clock and the sections, no redirect loop', [await frame.locator('.aclock svg').count(), await frame.locator('.wall section.tefilla').count() >= 2, await frame.locator('html').evaluate(h => h.classList.contains('lobby'))], [1, true, true]);
  ok('the running time, with seconds, shows on the clock face in the frame, and the screen has no line across the top', [/^\d{1,2}:\d{2}:\d{2}$/.test((await frame.locator('.aclock .dig').textContent()).trim()), await frame.locator('header.top').count()], [true, 0]);
  await page.waitForTimeout(5300);
  ok('the buttons step aside after a moment', await page.locator('#bar').isVisible(), false);
  await page.mouse.click(420, 200); await page.waitForTimeout(250);
  ok('a tap on the picture brings them back, over the top of it', [await page.locator('#bar').isVisible(), await page.locator('#full').isVisible(), (await stageOf(page)).whole], [true, true, true]);
  await page.mouse.click(420, 300); await page.waitForTimeout(250);
  ok('and a second tap puts them away', await page.locator('#bar').isVisible(), false);
  await page.screenshot({ path: 'test/shot-tv-preview.png' });
  await ctx.close();
  /* a phone, upright */
  ({ ctx, page } = await open('tv.html', { width: 390, height: 844 }));
  await page.frameLocator('#tv').locator('.aclock svg').waitFor({ timeout: 10000 });
  geo = await stageOf(page);
  ok('held upright, the whole screen is still in view, under the buttons, with nothing to scroll', [geo.whole, geo.bare, geo.scrolls, geo.scale > 0.18 && geo.scale < 0.21, await page.locator('#full').isVisible()], [true, false, false, true, true]);
  await page.selectOption('#size', '3840x2160'); await page.waitForTimeout(300);
  ok('4K choice: the frame becomes 3840×2160, still all in view', await page.evaluate(() => { const f = document.getElementById('tv'), s = document.getElementById('stage').getBoundingClientRect(); return [+f.width, +f.height, s.right <= window.innerWidth + 1 && s.bottom <= window.innerHeight + 1]; }), [3840, 2160, true]);
  await page.selectOption('#size', '1920x1080'); await page.waitForTimeout(200);
  await page.click('#full'); await page.waitForTimeout(700);
  geo = await stageOf(page);
  ok('"Full screen" on an upright phone lays the picture on its side so it takes the phone\'s whole length', [geo.bare, geo.turned, geo.whole, geo.fills, await page.locator('#full').textContent()], [true, '1', true, true, 'Leave full screen']);
  await page.click('#full'); await page.waitForTimeout(500);
  geo = await stageOf(page);
  ok('"Leave full screen" puts everything back', [geo.bare, geo.turned, geo.whole, await page.locator('#full').textContent()], [false, '0', true, 'Full screen']);
  await ctx.close();
  /* the screen's own address, with &full=1: a small TV keeps the screen itself; a phone or an upright tablet gets the picture, which shows all of it */
  ({ ctx, page } = await open('index.html?view=display&full=1', { width: 960, height: 540 }));
  ok('&full=1 keeps the screen itself on a small TV (one whose browser reports 960 × 540)', [/index\.html/.test(page.url()), await page.locator('.aclock svg').count(), await page.locator('main.wall > .wcol').count()], [true, 1, 3]);
  await ctx.close();
  for (const [w, h, what] of [[844, 390, 'a phone on its side'], [390, 844, 'an upright phone'], [820, 1180, 'an upright tablet']]) {
    ({ ctx, page } = await open('index.html?view=display&full=1&at=2026-12-01T07:30', { width: w, height: h }));
    await page.frameLocator('#tv').locator('.aclock svg').waitFor({ timeout: 10000 });
    ok(what + ' gets the picture even with &full=1, whole, and the day asked for goes along', [/\/tv\.html\?at=2026-12-01T07:30$/.test(page.url()), (await stageOf(page)).whole, await page.frameLocator('#tv').locator('#app').getAttribute('data-day'), await page.locator('#title').textContent()],
      [true, true, '2026-12-01', 'The hallway screen on 2026-12-01 at 07:30']);
    await ctx.close();
  }
  /* a laptop keeps the lobby (no redirect), the admin header links to the preview */
  ({ ctx, page } = await open('index.html?view=display', { width: 1366, height: 768 }));
  ok('a laptop or TV keeps the lobby page', [/index\.html/.test(page.url()), await page.locator('.aclock svg').count()], [true, 1]);
  await ctx.close();
  ({ ctx, page } = await open('screen.html', { width: 1920, height: 1080 }));
  ok('/screen opens the hallway screen itself, full size', [/index\.html\?view=display&full=1$/.test(page.url()), await page.locator('.aclock svg').count(), await page.locator('main.wall').count()], [true, 1, 1]);
  await ctx.close();
  ({ ctx, page } = await open('screen.html', { width: 390, height: 844 }));
  await page.frameLocator('#tv').locator('.aclock svg').waitFor({ timeout: 10000 });
  ok('/screen on a phone shows the picture of the whole screen, not a cut-off column', [/\/tv\.html$/.test(page.url()), (await stageOf(page)).whole, (await stageOf(page)).scrolls], [true, true, false]);
  await ctx.close();
  /* a TV whose browser still shows its bars: the screen offers a way to full screen */
  {
    const c5 = await browser.newContext({ viewport: { width: 1600, height: 820 }, screen: { width: 1920, height: 1080 }, locale: 'he', timezoneId: 'America/New_York', serviceWorkers: 'block' });
    const p5 = await c5.newPage(); p5.on('pageerror', e => errors.push(e.message));
    await p5.goto('http://localhost:8790/index.html?view=display', { waitUntil: 'networkidle' }); await p5.waitForTimeout(700);
    ok('in a window that does not fill the display, the screen offers "Full screen" in a corner, clear of the minyanim', [await p5.locator('#fs-btn').isVisible(), /Full screen/.test(await p5.locator('#fs-btn').textContent()),
      await p5.evaluate(() => { const b = document.getElementById('fs-btn').getBoundingClientRect(); return b.height >= 44 && b.bottom <= window.innerHeight && b.right <= window.innerWidth && document.documentElement.scrollHeight <= window.innerHeight; })], [true, true, true]);
    await p5.click('#fs-btn'); await p5.waitForTimeout(700);
    ok('pressing it fills the display and the button steps away', [await p5.evaluate(() => !!document.fullscreenElement), await p5.locator('#fs-btn').isVisible()], [true, false]);
    await c5.close();
    ({ ctx, page } = await open('index.html?view=display', { width: 1920, height: 1080 }));
    await page.waitForTimeout(400);
    ok('a screen that already fills its display is shown no button', await page.locator('#fs-btn').isVisible(), false);
    ok('the board itself has no such button', await (async () => { await page.goto('http://localhost:8790/index.html', { waitUntil: 'networkidle' }); return page.locator('#fs-btn').count(); })(), 0);
    await ctx.close();
  }
  ({ ctx, page } = await open('screen.html?size=120', { width: 1920, height: 1080 }));
  ok('a short link carries what the address already had', /index\.html\?view=display&full=1&size=120$/.test(page.url()), true);
  await ctx.close();
  /* the host answers an address it has no file for with 404.html, which sends each short name to its page */
  for (const [asked, lands] of [['/admin', 'admin.html'], ['/admin/', 'admin.html'], ['/screen', 'index.html'], ['/tv', 'tv.html'], ['/nowhere', null]]) {
    const c3 = await browser.newContext({ viewport: { width: 1100, height: 800 }, locale: 'he', timezoneId: 'America/New_York', serviceWorkers: 'block' });
    await c3.route('**/*', async route => { /* stand in for GitHub Pages: an unknown path gets 404.html, with that status */
      const u = new URL(route.request().url());
      if (route.request().resourceType() === 'document' && !/\.[a-z0-9]+$/i.test(u.pathname)) {
        const r = await route.fetch({ url: u.origin + '/404.html' });
        return route.fulfill({ status: 404, contentType: 'text/html', body: await r.text() });
      }
      return route.fallback();
    });
    const p3 = await c3.newPage();
    await p3.goto('http://localhost:8790' + asked, { waitUntil: 'domcontentloaded' }); await p3.waitForTimeout(700);
    const landed = new URL(p3.url()).pathname;
    ok('a host with no file for ' + asked + (lands ? ' ends up on ' + lands : ' says so plainly'),
      lands ? landed === '/' + lands : [landed, await p3.locator('#m').textContent()], lands ? true : ['/nowhere', 'That page is not here.']);
    await c3.close();
  }
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
  for (const p of ['sign.html', 'sms.html', 'tv.html', 'admin.html', 'screen.html', '404.html', 'index.html']) { await page.goto('http://localhost:8790/' + p, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(400); titles[p] = (await page.title()).replace(/Cascade Zmanim/, 'SHUL'); }
  ok('with the worker installed, each page is itself (not the page visited before it)', [/שלט/.test(titles['sign.html']), /טקסט/.test(titles['sms.html']), titles['tv.html'], /Admin/.test(titles['admin.html']), titles['screen.html'], /not found/i.test(titles['404.html']), titles['index.html']], [true, true, 'Hallway screen', true, 'SHUL', true, 'SHUL']);
  await ctx.close(); await browser.close();
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
  console.log(fails ? fails + ' FAILING' : 'tvpreview: all good');
  if (fails) process.exit(1);
})().catch(e => { console.log('ERROR', e); process.exit(1); });
