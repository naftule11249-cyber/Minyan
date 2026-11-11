/* The hallway screen's next-minyan panel: it can stay on a minyan for a few minutes after it starts, so someone a minute late still
   reads where it is, and it can be taken off the screen altogether. Both are set in Hallway screen → The next-minyan panel.
   The schedule here is the check's own: שחרית at 7:45 לב אהרן, 8:00 דברי יואל, 8:02 ברך משה, 8:30 שלמה יודא. Wed 18 Nov 2026, New York. */
const { chromium } = require('playwright');
const BASE = 'http://localhost:8790/';
const at = (h, m, s) => Date.UTC(2026, 10, 18, h + 5, m, s || 0); /* New York is five hours behind in November */
(async () => {
  const browser = await chromium.launch(); const errors = []; let fails = 0;
  const ok = (name, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) console.log('ok   ' + name); else { fails++; console.log('FAIL ' + name + ' got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want)); } };
  async function context(when, more, viewport) {
    const ctx = await browser.newContext({ viewport: viewport || { width: 1920, height: 1080 }, locale: 'he', timezoneId: 'America/New_York', serviceWorkers: 'block' });
    await ctx.addInitScript(({ fixed }) => { const real = Date.now; const start = real(); Date.now = () => fixed + (real() - start); }, { fixed: when });
    await ctx.route('**/config.json*', async route => {
      const res = await route.fetch(); const c = JSON.parse(await res.text());
      c.schedules.weekday.shacharis = '07:45 לב אהרן\n08:00 דברי יואל\n08:02 ברך משה\n08:30 שלמה יודא'; c.rolls = []; c.overrides = []; c.notices = []; c.banner = { text: '', from: '', until: '' };
      c.nextTemplate = ''; delete c.nextPanel; delete c.nextHold; Object.assign(c, more || {});
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(c) });
    });
    const page = await ctx.newPage(); page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/ERR_|Failed to load resource|favicon/.test(m.text())) errors.push(m.text()); });
    return { ctx, page };
  }
  const screen = async page => { await page.goto(BASE + 'index.html?view=display&full=1', { waitUntil: 'networkidle' }); await page.locator('.aclock svg').waitFor({ timeout: 15000 }); await page.waitForTimeout(500); };
  const panel = page => page.evaluate(() => { const p = document.querySelector('.wall > .wcol > section.next'); if (!p) return null;
    return { head: p.querySelector('h2').textContent, held: p.classList.contains('held'), lines: Array.from(p.children).slice(1).map(c => c.className.replace(' num', '') + ': ' + c.textContent.replace(/\d\d:\d\d:\d\d$/, 'countdown')) }; });
  const fits = page => page.evaluate(() => Array.from(document.querySelectorAll('main.wall > .wcol')).every(c => c.scrollHeight - c.clientHeight <= 1) && document.documentElement.scrollHeight <= window.innerHeight);

  /* as it has always been: no holding */
  let { ctx, page } = await context(at(7, 47));
  await screen(page);
  ok('left as it is, the panel is on the next minyan the moment one has started', await panel(page), { head: 'מנין הבא', held: false, lines: ['tf: שחרית', 'rm: דברי יואל', 'time: 8:00', 'ms: הודו 8:10', 'count: countdown'] });
  await ctx.close();

  /* five minutes on a minyan after it starts */
  ({ ctx, page } = await context(at(7, 47), { nextHold: 5 }));
  await screen(page);
  ok('told to stay five minutes, at 7:47 it is still on the 7:45, headed עכשיו, with the next one named under it instead of a countdown', await panel(page),
    { head: 'עכשיו', held: true, lines: ['tf: שחרית', 'rm: לב אהרן', 'time: 7:45', 'ms: הודו 7:55', 'then: הבא8:00דברי יואל'] });
  ok('the tiles are as ever: the 7:45 marked as the one davening, the 8:00 as the next, and everything fits', [await page.locator('.wall .tile.prev .time').textContent(), await page.locator('.wall .tile.next .time').textContent(), await fits(page)], ['7:45', '8:00', true]);
  await page.screenshot({ path: 'test/shot-nextpanel-held.png' });
  await ctx.close();
  ({ ctx, page } = await context(at(7, 49, 57), { nextHold: 5 }));
  await screen(page);
  ok('seconds before the five minutes are up it is still on it', (await panel(page)).head, 'עכשיו');
  await page.waitForTimeout(4500);
  ok('and when they are up the panel moves on by itself to the next minyan, with its countdown', await panel(page), { head: 'מנין הבא', held: false, lines: ['tf: שחרית', 'rm: דברי יואל', 'time: 8:00', 'ms: הודו 8:10', 'count: countdown'] });
  await ctx.close();
  /* two minyanim close together: the one that started last is the one held */
  ({ ctx, page } = await context(at(8, 1, 57), { nextHold: 5 }));
  await screen(page);
  ok('at 8:01 it is on the 8:00, the 8:02 named under it', [(await panel(page)).lines[1], (await panel(page)).lines[4]], ['rm: דברי יואל', 'then: הבא8:02ברך משה']);
  await page.waitForTimeout(4500);
  ok('and the moment the 8:02 starts it turns to that one, without waiting out the five minutes', [(await panel(page)).head, (await panel(page)).lines[1], (await panel(page)).lines[4]], ['עכשיו', 'rm: ברך משה', 'then: הבא8:30שלמה יודא']);
  await ctx.close();

  /* the panel taken off the screen */
  ({ ctx, page } = await context(at(7, 47), { nextPanel: false }));
  await screen(page);
  ok('switched off, the panel is not on the screen and the minyanim have its room; nothing is cut off', [await panel(page), await page.locator('main.wall > .wcol').first().locator('section.tefilla').count(), await fits(page),
    await page.evaluate(() => { const c = document.querySelector('main.wall > .wcol'), card = c.querySelector('section.tefilla'); return c.getBoundingClientRect().bottom - card.getBoundingClientRect().bottom < 4; })], [null, 1, true, true]);
  await ctx.close();

  /* the back end */
  ({ ctx, page } = await context(at(7, 47), null, { width: 1280, height: 900 }));
  await page.goto(BASE + 'admin.html', { waitUntil: 'networkidle' });
  await page.fill('#pin-input', '1234'); await page.press('#pin-input', 'Enter'); await page.waitForSelector('#tab-screen'); await page.click('#tab-screen'); await page.waitForTimeout(200);
  ok('the back end has both: the switch on, the minutes at 0', [await page.isChecked('#w-nextpanel'), await page.inputValue('#w-nexthold'), await page.locator('#w-next-template').isVisible()], [true, '0', true]);
  await page.fill('#w-nexthold', '5'); await page.click('.abar .btn.primary'); await page.waitForTimeout(900);
  const tv = await ctx.newPage(); await tv.setViewportSize({ width: 1920, height: 1080 }); await screen(tv);
  ok('set to 5 and saved, the screen holds the minyan that has just started', [(await panel(tv)).head, (await panel(tv)).lines[1]], ['עכשיו', 'rm: לב אהרן']);
  await page.bringToFront(); await page.click('#tab-screen');
  await page.fill('#w-nexthold', '99'); await page.locator('#w-nexthold').blur(); await page.click('.abar .btn.primary'); await page.waitForTimeout(900);
  ok('a number out of range is brought back into it', await page.evaluate(() => JSON.parse(localStorage.getItem('minyan-config')).nextHold), 30);
  await page.click('#tab-screen'); await page.uncheck('#w-nextpanel'); await page.waitForTimeout(100);
  ok('switching the panel off puts its other settings away', [await page.locator('#w-next-template').isVisible(), await page.locator('#w-nexthold').isVisible()], [false, false]);
  await page.click('.abar .btn.primary'); await page.waitForTimeout(900);
  await tv.bringToFront(); await screen(tv);
  ok('and after Save the screen has no panel', await panel(tv), null);
  await ctx.close();

  await browser.close();
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
  console.log(fails ? fails + ' FAILED' : 'all ok');
  process.exit(fails || errors.length ? 1 : 0);
})().catch(e => { console.log('ERROR', e.message); process.exit(1); });
