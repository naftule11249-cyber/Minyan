const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
  const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
  const file = 'file://' + path.resolve(__dirname, 'icon.html');
  const out = path.resolve(__dirname, '..', 'docs');
  await page.goto(file); await page.waitForTimeout(300);
  await page.evaluate(() => { document.getElementById('bg').classList.add('round'); });
  await page.screenshot({ path: path.join(out, 'icon-512.png'), omitBackground: true });
  await page.evaluate(() => { document.getElementById('bg').classList.remove('round'); document.body.classList.add('maskable'); });
  await page.screenshot({ path: path.join(out, 'icon-maskable-512.png') });
  await browser.close();
})();
