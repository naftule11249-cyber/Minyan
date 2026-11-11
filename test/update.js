/* A new version reaches a phone that already has the app: the host lets a browser keep each file for ten minutes (Cache-Control: max-age=600,
   as GitHub Pages sends), a new version is published inside those ten minutes, and the page that looks for it must end up running the new
   code — not the browser's own copy of the old files stored under the new version's name. Served by its own small server, from a copy of docs/. */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
(async () => {
  const site = fs.mkdtempSync(path.join(os.tmpdir(), 'minyan-update-'));
  fs.cpSync(path.join(__dirname, '..', 'docs'), site, { recursive: true });
  if (process.env.OLD_SW) fs.copyFileSync(process.env.OLD_SW, path.join(site, 'sw.js')); /* to see the test catch the fault: run it with the worker as it used to be */
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
    const file = path.join(site, p);
    if (!file.startsWith(site) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'max-age=600' });
    res.end(fs.readFileSync(file));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch(); const errors = []; let fails = 0;
  const ok = (name, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) console.log('ok   ' + name); else { fails++; console.log('FAIL ' + name + ' got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want)); } };
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 800 }, locale: 'he', timezoneId: 'America/New_York', serviceWorkers: 'allow' });
  const page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto(base + '/index.html', { waitUntil: 'networkidle' });
  await page.evaluate(() => navigator.serviceWorker.ready); await page.waitForTimeout(800);
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(500);
  ok('the app is installed: the worker controls the page, which runs the first version', await page.evaluate(() => [!!navigator.serviceWorker.controller, window.__v2 === true]), [true, false]);
  /* a new version is published, minutes after the phone last fetched the old files */
  fs.appendFileSync(path.join(site, 'app.js'), '\n;window.__v2 = true;\n');
  fs.writeFileSync(path.join(site, 'sw.js'), fs.readFileSync(path.join(site, 'sw.js'), 'utf8').replace(/minyan-shell-[a-z0-9]+/, 'minyan-shell-second'));
  const reloaded = page.waitForEvent('load', { timeout: 25000 }).then(() => true, () => false);
  await page.evaluate(() => navigator.serviceWorker.getRegistration().then(r => r.update()));
  ok('the page finds the new version and reloads by itself', await reloaded, true);
  await page.waitForLoadState('networkidle'); await page.waitForTimeout(800);
  ok('and it runs the new code, not the browser\'s ten-minute copy of the old files', await page.evaluate(() => window.__v2 === true), true);
  ok('the new version keeps only its own files', await page.evaluate(() => caches.keys().then(k => k.filter(x => x.indexOf('minyan-shell-') === 0))), ['minyan-shell-second']);
  /* a phone that opens the app later gets the new code at once, from its own cache */
  const page2 = await ctx.newPage(); await page2.goto(base + '/index.html', { waitUntil: 'networkidle' }); await page2.waitForTimeout(400);
  ok('a later opening starts on the new code', await page2.evaluate(() => window.__v2 === true), true);
  await ctx.close(); await browser.close(); server.close(); fs.rmSync(site, { recursive: true, force: true });
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
  console.log(fails ? fails + ' FAILING' : 'update: all good');
  if (fails) process.exit(1);
})().catch(e => { console.log('ERROR', e); process.exit(1); });
