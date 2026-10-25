const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'he', timezoneId: 'America/New_York', serviceWorkers: 'block' });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('pageerror: ' + e.message)); page.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|ERR_INTERNET|ERR_CONNECTION/.test(m.text())) errors.push(m.text()); });
  await page.goto('http://localhost:8790/admin.html', { waitUntil: 'networkidle' });
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} }); await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('#pin-input'); await page.fill('#pin-input', '1234'); await page.press('#pin-input', 'Enter');
  await page.waitForSelector('#tab-notices'); await page.click('#tab-notices');
  await page.fill('#banner-text', 'אין מעריב בלב אהרן הערב');
  const until = new Date(Date.now() + 2 * 3600000); const pad = n => String(n).padStart(2, '0');
  await page.fill('#banner-until', `${until.getFullYear()}-${pad(until.getMonth() + 1)}-${pad(until.getDate())}T${pad(until.getHours())}:${pad(until.getMinutes())}`);
  // date the first sponsor so it ends yesterday -> should disappear from the board
  const y = new Date(Date.now() - 86400000);
  const firstTo = page.locator('input[id^="n-to-"]').first(); await firstTo.fill(`${y.getFullYear()}-${pad(y.getMonth() + 1)}-${pad(y.getDate())}`);
  await page.click('.panel .bar button.primary'); await page.waitForTimeout(500);
  console.log('banner on board:', await page.locator('.banner-inner').textContent().catch(() => 'none'), '| sponsor boxes:', await page.locator('.sponsor').count());
  // undo: history has the previous version
  await page.click('footer button:has-text("Edit")');
  await page.waitForSelector('#tab-data'); await page.click('#tab-data');
  console.log('history entries:', await page.locator('button:has-text("Restore")').count());
  await page.locator('button:has-text("Restore")').first().click(); await page.waitForTimeout(300);
  console.log('after restore banner text field:', JSON.stringify(await page.inputValue('#banner-text')), '| toast:', await page.locator('#toast').textContent().catch(() => ''));
  await page.click('#tab-general'); console.log('notify field:', await page.locator('#f-notify').count());
  await ctx.close(); await browser.close();
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
})();
