/* The short addresses, on a host that behaves the way GitHub Pages does: a page is also served at its name without ".html"
   (/admin answers with admin.html, at that same address), an address with no file gets 404.html, and every file may be kept by the
   browser for ten minutes. /admin must open the back end — not the board — fresh, with the app installed, and without a connection.
   Served by its own small server from docs/ (or DIR=…, to see the test catch the fault in an older build). */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
(async () => {
  const site = path.resolve(process.env.DIR || path.join(__dirname, '..', 'docs'));
  let up = true;
  const server = http.createServer((req, res) => {
    if (!up) { req.socket.destroy(); return; } /* the connection is gone */
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
    let file = path.join(site, p), status = 200;
    if (!file.startsWith(site)) { res.writeHead(403); return res.end(); }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      if (!path.extname(p) && fs.existsSync(file + '.html')) file += '.html'; /* the page at its short address */
      else { file = path.join(site, '404.html'); status = 404; }
    }
    if (!fs.existsSync(file)) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('not found'); }
    res.writeHead(status, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'max-age=600' });
    res.end(fs.readFileSync(file));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch(); const errors = []; let fails = 0;
  const ok = (name, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) console.log('ok   ' + name); else { fails++; console.log('FAIL ' + name + ' got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want)); } };
  async function open(viewport, sw) {
    const ctx = await browser.newContext({ viewport, locale: 'he', timezoneId: 'America/New_York', serviceWorkers: sw ? 'allow' : 'block' });
    const page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/ERR_|Failed to load resource|404/.test(m.text())) errors.push(m.text()); });
    return { ctx, page };
  }
  const where = page => new URL(page.url()).pathname + new URL(page.url()).search;
  const pinShown = page => page.locator('#pin-input').isVisible().catch(() => false);

  /* a browser that has never seen the site */
  let { ctx, page } = await open({ width: 1200, height: 850 });
  await page.goto(base + '/admin', { waitUntil: 'networkidle' }); await page.waitForTimeout(500);
  ok('/admin opens the back end: it asks for the PIN, at that address', [await pinShown(page), where(page)], [true, '/admin']);
  if (await pinShown(page)) { await page.fill('#pin-input', '1234'); await page.press('#pin-input', 'Enter'); await page.waitForTimeout(600); }
  ok('the PIN lets you in: the tabs of the back end are there', [await page.locator('#tab-notices').isVisible().catch(() => false), await page.locator('#tab-schedule').isVisible().catch(() => false)], [true, true]);
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(500);
  ok('reloading /admin stays in the back end', [where(page), await page.locator('#tab-notices').isVisible().catch(() => false) || await pinShown(page)], ['/admin', true]);
  await page.goto(base + '/admin.html', { waitUntil: 'networkidle' }); await page.waitForTimeout(400);
  ok('/admin.html opens the back end too', await page.locator('#tab-notices').isVisible().catch(() => false) || await pinShown(page), true);
  await page.goto(base + '/admin/', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(900);
  ok('/admin/ (with a slash) is sent on to the back end', [where(page), await page.locator('#tab-notices').isVisible().catch(() => false) || await pinShown(page)], ['/admin.html', true]);
  await page.goto(base + '/', { waitUntil: 'networkidle' }); await page.waitForTimeout(400);
  ok('the board itself is still the board: no PIN, no back end', [await pinShown(page), await page.locator('#tab-notices').count(), await page.locator('section.next').count() >= 1], [false, 0, true]);
  await page.goto(base + '/screen', { waitUntil: 'networkidle' }); await page.waitForTimeout(700);
  ok('/screen opens the hallway screen', [where(page), await page.locator('.aclock svg').count(), await page.locator('main.wall').count()], ['/index.html?view=display&full=1', 1, 1]);
  await page.goto(base + '/tv', { waitUntil: 'networkidle' }); await page.waitForTimeout(700);
  ok('/tv opens the preview, with the screen inside it', [where(page), await page.frameLocator('#tv').locator('.aclock svg').count()], ['/tv', 1]);
  await page.goto(base + '/nowhere', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(500);
  ok('an address that is nothing says so plainly and offers the ways on', [await page.locator('#m').textContent(), await page.locator('a[href="admin.html"]').count()], ['That page is not here.', 1]);
  await ctx.close();

  /* a phone */
  ({ ctx, page } = await open({ width: 390, height: 780 }));
  await page.goto(base + '/admin', { waitUntil: 'networkidle' }); await page.waitForTimeout(500);
  ok('on a phone /admin asks for the PIN, with the box in view', [await pinShown(page), await page.evaluate(() => { const e = document.getElementById('pin-input'); if (!e) return false; const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth && r.top >= 0 && r.bottom <= window.innerHeight; })], [true, true]);
  await ctx.close();

  /* with the app installed: the saved pages answer first */
  ({ ctx, page } = await open({ width: 1200, height: 850 }, true));
  await page.goto(base + '/', { waitUntil: 'networkidle' });
  await page.evaluate(() => navigator.serviceWorker.ready); await page.waitForTimeout(900);
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(400);
  ok('the app is installed', await page.evaluate(() => !!navigator.serviceWorker.controller), true);
  await page.goto(base + '/admin', { waitUntil: 'networkidle' }); await page.waitForTimeout(600);
  ok('with the app installed /admin still opens the back end', [await pinShown(page), where(page)], [true, '/admin']);
  await page.goto(base + '/', { waitUntil: 'networkidle' }); await page.waitForTimeout(400);
  ok('and the board is still the board', [await pinShown(page), await page.locator('section.next').count() >= 1], [false, true]);
  /* the connection goes */
  up = false; server.closeAllConnections && server.closeAllConnections();
  await page.goto(base + '/admin', { waitUntil: 'load' }).catch(() => {}); await page.waitForTimeout(900);
  ok('without a connection /admin opens from the phone\'s own copy', await pinShown(page), true);
  await page.goto(base + '/', { waitUntil: 'load' }).catch(() => {}); await page.waitForTimeout(900);
  ok('and so does the board', [await pinShown(page), await page.locator('section.next').count() >= 1], [false, true]);
  await ctx.close(); await browser.close(); server.close();
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
  console.log(fails ? fails + ' FAILING' : 'shortlinks: all good');
  if (fails || errors.length) process.exit(1);
})().catch(e => { console.log('ERROR', e); process.exit(1); });
