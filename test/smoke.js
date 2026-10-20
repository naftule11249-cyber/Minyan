const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(async e => { console.log('launch fallback', e.message.slice(0, 80)); return chromium.launch(); });
  const errors = [];
  for (const [name, vp, scheme] of [['desktop', { width: 1280, height: 900 }, 'light'], ['phone', { width: 400, height: 860 }, 'dark']]) {
    const ctx = await browser.newContext({ viewport: vp, colorScheme: scheme, locale: 'he', timezoneId: 'America/New_York' });
    const page = await ctx.newPage();
    page.on('console', m => { if (m.type() === 'error') errors.push(name + ': ' + m.text()); });
    page.on('pageerror', e => errors.push(name + ' pageerror: ' + e.message));
    await page.goto('http://localhost:8790/index.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    console.log(name, 'dayline:', await page.textContent('.dayline'), '| next:', (await page.textContent('.next')).replace(/\s+/g, ' ').slice(0, 120));
    console.log(name, 'scrollWidth', await page.evaluate(() => document.documentElement.scrollWidth), 'tiles', await page.locator('.tile').count(), 'next-tiles', await page.locator('.tile.next').count());
    await page.screenshot({ path: 'test/shot-' + name + '.png', fullPage: true });
    if (name === 'desktop') {
      await page.click('footer button:has-text("Edit")');
      await page.fill('#pin-input', '1234'); await page.press('#pin-input', 'Enter');
      await page.waitForSelector('#f-name');
      await page.fill('#f-name', 'ביהמ״ד בדיקה');
      await page.click('#tab-schedule');
      await page.fill('#sch-weekday-mincha', 'שקיעה-15~5 ברך משה\n1:30 דברי יואל\nבלבול לב אהרן');
      await page.waitForTimeout(200);
      console.log('preview:', (await page.textContent('#sch-weekday-mincha + .preview')).trim());
      await page.screenshot({ path: 'test/shot-admin.png', fullPage: false });
      await page.click('.panel .bar button.primary');
      await page.waitForTimeout(500);
      console.log('after save shul:', await page.textContent('.top .shul'), '| overlay gone:', await page.locator('#overlay').count() === 0);
      await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(500);
      console.log('after reload shul:', await page.textContent('.top .shul'));
      console.log('mincha tiles:', (await page.locator('section.tefilla').nth(1).textContent()).replace(/\s+/g, ' '));
    }
    await ctx.close();
  }
  await browser.close();
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
})();
