/* The back end's Donations page, used the way a gabbai would: the list of cards (who, which kind, Hebrew start and end, on the board / coming
   up / finished), search, the filters and the order; adding, editing, copying and removing a donation; the kinds; and the careless cases —
   nothing typed, the last day before the first, a double press, odd characters, none at all and a hundred. The board behind the back end shows
   what was saved. Clock frozen Wed 18 Nov 2026, 9:10 AM New York = ח׳ כסלו תשפ״ז; the schedule file is stood in for with three donations. */
const { chromium } = require('playwright');
const BASE = 'http://localhost:8790/';
const FIXED = Date.UTC(2026, 10, 18, 14, 10);
const THREE = [
  { title: 'פרנס חודש כסלו', lead: 'רון שיר ושבח', name: 'מו״ה יעקב יואל פריעדמאן הי״ו', body: 'מחשובי מתפללי ולומדי בית מדרשינו', size: 'big', logo: '', from: '2026-11-11', to: '2026-12-10' },
  { title: 'נר למאור לחודש כסלו', lead: 'נתנדב לעילוי נשמת', name: 'ר׳ דוד ב״ר משה אלי׳ עסטרייכער ע״ה', body: 'נפטר כ״ז כסלו תשפ״ד', size: 'small', logo: '', from: '2026-11-11', to: '2026-12-10' },
  { title: 'פרנס היום', lead: '', name: '', body: '', size: 'tiny', logo: '', from: '', to: '' }, /* an empty frame from the old editor: it shows nothing and is not a donation */
  { title: 'פרנס החודש', lead: '', name: '', body: 'הרה״ח ר׳ חיים אליעזר פאלקאוויטש הי״ו\nלרגל הולדות בנו למזל טוב', size: '', logo: '', from: '', to: '2026-11-10' }
];
(async () => {
  const browser = await chromium.launch(); const errors = []; let fails = 0;
  const ok = (name, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) console.log('ok   ' + name); else { fails++; console.log('FAIL ' + name + ' got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want)); } };
  async function open(viewport, notices, when, more) {
    const ctx = await browser.newContext({ viewport: viewport || { width: 1280, height: 900 }, locale: 'en-US', timezoneId: 'America/New_York', serviceWorkers: 'block' });
    await ctx.addInitScript(({ fixed }) => { const real = Date.now; const start = real(); Date.now = () => fixed + (real() - start); }, { fixed: when || FIXED });
    await ctx.route('**/config.json*', async route => {
      const res = await route.fetch(); const c = JSON.parse(await res.text());
      c.notices = JSON.parse(JSON.stringify(notices)); delete c.donationKinds; Object.assign(c, more || {});
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(c) });
    });
    const page = await ctx.newPage(); page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/ERR_|Failed to load resource|favicon/.test(m.text())) errors.push(m.text()); });
    await page.goto(BASE + 'admin.html', { waitUntil: 'networkidle' });
    await enter(page);
    return { ctx, page };
  }
  async function enter(page) {
    await page.waitForSelector('#pin-input, #tab-donations'); /* the PIN is asked once per sitting; a reload goes straight back in */
    if (await page.locator('#pin-input').count()) { await page.fill('#pin-input', '1234'); await page.press('#pin-input', 'Enter'); }
    await page.waitForSelector('#tab-donations'); await page.click('#tab-donations'); await page.waitForTimeout(250);
  }
  const cards = page => page.evaluate(() => Array.from(document.querySelectorAll('.dn-card')).map(c => ({
    no: c.querySelector('.dn-no').textContent, name: c.querySelector('.dn-name').textContent, st: c.querySelector('.dn-st').textContent, kind: c.querySelector('.dn-kind').textContent,
    start: c.querySelectorAll('.dn-heb')[0].textContent, end: c.querySelectorAll('.dn-heb')[1].textContent, rel: Array.from(c.querySelectorAll('.dn-rel')).map(r => r.textContent) })));
  const counts = page => page.evaluate(() => Array.from(document.querySelectorAll('#page-donations .dn-filters .dn-chip')).map(b => b.textContent));
  const formOpen = page => page.locator('.dn-sheet').count();
  const saved = async page => { await page.waitForTimeout(600); };
  const boardPanels = page => page.evaluate(() => Array.from(document.querySelectorAll('.sponsors .sponsor')).map(s => [s.querySelector('.t').textContent, (s.querySelector('.n') || {}).textContent || '', s.className.replace('sponsor', '').trim()]));

  /* ---- the list ---- */
  let { ctx, page } = await open(null, THREE);
  let list = await cards(page);
  ok('a card for each donation, the empty frame left out; what is on the board comes first, in the order it stands there', list.map(c => [c.no, c.name, c.st, c.kind]),
    [['#001', 'מו״ה יעקב יואל פריעדמאן הי״ו', 'On the board', 'פרנס החודש'], ['#002', 'ר׳ דוד ב״ר משה אלי׳ עסטרייכער ע״ה', 'On the board', 'נר למאור'], ['#003', 'הרה״ח ר׳ חיים אליעזר פאלקאוויטש הי״ו', 'Finished', 'פרנס החודש']]);
  ok('Hebrew start and end dates, and how far off they are in plain words', [list[0].start, list[0].end, list[0].rel, list[2].start, list[2].end, list[2].rel],
    ['א׳ כסלו תשפ״ז', 'ל׳ כסלו תשפ״ז', ['started 7 days ago', 'ends in 22 days'], '—', 'ל׳ חשון תשפ״ז', ['no start date', 'ended 8 days ago']]);
  ok('initials stand for the name itself, not its titles', await page.locator('.dn-av').allTextContents(), ['יפ', 'דע', 'חפ']);
  ok('the filters carry their counts', await counts(page), ['All3', 'On the board2', 'Coming up0', 'Finished1']);
  await page.click('[data-filter="done"]');
  ok('"Finished" shows the finished one', (await cards(page)).map(c => c.no), ['#003']);
  await page.click('[data-filter="soon"]');
  ok('a filter with nothing under it says so and offers the way back', [await page.locator('.dn-empty h3').textContent(), await page.locator('.dn-card').count()], ['Nothing matches', 0]);
  await page.locator('.dn-empty .btn').click();
  ok('"Show all donations" brings them back', await page.locator('.dn-card').count(), 3);
  await page.fill('#dn-search', 'עסטרייכער');
  ok('search by a name', (await cards(page)).map(c => c.no), ['#002']);
  await page.fill('#dn-search', 'נר  למאור  '); ok('search by a kind, stray spaces and all', (await cards(page)).map(c => c.no), ['#002']);
  await page.fill('#dn-search', '003'); ok('search by its number', (await cards(page)).map(c => c.no), ['#003']);
  await page.fill('#dn-search', 'zzz <b>');
  ok('a search with no match says what was searched for, as plain text', [await page.locator('.dn-empty p').textContent(), await page.locator('.dn-empty b').count()], ['No donation has "zzz <b>" in it.', 0]);
  await page.fill('#dn-search', '');
  await page.selectOption('#dn-sort', 'old'); ok('oldest first', (await cards(page)).map(c => c.no), ['#003', '#001', '#002']);
  await page.selectOption('#dn-sort', 'new'); ok('newest first', (await cards(page)).map(c => c.no), ['#002', '#001', '#003']);
  await page.selectOption('#dn-sort', 'board');
  ok('the board behind shows the two that are on, the big one leading', await boardPanels(page), [['פרנס חודש כסלו', 'מו״היעקב יואל פריעדמאןהי״ו', 'sp-big'], ['נר למאור לחודש כסלו', 'ר׳דודב״רמשה אלי׳ עסטרייכערע״ה', 'sp-sm']]);

  /* ---- adding one ---- */
  await page.click('#dn-add'); await page.waitForTimeout(250);
  ok('"Add donation" opens the form with the cursor in the name, the first kind chosen and this month filled in',
    [await page.locator('.dn-head h2').textContent(), await page.evaluate(() => document.activeElement.id.replace(/-\d+$/, '')), await page.locator('.dn-kindbtn.on').textContent(),
      await page.inputValue('[id^="dn-from-"]'), await page.inputValue('[id^="dn-to-"]'), await page.locator('.dn-sheet .dn-quick .dn-chip.on').textContent(), await page.locator('.dn-stage .t').textContent()],
    ['Add a donation', 'dn-name', 'פרנס החודש', '2026-11-11', '2026-12-10', 'כסלוthis month', 'פרנס חודש כסלו']);
  await page.click('#dn-save'); await page.waitForTimeout(150);
  ok('saving with nothing typed is refused, beside the name, in a plain sentence', [await page.locator('.dn-err').first().textContent(), await formOpen(page), await page.evaluate(() => document.activeElement.id.replace(/-\d+$/, ''))], ['Enter the name of the donor.', 1, 'dn-name']);
  await page.click('.dn-kindbtn[data-kind="day"]'); await page.waitForTimeout(150);
  ok('choosing פרנס היום turns the dates to today and offers today and tomorrow', [await page.inputValue('[id^="dn-from-"]'), await page.inputValue('[id^="dn-to-"]'), await page.locator('.dn-sheet .dn-quick .dn-chip').allTextContents(), await page.locator('.dn-stage .t').textContent(), await page.locator('.dn-stage .sponsor').getAttribute('class')],
    ['2026-11-18', '2026-11-18', ['Today', 'Tomorrow'], 'פרנס היום', 'sponsor sp-xs']);
  await page.locator('.dn-sheet .dn-quick .dn-chip', { hasText: 'Tomorrow' }).click(); await page.waitForTimeout(100);
  ok('"Tomorrow" sets both days and shows them in Hebrew and in the civil calendar; the preview waits for a name',
    [await page.inputValue('[id^="dn-from-"]'), await page.inputValue('[id^="dn-to-"]'), await page.locator('.dn-sheet .dn-civil').first().textContent(), await page.locator('.dn-date .dn-hebd').allTextContents(), await page.locator('.dn-note').textContent()],
    ['2026-11-19', '2026-11-19', 'Thu, Nov 19, 2026', ['ט׳ כסלו תשפ״ז', 'ט׳ כסלו תשפ״ז'], 'The name and the lines appear here as you type.']);
  await page.fill('[id^="dn-name-"]', '  מו״ה אלעזר ליבערמאן הי״ו  '); await page.fill('[id^="dn-body-"]', 'לע״נ אביו\nהרב משה יודא לייב ב״ר יחיאל מיכל זצ״ל');
  ok('the preview reads as the board will: the name large, its titles small; it says the panel goes up by itself on its day', [await page.locator('.dn-stage .n .nm').textContent(), await page.locator('.dn-stage .n .hon').allTextContents(), await page.locator('.dn-err').first().textContent(), await page.locator('.dn-note').textContent()], ['אלעזר ליבערמאן', ['מו״ה', 'הי״ו'], '', 'It goes on the board by itself on its first day.']);
  await page.locator('#dn-save').dblclick(); await saved(page);
  list = await cards(page);
  ok('a double press on Save saves it once: one new card, numbered on from the last, coming up tomorrow', [await formOpen(page), list.length, list.filter(c => c.name === 'מו״ה אלעזר ליבערמאן הי״ו').map(c => [c.no, c.st, c.kind, c.start, c.end, c.rel])],
    [0, 4, [['#004', 'Coming up', 'פרנס היום', 'ט׳ כסלו תשפ״ז', 'ט׳ כסלו תשפ״ז', ['starts tomorrow', 'ends tomorrow']]]]);
  ok('the back end says it is saved, and tells what to do next', [await page.locator('.abar .status').textContent().then(t => /^Saved/.test(t)), /Saved/.test(await page.locator('#toast').textContent().catch(() => ''))], [true, true]);
  ok('the counts follow', await counts(page), ['All4', 'On the board2', 'Coming up1', 'Finished1']);

  /* one for today goes on the board at once */
  await page.click('#dn-add'); await page.waitForTimeout(200);
  await page.click('.dn-kindbtn[data-kind="week"]');
  ok('פרנס השבוע takes this week, Sunday to Shabbos', [await page.inputValue('[id^="dn-from-"]'), await page.inputValue('[id^="dn-to-"]'), await page.locator('.dn-sheet .dn-quick .dn-chip.on').textContent()], ['2026-11-15', '2026-11-21', 'This week']);
  await page.fill('[id^="dn-name-"]', 'יואל "פרנס" <b>&amp; 🎉 O\'Brien');
  await page.press('[id^="dn-name-"]', 'Enter'); await saved(page);
  list = await cards(page);
  ok('Enter in the name saves; quotes, < and &, an emoji and an apostrophe are kept as typed, as text', [list.length, list.filter(c => c.no === '#005').map(c => [c.name, c.st]), await page.locator('.dn-card b, .sponsors b').count()], [5, [['יואל "פרנס" <b>&amp; 🎉 O\'Brien', 'On the board']], 0]);
  ok('and it is on the board behind, between נר למאור and פרנס היום, at its kind\'s size', (await boardPanels(page)).map(p => [p[0], p[2]]), [['פרנס חודש כסלו', 'sp-big'], ['נר למאור לחודש כסלו', 'sp-sm'], ['פרנס השבוע', '']]);

  /* ---- it is still there after closing and coming back ---- */
  await page.reload({ waitUntil: 'networkidle' }); await enter(page);
  ok('reloading the page keeps everything that was saved', (await cards(page)).map(c => c.no).sort(), ['#001', '#002', '#003', '#004', '#005']);

  /* ---- editing ---- */
  await page.locator('.dn-card[data-no="4"] [data-act="edit"]').click(); await page.waitForTimeout(200);
  ok('Edit opens that donation with what it holds', [await page.locator('.dn-head h2').textContent(), await page.inputValue('[id^="dn-name-"]'), await page.inputValue('[id^="dn-body-"]'), await page.locator('.dn-kindbtn.on').textContent(), await page.inputValue('[id^="dn-from-"]')],
    ['Edit donation #004', 'מו״ה אלעזר ליבערמאן הי״ו', 'לע״נ אביו\nהרב משה יודא לייב ב״ר יחיאל מיכל זצ״ל', 'פרנס היום', '2026-11-19']);
  await page.fill('[id^="dn-name-"]', 'changed my mind'); await page.click('#dn-cancel'); await page.waitForTimeout(150);
  ok('Cancel leaves it as it was', [(await cards(page)).filter(c => c.no === '#004')[0].name, await formOpen(page)], ['מו״ה אלעזר ליבערמאן הי״ו', 0]);
  await page.locator('.dn-card[data-no="4"] [data-act="edit"]').click(); await page.waitForTimeout(200);
  await page.fill('[id^="dn-name-"]', 'changed again'); await page.keyboard.press('Escape'); await page.waitForTimeout(150);
  ok('so does Escape', [(await cards(page)).filter(c => c.no === '#004')[0].name, await formOpen(page)], ['מו״ה אלעזר ליבערמאן הי״ו', 0]);
  await page.locator('.dn-card[data-no="4"] [data-act="edit"]').click(); await page.waitForTimeout(200);
  await page.mouse.click(8, 450); await page.waitForTimeout(150);
  ok('a click beside the form closes it while nothing has been changed', await formOpen(page), 0);
  await page.locator('.dn-card[data-no="4"] [data-act="edit"]').click(); await page.waitForTimeout(200);
  await page.fill('[id^="dn-body-"]', 'לע״נ אביו'); await page.mouse.click(8, 450); await page.waitForTimeout(150);
  ok('but not once something has been typed: a slip does not lose it', [await formOpen(page), await page.inputValue('[id^="dn-body-"]')], [1, 'לע״נ אביו']);
  /* ---- the calendar: it opens on the Hebrew month, and tells all there is to tell about each day ---- */
  const calTitle = page => page.locator('.hcal-jump').evaluate(e => e.options[e.selectedIndex].text);
  const dayCell = (page, iso) => page.locator('.hcal-day[data-iso="' + iso + '"]');
  const cellSays = (page, iso) => dayCell(page, iso).evaluate(c => [c.querySelector('.hd').textContent, c.querySelector('.cd').textContent.trim(), c.querySelector('.tg').textContent, c.className.replace('hcal-day', '').trim()]);
  ok('the two days are shown in both calendars, each on a button of its own, and no calendar is open yet', [await page.locator('.dn-date').evaluateAll(bs => bs.map(b => Array.from(b.querySelectorAll('span:not(.ico)')).map(x => x.textContent))), await page.locator('.hcal').isVisible()],
    [[['First day', 'ט׳ כסלו תשפ״ז', 'Thu, Nov 19, 2026'], ['Last day', 'ט׳ כסלו תשפ״ז', 'Thu, Nov 19, 2026']], false]);
  await page.click('.dn-date[data-end="to"]'); await page.waitForTimeout(200);
  ok('pressing "Last day" opens the calendar under it, on the Hebrew month of that day, with the civil months it spans', [await calTitle(page), await page.locator('.hcal-sub').textContent(), await page.locator('.hcal-day').count(), await page.locator('.hcal-which').textContent(), await page.locator('.hcal').getAttribute('data-view'), await page.locator('.dn-date[data-end="to"]').getAttribute('aria-expanded')],
    ['כסלו תשפ״ז', 'Nov – Dec 2026', 30, 'Choosing the last day', 'heb', 'true']);
  ok('the week runs from the right, as on a לוח: Sunday on the right, Shabbos on the left', [await page.locator('.hcal-dow span').allTextContents(), await page.evaluate(() => { const x = iso => document.querySelector('.hcal-day[data-iso="' + iso + '"]').getBoundingClientRect(); return x('2026-11-15').left > x('2026-11-16').left && x('2026-11-21').left < x('2026-11-20').left && Math.abs(x('2026-11-15').top - x('2026-11-21').top) < 2; })],
    [['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש״ק'], true]);
  ok('each day carries its Hebrew date large and its civil date small; Rosh Chodesh, a Shabbos with its parsha, Chanukah and today are told apart',
    [await cellSays(page, '2026-11-11'), await cellSays(page, '2026-11-14'), await cellSays(page, '2026-12-01'), await cellSays(page, '2026-12-05'), await cellSays(page, '2026-12-06'), (await cellSays(page, '2026-11-18'))[3].indexOf('today') >= 0],
    [['א׳', 'Nov 11', 'ר״ח', 'rc shut'], ['ד׳', '14', 'תולדות', 'shab shut'], ['כ״א', 'Dec 1', '', ''], ['כ״ה', '5', 'וישב', 'shab moed'], ['כ״ו', '6', 'חנוכה', 'moed'], true]);
  await dayCell(page, '2026-12-05').hover(); await page.waitForTimeout(80);
  ok('pointing at a day spells it out in full under the calendar', await page.locator('.hcal-line span').allTextContents(), ['שבת קודש פרשת וישב · כ״ה כסלו תשפ״ז · חנוכה', 'Sat, Dec 5, 2026']);
  await dayCell(page, '2026-12-10').hover(); await page.waitForTimeout(80);
  ok('a weekday names the week\'s parsha too, and both of its occasions', await page.locator('.hcal-line span').allTextContents(), ['יום חמישי · ל׳ כסלו תשפ״ז · חנוכה · ראש חודש טבת · פרשת השבוע: מקץ', 'Thu, Dec 10, 2026']);
  /* the last day cannot come before the first */
  ok('choosing the last day, the days before the first one are shut', [await dayCell(page, '2026-11-17').getAttribute('aria-disabled'), await dayCell(page, '2026-11-19').getAttribute('aria-disabled')], ['true', null]);
  await dayCell(page, '2026-11-17').click({ force: true }); await page.waitForTimeout(100);
  ok('and pressing one does nothing', [await page.inputValue('[id^="dn-to-"]'), await page.locator('.hcal').isVisible()], ['2026-11-19', true]);
  await page.evaluate(() => { const t = document.querySelector('[id^="dn-to-"]'); t.value = '2026-11-17'; t.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.click('#dn-save'); await page.waitForTimeout(150);
  ok('a last day before the first, however it got there, is refused beside the dates', [await page.locator('.dn-form > .dn-err').textContent(), await formOpen(page), await page.locator('.hcal-which').textContent()], ['The last day is before the first day. Pick a later last day.', 1, 'Choosing the last day']);
  /* moving the first day past the last one carries the last day along, and the calendar goes straight on to the last day */
  await page.click('.dn-date[data-end="from"]'); await page.waitForTimeout(150);
  await dayCell(page, '2026-11-25').click(); await page.waitForTimeout(150);
  ok('moving the first day past the last carries the last day with it, the message goes, and the calendar moves on to the last day by itself', [await page.inputValue('[id^="dn-from-"]'), await page.inputValue('[id^="dn-to-"]'), await page.locator('.dn-form > .dn-err').textContent(), await page.locator('.hcal-which').textContent()],
    ['2026-11-25', '2026-11-25', '', 'Choosing the last day']);
  await dayCell(page, '2026-11-30').click(); await page.waitForTimeout(150);
  ok('pressing כ׳ כסלו sets the last day, in both calendars, and the calendar closes', [await page.inputValue('[id^="dn-to-"]'), await page.locator('.dn-date .dn-hebd').allTextContents(), await page.locator('.dn-sheet .dn-civil').nth(1).textContent(), await page.locator('.hcal').isVisible()],
    ['2026-11-30', ['ט״ו כסלו תשפ״ז', 'כ׳ כסלו תשפ״ז'], 'Mon, Nov 30, 2026', false]);
  /* moving about in it */
  await page.click('.dn-date[data-end="to"]'); await page.waitForTimeout(150);
  ok('opened again it shows the days chosen: the two ends marked, the days between them shaded', [await page.locator('.hcal-day.a').getAttribute('data-iso'), await page.locator('.hcal-day.b').getAttribute('data-iso'), await page.locator('.hcal-day.in').count()], ['2026-11-25', '2026-11-30', 4]);
  await page.click('.hcal-nav.next'); await page.waitForTimeout(120);
  ok('the arrow goes on to the next Hebrew month: טבת, with its fast', [await calTitle(page), await page.locator('.hcal-sub').textContent(), await cellSays(page, '2026-12-20'), await cellSays(page, '2026-12-11')], ['טבת תשפ״ז', 'Dec – Jan 2027', ['י׳', '20', 'עשרה בטבת', 'fast'], ['א׳', 'Dec 11', 'חנוכה', 'moed']]);
  await page.click('.hcal-nav.prev'); await page.click('.hcal-nav.prev'); await page.waitForTimeout(120);
  ok('and back, past where it started', await calTitle(page), 'חשון תשפ״ז');
  await page.selectOption('.hcal-jump', { label: 'תשרי תשפ״ח' }); await page.waitForTimeout(150);
  ok('the list of months jumps a year ahead in one go: תשרי, with its Yomim Tovim named', [await calTitle(page), await page.locator('.hcal-day').evaluateAll(ds => ds.filter(d => /yt|fast/.test(d.className)).map(d => d.querySelector('.hd').textContent + ' ' + d.querySelector('.tg').textContent))],
    ['תשרי תשפ״ח', ['א׳ ראש השנה', 'ב׳ ראש השנה', 'ג׳ צום גדליה', 'י׳ יום כיפור', 'ט״ו סוכות', 'ט״ז סוכות', 'כ״ב שמיני עצרת', 'כ״ג שמחת תורה']]);
  await page.click('.hcal-seg[data-cal="civil"]'); await page.waitForTimeout(150);
  ok('"Civil months" shows the same days by the civil month, the Hebrew date small in each', [await calTitle(page), await page.locator('.hcal-sub').textContent(), await page.locator('.hcal-day').count(), await cellSays(page, '2027-10-02')], ['Oct 2027', 'אלול – תשרי תשפ״ח', 31, ['2', 'א׳ תשרי', 'ראש השנה', 'shab yt']]);
  await page.click('.hcal-today'); await page.waitForTimeout(150);
  ok('"Today" comes back to the present month', [await calTitle(page), (await cellSays(page, '2026-11-18'))[3].indexOf('today') >= 0], ['Nov 2026', true]);
  await page.click('.hcal-seg[data-cal="heb"]'); await page.waitForTimeout(150);
  /* by keyboard */
  await dayCell(page, '2026-11-30').focus(); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowDown'); await page.waitForTimeout(80);
  ok('the arrow keys walk the days: left is the day after (the week runs from the right), down is a week on', await page.evaluate(() => document.activeElement.getAttribute('data-iso')), '2026-12-08');
  await page.keyboard.press('PageDown'); await page.waitForTimeout(120);
  ok('Page Down turns the month and keeps the place', [await calTitle(page), await page.evaluate(() => document.activeElement.getAttribute('data-iso'))], ['טבת תשפ״ז', '2027-01-07']);
  await page.keyboard.press('Escape'); await page.waitForTimeout(120);
  ok('Escape closes the calendar, not the form, and nothing was changed by looking', [await page.locator('.hcal').isVisible(), await formOpen(page), await page.inputValue('[id^="dn-to-"]'), await page.evaluate(() => document.activeElement.getAttribute('data-end'))], [false, 1, '2026-11-30', 'to']);
  await page.click('.dn-date[data-end="to"]'); await page.waitForTimeout(120);
  ok('the calendar opens on Hebrew months every time, whatever it was left on', [await page.locator('.hcal').getAttribute('data-view'), await calTitle(page)], ['heb', 'כסלו תשפ״ז']);
  await page.click('.hcal [data-cal="none"]'); await page.waitForTimeout(120);
  ok('"No last day" leaves it open-ended, and says what that means', [await page.inputValue('[id^="dn-to-"]'), await page.locator('.dn-date[data-end="to"] span:not(.ico)').allTextContents(), await page.locator('.hcal').isVisible()], ['', ['Last day', 'No last day', 'Stays until it is removed'], false]);
  await page.click('.dn-date[data-end="to"]'); await page.waitForTimeout(120);
  await dayCell(page, '2026-11-30').click(); await page.waitForTimeout(150);
  await page.click('#dn-save'); await saved(page);
  ok('the change is saved on the card', (await cards(page)).filter(c => c.no === '#004').map(c => [c.start, c.end, c.rel]), [['ט״ו כסלו תשפ״ז', 'כ׳ כסלו תשפ״ז', ['starts in 7 days', 'ends in 12 days']]]);

  /* ---- on and off ---- */
  const switchOf = (page, no) => page.locator('.dn-card[data-no="' + no + '"] .dn-switch');
  const switches = page => page.locator('.dn-card').evaluateAll(cs => cs.map(c => [c.querySelector('.dn-no').textContent, c.querySelector('[data-act="onoff"]').checked, c.querySelector('.dn-switch .swl').textContent, c.querySelector('.dn-st').textContent]));
  ok('every donation has a switch, and all start on', [(await switches(page)).every(r => r[1] === true && r[2] === 'On'), (await counts(page)).some(t => /Switched off/.test(t))], [true, false]);
  await switchOf(page, 1).click(); await saved(page);
  ok('switching one off keeps it in the list, marked and counted as switched off', [(await switches(page)).filter(r => r[0] === '#001')[0], (await counts(page)).filter(t => /On the board|Switched off/.test(t)), (await cards(page)).length, /^Saved/.test(await page.locator('.abar .status').textContent())],
    [['#001', false, 'Off', 'Switched off'], ['On the board2', 'Switched off1'], 5, true]);
  ok('and takes it off the board, though its dates have not passed', (await boardPanels(page)).map(p => p[0]).indexOf('פרנס חודש כסלו'), -1);
  await page.reload({ waitUntil: 'networkidle' }); await enter(page);
  ok('it is still off after the page is opened again', (await switches(page)).filter(r => r[0] === '#001')[0], ['#001', false, 'Off', 'Switched off']);
  await page.click('[data-filter="off"]'); await page.waitForTimeout(100);
  ok('"Switched off" lists just those', (await cards(page)).map(c => c.no), ['#001']);
  await page.locator('.dn-card[data-no="1"] [data-act="edit"]').click(); await page.waitForTimeout(200);
  ok('its form says why it is not on the board, and still holds everything', [await page.locator('.dn-note').textContent(), await page.inputValue('[id^="dn-name-"]')], ['This donation is switched off, so it is not on the board. Switch it on in the list to show it.', 'מו״ה יעקב יואל פריעדמאן הי״ו']);
  await page.click('#dn-cancel'); await page.waitForTimeout(100);
  await switchOf(page, 1).click(); await saved(page);
  ok('switching it on again puts it back: on the board, the list back to all, the "Switched off" filter gone', [(await switches(page)).filter(r => r[0] === '#001')[0], (await counts(page)).some(t => /Switched off/.test(t)), (await cards(page)).length, (await boardPanels(page))[0][0]],
    [['#001', true, 'On', 'On the board'], false, 5, 'פרנס חודש כסלו']);
  await page.locator('.dn-card[data-no="1"] [data-act="onoff"]').focus(); await page.keyboard.press('Space'); await saved(page);
  ok('the switch works from the keyboard too', (await switches(page)).filter(r => r[0] === '#001')[0][2], 'Off');
  await switchOf(page, 1).click(); await saved(page);

  /* ---- copying ---- */
  await page.locator('.dn-card[data-no="2"] [data-act="copy"]').click(); await page.waitForTimeout(200);
  ok('Copy starts a new donation from another\'s details, for the present month', [await page.locator('.dn-head h2').textContent(), await page.inputValue('[id^="dn-name-"]'), await page.locator('.dn-kindbtn.on').textContent(), await page.inputValue('[id^="dn-from-"]'), await page.locator('#dn-remove').count()],
    ['Add a donation', 'ר׳ דוד ב״ר משה אלי׳ עסטרייכער ע״ה', 'נר למאור', '2026-11-11', 0]);
  await page.locator('.dn-sheet .dn-quick .dn-chip', { hasText: 'next month' }).click(); await page.click('#dn-save'); await saved(page);
  list = await cards(page);
  ok('the copy is its own donation for טבת, titled for that month; the one it came from is untouched', [list.length, list.filter(c => c.no === '#006').map(c => [c.name, c.st, c.start, c.end]), list.filter(c => c.no === '#002').map(c => c.start)],
    [6, [['ר׳ דוד ב״ר משה אלי׳ עסטרייכער ע״ה', 'Coming up', 'א׳ טבת תשפ״ז', 'כ״ט טבת תשפ״ז']], ['א׳ כסלו תשפ״ז']]);

  /* ---- removing ---- */
  await page.locator('.dn-card[data-no="5"] [data-act="remove"]').click(); await page.waitForTimeout(100);
  ok('Remove asks first, on the card itself', [await page.locator('.dn-card[data-no="5"] .dn-ask').textContent(), await page.locator('.dn-card').count()], ['Remove for good?', 6]);
  await page.locator('.dn-card[data-no="5"] .dn-acts .btn', { hasText: 'Keep it' }).click(); await page.waitForTimeout(100);
  ok('"Keep it" keeps it', [await page.locator('.dn-card[data-no="5"] [data-act="edit"]').count(), await page.locator('.dn-card').count()], [1, 6]);
  await page.locator('.dn-card[data-no="5"] [data-act="remove"]').click(); await page.locator('.dn-card[data-no="5"] [data-act="remove-yes"]').click(); await saved(page);
  ok('"Yes, remove" removes it, from the list and from the board', [(await cards(page)).map(c => c.no).sort(), (await boardPanels(page)).map(p => p[0])], [['#001', '#002', '#003', '#004', '#006'], ['פרנס חודש כסלו', 'נר למאור לחודש כסלו']]);
  await page.locator('.dn-card[data-no="3"] [data-act="edit"]').click(); await page.waitForTimeout(200);
  await page.click('#dn-remove'); await page.waitForTimeout(100);
  ok('Remove inside the form asks too', [await page.locator('.dn-foot .dn-ask').textContent(), await formOpen(page)], ['Remove this donation for good?', 1]);
  await page.click('#dn-remove-yes'); await saved(page);
  ok('and removes it', (await cards(page)).map(c => c.no).sort(), ['#001', '#002', '#004', '#006']);
  await page.click('#dn-add'); await page.waitForTimeout(200); await page.fill('[id^="dn-name-"]', 'ר׳ משה כהן'); await page.click('#dn-save'); await saved(page);
  ok('a number is never used twice, even after removals', (await cards(page)).map(c => c.no).sort(), ['#001', '#002', '#004', '#006', '#007']);
  await page.reload({ waitUntil: 'networkidle' }); await enter(page);
  ok('after a reload: the removed ones stay removed', (await cards(page)).map(c => c.no).sort(), ['#001', '#002', '#004', '#006', '#007']);

  /* ---- the kinds ---- */
  await page.click('#dn-kinds'); await page.waitForTimeout(200);
  ok('"Kinds…" lists the four kinds a shul gives out', [await page.locator('.dn-head h2').textContent(), await page.locator('.dn-kname').allTextContents()], ['Kinds of donation', ['פרנס החודש', 'נר למאור', 'פרנס השבוע', 'פרנס היום']]);
  await page.click('#dk-add'); await page.waitForTimeout(100);
  await page.click('#dk-save'); await page.waitForTimeout(100);
  ok('a kind with no name is refused in a plain sentence', [await page.locator('.dn-sheet .dn-err').textContent(), await formOpen(page)], ['Give every kind a name, or remove the empty one.', 1]);
  await page.locator('.dn-krow').last().locator('[id^="dk-name-"]').fill('קידוש');
  await page.locator('.dn-krow').last().locator('[id^="dk-title-"]').fill('קידוש פרשת {parsha}');
  await page.locator('.dn-krow').last().locator('[id^="dk-period-"]').selectOption('week');
  await page.locator('.dn-krow').nth(1).locator('[id^="dk-size-"]').selectOption('big'); /* נר למאור, large from now on */
  await page.click('#dk-save'); await saved(page);
  ok('the board follows a kind\'s new size for the donations of that kind (the two פרנס החודש first, as their kind stands first)', (await boardPanels(page)).map(p => [p[0], p[2]]), [['פרנס חודש כסלו', 'sp-big'], ['פרנס חודש כסלו', 'sp-big'], ['נר למאור לחודש כסלו', 'sp-big']]);
  await page.click('#dn-add'); await page.waitForTimeout(200);
  ok('the new kind is there to choose', await page.locator('.dn-kindbtn').allTextContents(), ['פרנס החודש', 'נר למאור', 'פרנס השבוע', 'פרנס היום', 'קידוש', 'Other']);
  await page.locator('.dn-kindbtn', { hasText: 'קידוש' }).click(); await page.waitForTimeout(100);
  ok('and titles its panel with the week\'s parsha', [await page.locator('.dn-stage .t').textContent(), await page.inputValue('[id^="dn-from-"]'), await page.inputValue('[id^="dn-to-"]')], ['קידוש פרשת ויצא', '2026-11-15', '2026-11-21']);
  await page.fill('[id^="dn-name-"]', 'משפחת גאלדבערגער'); await page.click('#dn-save'); await saved(page);
  await page.click('#dn-add'); await page.waitForTimeout(200);
  await page.locator('.dn-kindbtn', { hasText: 'Other' }).click(); await page.waitForTimeout(100);
  ok('"Other" asks for the words at the top itself, in the form', [await page.locator('.dn-form > .fields:not([hidden]) [id^="dn-title-"]').count(), await page.locator('.dn-sheet .dn-quick .dn-chip').allTextContents()], [1, ['Today', 'This week', 'כסלוthis month']]);
  await page.fill('[id^="dn-title-"]', 'סעודה שלישית'); await page.fill('[id^="dn-name-"]', 'ר׳ יודא בערגער'); await page.click('#dn-save'); await saved(page);
  ok('and is shown under those words', (await cards(page)).filter(c => c.name === 'ר׳ יודא בערגער').map(c => c.kind), ['סעודה שלישית']);
  /* a kind is removed while a donation still uses it */
  await page.click('#dn-kinds'); await page.waitForTimeout(200);
  await page.locator('.dn-krow', { hasText: 'קידוש' }).locator('.btn.danger').click(); await page.click('#dk-save'); await saved(page);
  ok('removing a kind keeps its donations, with the title they had', (await cards(page)).filter(c => c.name === 'משפחת גאלדבערגער').map(c => [c.kind, c.st]), [['קידוש פרשת ויצא', 'On the board']]);
  ok('nothing was lost along the way', (await cards(page)).length, 7);
  await ctx.close();

  /* ---- none, and a hundred ---- */
  ({ ctx, page } = await open(null, []));
  ok('with no donations the page says so and offers the first step', [await page.locator('.dn-empty h3').textContent(), await page.locator('.dn-card').count(), await counts(page)], ['No donations yet', 0, ['All0', 'On the board0', 'Coming up0', 'Finished0']]);
  await page.locator('.dn-empty .btn').click(); await page.waitForTimeout(200);
  await page.fill('[id^="dn-name-"]', 'הראשון'); await page.click('#dn-save'); await saved(page);
  ok('the first donation is #001', (await cards(page)).map(c => [c.no, c.name]), [['#001', 'הראשון']]);
  await ctx.close();
  const hundred = []; for (let i = 0; i < 100; i++) hundred.push({ title: 'פרנס היום', name: 'תורם מספר ' + (i + 1), body: 'לזכות', size: 'tiny', from: '2026-10-' + String(1 + (i % 28)).padStart(2, '0'), to: '2026-10-' + String(1 + (i % 28)).padStart(2, '0') });
  ({ ctx, page } = await open(null, hundred));
  const t0 = Date.now(); await page.fill('#dn-search', 'מספר 77'); const took = Date.now() - t0;
  ok('a hundred donations: all listed, numbered, and found at once', [await page.evaluate(() => document.querySelectorAll('#page-donations .dn-filters .dn-chip')[0].textContent), (await cards(page)).map(c => c.name), took < 1500], ['All100', ['תורם מספר 77'], true]);
  await ctx.close();

  /* ---- the turn of a month, a leap year and a new year ---- */
  ({ ctx, page } = await open(null, [], Date.UTC(2027, 0, 13, 15, 0))); /* ה׳ שבט תשפ״ז, a leap year */
  await page.click('#dn-add'); await page.waitForTimeout(200);
  ok('in שבט of a leap year next month is אדר א׳', await page.locator('.dn-sheet .dn-quick .dn-chip bdi').allTextContents(), ['שבט', 'אדר א׳']);
  await ctx.close();
  ({ ctx, page } = await open(null, [], Date.UTC(2027, 8, 20, 15, 0))); /* י״ח אלול תשפ״ז: next month is in the new year */
  await page.click('#dn-add'); await page.waitForTimeout(200);
  await page.locator('.dn-sheet .dn-quick .dn-chip').nth(1).click(); await page.waitForTimeout(100);
  ok('in אלול next month is תשרי of the new year, whole', [await page.locator('.dn-sheet .dn-quick .dn-chip bdi').allTextContents(), await page.locator('.dn-stage .t').textContent(),
    await page.locator('.dn-date .dn-hebd').allTextContents()],
    [['אלול', 'תשרי'], 'פרנס חודש תשרי', ['א׳ תשרי תשפ״ח', 'ל׳ תשרי תשפ״ח']]);
  await ctx.close();
  ({ ctx, page } = await open(null, [], Date.UTC(2026, 10, 22, 4, 30))); /* Saturday night 11:30 PM in New York: still Shabbos's date, the week not yet turned */
  await page.click('#dn-add'); await page.waitForTimeout(200); await page.click('.dn-kindbtn[data-kind="week"]'); await page.waitForTimeout(100);
  ok('"today" is the shul\'s own day: late on Saturday night the week is still the one ending that Shabbos', [await page.inputValue('[id^="dn-from-"]'), await page.inputValue('[id^="dn-to-"]')], ['2026-11-15', '2026-11-21']);
  await ctx.close();

  /* ---- a phone ---- */
  ({ ctx, page } = await open({ width: 360, height: 740 }, THREE));
  ok('on a narrow phone the list fits: no sideways scrolling, one card to a row', await page.evaluate(() => { const c = Array.from(document.querySelectorAll('.dn-card')).map(e => e.getBoundingClientRect()); return [document.documentElement.scrollWidth <= window.innerWidth, c.every(r => r.left >= 0 && r.right <= window.innerWidth), c[1].top > c[0].bottom - 1]; }), [true, true, true]);
  await page.click('#dn-add'); await page.waitForTimeout(250);
  ok('the form fills the screen, its buttons a thumb can hit, nothing off the side', await page.evaluate(() => {
    const s = document.querySelector('.dn-sheet').getBoundingClientRect(), b = Array.from(document.querySelectorAll('.dn-foot .btn, .dn-kindbtn, .dn-sheet .dn-quick .dn-chip')).map(e => e.getBoundingClientRect());
    return [Math.round(s.width) === window.innerWidth, Math.round(s.height) === window.innerHeight, b.every(r => r.height >= 40 && r.right <= window.innerWidth + 1), document.querySelector('.dn-body').scrollWidth <= document.querySelector('.dn-body').clientWidth + 1];
  }), [true, true, true, true]);
  await page.screenshot({ path: 'test/shot-donations-phone.png' });
  await ctx.close();

  /* ---- with the website connected, saving publishes ---- */
  ({ ctx, page } = await open(null, THREE));
  const sent = [];
  await ctx.route('https://api.github.com/**', async route => {
    const req = route.request();
    if (req.method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sha: 'abc123' }) });
    sent.push(JSON.parse(req.postData())); return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.evaluate(() => localStorage.setItem('minyan-github', JSON.stringify({ repo: 'someone/minyan', token: 'test-token', branch: 'main', path: 'docs/config.json' })));
  await page.reload({ waitUntil: 'networkidle' }); await enter(page);
  await page.click('#dn-add'); await page.waitForTimeout(200);
  ok('with the website connected the main button saves and publishes, with "Save only" beside it', [await page.locator('#dn-save').textContent(), await page.locator('#dn-save-only').textContent()], ['Save and publish', 'Save only']);
  await page.fill('[id^="dn-name-"]', 'מו״ה חיים גרין הי״ו'); await page.click('.dn-kindbtn[data-kind="day"]'); await page.click('#dn-save'); await page.waitForTimeout(1500);
  const pub = sent.length ? JSON.parse(Buffer.from(sent[sent.length - 1].content, 'base64').toString('utf8')) : { notices: [] };
  ok('what goes to the website holds the new donation as the board reads it', [sent.length >= 1, pub.notices.filter(n => n.name === 'מו״ה חיים גרין הי״ו').map(n => [n.title, n.size, n.from, n.to, n.no])], [true, [['פרנס היום', 'tiny', '2026-11-18', '2026-11-18', 4]]]);
  ok('and the back end says it was published', /Published/.test(await page.locator('#toast').textContent().catch(() => '')), true);
  await ctx.close();

  await browser.close();
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
  console.log(fails ? fails + ' FAILING' : 'donations: all good');
  if (fails || errors.length) process.exit(1);
})().catch(e => { console.log('ERROR', e); process.exit(1); });
