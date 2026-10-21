const { chromium } = require('playwright'); const path = require('path');
const fs = require('fs');
const logo = ['logo.png', 'logo.jpg', 'logo.jpeg', 'logo.svg', 'logo.webp'].map(f => path.join(__dirname, f)).find(fs.existsSync);
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
  const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
  const out = path.resolve(__dirname, '..', 'docs');
  if (logo) {
    // the shul's own logo on a white plate: rounded for the regular icon, extra margin for the maskable one
    const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp' }[path.extname(logo).toLowerCase()];
    const data = 'data:' + mime + ';base64,' + fs.readFileSync(logo).toString('base64');
    await page.setContent('<!doctype html><html><head><style>html,body{margin:0;width:512px;height:512px;background:transparent;overflow:hidden}#bg{position:absolute;inset:0;background:#ffffff}#bg.round{border-radius:110px}#l{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:34px;box-sizing:border-box}#l.mask{padding:86px}#l img{max-width:100%;max-height:100%;object-fit:contain}</style></head><body><div id="bg" class="round"></div><div id="l"><img src="' + data + '"></div></body></html>');
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(out, 'icon-512.png'), omitBackground: true });
    await page.evaluate(() => { document.getElementById('bg').classList.remove('round'); document.getElementById('l').classList.add('mask'); });
    await page.screenshot({ path: path.join(out, 'icon-maskable-512.png') });
    await browser.close();
    console.log('icons from ' + path.basename(logo));
    return;
  }
  const file = 'file://' + path.resolve(__dirname, 'icon.html');
  await page.goto(file); await page.waitForTimeout(300);
  await page.evaluate(() => { document.getElementById('bg').classList.add('round'); });
  await page.screenshot({ path: path.join(out, 'icon-512.png'), omitBackground: true });
  await page.evaluate(() => { document.getElementById('bg').classList.remove('round'); document.body.classList.add('maskable'); });
  await page.screenshot({ path: path.join(out, 'icon-maskable-512.png') });
  await browser.close();
})();
