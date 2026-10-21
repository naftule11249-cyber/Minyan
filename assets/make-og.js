// Renders docs/og-image.png (1200x630), the picture shown when the site link is shared.
// Uses assets/logo.png|jpg|svg when present, otherwise the app icon. Text comes from config.default.json.
const { chromium } = require('playwright'); const path = require('path'); const fs = require('fs');
const root = path.resolve(__dirname, '..'); const cfg = JSON.parse(fs.readFileSync(path.join(root, 'config.default.json'), 'utf8'));
const logo = ['logo.png', 'logo.jpg', 'logo.jpeg', 'logo.svg', 'logo.webp'].map(f => path.join(__dirname, f)).find(fs.existsSync);
const src = logo || path.join(root, 'docs', 'icon-512.png');
const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp' }[path.extname(src).toLowerCase()];
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.goto('file://' + path.join(__dirname, 'og.html'));
  await page.evaluate(({ data, name, url, isIcon }) => {
    document.getElementById('logo').src = data; document.getElementById('name').textContent = name; document.getElementById('url').textContent = url;
    if (isIcon) document.getElementById('plate').classList.add('icon');
  }, { data: 'data:' + mime + ';base64,' + fs.readFileSync(src).toString('base64'), name: cfg.name || 'לוח המנינים', url: (cfg.siteUrl || '').replace(/^https?:\/\//, '').replace(/\/$/, ''), isIcon: !logo });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(root, 'docs', 'og-image.png') });
  await browser.close();
  console.log('og-image.png from ' + path.basename(src));
})();
