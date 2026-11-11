/* The back end as a shortcut of its own. Saved from the back end ("Install", "Create shortcut", "Add to Home Screen"), a shortcut
   used to open the regular app, because both pages gave the browser the same install details. The back end now has its own: its
   own name and icon, and the address it starts at is the back end. The back end also says how to make the shortcut on the device
   at hand, and does it in one tap where the browser lets a page do that. Nothing here installs anything or writes to the website. */
const { chromium } = require('playwright');
const BASE = 'http://localhost:8790/';
const UA = { iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36',
  edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
  chrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36' };
(async () => {
  const browser = await chromium.launch(); const errors = []; let fails = 0;
  const ok = (name, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) console.log('ok   ' + name); else { fails++; console.log('FAIL ' + name + ' got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want)); } };
  const watch = page => { page.on('pageerror', e => errors.push('pageerror: ' + e.message)); page.on('console', m => { if (m.type() === 'error' && !/ERR_|Failed to load resource|favicon/.test(m.text())) errors.push(m.text()); }); return page; };
  async function open(opts) {
    const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1280, height: 900 }, locale: 'en-US', timezoneId: 'America/New_York', serviceWorkers: opts.sw ? 'allow' : 'block', userAgent: opts.ua || undefined });
    if (opts.init) await ctx.addInitScript(opts.init);
    const page = watch(await ctx.newPage());
    await page.goto(BASE + (opts.page || 'admin.html'), { waitUntil: 'networkidle' });
    if (opts.pin !== false && !opts.page) { await page.fill('#pin-input', '1234'); await page.press('#pin-input', 'Enter'); await page.waitForSelector('#tab-home'); await page.waitForTimeout(300); }
    return { ctx, page };
  }
  /* what a page tells the browser about installing it */
  const details = page => page.evaluate(async () => {
    const link = document.querySelector('link[rel="manifest"]'), url = new URL(link.getAttribute('href'), location.href), m = await (await fetch(url)).json(), abs = v => new URL(v, url).pathname;
    const sizes = await Promise.all(m.icons.map(i => new Promise(res => { const im = new Image(); im.onload = () => res([i.sizes, im.naturalWidth + 'x' + im.naturalHeight, i.purpose || 'any']); im.onerror = () => res([i.sizes, 'missing', i.purpose || 'any']); im.src = new URL(i.src, url).href; })));
    const touch = document.querySelector('link[rel="apple-touch-icon"]'), tsize = await new Promise(res => { const im = new Image(); im.onload = () => res(im.naturalWidth + 'x' + im.naturalHeight); im.onerror = () => res('missing'); im.src = touch.href; });
    return { file: url.pathname.split('/').pop(), name: m.name, short: m.short_name, start: abs(m.start_url), scope: abs(m.scope), id: m.id ? abs(m.id) : abs(m.start_url), display: m.display, sizes,
      theme: document.querySelector('meta[name="theme-color"]').content, mtheme: m.theme_color, appleTitle: document.querySelector('meta[name="apple-mobile-web-app-title"]').content, touch: touch.getAttribute('href'), tsize };
  });
  const dialog = async page => ({ title: await page.locator('#askbox h2').textContent(), text: (await page.locator('#askbox .ask-body').innerText()).replace(/\s+/g, ' ').trim(), steps: await page.locator('#askbox .guide li').count(),
    address: await page.locator('#askbox .copyrow code').allTextContents(), buttons: await page.locator('#askbox .dn-foot .btn').allTextContents() });

  /* ---- the two pages are two apps to the browser ---- */
  let { ctx, page } = await open({ pin: false });
  const adm = await details(page);
  ok('the back end gives the browser install details of its own: its own name, and the address it starts at is the back end', [adm.file, adm.name, adm.short, adm.start, adm.display], ['admin.webmanifest', 'Cascade Zmanim – Back end', 'Back end', '/admin.html', 'standalone']);
  ok('the address it starts at lies inside the part of the site that is its own, so the browser accepts it', [adm.scope, adm.start.indexOf(adm.scope) === 0], ['/admin', true]);
  ok('its icons are there, in the sizes it says, with one for round and squircle home screens', adm.sizes, [['192x192', '192x192', 'any'], ['512x512', '512x512', 'any'], ['512x512', '512x512', 'maskable']]);
  ok('an iPhone gets its name and its icon too, and the browser bar wears the back end\'s navy', [adm.appleTitle, adm.touch, adm.tsize, adm.theme, adm.mtheme], ['Back end', 'admin-touch-icon.png', '180x180', '#1f3a68', '#1f3a68']);
  /* the browser's own reading of it, where the browser will say */
  await ctx.close();
  /* the browser's own verdict, with its offline helper running as on the real site: can this page be installed as an app? */
  for (const pg of ['admin.html', 'index.html']) {
    const c2 = await browser.newContext({ serviceWorkers: 'allow' }), p2 = watch(await c2.newPage()); let verdict = null;
    await p2.goto(BASE + pg, { waitUntil: 'networkidle' }); await p2.waitForTimeout(1200);
    try { const cdp = await c2.newCDPSession(p2); const man = await cdp.send('Page.getAppManifest'); const inst = await cdp.send('Page.getInstallabilityErrors'); verdict = [man.url.split('/').pop(), (man.errors || []).length, (inst.installabilityErrors || []).map(e => e.errorId)]; } catch (e) { verdict = null; }
    if (verdict) ok('the browser itself reads ' + pg + '\'s details without a complaint and finds nothing against installing it', verdict, [pg === 'admin.html' ? 'admin.webmanifest' : 'manifest.webmanifest', 0, []]);
    else console.log('ok   (this browser will not say whether ' + pg + ' can be installed; skipped)');
    await c2.close();
  }
  ({ ctx, page } = await open({ page: 'index.html' }));
  const board = await details(page);
  ok('the board keeps its own details and still starts at the board', [board.file, board.short, board.start, board.scope, board.appleTitle, board.touch], ['manifest.webmanifest', 'Cascade Zmanim', '/index.html', '/', 'Cascade Zmanim', 'apple-touch-icon.png']);
  ok('the two are different apps to the browser: different identities, different names, different icons', [adm.id !== board.id, adm.short !== board.short, adm.touch !== board.touch], [true, true, true]);
  await ctx.close();

  /* ---- the back end says how, for the device at hand ---- */
  ({ ctx, page } = await open({ ua: UA.chrome }));
  ok('on a computer the side menu has "Shortcut on this device", and Home offers it too', [(await page.locator('#adm-shortcut').textContent()).trim(), await page.locator('#adm-shortcut').isVisible(), (await page.locator('#home-shortcut').textContent()).trim()], ['Shortcut on this device', true, 'Put the back end on this device']);
  await page.click('#adm-shortcut'); await page.waitForTimeout(200);
  let d = await dialog(page);
  ok('Chrome on a computer: the menu, "Install page as app", and the plain desktop way with the address to paste', [d.title, d.steps, /Cast, save and share/.test(d.text), /Install page as app/.test(d.text), /right-click the desktop/.test(d.text), d.address, d.buttons], ['The back end on this device', 3, true, true, true, ['http://localhost:8790/admin'], ['Close']]);
  await page.click('#adm-copy').catch(() => {}); await page.waitForTimeout(200);
  ok('the address can be copied, or is shown to copy by hand', /Address copied|localhost:8790\/admin/.test(await page.locator('#toast').textContent().catch(() => '')), true);
  await page.keyboard.press('Escape'); await page.waitForTimeout(150);
  ok('Escape closes it, and none of this counts as a change to save', [await page.locator('#askbox').count(), /Unsaved/.test(await page.locator('.abar .status').textContent())], [0, false]);
  await ctx.close();
  ({ ctx, page } = await open({ ua: UA.edge }));
  await page.click('#adm-shortcut'); await page.waitForTimeout(200); d = await dialog(page);
  ok('Edge on a computer: "Apps", then "Install this site as an app"', [/Apps/.test(d.text), /Install this site as an app/.test(d.text), /Cast, save and share/.test(d.text)], [true, true, false]);
  await ctx.close();

  /* where the browser lets a page do it: one tap */
  ({ ctx, page } = await open({ ua: UA.chrome }));
  await page.evaluate(() => { window.__asked = 0; const e = new Event('beforeinstallprompt'); e.prompt = () => { window.__asked++; }; e.userChoice = Promise.resolve({ outcome: 'accepted' }); window.dispatchEvent(e); });
  await page.click('#adm-shortcut'); await page.waitForTimeout(200); d = await dialog(page);
  ok('when the browser offers to install the page, the back end asks once, in a sentence, with the safe answer beside it', [d.steps, /icon of its own, named “Back end”/.test(d.text), d.buttons], [0, true, ['Not now', 'Add it']]);
  await page.click('#adm-install-go'); await page.waitForTimeout(200);
  ok('"Add it" hands over to the browser\'s own question, once', [await page.evaluate(() => window.__asked), await page.locator('#askbox').count()], [1, 0]);
  await page.click('#adm-shortcut'); await page.waitForTimeout(200); d = await dialog(page);
  ok('asked again afterwards, it falls back to the steps instead of a button that would do nothing', [d.steps > 0, d.buttons], [true, ['Close']]);
  await ctx.close();

  /* phones */
  for (const [name, ua, test] of [['an iPhone in Safari: Share, Add to Home Screen, Add', UA.iphone, x => [x.steps, /Share button/.test(x.text), /Add to Home Screen/.test(x.text), x.address.length]], ['an iPhone in another browser: open it in Safari, with the address to copy', UA.iphoneChrome, x => [x.steps, /from Safari/.test(x.text), /Add to Home Screen/.test(x.text), x.address.length]],
    ['an Android phone: the three dots, Add to Home screen or Install app', UA.android, x => [x.steps, /three dots/.test(x.text), /Add to Home screen/.test(x.text), x.address.length]]]) {
    ({ ctx, page } = await open({ ua, viewport: { width: 390, height: 844 } }));
    const fromHome = await page.locator('#home-shortcut').isVisible(), sideHidden = !(await page.locator('#adm-shortcut').isVisible());
    await page.locator('#home-shortcut').scrollIntoViewIfNeeded(); await page.click('#home-shortcut'); await page.waitForTimeout(250); d = await dialog(page);
    ok(name, [fromHome && sideHidden].concat(test(d)), [true].concat(/Safari:/.test(name) ? [3, true, true, 0] : /another browser/.test(name) ? [2, true, true, 1] : [3, true, true, 0]));
    ok('  it fits the phone: nothing off the side, the answer big enough for a thumb', await page.evaluate(() => { const s = document.querySelector('#askbox .dn-sheet').getBoundingClientRect(), b = document.querySelector('#askbox .dn-foot .btn').getBoundingClientRect(); return [s.left >= 0 && s.right <= window.innerWidth && s.bottom <= window.innerHeight + 1, b.height >= 44, document.documentElement.scrollWidth <= window.innerWidth]; }), [true, true, true]);
    if (/Safari:/.test(name)) await page.screenshot({ path: 'test/shot-adminapp-phone.png' });
    await ctx.close();
  }

  /* opened from its own shortcut */
  ({ ctx, page } = await open({ ua: UA.chrome, init: () => { const real = window.matchMedia.bind(window); window.matchMedia = q => /display-mode:\s*standalone/.test(q) ? { matches: true, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} } : real(q); } }));
  ok('opened from its own shortcut, Home no longer offers one', await page.locator('#home-shortcut').count(), 0);
  await page.click('#adm-shortcut'); await page.waitForTimeout(200); d = await dialog(page);
  ok('and the side menu\'s entry says that this is it', [/own shortcut/.test(d.text), d.steps, d.buttons], [true, 0, ['Close']]);
  await ctx.close();

  /* ---- and it works with no connection, as the board does ---- */
  ({ ctx, page } = await open({ sw: true, pin: false }));
  const kept = await page.evaluate(async () => { await navigator.serviceWorker.ready; for (let i = 0; i < 40; i++) { const keys = await caches.keys(); for (const k of keys) { const c = await caches.open(k); if (await c.match('./admin.webmanifest') && await c.match('./admin-192.png') && await c.match('./admin.html')) return true; } await new Promise(r => setTimeout(r, 250)); } return false; });
  ok('the offline copy keeps the back end\'s page, its install details and its icon', kept, true);
  await ctx.setOffline(true); await page.reload({ waitUntil: 'load' }).catch(() => {}); await page.waitForTimeout(800);
  ok('with no connection the shortcut still opens the back end, at its PIN', [await page.locator('#pin-input').count(), await page.evaluate(() => document.querySelector('link[rel="manifest"]').getAttribute('href')), await page.evaluate(() => fetch('admin.webmanifest').then(r => r.ok, () => false))], [1, 'admin.webmanifest', true]);
  await ctx.setOffline(false); await ctx.close();

  await browser.close();
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
  console.log(fails ? fails + ' FAILED' : 'all ok');
  process.exit(fails || errors.length ? 1 : 0);
})().catch(e => { console.log('ERROR', e.message); process.exit(1); });
