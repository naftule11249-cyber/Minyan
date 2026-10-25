const { chromium } = require('playwright'); const fs = require('fs');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 400, height: 860 }, locale: 'he', timezoneId: 'America/New_York' });
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|ERR_INTERNET|ERR_CONNECTION/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.goto('http://localhost:8790/index.html', { waitUntil: 'networkidle' });
  const swState = await page.evaluate(async () => { const r = await navigator.serviceWorker.ready; await new Promise(r => setTimeout(r, 800)); return { scope: r.scope, caches: await caches.keys() }; });
  console.log('sw:', JSON.stringify(swState));
  const manifest = await page.evaluate(async () => (await (await fetch('manifest.webmanifest')).json()).short_name);
  console.log('manifest short_name:', manifest);
  // remote schedule precedence: a newer config.json must win over the embedded one
  const orig = fs.readFileSync('docs/config.json', 'utf8'); const c = JSON.parse(orig); c.name = 'בדיקה מרחוק'; c.savedAt = 1; c.smsNumber = '+1 718 555 0100';
  fs.writeFileSync('docs/config.json', JSON.stringify(c));
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(700);
  console.log('shul after remote change:', await page.textContent('.top .shul'), '| sms panel:', await page.textContent('.sms-num').catch(() => 'missing'), '| sms link:', await page.getAttribute('.side a.btn', 'href').catch(() => 'missing'));
  fs.writeFileSync('docs/config.json', orig);
  // offline: shell served from cache
  await ctx.setOffline(true);
  await page.reload({ waitUntil: 'load' }).catch(e => console.log('offline reload failed:', e.message.slice(0, 80)));
  await page.waitForTimeout(700);
  console.log('offline dayline:', await page.textContent('.dayline').catch(() => 'n/a'), '| tiles', await page.locator('.tile').count());
  await ctx.setOffline(false);
  // publish tab present in self-hosted mode
  await page.goto('http://localhost:8790/admin.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('#pin-input'); await page.fill('#pin-input', '1234'); await page.press('#pin-input', 'Enter');
  await page.waitForSelector('#tab-publish'); await page.click('#tab-publish');
  await page.click('button:has-text("Test connection")'); await page.waitForTimeout(200);
  console.log('publish tab msg:', await page.textContent('#gh-repo ~ *').catch(() => ''), '|', await page.evaluate(() => document.querySelector('.panel .hint:last-of-type') && '' ) , (await page.textContent('.bar .hint')));
  await page.screenshot({ path: 'test/shot-publish.png' });
  await ctx.close(); await browser.close();
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
})();
