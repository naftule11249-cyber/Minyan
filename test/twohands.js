/* Two hands on the settings. A publish from a page whose settings grew from an older published version must not quietly undo what
   another phone (or another open page) published in between: it stops, says what would change, and asks. An open back end with
   nothing unsaved follows the website by itself. The "website" here is one settings file answering both the site's own address and
   GitHub's, so nothing real is written. Clock frozen Wed 18 Nov 2026, 9:10 AM New York. */
const { chromium } = require('playwright');
const BASE = 'http://localhost:8790/', FIXED = Date.UTC(2026, 10, 18, 14, 10);
(async () => {
  const browser = await chromium.launch(); const errors = []; let fails = 0;
  const ok = (name, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) console.log('ok   ' + name); else { fails++; console.log('FAIL ' + name + ' got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want)); } };
  let site = null; const puts = [];
  const b64 = s => Buffer.from(s, 'utf8').toString('base64');
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-US', timezoneId: 'America/New_York', serviceWorkers: 'block' });
  await ctx.addInitScript(({ fixed }) => {
    const real = Date.now; const start = real(); Date.now = () => fixed + (real() - start);
    try { localStorage.setItem('minyan-github', JSON.stringify({ repo: 'shul/board', token: 'not-a-real-token', branch: 'main', path: 'docs/config.json' })); } catch (e) {}
  }, { fixed: FIXED });
  await ctx.route('**/config.json*', async route => {
    if (!site) { const res = await route.fetch(); site = JSON.parse(await res.text()); site.notices = []; site.banner = { text: '', from: '', until: '' }; delete site.donationKinds; site.savedAt = FIXED - 3600e3; }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(site) });
  });
  await ctx.route('https://api.github.com/**', async route => { /* GitHub's side of a publish: read what is there, then write */
    const req = route.request();
    if (req.method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sha: 'sha' + puts.length, content: b64(JSON.stringify(site, null, 1)).replace(/(.{60})/g, '$1\n') }) });
    if (req.method() === 'PUT') { const c = JSON.parse(Buffer.from(JSON.parse(req.postData()).content, 'base64').toString('utf8')); puts.push(c); site = c; return route.fulfill({ status: 200, contentType: 'application/json', body: '{"content":{}}' }); }
    return route.fulfill({ status: 405, contentType: 'application/json', body: '{}' });
  });
  const page = await ctx.newPage(); page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_|Failed to load resource|favicon/.test(m.text())) errors.push(m.text()); });
  /* another phone publishes: the website's file changes under this page */
  const elsewhere = (change, at) => { site = Object.assign(JSON.parse(JSON.stringify(site)), change, { savedAt: at }); };
  const banner = async text => { await page.click('#tab-notices'); await page.fill('#banner-text', text); };
  const save = async () => { await page.click('.abar .btn.primary'); await page.waitForTimeout(900); };
  const publish = async () => { await page.click('.pubbar .btn.gold'); await page.waitForTimeout(900); };
  const asked = () => page.locator('#askbox').count();
  const wake = async () => { await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await page.waitForTimeout(900); }; /* the page looks at the website again, as it does every few minutes and whenever it comes back into view */

  await page.goto(BASE + 'admin.html', { waitUntil: 'networkidle' }); await page.waitForTimeout(500);
  ok('the website holding newer settings than the page was built with does not let anyone past the PIN box', [await page.locator('#pin-input').count(), await page.locator('#tab-home').count()], [1, 0]);
  elsewhere({}, FIXED - 3000e3); await wake();
  ok('nor do newer settings arriving while the PIN box is showing', [await page.locator('#pin-input').count(), await page.locator('#tab-home').count(), await page.locator('.abar').count()], [1, 0, 0]);
  await page.fill('#pin-input', '1234'); await page.press('#pin-input', 'Enter'); await page.waitForSelector('#tab-home'); await page.waitForTimeout(400);

  /* the ordinary way: nobody else, no questions */
  await banner('מעריב היום בשעה 6:00'); await save();
  ok('a change saved here waits to be published', [/1 change/.test(await page.locator('.pubbar').textContent()), puts.length], [true, 0]);
  await publish();
  ok('with nobody else at the settings, Publish simply publishes', [await asked(), puts.length, puts[0] && puts[0].banner.text, /Published/.test(await page.locator('#toast').textContent().catch(() => ''))], [0, 1, 'מעריב היום בשעה 6:00', true]);
  await banner('מעריב היום בשעה 6:15'); await save(); await publish();
  ok('and again, straight after: this page\'s own publish is not taken for someone else\'s', [await asked(), puts.length, puts[1] && puts[1].banner.text], [0, 2, 'מעריב היום בשעה 6:15']);

  /* another phone publishes while this page has a change of its own saved */
  await banner('מנחה גדולה 1:00'); await save();
  elsewhere({ notices: [{ title: 'פרנס היום', name: 'ר׳ משה ווייס', body: 'לרגל היארצייט', size: 'tiny', from: '2026-11-18', to: '2026-11-18' }] }, FIXED + 600e3); /* the other phone's clock runs ten minutes ahead of this one, to make it harder */
  await publish();
  ok('when the website has moved on, Publish stops and asks; nothing is written', [await asked(), puts.length, await page.locator('#askbox h2').textContent()], [1, 2, 'The website has newer settings']);
  const lines = await page.locator('#askbox .ask-list li').allTextContents();
  ok('it says what publishing from here would change, the other phone\'s work included', [lines.some(l => /^Donation removed: ר׳ משה ווייס/.test(l)), lines.some(l => /anner/.test(l)), await page.locator('#askbox .dn-foot .btn').allTextContents()], [true, true, ['Cancel', 'Publish mine anyway', 'Take the newer settings']]);
  ok('the safe answer is the one under the finger', await page.evaluate(() => document.activeElement.id), 'ask-theirs');
  await page.screenshot({ path: 'test/shot-newer.png' });
  await page.click('#ask-cancel'); await page.waitForTimeout(200);
  ok('Cancel leaves everything as it was: nothing published, the change still waiting here', [await asked(), puts.length, /1 change|2 changes/.test(await page.locator('.pubbar').textContent())], [0, 2, true]);
  await publish(); await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  ok('Escape is Cancel', [await asked(), puts.length], [0, 2]);
  await publish(); await page.click('#ask-theirs'); await page.waitForTimeout(700);
  ok('"Take the newer settings" loads what the website has, here in the back end, and publishes nothing', [await asked(), puts.length, await page.inputValue('#banner-text'), /newer settings are loaded/.test(await page.locator('#toast').textContent().catch(() => ''))], [0, 2, 'מעריב היום בשעה 6:15', true]);
  await page.click('#tab-donations'); await page.waitForTimeout(200);
  ok('the other phone\'s donation is here now', await page.locator('.dn-card .dn-name').allTextContents(), ['ר׳ משה ווייס']);
  ok('what had been saved on this device is not thrown away: it is the first of the previous versions', await page.evaluate(() => { const h = JSON.parse(localStorage.getItem('minyan-history') || '[]'); return h.length ? h[0].cfg.banner.text : null; }), 'מנחה גדולה 1:00');
  await banner('מנחה גדולה 1:00'); await save(); await publish();
  ok('made again on top of the newer settings, the change publishes without a question and keeps the other phone\'s work', [await asked(), puts.length, puts[2] && puts[2].banner.text, puts[2] && puts[2].notices.map(n => n.name)], [0, 3, 'מנחה גדולה 1:00', ['ר׳ משה ווייס']]);
  ok('and it is stamped later than the settings it was made on, though this device\'s clock is ten minutes behind the other\'s: every board will take it', puts[2] && puts[2].savedAt > FIXED + 600e3, true);

  /* an open back end with nothing unsaved follows the website by itself */
  elsewhere({ banner: { text: 'קידוש אחר התפילה', from: '', until: '' } }, FIXED + 1200e3);
  await page.click('#tab-notices'); await wake();
  ok('newer settings arriving while the back end is open and untouched are simply loaded, on the same page', [await page.inputValue('#banner-text'), await page.locator('#tab-notices').getAttribute('aria-selected'), /were loaded here/.test(await page.locator('#toast').textContent().catch(() => '')), /Unsaved/.test(await page.locator('.abar .status').textContent())],
    ['קידוש אחר התפילה', 'true', true, false]);
  await banner('שיעור אחר מעריב'); await save(); await publish();
  ok('a change made after that publishes without a question: the page stands on the newest settings', [await asked(), puts.length, puts[3] && puts[3].banner.text], [0, 4, 'שיעור אחר מעריב']);

  /* newer settings arriving while something is typed here: what is typed is not touched, and the publish asks */
  await banner('שלי');
  elsewhere({ name: 'Changed Elsewhere' }, FIXED + 1800e3);
  await wake();
  ok('with something typed, the page keeps what was typed and says that newer settings were published', [await page.inputValue('#banner-text'), /will ask before replacing/.test(await page.locator('#toast').textContent().catch(() => '')), /Unsaved/.test(await page.locator('.abar .status').textContent())], ['שלי', true, true]);
  await save(); await publish();
  ok('and publishing from there asks', [await asked(), puts.length, (await page.locator('#askbox .ask-list li').allTextContents()).some(l => /Shul name/.test(l))], [1, 4, true]);
  await page.click('#ask-mine'); await page.waitForTimeout(900);
  ok('"Publish mine anyway" does just that, knowingly', [await asked(), puts.length, puts[4] && puts[4].banner.text, puts[4] && puts[4].name !== 'Changed Elsewhere'], [0, 5, 'שלי', true]);
  await banner('אחרון'); await save(); await publish();
  ok('after that the page is level with the website again', [await asked(), puts.length], [0, 6]);

  /* a donation's own "Save and publish" goes through the same door */
  elsewhere({ rooms: 'ברך משה, דברי יואל' }, FIXED + 2400e3);
  await page.click('#tab-donations'); await page.click('#dn-add'); await page.waitForTimeout(200);
  await page.fill('[id^="dn-name-"]', 'ר׳ יואל'); await page.click('#dn-save'); await page.waitForTimeout(1200);
  ok('a donation\'s "Save and publish" asks too when the website has moved on', [await page.locator('#dn-save').count(), await asked(), puts.length], [0, 1, 6]);
  await page.click('#ask-cancel');

  /* on a phone the question fits, with its answers one under the other */
  await page.setViewportSize({ width: 390, height: 780 }); await page.waitForTimeout(200);
  await page.evaluate(() => { const b = document.querySelector('.pubbar .btn.gold'); if (b) b.click(); }); await page.waitForTimeout(900);
  ok('on a phone the question fits the screen: nothing off the side, every answer big enough for a thumb', await page.evaluate(() => { const s = document.querySelector('#askbox .dn-sheet').getBoundingClientRect(), b = Array.from(document.querySelectorAll('#askbox .dn-foot .btn')).map(e => e.getBoundingClientRect());
    return [s.left >= 0 && s.right <= window.innerWidth && s.bottom <= window.innerHeight + 1, b.length, b.every(r => r.height >= 44 && r.left >= 0 && r.right <= window.innerWidth), document.documentElement.scrollWidth <= window.innerWidth]; }), [true, 3, true, true]);

  await page.screenshot({ path: 'test/shot-newer-phone.png' });
  await browser.close();
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
  console.log(fails ? fails + ' FAILED' : 'all ok');
  process.exit(fails || errors.length ? 1 : 0);
})().catch(e => { console.log('ERROR', e.message); process.exit(1); });
