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
  await page.waitForSelector('#tab-general'); await page.click('#tab-general');
  await page.fill('#f-name', 'בדיקת קטגוריות'); // an unsaved edit that must survive adding a category
  await page.click('button:has-text("+ Add category")'); await page.waitForSelector('#t-name-3');
  console.log('after add: name kept:', await page.inputValue('#f-name'), '| categories:', await page.locator('[id^="t-name-"]').count(), '| new kind:', await page.inputValue('#t-kind-3'));
  await page.fill('#t-name-3', 'שיעור דף היומי');
  await page.click('#tab-schedule');
  const cat = page.locator('#dtp-weekday .fields.three > .field').nth(3);
  console.log('weekday editors:', await page.locator('#dtp-weekday .fields.three > .field').count(), '| 4th label:', await cat.locator('label').first().textContent());
  await cat.locator('button:has-text("+ Add minyan")').click();
  await cat.locator('.mrow').last().locator('input[type=time]').fill('20:30');
  await cat.locator('.mrow').last().locator('select[aria-label="Room"]').selectOption('היכל ביהמ״ד');
  // yearly special day: Chol Hamoed Sukkos
  await page.click('#tab-overrides'); await page.click('button:has-text("+ Date")');
  const ov = page.locator('.ovr').last();
  await ov.locator('select[id^="o-when-"]').selectOption('cal'); await ov.locator('select[id^="o-cal-"]').selectOption('חול המועד סוכות');
  await ov.locator('input[id^="o-label-"]').fill('חול המועד');
  const ovSh = ov.locator('.fields.three > .field').nth(0);
  await ovSh.locator('button:has-text("+ Add minyan")').click(); await ovSh.locator('.mrow').last().locator('input[type=time]').fill('07:00');
  await page.click('.panel .bar button.primary'); await page.waitForTimeout(500);
  const cfg = await page.evaluate(() => JSON.parse(localStorage.getItem('minyan-config')));
  console.log('saved tefillos:', cfg.tefillos.map(t => t.name + '/' + (t.kind || 'minyan')).join(', '));
  console.log('saved shiur lines:', cfg.schedules.weekday[cfg.tefillos[3].id], '| override:', JSON.stringify(cfg.overrides[0]).slice(0, 120));
  console.log('board sections:', (await page.locator('section.tefilla h3').allTextContents()).join(' | '), '| next panel:', await page.locator('.next .what').textContent());
  await ctx.close(); await browser.close();
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
})();
