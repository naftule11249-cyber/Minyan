// Generates store screenshots (iPhone 6.7" and Android phone) and the Play feature graphic from the built site in docs/.
const { chromium } = require('playwright'); const path = require('path'); const fs = require('fs'); const http = require('http');
const out = path.resolve(__dirname, '..', 'app', 'store'); fs.mkdirSync(out, { recursive: true });
const FIXED = Date.UTC(2026, 9, 20, 14, 59, 0); // 10:59 AM New York on the sample day
async function serve() {
  const docs = path.resolve(__dirname, '..', 'docs');
  return new Promise(res => {
    const srv = http.createServer((req, rq) => {
      const f = path.join(docs, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
      fs.readFile(f, (e, data) => { if (e) { rq.writeHead(404); rq.end(); return; }
        const t = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' }[path.extname(f)] || 'application/octet-stream';
        rq.writeHead(200, { 'content-type': t }); rq.end(data); });
    }).listen(0, () => res(srv));
  });
}
(async () => {
  const srv = await serve(); const base = 'http://127.0.0.1:' + srv.address().port + '/index.html';
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
  async function shots(prefix, vp, dsf) {
    let n = 0;
    for (const scheme of ['light', 'dark']) {
      const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: dsf, colorScheme: scheme, locale: 'he', timezoneId: 'America/New_York', serviceWorkers: 'block' });
      await ctx.addInitScript(({ fixed }) => { const real = Date.now; const start = real(); Date.now = () => fixed + (real() - start); }, { fixed: FIXED });
      const page = await ctx.newPage();
      await page.goto(base, { waitUntil: 'networkidle' }); await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(out, `${prefix}-${++n}-${scheme}-next.png`) });
      if (scheme === 'light') {
        await page.evaluate(() => document.querySelectorAll('section.tefilla')[1].scrollIntoView({ block: 'start' })); await page.waitForTimeout(200);
        await page.screenshot({ path: path.join(out, `${prefix}-${++n}-${scheme}-mincha.png`) });
        await page.evaluate(() => document.querySelector('.side').scrollIntoView({ block: 'start' })); await page.waitForTimeout(200);
        await page.screenshot({ path: path.join(out, `${prefix}-${++n}-${scheme}-zmanim.png`) });
      }
      await ctx.close();
    }
  }
  await shots('ios-6.7', { width: 430, height: 932 }, 3);
  await shots('android-phone', { width: 360, height: 780 }, 3);
  // feature graphic 1024x500
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 500 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const icon = fs.readFileSync(path.resolve(__dirname, '..', 'docs', 'icon-512.png')).toString('base64');
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;width:1024px;height:500px;background:linear-gradient(135deg,#2d4b82,#1a2f55);font-family:'DejaVu Sans',sans-serif;color:#f6f1e7;overflow:hidden}
    .ic{position:absolute;left:70px;top:90px;width:320px;height:320px}
    .t{position:absolute;left:440px;top:120px;right:60px}
    .he{font-size:72px;font-weight:700;direction:rtl;text-align:left;line-height:1.1}
    .en{font-size:40px;font-weight:700;margin-top:10px;opacity:.95}
    .tag{font-size:26px;margin-top:22px;opacity:.85}
    .tile{position:absolute;right:60px;bottom:34px;background:#7a1d2a;color:#fff3e3;border-radius:14px;padding:10px 22px;font-size:22px;font-weight:700}
    </style></head><body><img class="ic" src="data:image/png;base64,${icon}"><div class="t"><div class="he" style="direction:ltr">Cascade Zmanim</div><div class="en">The next minyan, live</div><div class="tag">Every room · today's zmanim · reminders</div></div><div class="tile">מנין הבא · 11:00</div></body></html>`);
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(out, 'android-feature-graphic.png') });
  await ctx.close(); await browser.close(); srv.close();
  for (const f of fs.readdirSync(out).filter(f => f.endsWith('.png'))) { const b = fs.readFileSync(path.join(out, f)); console.log(f, b.readUInt32BE(16) + 'x' + b.readUInt32BE(20)); }
})();
