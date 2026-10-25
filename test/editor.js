const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'he', timezoneId: 'America/New_York', serviceWorkers: 'block' });
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|ERR_INTERNET|ERR_CONNECTION/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.goto('http://localhost:8790/admin.html', { waitUntil: 'networkidle' });
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} }); await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('#pin-input'); await page.fill('#pin-input', '1234'); await page.press('#pin-input', 'Enter');
  await page.waitForSelector('#tab-schedule'); await page.click('#tab-schedule');
  const weekday = page.locator('#dtp-weekday');
  const sh = weekday.locator('.fields.three > .field').nth(0), mi = weekday.locator('.fields.three > .field').nth(1);
  console.log('shacharis rows:', await sh.locator('.mrow').count(), '| mincha rows:', await mi.locator('.mrow').count());
  console.log('last shacharis row:', (await sh.locator('.mrow').last().textContent()).replace(/\s+/g, ' ').trim(), '| select =', await sh.locator('.mrow').last().locator('select').first().inputValue(), '| mins =', await sh.locator('.mrow').last().locator('input.mins').inputValue());
  console.log('first mincha row preview:', await mi.locator('.mrow').first().locator('.pv').textContent());
  // edit: change the first mincha row to sunset-15 round
  const r0 = mi.locator('.mrow').first();
  await r0.locator('select').first().selectOption('sunset'); await r0.locator('select').nth(1).selectOption('-'); await r0.locator('input.mins').fill('15');
  console.log('after edit preview:', await r0.locator('.pv').textContent());
  // add a minyan
  await mi.locator('button:has-text("+ Add minyan")').click();
  console.log('mincha rows after add:', await mi.locator('.mrow').count(), '| new row preview:', await mi.locator('.mrow').last().locator('.pv').textContent());
  await mi.locator('.mrow').last().locator('select').first().selectOption('fixed');
  await mi.locator('.mrow').last().locator('input[type=time]').fill('17:45');
  await mi.locator('.mrow').last().locator('select[aria-label="Room"]').selectOption('לב אהרן');
  // repeating row on sunday shacharis
  await page.click('#dt-sunday');
  const sun = page.locator('#dtp-sunday').locator('.fields.three > .field').nth(0);
  if (await sun.locator('input[type=checkbox]').first().isChecked()) await sun.locator('label.same').click(); // own list for Sunday (the shul config already gives it one)
  await sun.locator('button.danger').first().click({ clickCount: 1 }).catch(() => {});
  await sun.locator('button:has-text("+ Add repeating")').click();
  const srow = sun.locator('.mrow.series').first();
  await srow.locator('input[aria-label="Every how many minutes"]').fill('30');
  await srow.locator('select[aria-label="From"]').selectOption('fixed'); await srow.locator('input[type=time]').nth(0).fill('07:00');
  await srow.locator('select[aria-label="Until time"]').selectOption('fixed'); await srow.locator('input[type=time]').nth(1).fill('09:00');
  await srow.locator('select[aria-label="Add a room"]').selectOption('ברך משה'); await srow.locator('select[aria-label="Add a room"]').selectOption('דברי יואל');
  console.log('sunday repeating preview:', await srow.locator('.pv').textContent(), '| tab marked:', await page.getAttribute('#dt-sunday', 'class'));
  // text view of sunday shacharis
  await sun.locator('button:has-text("Edit as text")').click();
  console.log('sunday text:', (await sun.locator('textarea').inputValue()).replace(/\n/g, ' | '));
  await sun.locator('button:has-text("Back to the list")').click();
  // copy weekday -> sunday mincha
  const sunMi = page.locator('#dtp-sunday').locator('.fields.three > .field').nth(1);
  await sunMi.locator('label.same').click();
  await sunMi.locator('select[aria-label="Copy from another day"]').selectOption('weekday');
  console.log('sunday mincha rows after copy:', await sunMi.locator('.mrow').count());
  await page.click('#dt-weekday');
  await page.screenshot({ path: 'test/shot-editor.png' });
  await page.click('.panel .bar button.primary'); await page.waitForTimeout(400);
  const cfg = await page.evaluate(() => JSON.parse(localStorage.getItem('minyan-config')));
  console.log('saved weekday mincha:', cfg.schedules.weekday.mincha.replace(/\n/g, ' | '));
  console.log('saved sunday shacharis:', cfg.schedules.sunday.shacharis.replace(/\n/g, ' | '));
  console.log('sunday expands to:', (() => { const e = null; return 'n/a'; })());
  console.log('saved sunday mincha == weekday mincha:', cfg.schedules.sunday.mincha === cfg.schedules.weekday.mincha);
  console.log('board mincha tiles:', (await page.locator('section.tefilla').nth(1).textContent()).replace(/\s+/g, ' ').trim());
  await ctx.close(); await browser.close();
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
})();
