/* The install guide in the Settings sheet shows the steps for the device at hand. */
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch(); const errors = []; let fails = 0;
  const ok = (name, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) console.log('ok   ' + name); else { fails++; console.log('FAIL ' + name + ' got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want)); } };
  async function guide(ua) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'he', timezoneId: 'America/New_York', serviceWorkers: 'block', userAgent: ua || undefined });
    const page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message));
    page.on('console', x => { if (x.type() === 'error' && !/ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|ERR_INTERNET|ERR_CONNECTION/.test(x.text())) errors.push(x.text()); });
    await page.goto('http://localhost:8790/index.html', { waitUntil: 'networkidle' }); await page.waitForTimeout(300);
    await page.click('#install-guide'); await page.waitForTimeout(300);
    const r = { title: await page.locator('#sset-app h3').textContent(), lead: await page.locator('#sset-app > .hint').first().textContent().catch(() => ''), steps: await page.locator('#sset-app .guide li').allTextContents(), copy: await page.locator('#sset-app .copyrow').count(), visible: await page.locator('#sset-app').isVisible() };
    await ctx.close(); return r;
  }
  let r = await guide('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1');
  ok('iPhone Safari: share, add to home screen, open from the icon', [r.title, r.steps.length, /Share/.test(r.steps[0]), /Add to Home Screen/.test(r.steps[1]), r.copy, r.visible], ['Install as an app', 3, true, true, 0, true]);
  r = await guide('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1');
  ok('iPhone Chrome: open in Safari first, with the address to copy', [/only Safari/.test(r.lead), r.copy, r.steps.length], [true, 1, 2]);
  r = await guide('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36');
  ok('Android Chrome: the menu, add to home screen, install', [/Android/.test(r.lead), /⋮/.test(r.steps[0]), /Install/.test(r.steps[2])], [true, true, true]);
  r = await guide(null);
  ok('computer: the install icon in the address bar', [/computer/.test(r.lead), /address bar/.test(r.steps[0]), /Install Cascade Zmanim/.test(r.steps[1])], [true, true, true]);
  await browser.close();
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
  console.log(fails ? fails + ' FAILING' : 'install: all good');
  if (fails) process.exit(1);
})().catch(e => { console.log('ERROR', e); process.exit(1); });
