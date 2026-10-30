/* The "Show: only while it starts before <zman>" rule in the row editor: preview, text form, and the publish step listing the change. Clock frozen Wed 28 Oct 2026 9:00. */
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch(); const errors = []; let fails = 0;
  const ok = (name, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) console.log('ok   ' + name); else { fails++; console.log('FAIL ' + name + ' got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want)); } };
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'he', timezoneId: 'America/New_York', serviceWorkers: 'block' });
  const fixed = Date.UTC(2026, 9, 28, 13, 0);
  await ctx.addInitScript(({ fixed }) => { const real = Date.now; const start = real(); Date.now = () => fixed + (real() - start); }, { fixed });
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|ERR_INTERNET|ERR_CONNECTION/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.goto('http://localhost:8790/admin.html', { waitUntil: 'networkidle' });
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} }); await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(600);
  /* the published copy the device compares against: make it older than this test's frozen clock, whatever date the shul last published */
  await page.evaluate(() => { try { const r = JSON.parse(localStorage.getItem('minyan-remote') || 'null'); if (r) { r.savedAt = 1; localStorage.setItem('minyan-remote', JSON.stringify(r)); } } catch (e) {} });
  await page.waitForSelector('#pin-input'); await page.fill('#pin-input', '1234'); await page.press('#pin-input', 'Enter');
  await page.waitForSelector('#tab-schedule'); await page.click('#tab-schedule');
  const sh = page.locator('#dtp-weekday .fields.three > .field').nth(0);
  await sh.locator('button:has-text("+ Add minyan")').click();
  let row = sh.locator('.mrow').last();
  await row.locator('select').first().selectOption('fixed'); await row.locator('input[type=time]').fill('10:45'); await page.waitForTimeout(100);
  ok('a new row is shown always', await row.locator('select[aria-label="Show only"]').inputValue(), '');
  await row.locator('select[aria-label="Show only"]').selectOption('until'); await page.waitForTimeout(150);
  ok('until: sof zman tefilla by default, still listed today (late October)', [await row.locator('select[aria-label="Condition zman"]').inputValue(), /^today 10:45 · only before סוף זמן תפילה, today \d{1,2}:\d{2}$/.test(await row.locator('.pv').textContent())], ['tefilla', true]);
  await row.locator('input[aria-label="Condition minutes"]').fill('90'); await page.waitForTimeout(150);
  ok('90 minutes before it: not today', /^not today: only before סוף זמן תפילה −90 min, today/.test(await row.locator('.pv').textContent()), true);
  await sh.locator('button:has-text("Edit as text")').click();
  ok('the text form carries the rule', /^10:45 .*until tefilla-90$/m.test(await sh.locator('textarea').inputValue()), true);
  await sh.locator('button:has-text("Back to the list")').click(); await page.waitForTimeout(150);
  row = sh.locator('.mrow').filter({ has: page.locator('input[type=time][value="10:45"]') }).first();
  ok('back in the list the rule is still there', [await row.locator('select[aria-label="Show only"]').inputValue(), await row.locator('input[aria-label="Condition minutes"]').inputValue()], ['until', '90']);
  // the On/Off switch keeps the row but takes it off the board
  await row.locator('.switch input').uncheck(); await page.waitForTimeout(150);
  ok('switched off: dimmed, preview says off', [await row.evaluate(e => e.classList.contains('off')), /^off · /.test(await row.locator('.pv').textContent())], [true, true]);
  await sh.locator('button:has-text("Edit as text")').click();
  ok('the text keeps the line with #off in front', /^#off 10:45 .*until tefilla-90$/m.test(await sh.locator('textarea').inputValue()), true);
  await sh.locator('button:has-text("Back to the list")').click(); await page.waitForTimeout(150);
  row = sh.locator('.mrow').filter({ has: page.locator('input[type=time][value="10:45"]') }).first();
  ok('still off after the list is rebuilt', await row.locator('.switch input').isChecked(), false);
  await row.locator('.switch input').check(); await page.waitForTimeout(150);
  ok('switched on again (the −90 rule still hides it today)', [await row.evaluate(e => e.classList.contains('off')), /^not today: only before/.test(await row.locator('.pv').textContent())], [false, true]);
  await row.locator('select[aria-label="Show only"]').selectOption('after'); await page.waitForTimeout(150);
  ok('after: listed today (10:45 is after sof zman tefilla minus 90)', /^today 10:45 · only from סוף זמן תפילה −90 min/.test(await row.locator('.pv').textContent()), true);
  // save: the change is counted, listed on the Publish tab, and nothing is published by Save itself
  await page.click('.panel .bar button.primary'); await page.waitForTimeout(700);
  ok('the publish bar counts the change', await page.locator('.pubbar .pubmsg').textContent(), '1 change not yet published');
  await page.click('#tab-publish'); await page.waitForTimeout(200);
  const listed = await page.locator('.changes li').allTextContents();
  ok('the Publish tab lists it', listed.filter(t => /^Weekdays/.test(t)), ['Weekdays · שחרית: added 10:45 ברך משה after tefilla-90']);
  ok('the saved copy is on the device, the website copy untouched', await page.evaluate(() => [/after tefilla-90/.test(localStorage.getItem('minyan-config') || ''), /after tefilla-90/.test(localStorage.getItem('minyan-remote') || '')]), [true, false]);
  await ctx.close(); await browser.close();
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
  console.log(fails ? fails + ' FAILING' : 'cond: all good');
  if (fails) process.exit(1);
})().catch(e => { console.log('ERROR', e); process.exit(1); });
