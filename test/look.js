/* Looks: the gabbai's default, a per-phone choice in the footer, and the lobby screen ignoring that choice. */
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
  const errors = []; let fails = 0;
  const ok = (name, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) console.log('ok   ' + name); else { fails++; console.log('FAIL ' + name + ' got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want)); } };
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'he', timezoneId: 'America/New_York', serviceWorkers: 'block' });
  const page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|ERR_INTERNET|ERR_CONNECTION/.test(m.text())) errors.push(m.text()); });
  const look = () => page.evaluate(() => [document.documentElement.getAttribute('data-palette'), document.querySelector('meta[name=theme-color]').getAttribute('content'), getComputedStyle(document.documentElement).getPropertyValue('--band').trim()]);
  await page.goto('http://localhost:8790/index.html', { waitUntil: 'networkidle' }); await page.waitForTimeout(400);
  ok('default look is the shul palette', await look(), ['shul', '#3a332c', '#3a332c']);
  await page.click('#settings-open'); await page.waitForTimeout(200);
  ok('settings sheet shows it', await page.locator('#look').inputValue(), 'shul');
  await page.selectOption('#look', 'classic'); await page.waitForTimeout(200);
  ok('classic: no palette attribute, navy band', await look(), [null, '#223b68', '#223b68']);
  await page.selectOption('#look', 'contrast'); await page.waitForTimeout(200);
  ok('high contrast: black band, bigger type', [(await look())[0], await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)], ['contrast', '18.4px']);
  ok('the choice is remembered on the device', await page.evaluate(() => localStorage.getItem('minyan-look')), 'contrast');
  await page.goto('http://localhost:8790/index.html?view=display', { waitUntil: 'networkidle' }); await page.waitForTimeout(400); /* a full load, as a TV would */
  ok('the lobby screen keeps the gabbai\'s default', (await look())[0], 'shul');
  await page.goto('http://localhost:8790/index.html', { waitUntil: 'networkidle' }); await page.waitForTimeout(300);
  ok('back on the board the device choice holds', (await look())[0], 'contrast');
  await page.click('#settings-open'); await page.waitForTimeout(200);
  await page.selectOption('#look', 'shul'); await page.waitForTimeout(200);
  ok('choosing the default clears the override', await page.evaluate(() => localStorage.getItem('minyan-look')), null);
  await page.screenshot({ path: 'test/shot-look-shul.png', fullPage: false });
  await ctx.close(); await browser.close();
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
  if (fails || errors.length) process.exit(1); else console.log('look: all good');
})();
