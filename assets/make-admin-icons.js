/* The back end's icons, from assets/icon-admin.html: admin-512.png and admin-192.png (rounded), admin-maskable-512.png (full square,
   the drawing inside the safe middle) and admin-touch-icon.png (180, full square, for an iPhone's home screen). Run: node assets/make-admin-icons.js */
const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
  const out = path.resolve(__dirname, '..', 'docs'), file = 'file://' + path.resolve(__dirname, 'icon-admin.html');
  async function shot(name, size, cls, transparent) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.goto(file); await page.waitForTimeout(200);
    await page.evaluate(({ size, cls }) => { document.documentElement.style.zoom = String(size / 512); if (cls === 'round') document.getElementById('bg').classList.add('round'); if (cls === 'maskable') document.body.classList.add('maskable'); }, { size, cls });
    await page.screenshot({ path: path.join(out, name), omitBackground: !!transparent, clip: { x: 0, y: 0, width: size, height: size } });
    await page.close();
  }
  await shot('admin-512.png', 512, 'round', true);
  await shot('admin-192.png', 192, 'round', true);
  await shot('admin-maskable-512.png', 512, 'maskable', false);
  await shot('admin-touch-icon.png', 180, '', false);
  await browser.close(); console.log('back end icons written to docs/');
})().catch(e => { console.log('ERROR', e.message); process.exit(1); });
