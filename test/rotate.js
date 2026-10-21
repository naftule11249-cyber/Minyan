const { chromium } = require('playwright'); const fs = require('fs');
(async () => {
  const orig = fs.readFileSync('docs/config.json', 'utf8'); const c = JSON.parse(orig);
  c.notices = [{ title: 'פרנס החודש', body: 'א' }, { title: 'פרנס השבוע', body: 'ב' }, { title: 'נר למאור', body: 'ג' }]; c.sponsorSeconds = 2; c.savedAt = Date.now();
  fs.writeFileSync('docs/config.json', JSON.stringify(c));
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'he', timezoneId: 'America/New_York', serviceWorkers: 'block' });
  const page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://localhost:8790/index.html?view=display', { waitUntil: 'networkidle' }); await page.waitForTimeout(600);
  const seen = [];
  for (let i = 0; i < 4; i++) { seen.push(await page.locator('.sponsor.on .t').textContent()); console.log('visible boxes:', await page.locator('.sponsor.on').count(), '| boxes:', await page.locator('.sponsor').count()); await page.waitForTimeout(2100); }
  console.log('sequence:', seen.join(' → '));
  await page.goto('http://localhost:8790/index.html', { waitUntil: 'networkidle' }); await page.waitForTimeout(400);
  console.log('normal page side by side:', await page.locator('.sponsors-inner.rotating').count() === 0, '| boxes:', await page.locator('.sponsor').count());
  fs.writeFileSync('docs/config.json', orig);
  await ctx.close(); await browser.close();
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
})();
