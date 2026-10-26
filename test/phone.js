/* Phone layout: tabs, rows, folded past minyanim, and the next-three strip. Clock frozen on Sunday 25 Oct 2026 9:22. */
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
  const errors = []; let fails = 0;
  const ok = (name, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) console.log('ok   ' + name); else { fails++; console.log('FAIL ' + name + ' got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want)); } };
  async function open(width, h, m) {
    const ctx = await browser.newContext({ viewport: { width: width, height: 860 }, locale: 'he', timezoneId: 'America/New_York', serviceWorkers: 'block' });
    const fixed = Date.UTC(2026, 9, 25, h + 4, m);
    await ctx.addInitScript(({ fixed }) => { const real = Date.now; const start = real(); Date.now = () => fixed + (real() - start); }, { fixed });
    const page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message));
    page.on('console', x => { if (x.type() === 'error' && !/ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|ERR_INTERNET|ERR_CONNECTION/.test(x.text())) errors.push(x.text()); });
    await page.goto('http://localhost:8790/index.html', { waitUntil: 'networkidle' }); await page.waitForTimeout(400);
    return { ctx, page };
  }
  let { ctx, page } = await open(400, 9, 22);
  ok('phone: tabs instead of tiles', [await page.locator('.ttabs button').count() >= 3, await page.locator('.tile').count()], [true, 0]);
  ok('phone: the next minyan\'s tefilla is the open tab', await page.locator('.ttabs button[aria-selected="true"]').textContent(), 'שחרית');
  const times = async () => page.locator('.row .time').allTextContents();
  ok('phone: six past minyanim folded, 9:15 (now) first', [(await times())[0], await page.locator('.foldbtn').textContent()], ['9:15', 'הצג את הקודמים (6)']);
  ok('phone: next and now badges', [await page.locator('.row.next .badge').textContent(), await page.locator('.row.now .badge').textContent()], ['הבא', 'עכשיו']);
  await page.click('.foldbtn'); await page.waitForTimeout(200);
  ok('phone: unfolded shows 7:30 first and no fold button', [(await times())[0], await page.locator('.foldbtn').count()], ['7:30', 0]);
  await page.click('.ttabs button:has-text("מנחה")'); await page.waitForTimeout(200);
  ok('phone: mincha tab shows mincha rows', [await page.locator('.ttabs button[aria-selected="true"]').textContent(), (await times()).length > 0], ['מנחה', true]);
  ok('next-three strip: the three after the 9:30 next one', await page.locator('.soon .time').allTextContents(), ['9:45', '10:00', '10:15']);
  await page.screenshot({ path: 'test/shot-phone.png', fullPage: false });
  await ctx.close();
  ({ ctx, page } = await open(1280, 23, 50));
  ok('tablet: tiles, no tabs', [await page.locator('.tile').count() > 10, await page.locator('.ttabs').count()], [true, 0]);
  ok('late night: the strip reaches into tomorrow', (await page.locator('.soon .sub').allTextContents()).some(t => /מחר/.test(t)), true);
  await ctx.close(); await browser.close();
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
  if (fails || errors.length) process.exit(1); else console.log('phone: all good');
})();
