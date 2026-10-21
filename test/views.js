const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'he', timezoneId: 'America/New_York', serviceWorkers: 'block' });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('pageerror: ' + e.message)); page.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text()); });
  // lobby screen
  await page.goto('http://localhost:8790/index.html?view=display', { waitUntil: 'networkidle' }); await page.waitForTimeout(400);
  console.log('display class:', await page.getAttribute('#app', 'class'), '| footer:', await page.locator('footer').count(), '| tiles visible:', await page.locator('.tile:visible').count(), '| side panels:', await page.locator('.side').count());
  await page.screenshot({ path: 'test/shot-display.png' });
  // door display
  await page.goto('http://localhost:8790/index.html?room=' + encodeURIComponent('ברך משה'), { waitUntil: 'networkidle' }); await page.waitForTimeout(400);
  const rooms = await page.locator('.tile .room').allTextContents();
  console.log('room view header:', await page.locator('.top .shul').textContent(), '| rooms shown:', [...new Set(rooms)], '| next:', (await page.locator('.next .what').textContent().catch(() => '')));
  // hash form for the claude.ai page: #room1
  await page.goto('http://localhost:8790/index.html#room2', { waitUntil: 'networkidle' }); await page.waitForTimeout(400);
  console.log('#room2 ->', [...new Set(await page.locator('.tile .room').allTextContents())]);
  // weekly sheet
  await page.goto('http://localhost:8790/index.html?view=week', { waitUntil: 'networkidle' }); await page.waitForTimeout(400);
  console.log('week blocks:', await page.locator('.week-block').count(), '| days:', await page.locator('.wday').count(), '| first h2:', await page.locator('.week-block h2').first().textContent());
  console.log('friday line:', (await page.locator('.wday').nth(5).textContent()).replace(/\s+/g, ' ').slice(0, 160));
  await page.screenshot({ path: 'test/shot-week.png', fullPage: true });
  // zmanim extras on a fast day (Asara B'Teves 5787) and during Sefirah, by freezing the clock
  for (const [label, y, m, d, h] of [['asara bteves', 2026, 12, 20, 10], ['omer day (2027-04-25)', 2027, 4, 25, 10], ['omer night', 2027, 4, 25, 21], ['shabbos', 2026, 10, 24, 12]]) {
    const c2 = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'he', timezoneId: 'America/New_York', serviceWorkers: 'block' });
    const fixed = Date.UTC(y, m - 1, d, h + 4, 0);
    await c2.addInitScript(({ fixed }) => { const real = Date.now; const start = real(); Date.now = () => fixed + (real() - start); }, { fixed });
    const p2 = await c2.newPage(); await p2.goto('http://localhost:8790/index.html', { waitUntil: 'networkidle' }); await p2.waitForTimeout(300);
    console.log(label + ':', (await p2.locator('.zlist li.hi').allTextContents()).join(' | '));
    await c2.close();
  }
  await ctx.close(); await browser.close();
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
})();
