/* The board's day chips: a tap on מחר shows tomorrow's minyanim and zmanim; today comes back; the lobby has no chips. Clock frozen Mon 9 Nov 2026 9:00 (tomorrow is Rosh Chodesh Kislev). */
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch(); const errors = []; let fails = 0;
  const ok = (name, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) console.log('ok   ' + name); else { fails++; console.log('FAIL ' + name + ' got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want)); } };
  async function open(path, width) {
    const ctx = await browser.newContext({ viewport: { width: width || 1280, height: 900 }, locale: 'he', timezoneId: 'America/New_York', serviceWorkers: 'block' });
    await ctx.addInitScript(({ fixed }) => { const real = Date.now; const start = real(); Date.now = () => fixed + (real() - start); }, { fixed: Date.UTC(2026, 10, 9, 14, 0) });
    const page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message));
    page.on('console', x => { if (x.type() === 'error' && !/ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|ERR_INTERNET|ERR_CONNECTION/.test(x.text())) errors.push(x.text()); });
    await page.goto('http://localhost:8790/index.html' + (path || ''), { waitUntil: 'networkidle' }); await page.waitForTimeout(400);
    return { ctx, page };
  }
  let { ctx, page } = await open('');
  const chips = () => page.locator('.board-days .daychip .dc-day').allTextContents();
  ok('seven chips: today, tomorrow, then day names', [(await chips()).length, (await chips()).slice(0, 3)], [7, ['היום', 'מחר', 'יום רביעי']]);
  ok('today is selected and the heading says today', [await page.locator('.board-days .daychip.on .dc-day').textContent(), await page.locator('.day-head h2').first().textContent()], ['היום', 'היום']);
  const todayTimes = await page.locator('section.tefilla').first().locator('.tile .time').allTextContents();
  await page.locator('.board-days .daychip', { hasText: 'מחר' }).click(); await page.waitForTimeout(300);
  const head = await page.locator('.day-head h2').first().textContent(), sub = await page.locator('.day-head .sub').first().textContent();
  ok('tomorrow: heading with the day and its date, Rosh Chodesh board', [/^יום שלישי – ל׳ חשון/.test(head), /ראש חודש/.test(sub)], [true, true]);
  const tomoTimes = await page.locator('section.tefilla').first().locator('.tile .time').allTextContents();
  ok('tomorrow\'s shacharis is the Rosh Chodesh list (7:10, 7:30, 7:45; no 11:20), unlike today\'s', [tomoTimes.slice(2, 5), tomoTimes.indexOf('11:20') < 0, JSON.stringify(tomoTimes) !== JSON.stringify(todayTimes)], [['7:10', '7:30', '7:45'], true, true]);
  ok('no tile is dimmed as past on tomorrow\'s list', await page.locator('section.tefilla .tile.past').count(), 0);
  ok('the side panel shows tomorrow\'s zmanim, without reminders', [await page.locator('.side h3').first().textContent(), await page.locator('.zlist li.tap').count()], ['זמני מחר', 0]);
  ok('the next-minyan box stays live', await page.locator('section.next:not(.zman) .count').count(), 1);
  await page.locator('.board-days .daychip', { hasText: 'היום' }).click(); await page.waitForTimeout(300);
  ok('back to today', [await page.locator('.day-head h2').first().textContent(), await page.locator('.side h3').first().textContent()], ['היום', 'זמני היום']);
  await ctx.close();
  ({ ctx, page } = await open('', 390));
  await page.locator('.board-days .daychip', { hasText: 'מחר' }).click(); await page.waitForTimeout(300);
  ok('phone: the chips work with the tabbed layout', [await page.locator('.board-days').count(), /^יום שלישי/.test(await page.locator('.day-head h2').first().textContent()), await page.locator('.ttabs').count()], [1, true, 1]);
  await ctx.close();
  ({ ctx, page } = await open('?view=display'));
  ok('the lobby screen has no chips', await page.locator('.board-days').count(), 0);
  await ctx.close(); await browser.close();
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
  console.log(fails ? fails + ' FAILING' : 'dayswitch: all good');
  if (fails) process.exit(1);
})().catch(e => { console.log('ERROR', e); process.exit(1); });
