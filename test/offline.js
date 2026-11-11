/* offline.html — what the store app shows when the phone has no connection. It stands on its own (nothing beside it is asked for),
   says so in plain words, looks again by itself and when asked, and opens the board the moment the connection is back.
   The website is stood in for by routes: cut off, then answering. */
const { chromium } = require('playwright');
const SITE = 'https://minyan.cascadeshul.org/', PAGE = 'http://localhost:8790/offline.html';
(async () => {
  const browser = await chromium.launch(); const errors = []; let fails = 0;
  const ok = (name, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) console.log('ok   ' + name); else { fails++; console.log('FAIL ' + name + ' got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want)); } };
  async function open(viewport, opts) {
    const ctx = await browser.newContext(Object.assign({ viewport, locale: 'he', timezoneId: 'America/New_York', serviceWorkers: 'block' }, opts || {}));
    const state = { online: false, probes: 0, extra: [] };
    await ctx.route('**/*', route => {
      const u = route.request().url();
      if (u.split('?')[0] === PAGE) return route.fallback();
      if (u.indexOf(SITE) === 0) {
        if (/favicon\.png/.test(u)) { state.probes++; return state.online ? route.fulfill({ status: 200, contentType: 'image/png', body: '' }) : route.abort('internetdisconnected'); }
        return state.online ? route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>the board</title><p>board</p>' }) : route.abort('internetdisconnected');
      }
      state.extra.push(u); return route.abort();
    });
    const page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/ERR_INTERNET_DISCONNECTED|ERR_FAILED|Failed to load resource/.test(m.text())) errors.push(m.text()); });
    return { ctx, page, state };
  }
  const status = page => page.evaluate(() => [document.getElementById('status').className.replace('status ', ''), document.getElementById('status-text').textContent, document.getElementById('retry').disabled]);

  /* a phone with no connection */
  let { ctx, page, state } = await open({ width: 390, height: 780 });
  await page.goto(PAGE, { waitUntil: 'load' });
  ok('it says what happened and what will happen, in plain words', [await page.locator('h1').textContent(), await page.locator('.card p').textContent(), await page.locator('#retry').textContent()], ['אין חיבור לאינטרנט', 'הלוח ייפתח מעצמו ברגע שהחיבור יחזור.', 'לנסות שוב']);
  ok('it starts by waiting, the button ready', await status(page), ['waiting', 'ממתין לחיבור…', false]);
  await page.waitForTimeout(2600);
  ok('it looks by itself within a couple of seconds, finds nothing, and waits again', [state.probes, (await status(page))[0]], [1, 'waiting']);
  ok('it stands on its own: nothing beside the page was asked for', state.extra, []);
  /* the button, pressed twice in a hurry */
  await page.locator('#retry').dblclick(); await page.waitForTimeout(150);
  ok('a press is answered at once: it says it is checking and the button rests', await status(page), ['checking', 'בודק את החיבור…', true]);
  await page.waitForTimeout(1200);
  ok('two quick presses made one check, and it is waiting again with the button ready', [state.probes, (await status(page))[0], (await status(page))[2]], [2, 'waiting', false]);
  await page.waitForTimeout(1000);
  ok('fits a phone: no sideways scrolling, a button big enough for a thumb, text easy to read', await page.evaluate(() => {
    const b = document.getElementById('retry').getBoundingClientRect(), fs = e => parseFloat(getComputedStyle(document.querySelector(e)).fontSize);
    return [document.documentElement.scrollWidth <= window.innerWidth, b.height >= 44 && b.width >= 160, fs('.card p') >= 16, fs('h1') >= 20];
  }), [true, true, true, true]);
  await page.screenshot({ path: 'test/shot-offline-phone.png' });
  await page.setViewportSize({ width: 360, height: 640 });
  ok('and the narrowest phones', await page.evaluate(() => [document.documentElement.scrollWidth <= window.innerWidth, document.querySelector('.card').getBoundingClientRect().right <= window.innerWidth]), [true, true]);

  /* the connection comes back */
  state.online = true;
  await page.locator('#retry').click(); await page.waitForTimeout(150);
  const seen = await status(page);
  await page.waitForURL(SITE, { timeout: 8000 });
  ok('when the website answers it says so and opens the board', [seen[0] === 'checking' || seen[0] === 'found', page.url(), await page.title()], [true, SITE, 'the board']);
  /* the board failed to open after all and the app came back here: it holds off instead of flickering between the two */
  state.online = true; const before = state.probes;
  await page.goto(PAGE, { waitUntil: 'load' }); await page.waitForTimeout(3500);
  ok('back here right after leaving, it waits a good while before trying by itself', [state.probes - before, (await status(page))[0], page.url().split('?')[0]], [0, 'waiting', PAGE]);
  await page.locator('#retry').click(); await page.waitForURL(SITE, { timeout: 8000 });
  ok('though the button still works at once', page.url(), SITE);
  await ctx.close();

  /* the phone itself reports the connection is back */
  ({ ctx, page, state } = await open({ width: 390, height: 780 }));
  await page.goto(PAGE, { waitUntil: 'load' }); await page.waitForTimeout(300);
  /* someone arriving with a keyboard: Tab reaches the button, Enter presses it */
  await page.keyboard.press('Tab');
  const reached = await page.evaluate(() => document.activeElement && document.activeElement.id);
  await page.keyboard.press('Enter'); await page.waitForTimeout(150);
  ok('the keyboard works too: Tab reaches the button and Enter presses it', [reached, (await status(page))[0], state.probes], ['retry', 'checking', 1]);
  await page.waitForTimeout(1100);
  state.online = true;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForURL(SITE, { timeout: 8000 });
  ok('when the phone says it is back online, the board opens without a press', page.url(), SITE);
  await ctx.close();

  /* a wide screen, and the dark look */
  ({ ctx, page, state } = await open({ width: 1440, height: 900 }, { colorScheme: 'dark' }));
  await page.goto(PAGE, { waitUntil: 'load' }); await page.waitForTimeout(300);
  ok('on a wide screen the card keeps a comfortable width, in the middle', await page.evaluate(() => { const r = document.querySelector('.card').getBoundingClientRect(); return [Math.round(r.width) <= 420, Math.abs((r.left + r.right) / 2 - window.innerWidth / 2) < 2]; }), [true, true]);
  ok('dark look: the writing stands out from the card', await page.evaluate(() => {
    const lum = c => { const m = c.match(/\d+(\.\d+)?/g).map(Number).slice(0, 3).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]; };
    const a = lum(getComputedStyle(document.querySelector('h1')).color), b = lum(getComputedStyle(document.querySelector('.card')).backgroundColor);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) > 7;
  }), true);
  await page.screenshot({ path: 'test/shot-offline-dark.png' });
  await ctx.close(); await browser.close();
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
  console.log(fails ? fails + ' FAILING' : 'offline: all good');
  if (fails || errors.length) process.exit(1);
})().catch(e => { console.log('ERROR', e); process.exit(1); });
