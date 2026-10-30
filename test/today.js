/* The Today tab: cancel, move and add a minyan for today only, saved as a one-date special schedule that the board shows. */
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
  const errors = []; let fails = 0;
  const ok = (name, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) console.log('ok   ' + name); else { fails++; console.log('FAIL ' + name + ' got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want)); } };
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 900 }, locale: 'he', timezoneId: 'America/New_York', serviceWorkers: 'block' });
  /* Clock frozen on Monday 1 Feb 2027, 6 AM New York: the board shows that day's own lists, and the local draft is newer than the published file */
  const fixed = Date.parse('2027-02-01T06:00:00-05:00'); /* a Monday, 6 AM New York: a plain weekday, before any minyan, and later than any published savedAt so the local draft wins */
  await ctx.addInitScript(({ fixed }) => { const real = Date.now; const start = real(); Date.now = () => fixed + (real() - start); }, { fixed });
  const page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|ERR_INTERNET|ERR_CONNECTION/.test(m.text())) errors.push(m.text()); });
  await page.goto('http://localhost:8790/admin.html', { waitUntil: 'networkidle' });
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} }); await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('#pin-input'); await page.fill('#pin-input', '1234'); await page.press('#pin-input', 'Enter');
  await page.waitForSelector('#tab-today');
  ok('Today tab opens first', await page.locator('#tab-today').getAttribute('aria-selected'), 'true');
  const sh = () => page.locator('#page-today .field:has(label:text-is("שחרית"))'), mi = () => page.locator('#page-today .field:has(label:text-is("מנחה"))');
  const n = await sh().locator('.today-row').count(); console.log('shacharis rows today:', n);
  ok('today lists minyanim', n > 0, true);
  await sh().locator('.today-row').first().locator('button:has-text("Cancel")').click();
  ok('one cancelled', await sh().locator('.today-row').count(), n - 1);
  await sh().locator('.today-row').first().locator('input[type=time]').fill('07:33');
  await sh().locator('.today-row').first().locator('input[type=time]').dispatchEvent('change');
  await sh().locator('.today-row').first().locator('select[aria-label="Room"]').selectOption('היכל אדל');
  await mi().locator('input[aria-label="New time"]').fill('16:10');
  await mi().locator('select[aria-label="Add a room"]').selectOption('ברך משה');
  await mi().locator('button:has-text("+ Add for today")').click();
  const times = await mi().locator('.today-row input[type=time]').evaluateAll(els => els.map(e => e.value));
  ok('mincha added at 16:10', times.indexOf('16:10') >= 0, true);
  await page.click('#page-today button:has-text("Save today")'); await page.waitForTimeout(600);
  const cfg = await page.evaluate(() => JSON.parse(localStorage.getItem('minyan-config')));
  const ovr = (cfg.overrides || []).filter(o => o.label === 'שינוי להיום')[0];
  ok('saved as a one-date special schedule', !!ovr && /^\d{4}-\d{2}-\d{2}$/.test(ovr.date), true);
  console.log('shacharis lines:', (ovr.lines.shacharis || '').replace(/\n/g, ' | ').slice(0, 140));
  console.log('mincha lines:', (ovr.lines.mincha || '').replace(/\n/g, ' | '));
  ok('moved time and new room are in the lines', /^07:33 היכל אדל$/m.test(ovr.lines.shacharis), true);
  ok('added mincha is in the lines', /^16:10 ברך משה$/m.test(ovr.lines.mincha), true);
  ok('one fewer shacharis line', ovr.lines.shacharis.split('\n').length, n - 1);
  ok('maariv untouched (no line)', ovr.lines.maariv, undefined);
  await page.goto('http://localhost:8790/index.html', { waitUntil: 'networkidle' }); await page.waitForTimeout(400);
  ok('board marks the special day', /שינוי להיום/.test(await page.locator('.day-head .sub').first().textContent()), true);
  const tileTimes = await page.locator('.tile .time').allTextContents();
  ok('board shows the moved and the added minyan', [tileTimes.indexOf('7:33') >= 0, tileTimes.indexOf('4:10') >= 0], [true, true]);
  // undo
  await page.goto('http://localhost:8790/admin.html', { waitUntil: 'networkidle' }); await page.waitForTimeout(300);
  if (await page.locator('#pin-input').count()) { await page.fill('#pin-input', '1234'); await page.press('#pin-input', 'Enter'); }
  await page.waitForSelector('#tab-today');
  ok('undo offered when today has changes', await page.locator('#page-today button:has-text("Back to the regular schedule")').count(), 1);
  await page.click('#page-today button:has-text("Back to the regular schedule")'); await page.waitForTimeout(600);
  const cfg2 = await page.evaluate(() => JSON.parse(localStorage.getItem('minyan-config')));
  ok('undo removes it', (cfg2.overrides || []).filter(o => o.label === 'שינוי להיום').length, 0);
  // a later day: pick the day after tomorrow, cancel its first Shacharis, save; it gets its own one-date schedule, today stays untouched
  await page.waitForSelector('#tab-today'); await page.waitForTimeout(200);
  ok('seven day cards, today first and selected', [await page.locator('.daychip').count(), await page.locator('.daychip').first().getAttribute('aria-selected'), await page.locator('.daychip .dc-day').nth(1).textContent()], [7, 'true', 'Tomorrow']);
  await page.locator('.daychip').nth(2).click(); await page.waitForTimeout(200);
  const n3 = await sh().locator('.today-row').count();
  await sh().locator('.today-row').first().locator('button:has-text("Cancel")').click();
  ok('the later day lists its minyanim and one is cancelled', [n3 > 0, await sh().locator('.today-row').count()], [true, n3 - 1]);
  ok('the day card is marked as touched', await page.locator('.daychip').nth(2).evaluate(e => e.classList.contains('has')), true);
  await page.click('#page-today button:has-text("Save the changes for")'); await page.waitForTimeout(600);
  const cfg3 = await page.evaluate(() => JSON.parse(localStorage.getItem('minyan-config')));
  const dayIso = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(fixed + 2 * 86400000)); /* the page's clock is `fixed`; the third card is two days after its today */
  const o3 = (cfg3.overrides || []).filter(o => o.label === 'שינוי')[0];
  ok('saved as that day\'s own schedule, today untouched', [!!o3, o3 && o3.date === dayIso, o3 && o3.lines.shacharis.split('\n').length, (cfg3.overrides || []).filter(o => o.label === 'שינוי להיום').length], [true, true, n3 - 1, 0]);
  await ctx.close(); await browser.close();
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
  if (fails || errors.length) process.exit(1); else console.log('today: all good');
})();
