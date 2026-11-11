/* Shabbos and Yom Tov. The screen and the board get the evening right by what the next day is (candles before sunset, candles after
   nightfall, or the day ending), a Yom Tov on a Friday takes Erev Shabbos's afternoon, and each kind of day can give a tefilla a name
   and a second time of its own (Schedule → the kind of day → the tefilla → "On …").
   The schedule here is the check's own, never the shul's, and nothing is written to the website. New York. */
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
global.Cal = require('../src/cal.js');
const E = require('../src/engine.js');
const BASE = 'http://localhost:8790/';
const FIX = c => {
  c.schedules = { weekday: { shacharis: '07:00 לב אהרן\n08:00 דברי יואל\n09:00 ברך משה\n10:30 שלמה יודא', mincha: '13:30 ברך משה', maariv: '21:00 ברך משה' },
    friday: { mincha: 'candles+10 ברך משה\ncandles+15 לב אהרן', maariv: 'candles+45~5 ברך משה' },
    shabbos: { shacharis: '08:30 לב אהרן\n09:00 ברך משה\n09:30 דברי יואל\n10:00 שלמה יודא', mincha: '13:30 ברך משה\nsunset-40~5 דברי יואל', maariv: 'sunset+50~5 דברי יואל\nrt לב אהרן' } };
  c.tefillos = [{ id: 'shacharis', name: 'שחרית', milestone: 'הודו', offset: 10, startLabel: 'ברכות', period: 'am', kind: 'minyan' }, { id: 'mincha', name: 'מנחה', milestone: '', offset: 0, startLabel: '', period: 'pm', kind: 'minyan' }, { id: 'maariv', name: 'מעריב', milestone: '', offset: 0, startLabel: '', period: 'pm', kind: 'minyan' }];
  c.bigTime = 'start'; c.lang = 'he'; c.amidahMinutes = 15; c.nowMinutes = 20; c.clock24 = false; c.palette = 'hallway'; /* the check's own, whatever the shul's settings are today */
  c.rolls = []; c.overrides = []; c.notices = []; c.banner = { text: '', from: '', until: '' }; c.nextTemplate = ''; c.candles = 18; c.tzeisMinutes = 72; c.israel = false; c.weeklyEarliest = false;
  delete c.dayTefilla; delete c.nextPanel; delete c.nextHold; delete c.wallWindow; delete c.countTo; delete c.nextMark; delete c.donationKinds;
  return c;
};
const eng = (E.MinyanEngine || E)(FIX(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'config.json'), 'utf8'))));
const rd = (y, m, d) => Cal.rdFromGreg(y, m, d), zt = (r, k, add) => eng.fmtTime(Math.round(eng.zmanimFor(r)[k]) + (add || 0)); /* a zman as the screen writes it */
const ny = (y, m, d, h, min) => Cal.epochFromWall(rd(y, m, d), h * 60 + (min || 0), 'America/New_York');
(async () => {
  const browser = await chromium.launch(); const errors = []; let fails = 0;
  const ok = (name, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) console.log('ok   ' + name); else { fails++; console.log('FAIL ' + name + ' got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want)); } };
  async function context(when, more, viewport, locale) {
    const ctx = await browser.newContext({ viewport: viewport || { width: 1920, height: 1080 }, locale: locale || 'he', timezoneId: 'America/New_York', serviceWorkers: 'block' });
    await ctx.addInitScript(({ fixed }) => { const real = Date.now; const start = real(); Date.now = () => fixed + (real() - start); }, { fixed: when });
    await ctx.route('**/config.json*', async route => { const res = await route.fetch(); const c = Object.assign(FIX(JSON.parse(await res.text())), more || {}); await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(c) }); });
    const page = await ctx.newPage(); page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/ERR_|Failed to load resource|favicon/.test(m.text())) errors.push(m.text()); });
    return { ctx, page };
  }
  const screen = async (page, q) => { await page.goto(BASE + 'index.html?view=display&full=1' + (q || ''), { waitUntil: 'networkidle' }); await page.locator('.aclock svg').waitFor({ timeout: 15000 }); await page.waitForTimeout(500); };
  /* what the screen says: each frame's heading, its sub-headings and its tiles; the zmanim card's band above the three and the three */
  const read = page => page.evaluate(() => {
    const txt = (e, s) => { const x = e.querySelector(s); return x ? x.textContent : ''; };
    const cards = Array.from(document.querySelectorAll('.wall section.tefilla:not(.zcard)')).map(c => ({ head: c.querySelector('h3').textContent.replace(/[●○\s]+$/, ''), subs: Array.from(c.querySelectorAll('.sub')).map(s => s.textContent),
      tiles: Array.from(c.querySelectorAll('.tile')).map(t => [txt(t, '.room'), txt(t, '.time'), txt(t, '.ms')]), marks: Array.from(c.querySelectorAll('.tile .mark')).map(m => m.textContent) }));
    const z = document.querySelector('.wall .zcard'), p = document.querySelector('.wall > .wcol > section.next');
    return { cards, zhead: z ? z.querySelector('h3').textContent : null, band: z ? Array.from(z.querySelectorAll('.zday .ztile')).map(t => [txt(t, '.room'), txt(t, '.time')]) : null, three: z ? Array.from(z.querySelectorAll('.zgrid .ztile')).map(t => txt(t, '.room')) : null,
      panel: p ? Array.from(p.children).slice(1).map(c => c.className.replace(' num', '') + ': ' + c.textContent.replace(/\d\d:\d\d:\d\d$/, 'countdown')) : null,
      fits: Array.from(document.querySelectorAll('main.wall > .wcol')).every(c => c.scrollHeight - c.clientHeight <= 1) && document.documentElement.scrollHeight <= window.innerHeight };
  });
  const card = (s, re) => s.cards.filter(c => re.test(c.head))[0] || { head: null, subs: [], tiles: [], marks: [] };
  const FRI = rd(2026, 11, 13), SHAB = rd(2026, 11, 14), EREV = rd(2027, 4, 21), P1 = rd(2027, 4, 22), P2 = rd(2027, 4, 23), LAST = rd(2027, 4, 29);

  /* ---- an ordinary Friday and Shabbos ---- */
  let { ctx, page } = await context(ny(2026, 11, 13, 15, 0));
  await screen(page); let s = await read(page);
  ok('Friday afternoon: מנחה goes by candle lighting, and candle lighting is one of the zmanim', [card(s, /מנחה/).tiles.slice(0, 2).map(t => t[1]), s.three.indexOf('הדלקת נרות') >= 0, s.band, s.fits], [[zt(FRI, 'candles', 10), zt(FRI, 'candles', 15)], true, [], true]);
  ok('the morning frame has gone over to tomorrow and names it: Shabbos', card(s, /שחרית/).head, 'מניני שחרית – מחר, שבת קודש');
  await ctx.close();
  ({ ctx, page } = await context(ny(2026, 11, 14, 9, 0)));
  await screen(page); s = await read(page);
  ok('Shabbos morning: "מוצאי שבת" stands in a band of its own over the three zmanim, which stay three', [s.zhead, s.band, s.three.length, s.fits], ['זמני היום', [['מוצאי שבת', zt(SHAB, 'tzeis')]], 3, true]);
  ok('שחרית is Shabbos\'s list; left alone, its second time is the everyday one', card(s, /שחרית/).tiles, [['לב אהרן', '8:30', 'הודו 8:40'], ['ברך משה', '9:00', 'הודו 9:10'], ['דברי יואל', '9:30', 'הודו 9:40'], ['שלמה יודא', '10:00', 'הודו 10:10']]);
  ok('no "last minyan for סוף זמן תפילה" marks on Shabbos: they are reckoned at the weekday pace', card(s, /שחרית/).marks, []);
  await page.screenshot({ path: 'test/shot-shabbos.png' });
  await ctx.close();
  ({ ctx, page } = await context(ny(2026, 11, 16, 6, 30)));
  await screen(page); s = await read(page);
  ok('(on a weekday the same screen does carry those marks, so the check above means something)', card(s, /שחרית/).marks.length > 0, true);
  await ctx.close();
  ({ ctx, page } = await context(ny(2026, 11, 14, 17, 55)));
  await screen(page); s = await read(page);
  ok('minutes after Shabbos is out the band still says when it went out', s.band, [['מוצאי שבת', zt(SHAB, 'tzeis')]]);
  await ctx.close();
  ({ ctx, page } = await context(ny(2026, 11, 14, 19, 0)));
  await screen(page); s = await read(page);
  ok('an hour later, with the card on tomorrow\'s zmanim, last night\'s "מוצאי שבת" is not left standing under "זמני מחר"', [s.zhead, s.band, s.three.length], ['זמני מחר', [], 3]);
  await ctx.close();

  /* ---- Yom Tov ---- */
  ({ ctx, page } = await context(ny(2027, 4, 21, 15, 0), { dayTefilla: { friday: { maariv: { name: 'קבלת שבת' } } } }));
  await screen(page); s = await read(page);
  ok('Erev Pesach: tomorrow is called by its name, not "יום חמישי"', card(s, /שחרית/).head, 'מניני שחרית – מחר, פסח');
  ok('it borrows Friday\'s times (candle lighting) but not Friday\'s name for מעריב', [card(s, /מנחה/).tiles[0][1], card(s, /מנחה/).subs], [zt(EREV, 'candles', 10), ['מנחה', 'מעריב']]);
  await ctx.close();
  ({ ctx, page } = await context(ny(2027, 4, 22, 10, 0)));
  await screen(page); s = await read(page);
  ok('the first day of Pesach: candles for the second night after nightfall, and no "מוצאי יום טוב" yet', [s.band, s.three.indexOf('הדלקת נרות'), s.three.length, s.fits], [[['הדלקת נרות', zt(P1, 'tzeis')]], -1, 3, true]);
  ok('Yom Tov with no list of its own uses Shabbos\'s', card(s, /שחרית/).tiles.map(t => t[1]), ['8:30', '9:00', '9:30', '10:00']);
  await page.screenshot({ path: 'test/shot-yomtov.png' });
  await ctx.close();
  ({ ctx, page } = await context(ny(2027, 4, 23, 15, 0), { dayTefilla: { friday: { maariv: { name: 'קבלת שבת' } } } }));
  await screen(page); s = await read(page);
  ok('the second day on a Friday: the afternoon is Erev Shabbos\'s, by candle lighting, and מעריב is קבלת שבת', [card(s, /מנחה/).subs, card(s, /מנחה/).tiles.map(t => t[1])], [['מנחה', 'קבלת שבת'], [zt(P2, 'candles', 10), zt(P2, 'candles', 15), eng.fmtTime(Math.floor((Math.round(eng.zmanimFor(P2).candles) + 45) / 5) * 5)]]);
  ok('nothing on the card says Yom Tov is going out', s.band.filter(b => /מוצאי/.test(b[0])), []);
  await ctx.close();
  ({ ctx, page } = await context(ny(2027, 4, 29, 10, 0)));
  await screen(page); s = await read(page);
  ok('the last day of Pesach: now it does say "מוצאי יום טוב"; with the Omer count beside it in the band, the three zmanim are still three and everything fits', [s.band.filter(b => /מוצאי|נרות/.test(b[0])), s.band.length, s.three.length, s.fits], [[['מוצאי יום טוב', zt(LAST, 'tzeis')]], 2, 3, true]);
  await page.screenshot({ path: 'test/shot-lastday.png' });
  await ctx.close();

  /* ---- a second time and a name of its own, on the screen ---- */
  ({ ctx, page } = await context(ny(2026, 11, 14, 9, 0), { dayTefilla: { shabbos: { shacharis: { second: 'own', milestone: 'נשמת', offset: 30 } } } }));
  await screen(page); s = await read(page);
  ok('Shabbos given נשמת half an hour on: the tiles and the next-minyan panel carry it', [card(s, /שחרית/).tiles.map(t => t[2]), s.panel], [['נשמת 9:00', 'נשמת 9:30', 'נשמת 10:00', 'נשמת 10:30'], ['tf: שחרית', 'rm: דברי יואל', 'time: 9:30', 'ms: נשמת 10:00', 'count: countdown']]);
  await ctx.close();
  ({ ctx, page } = await context(ny(2026, 11, 14, 9, 0), { dayTefilla: { shabbos: { shacharis: { second: 'none' } } } }));
  await screen(page); s = await read(page);
  ok('Shabbos given no second time: none on the tiles, none in the panel, and everything fits', [card(s, /שחרית/).tiles.map(t => t[2]), s.panel, s.fits], [['', '', '', ''], ['tf: שחרית', 'rm: דברי יואל', 'time: 9:30', 'count: countdown'], true]);
  await ctx.close();
  ({ ctx, page } = await context(ny(2026, 11, 13, 15, 0), { dayTefilla: { friday: { maariv: { name: 'קבלת שבת' } } } }));
  await screen(page); s = await read(page);
  ok('Friday\'s מעריב called קבלת שבת: the frame and its sub-heading say so', [card(s, /מנחה/).head, card(s, /מנחה/).subs], ['מניני מנחה קבלת שבת', ['מנחה', 'קבלת שבת']]);
  await ctx.close();

  /* ---- the board on a phone, and the week on paper ---- */
  ({ ctx, page } = await context(ny(2027, 4, 22, 10, 0), null, { width: 390, height: 844 }));
  await page.goto(BASE + 'index.html', { waitUntil: 'networkidle' }); await page.waitForSelector('.zlist li'); await page.waitForTimeout(400);
  const zl = await page.evaluate(() => Array.from(document.querySelectorAll('.zlist li')).map(li => [li.children[0].textContent, li.querySelector('.z') ? li.querySelector('.z').textContent : '', li.classList.contains('hi')]));
  ok('the board\'s zmanim on the first day of Pesach: candles after nightfall at the head, written once, and no "מוצאי"', [zl.filter(x => x[2]).map(x => x.slice(0, 2)), zl.filter(x => /מוצאי/.test(x[0])).length, zl.filter(x => x[0] === 'הדלקת נרות').length], [[['הדלקת נרות', zt(P1, 'tzeis')]], 0, 1]);
  ok('nothing runs off the side of the phone', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.goto(BASE + 'index.html?view=week', { waitUntil: 'networkidle' }); await page.waitForSelector('.wday'); await page.waitForTimeout(300);
  const wk = await page.evaluate(() => Array.from(document.querySelectorAll('.wday')).map(d => [d.querySelector('.whead strong').textContent, d.querySelector('.wz').textContent]));
  const dayLine = (name, nth) => (wk.filter(w => w[0] === name)[nth || 0] || ['', ''])[1];
  ok('the week on paper: Wednesday lights before sunset, Thursday after nightfall, Friday before sunset again, and Shabbos ends it',
    [dayLine('יום רביעי').indexOf('הדלקת נרות ' + zt(EREV, 'candles')) >= 0, dayLine('יום חמישי').indexOf('הדלקת נרות ' + zt(P1, 'tzeis')) >= 0, /מוצאי/.test(dayLine('יום חמישי')), dayLine('יום שישי').indexOf('הדלקת נרות ' + zt(P2, 'candles')) >= 0, /מוצאי/.test(dayLine('יום שישי')), /מוצאי שבת/.test(dayLine('שבת קודש'))],
    [true, true, false, true, false, true]);
  await ctx.close();

  /* ---- the back end ---- */
  const WED = ny(2026, 11, 18, 9, 10), NEXT_SHAB = rd(2026, 11, 21);
  ({ ctx, page } = await context(WED, null, { width: 1280, height: 900 }, 'en-US'));
  const status = () => page.locator('.abar .status').textContent(), save = async () => { await page.click('.abar .btn.primary'); await page.waitForTimeout(900); };
  const saved = () => page.evaluate(() => { const c = JSON.parse(localStorage.getItem('minyan-config') || 'null'); return c ? c.dayTefilla || null : 'nothing saved'; });
  async function admin() {
    await page.goto(BASE + 'admin.html', { waitUntil: 'networkidle' }); await page.waitForSelector('#pin-input, #tab-home');
    if (await page.locator('#pin-input').count()) { await page.fill('#pin-input', '1234'); await page.press('#pin-input', 'Enter'); }
    await page.waitForSelector('#tab-home'); await page.waitForTimeout(300); await page.click('#tab-schedule'); await page.waitForTimeout(200);
  }
  await admin();
  ok('the Weekdays page has no such box: it is the tefilla as it is every day (General)', [await page.locator('#dtp-weekday .dayset').count(), (await page.locator('#dtp-weekday .pv').first().textContent())], [0, 'today 7:00']);
  await page.click('#dt-shabbos'); await page.waitForTimeout(200);
  ok('looking at the Shabbos page is not a change to save', /Unsaved/.test(await status()), false);
  ok('the page says what Shabbos is: lists of its own, which Yom Tov uses', await page.locator('#dtp-shabbos > .hint').first().textContent(), 'Shabbos has its own lists; it follows no other day. Yom Tov uses these wherever it has no list of its own.');
  ok('each row previews the coming Shabbos, not today: fixed times and times that go by the sun', (await page.locator('#dtp-shabbos .pv').allTextContents()).filter((x, i) => i === 0 || i === 5 || i === 6),
    ['Sat Nov 21 8:30', 'Sat Nov 21 ' + eng.fmtTime(Math.floor((Math.round(eng.zmanimFor(NEXT_SHAB).sunset) - 40) / 5) * 5), 'Sat Nov 21 ' + eng.fmtTime(Math.floor((Math.round(eng.zmanimFor(NEXT_SHAB).sunset) + 50) / 5) * 5)]);
  ok('every tefilla has its "On Shabbos" box, closed and saying nothing is set', await page.locator('#dtp-shabbos .dayset > summary').allTextContents(), ['On Shabbos: the usual name and second time', 'On Shabbos: the usual name and second time', 'On Shabbos: the usual name and second time']);
  await page.locator('#dt-box-shabbos-shacharis > summary').click(); await page.waitForTimeout(150);
  ok('opening a box is not a change either', /Unsaved/.test(await status()), false);
  await page.selectOption('#dt-second-shabbos-shacharis', 'own'); await page.waitForTimeout(150);
  ok('"Its own" asks for a name and the minutes, starting at 30, and is a change', [await page.locator('#dt-ms-shabbos-shacharis').isVisible(), await page.inputValue('#dt-off-shabbos-shacharis'), /Unsaved/.test(await status()), await page.locator('#dt-err-shabbos-shacharis').isVisible()], [true, '30', true, false]);
  await page.click('#dt-weekday'); await save();
  ok('Save with the name still empty does not save: it says what is missing, opens the page and the box, and puts the cursor in the field', [await saved(), /second time needs a name/.test(await page.locator('#toast').textContent().catch(() => '')), await page.locator('#dtp-shabbos').isVisible(),
    await page.locator('#dt-err-shabbos-shacharis').isVisible(), await page.evaluate(() => document.activeElement.id), await page.locator('#dt-ms-shabbos-shacharis').getAttribute('aria-invalid')], ['nothing saved', true, true, true, 'dt-ms-shabbos-shacharis', 'true']);
  await page.fill('#dt-ms-shabbos-shacharis', 'נשמת'); await page.waitForTimeout(100);
  ok('typing the name clears the complaint and the box says what is set, the Hebrew in one piece', [await page.locator('#dt-err-shabbos-shacharis').isVisible(), (await page.locator('#dt-box-shabbos-shacharis > summary').textContent()).replace(/[\u2068\u2069]/g, '')], [false, 'On Shabbos: second time נשמת, 30 min after the start']);
  await page.fill('#dt-off-shabbos-shacharis', '35'); await save();
  ok('saved', await saved(), { shabbos: { shacharis: { name: '', second: 'own', milestone: 'נשמת', offset: 35 } } });
  await page.click('#tab-publish'); await page.waitForTimeout(300);
  ok('the list of what is waiting to be published says it in words, with nothing technical', (await page.locator('.changes li').allTextContents()).map(x => x.replace(/[\u2068\u2069]/g, '')).filter(x => /Shabbos|\{/.test(x)), ['Shabbos · שחרית: second time נשמת, 35 min after the start']);
  const tv = await ctx.newPage(); await tv.setViewportSize({ width: 1920, height: 1080 });
  await screen(tv, '&at=2026-11-21T09:00'); s = await read(tv);
  ok('and the screen on that Shabbos shows it', card(s, /שחרית/).tiles.map(t => t[2]), ['נשמת 9:05', 'נשמת 9:35', 'נשמת 10:05', 'נשמת 10:35']);
  await screen(tv, '&at=2026-11-18T06:30'); s = await read(tv);
  ok('while today, a weekday, is as it was', card(s, /שחרית/).tiles[0], ['לב אהרן', '7:00', 'הודו 7:10']);
  await page.bringToFront(); await admin(); await page.click('#dt-shabbos'); await page.waitForTimeout(200);
  ok('opened again, the box is marked as set and holds what was saved', [await page.locator('#dt-box-shabbos-shacharis').evaluate(e => e.classList.contains('set')), await page.inputValue('#dt-second-shabbos-shacharis'), await page.inputValue('#dt-ms-shabbos-shacharis'), await page.inputValue('#dt-off-shabbos-shacharis'), /Unsaved/.test(await status())], [true, 'own', 'נשמת', '35', false]);
  /* Yom Tov follows Shabbos for the second time, and can part from it */
  await page.click('#dt-yomtov'); await page.waitForTimeout(200);
  ok('the Yom Tov page says so, and tells about a Yom Tov on a Friday', [await page.locator('#dtp-yomtov .dayset > summary').first().textContent(), /on a Friday, its Mincha and Maariv are Erev Shabbos/.test(await page.locator('#dtp-yomtov > .hint').first().textContent())], ['On Yom Tov: the usual name · second time as on Shabbos', true]);
  await screen(tv, '&at=2027-04-22T09:00'); s = await read(tv);
  ok('on Pesach the screen has Shabbos\'s נשמת', card(s, /שחרית/).tiles[0][2], 'נשמת 9:05');
  await page.bringToFront();
  await page.locator('#dt-box-yomtov-shacharis > summary').click(); await page.selectOption('#dt-second-yomtov-shacharis', 'none');
  await page.click('#dt-friday'); await page.locator('#dt-box-friday-maariv > summary').click(); await page.fill('#dt-name-friday-maariv', 'קבלת שבת'); await save();
  ok('Yom Tov given none, and Friday\'s מעריב a name: both saved beside Shabbos\'s', await saved(), { shabbos: { shacharis: { name: '', second: 'own', milestone: 'נשמת', offset: 35 } }, yomtov: { shacharis: { name: '', second: 'none' } }, friday: { maariv: { name: 'קבלת שבת', second: '' } } });
  await screen(tv, '&at=2027-04-22T09:00'); s = await read(tv);
  ok('Pesach now has no second time', card(s, /שחרית/).tiles[0][2], '');
  await screen(tv, '&at=2026-11-20T15:00'); s = await read(tv);
  ok('and Friday says קבלת שבת', card(s, /מנחה/).subs, ['מנחה', 'קבלת שבת']);
  /* taking a setting away again leaves no trace of it */
  await page.bringToFront(); await page.click('#tab-schedule'); await page.click('#dt-friday'); await page.waitForTimeout(150);
  ok('a box that holds a setting says so while closed', [await page.locator('#dt-box-friday-maariv').evaluate(e => [e.open, e.classList.contains('set')]), (await page.locator('#dt-box-friday-maariv > summary').textContent()).replace(/[\u2068\u2069]/g, '')], [[false, true], 'On Erev Shabbos (Friday): called קבלת שבת']);
  await page.locator('#dt-box-friday-maariv > summary').click(); await page.fill('#dt-name-friday-maariv', '');
  await page.click('#dt-yomtov'); await page.locator('#dt-box-yomtov-shacharis > summary').click(); await page.selectOption('#dt-second-yomtov-shacharis', ''); await save();
  ok('emptied again, the two are gone from what is saved', await saved(), { shabbos: { shacharis: { name: '', second: 'own', milestone: 'נשמת', offset: 35 } } });
  await page.click('#tab-screen'); await page.click('#w-pageBg-darker'); await save(); await page.click('#tab-publish'); await page.waitForTimeout(300);
  ok('(a setting made of several values, like the screen\'s colours, is listed as changed, not spilled out in brackets)', (await page.locator('.changes li').allTextContents()).filter(x => /colours|\{/.test(x)), ['Hallway screen colours changed']);
  /* from the Schedule page to the screen on that day */
  await page.click('#tab-schedule'); await page.click('#dt-shabbos'); await page.waitForTimeout(150);
  ok('the Shabbos page offers the screen on the coming Shabbos', (await page.locator('#see-shabbos').textContent()).trim(), 'See the screen on Sat Nov 21');
  await page.click('#see-shabbos'); await page.waitForTimeout(700);
  ok('it opens Home on that day at nine in the morning, and that is not a change to save', [await page.locator('#tab-home').getAttribute('aria-selected'), await page.inputValue('#home-date'), await page.inputValue('#home-time'), await page.locator('.home-cap').textContent(), /Unsaved/.test(await status())],
    ['true', '2026-11-21', '09:00', 'The screen as it will be on Saturday, Nov 21, 2026 at 9:00 AM.', false]);
  const facts = () => page.evaluate(() => { const o = {}, k = document.querySelectorAll('.home-facts dt'), v = document.querySelectorAll('.home-facts dd'); for (let i = 0; i < k.length; i++) o[k[i].textContent] = v[i].textContent; return o; });
  ok('under the picture Home says what that evening is', (await facts()).Evening, 'Shabbos ends ' + zt(NEXT_SHAB, 'tzeis'));
  await page.locator('.home-when .dn-chip[data-day="2027-04-22"]').click(); await page.waitForTimeout(500);
  ok('on the first day of Pesach: candle lighting after nightfall', [(await facts())['Schedule in use'], (await facts()).Evening], ['Yom Tov', 'Candle lighting after nightfall, ' + zt(P1, 'tzeis')]);
  await page.fill('#home-date', '2027-04-23'); await page.locator('#home-date').dispatchEvent('change'); await page.waitForTimeout(500);
  ok('on the second day, a Friday: candle lighting before sunset, and the afternoon as on Erev Shabbos', [(await facts())['Schedule in use'], (await facts()).Evening], ['Yom Tov · Mincha and Maariv as on Erev Shabbos (Friday)', 'Candle lighting ' + zt(P2, 'candles')]);
  ok('Home\'s days now include the coming Yom Tov', await page.locator('.home-when .dn-chip[data-day]').evaluateAll(b => b.map(x => [x.textContent, x.getAttribute('data-day')]).filter(x => x[0] === 'Yom Tov')), [['Yom Tov', '2027-04-22']]);
  await page.click('#tab-schedule'); await page.click('#dt-yomtov'); await page.waitForTimeout(150);
  ok('the Yom Tov page offers the first day of Pesach', (await page.locator('#see-yomtov').textContent()).trim(), 'See the screen on Thu Apr 22');
  await ctx.close();

  /* on a phone */
  ({ ctx, page } = await context(WED, { dayTefilla: { shabbos: { shacharis: { second: 'own', milestone: 'נשמת', offset: 30 } } } }, { width: 390, height: 844 }, 'en-US'));
  await page.goto(BASE + 'admin.html', { waitUntil: 'networkidle' }); await page.fill('#pin-input', '1234'); await page.press('#pin-input', 'Enter'); await page.waitForSelector('#tab-schedule'); await page.click('#tab-schedule'); await page.click('#dt-shabbos'); await page.waitForTimeout(200);
  await page.locator('#dt-box-shabbos-shacharis > summary').click(); await page.waitForTimeout(150);
  ok('on a phone the box and its fields fit: nothing off the side, fields big enough for a thumb', await page.evaluate(() => { const f = Array.from(document.querySelectorAll('#dt-box-shabbos-shacharis input, #dt-box-shabbos-shacharis select')).map(e => e.getBoundingClientRect()).filter(r => r.width);
    return [document.documentElement.scrollWidth <= window.innerWidth, f.length, f.every(r => r.left >= 0 && r.right <= window.innerWidth && r.height >= 40)]; }), [true, 4, true]);
  ok('published settings that already hold such a setting open with it in place', [await page.inputValue('#dt-second-shabbos-shacharis'), await page.inputValue('#dt-ms-shabbos-shacharis'), /Unsaved/.test(await page.locator('.abar .status').textContent())], ['own', 'נשמת', false]);
  await page.screenshot({ path: 'test/shot-shabbos-settings.png' });
  await ctx.close();

  await browser.close();
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
  console.log(fails ? fails + ' FAILED' : 'all ok');
  process.exit(fails || errors.length ? 1 : 0);
})().catch(e => { console.log('ERROR', e.message); process.exit(1); });
