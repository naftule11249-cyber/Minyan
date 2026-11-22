/* Back end → This week: a change for today is saved by its own button and by the Save at the top, and the page stays alive after it.
   (A day with its own schedule once froze the browser: the Schedule page's rows were sized by container queries, and laying out the
   special date's lists never finished. Every step here is under a time limit for that reason.) */
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
  let fails = 0; const errors = [];
  const ok = (name, got, want) => { const pass = JSON.stringify(got) === JSON.stringify(want); if (!pass) fails++; console.log((pass ? 'ok   ' : 'FAIL ') + name + (pass ? '' : ' got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want))); };
  const within = (promise, ms) => Promise.race([promise, new Promise(r => setTimeout(() => r('FROZEN'), ms))]);
  const iso = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  for (const how of ['own', 'top']) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block', timezoneId: 'America/New_York' });
    await ctx.route('https://*.workers.dev/**', r => r.abort());
    const page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://localhost:8790/admin.html', { waitUntil: 'networkidle' });
    await page.fill('#pin-input', process.env.MINYAN_PIN || '1234'); await page.press('#pin-input', 'Enter'); await page.waitForSelector('#tab-home');
    await page.click('#tab-today'); await page.waitForTimeout(300);
    const row = () => page.locator('#page-today .tcard').nth(1).locator('.today-row').first(), sel = () => row().locator('select[aria-label="Room"]');
    const time = await row().locator('input[type=time]').inputValue(), was = await sel().inputValue(), to = was === 'לב אהרן' ? 'דברי יואל' : 'לב אהרן';
    await sel().selectOption(to); await page.waitForTimeout(400);
    ok(how + ': the room picked stays picked', await sel().inputValue(), to);
    const btn = how === 'own' ? page.locator('#page-today .actions button.primary') : page.locator('.abar button.primary', { hasText: /^Save$/ });
    btn.click({ timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(2500);
    const saved = await within(page.evaluate(() => (JSON.parse(localStorage.getItem('minyan-config') || '{}').overrides || []).map(o => [o.date, (o.lines.mincha || '').split('\n')[0]])), 5000);
    ok(how + ': saved for today, and the page is still alive', saved, [[iso, time + ' ' + to]]);
    if (saved !== 'FROZEN') {
      ok(how + ': the tab shows the day as changed, with the new room', [await within(sel().inputValue(), 4000), await within(page.locator('#page-today .today-head .status.dirty').count(), 4000)], [to, 1]);
      await within(page.click('#tab-settings').then(() => page.locator('.subtabs button', { hasText: 'Special dates' }).click()), 6000);
      ok(how + ': Special dates opens with that day in it', await within(page.locator('.ovr').count(), 4000), 1);
      await within(page.click('#tab-schedule'), 4000);
      ok(how + ': and the Schedule page still lays a minyan out on one line', await within(page.evaluate(() => { const r = Array.from(document.querySelectorAll('#dtp-weekday .mrow.flat')).find(x => x.offsetParent); return r ? Math.round(r.getBoundingClientRect().height) < 90 : null; }), 4000), true);
    }
    await ctx.close().catch(() => {});
  }
  await browser.close().catch(() => {});
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
  console.log(fails || errors.length ? fails + ' FAILING' : 'thisweek: all good'); process.exit(fails || errors.length ? 1 : 0);
})().catch(e => { console.log('ERROR', e.message); process.exit(1); });
