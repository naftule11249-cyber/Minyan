/* The zman countdown box: next important zman of the day, red in the last 30 minutes, gone when none is left. Clock frozen on Sunday 25 Oct 2026. */
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
  const errors = []; let fails = 0;
  const ok = (name, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) console.log('ok   ' + name); else { fails++; console.log('FAIL ' + name + ' got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want)); } };
  async function at(y, mo, d, h, m, hash, pref) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'he', timezoneId: 'America/New_York', serviceWorkers: 'block' });
    const fixed = Date.UTC(y, mo - 1, d, h + 4, m);
    await ctx.addInitScript(({ fixed, pref }) => { const real = Date.now; const start = real(); Date.now = () => fixed + (real() - start); try { if (pref) localStorage.setItem('minyan-countdown', JSON.stringify(pref)); } catch (e) {} }, { fixed, pref });
    const page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message));
    page.on('console', x => { if (x.type() === 'error' && !/ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|ERR_INTERNET|ERR_CONNECTION/.test(x.text())) errors.push(x.text()); });
    await page.goto('http://localhost:8790/index.html' + (hash || ''), { waitUntil: 'networkidle' }); await page.waitForTimeout(400);
    const box = page.locator('section.next.zman');
    const r = { n: await box.count(), what: await box.locator('.what').textContent().catch(() => ''), time: await box.locator('.time').textContent().catch(() => ''), count: await box.locator('.count').textContent().catch(() => ''), soon: await box.evaluate(e => e.classList.contains('soon')).catch(() => null) };
    await ctx.close(); return r;
  }
  let r = await at(2026, 10, 25, 9, 30);
  ok('9:30: counts down to sof zman Shema 9:59, red (under 30 min)', [r.what, r.time, /^00:2[89]:/.test(r.count), r.soon], ['סוף זמן ק״ש', '9:59', true, true]);
  r = await at(2026, 10, 25, 10, 5);
  ok('10:05: sof zman tefilla 10:52, not red yet', [r.what, r.time, r.soon], ['סוף זמן תפילה', '10:52', false]);
  r = await at(2026, 10, 25, 13, 0);
  ok('13:00 Sunday: shkia (no candle lighting today)', [r.what, r.time], ['שקיעה', '6:01']);
  r = await at(2026, 10, 30, 13, 0);
  ok('Friday 13:00: candle lighting comes first', r.what, 'הדלקת נרות');
  r = await at(2026, 10, 25, 19, 0);
  ok('after shkia: no box', r.n, 0);
  r = await at(2026, 10, 25, 9, 30, '#display');
  ok('lobby screen shows it too', r.what, 'סוף זמן ק״ש');
  r = await at(2026, 10, 25, 9, 30, '', ['chatzos']);
  ok('a device that picked only chatzos gets chatzos', [r.what, r.time], ['חצות', '12:40']);
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'he', timezoneId: 'America/New_York', serviceWorkers: 'block' });
    const page = await ctx.newPage(); await page.goto('http://localhost:8790/index.html', { waitUntil: 'networkidle' }); await page.waitForTimeout(300);
    await page.click('#zc-open');
    ok('chooser opens from the footer with the zmanim', await page.locator('#zc-overlay input[type=checkbox]').count() >= 8, true);
    await page.uncheck('#zc-shema'); await page.uncheck('#zc-tefilla'); await page.uncheck('#zc-candles'); await page.uncheck('#zc-sunset'); await page.check('#zc-tzeis');
    await page.click('#zc-overlay button:has-text("Save")'); await page.waitForTimeout(300);
    ok('the choice is saved on the device', await page.evaluate(() => localStorage.getItem('minyan-countdown')), '["tzeis"]');
    await ctx.close();
  }
  await browser.close();
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
  if (fails || errors.length) process.exit(1); else console.log('zcount: all good');
})();
