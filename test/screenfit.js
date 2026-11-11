/* The hallway screen fits its TV in every look. At 1280×720 and 1920×1080, in the Hallway, Shul, Classic and High-contrast looks, with
   two donations running: every column fits, the page does not scroll, the clock and both donation panels stand whole down the middle,
   and nothing on the screen is cut by the edge of a box that hides what leaves it. The high-contrast look's "larger type" once took
   the size away from the screen: the type stayed at the phone's size whatever the TV, nothing but the clock could shrink, and the
   second donation panel was cut off. A frame with more minyanim than fit turns pages, and every page is whole rows: no tile cut by
   the frame, the הבא badge and the ring of the next minyan whole, the last page ending on the last minyan.
   Clock frozen in New York: Wed 18 Nov 2026 9:10 AM and Shabbos 14 Nov 2026 9:00 AM. The donations are the check's own. */
const { chromium } = require('playwright');
const BASE = 'http://localhost:8790/';
const WEDNESDAY = Date.UTC(2026, 10, 18, 14, 10), SHABBOS = Date.UTC(2026, 10, 14, 14, 0);
const NOTICES = [
  { title: 'פרנס חודש כסלו', lead: 'רון שיר ושבח למע״כ הרבני הנכבד והמרום כש״ת', name: 'מו״ה יעקב יואל פריעדמאן הי״ו', logo: 'horizon.png', body: 'מחשובי מתפללי ולומדי בית מדרשינו\nלעילוי נשמת זקנתו מרת רבקה רחל בת ר׳ חיים ע״ה\nיארצייט ד׳ כסלו', size: 'big', from: '2026-11-11', to: '2026-12-10' },
  { title: 'נר למאור לחודש כסלו', lead: 'נתנדב לעילוי נשמת', name: 'ר׳ דוד ב״ר משה אלי׳ עסטרייכער ע״ה', body: 'נפטר כ״ז כסלו תשפ״ד · ג׳ דחנוכה · ת.נ.צ.ב.ה.', size: 'small', from: '2026-11-11', to: '2026-12-10' }];
const LOOKS = ['hallway', 'shul', 'classic', 'contrast'];
(async () => {
  const browser = await chromium.launch(); const errors = []; let fails = 0;
  const ok = (name, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) console.log('ok   ' + name); else { fails++; console.log('FAIL ' + name + ' got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want)); } };
  async function open(look, viewport, when, more) {
    const ctx = await browser.newContext({ viewport, locale: 'he', timezoneId: 'America/New_York', serviceWorkers: 'block' });
    await ctx.addInitScript(({ fixed }) => { const real = Date.now; const start = real(); Date.now = () => fixed + (real() - start); }, { fixed: when });
    await ctx.route('**/config.json*', async route => {
      const res = await route.fetch(); const c = JSON.parse(await res.text());
      c.palette = look; c.notices = JSON.parse(JSON.stringify(NOTICES)); delete c.donationKinds; c.banner = { text: '', from: '', until: '' };
      if (more) more(c);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(c) });
    });
    const page = await ctx.newPage(); page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/ERR_|Failed to load resource|favicon/.test(m.text())) errors.push(m.text()); });
    await page.goto(BASE + 'index.html?view=display&full=1', { waitUntil: 'networkidle' }); await page.waitForSelector('.wall .sponsor'); await page.waitForTimeout(700);
    return { ctx, page };
  }
  /* What a pair of eyes would check, in numbers. A box that hides what leaves it (a column, a frame that turns pages) cuts at its
     inner edge; everything in view has to stand inside, to within half a pixel. */
  const look = page => page.evaluate(() => {
    const W = window.innerWidth, H = window.innerHeight, html = document.documentElement, main = document.querySelector('main.wall'), cut = [];
    const name = e => e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/).join('.') : '') + ' "' + e.textContent.trim().slice(0, 16) + '"';
    const hides = e => { const cs = getComputedStyle(e); return /hidden|clip|auto|scroll/.test(cs.overflowX + cs.overflowY); };
    const edge = e => { const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return { top: r.top + parseFloat(cs.borderTopWidth), left: r.left + parseFloat(cs.borderLeftWidth), bottom: r.bottom - parseFloat(cs.borderBottomWidth), right: r.right - parseFloat(cs.borderRightWidth) }; };
    const inside = (r, b, by) => r.top - (by || 0) >= b.top - 0.5 && r.bottom + (by || 0) <= b.bottom + 0.5 && r.left - (by || 0) >= b.left - 0.5 && r.right + (by || 0) <= b.right + 0.5;
    const unseen = e => { for (let n = e; n && n !== main; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return true; } return false; };
    const cutter = e => { for (let a = e.parentElement; a && a !== main.parentElement; a = a.parentElement) if (hides(a)) return a; return null; };
    main.querySelectorAll('*').forEach(e => {
      if (e.closest('svg') && e.tagName.toLowerCase() !== 'svg') return; /* the clock is one picture */
      const r = e.getBoundingClientRect(); if (r.width < 0.5 || r.height < 0.5 || unseen(e)) return;
      if (!inside(r, { top: 0, left: 0, bottom: H, right: W })) { cut.push('off the screen: ' + name(e)); return; }
      for (let a = cutter(e); a; a = cutter(a)) if (!inside(r, edge(a))) { cut.push(name(e) + ' is cut by ' + name(a).split(' ')[0]); break; }
    });
    /* what reaches outside a tile is not an element of its own: the badge on its top edge, and the ring around the next minyan */
    main.querySelectorAll('.tile').forEach(t => {
      const a = cutter(t); if (!a || unseen(t)) return;
      const r = t.getBoundingClientRect(), badge = getComputedStyle(t, '::after'), b = edge(a);
      if (badge.content !== 'none' && badge.content !== 'normal' && r.top + (parseFloat(badge.top) || 0) < b.top - 0.5) cut.push('the badge of ' + name(t) + ' is cut by ' + name(a).split(' ')[0]);
      if (t.classList.contains('next') && a.classList.contains('grid') && !inside(r, b, 5)) cut.push('the ring of ' + name(t) + ' is cut by ' + name(a).split(' ')[0]);
    });
    const cols = Array.from(main.children), mid = main.querySelector('.wcol.mid'), me = edge(mid), panels = Array.from(mid.querySelectorAll('.sponsor'));
    const whole = e => { const r = e.getBoundingClientRect(); return r.height > 20 && inside(r, me) && inside(r, { top: 0, left: 0, bottom: H, right: W }); };
    return { look: html.getAttribute('data-palette') || 'classic', size: parseFloat(getComputedStyle(html).fontSize), columns: cols.length, columnsFit: cols.every(c => c.scrollHeight - c.clientHeight <= 1),
      noScroll: html.scrollHeight <= H && html.scrollWidth <= W, clockWhole: whole(mid.querySelector('.aclock svg')), panels: panels.map(p => p.querySelector('.t').textContent), panelsWhole: panels.map(whole),
      stacked: panels.every((p, i) => !i || p.getBoundingClientRect().top >= panels[i - 1].getBoundingClientRect().bottom), cut: cut.slice(0, 6), pagedFrames: main.querySelectorAll('.grid.paged').length };
  });

  /* ---- every look, on a 720p and a 1080p TV, on a weekday morning and on Shabbos morning ---- */
  for (const [w, h] of [[1280, 720], [1920, 1080]]) for (const [when, day] of [[WEDNESDAY, 'a weekday morning'], [SHABBOS, 'Shabbos morning']]) {
    const sizes = {};
    for (const lk of LOOKS) {
      const { ctx, page } = await open(lk, { width: w, height: h }, when);
      const v = await look(page); sizes[lk] = v.size;
      ok(w + '×' + h + ', ' + day + ', the ' + lk + ' look: three columns that fit, nothing to scroll, the clock and both donation panels whole down the middle, nothing cut',
        [v.look, v.columns, v.columnsFit, v.noScroll, v.clockWhole, v.panels, v.panelsWhole, v.stacked, v.cut], [lk, 3, true, true, true, ['פרנס חודש כסלו', 'נר למאור לחודש כסלו'], [true, true], true, []]);
      if (lk === 'contrast') await page.screenshot({ path: 'test/shot-screenfit-' + w + (when === SHABBOS ? '-shabbos' : '') + '.png' });
      await ctx.close();
    }
    /* the size is the screen's, not the look's: high contrast is set as large as the others, where it once stood at the phone's 18.4px on any TV */
    ok(w + '×' + h + ', ' + day + ': the type is the same size in every look, the one the screen and the fit give it', LOOKS.map(lk => Math.abs(sizes[lk] - sizes.hallway) <= 0.3), [true, true, true, true]);
  }
  /* ---- a day with a donation more than usual: three large panels on a 720p screen, where the clock makes the room (see clockroom.js) ---- */
  const THREE = [NOTICES[0], Object.assign({}, NOTICES[1], { size: 'big' }), { title: 'פרנס היום', lead: '', name: 'מו״ה אפרים אליעזר פריעדמאן הי״ו', body: 'לרגל נישואי בתו\nהיום באולם פרדס פיגא', size: 'big', from: '2026-11-11', to: '2026-12-10' }];
  for (const lk of ['hallway', 'contrast']) {
    const { ctx, page } = await open(lk, { width: 1280, height: 720 }, WEDNESDAY, c => { c.notices = JSON.parse(JSON.stringify(THREE)); });
    const v = await look(page);
    ok('1280×720, three large donation panels, the ' + lk + ' look: all three stand whole under the clock, the columns fit and nothing is cut',
      [v.columnsFit, v.noScroll, v.clockWhole, v.panels.length, v.panelsWhole, v.stacked, v.cut], [true, true, true, 3, [true, true, true], true, []]);
    if (lk === 'contrast') await page.screenshot({ path: 'test/shot-screenfit-three.png' });
    await ctx.close();
  }
  /* the board on a phone keeps the high-contrast look's larger type */
  {
    const { ctx, page } = await (async () => {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'he', timezoneId: 'America/New_York', serviceWorkers: 'block' });
      await ctx.addInitScript(({ fixed }) => { const real = Date.now; const start = real(); Date.now = () => fixed + (real() - start); }, { fixed: WEDNESDAY });
      await ctx.route('**/config.json*', async route => { const res = await route.fetch(); const c = JSON.parse(await res.text()); c.palette = 'contrast'; await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(c) }); });
      const page = await ctx.newPage(); page.on('pageerror', e => errors.push('pageerror: ' + e.message));
      await page.goto(BASE + 'index.html', { waitUntil: 'networkidle' }); await page.waitForTimeout(600);
      return { ctx, page };
    })();
    ok('on a phone the high-contrast board still has its larger type: 115% of the usual', await page.evaluate(() => [document.documentElement.getAttribute('data-palette'), Math.round(parseFloat(getComputedStyle(document.documentElement).fontSize) * 10) / 10]), ['contrast', 18.4]);
    await ctx.close();
  }

  /* ---- a frame that turns pages: whole rows on every page ---- */
  /* 44 minyanim from 6:00, one of them with a note under it (a taller tile): far more than a 720p screen holds at its smallest size */
  const crowd = c => {
    const rooms = ['ברך משה', 'דברי יואל', 'לב אהרן', 'שלמה יודא', 'היכל אדל'], lines = [];
    for (let i = 0; i < 44; i++) { const m = 6 * 60 + i * 8; lines.push(String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0') + ' ' + rooms[i % 5] + (i === 30 ? ' // ותיקין' : '')); }
    c.schedules.weekday.shacharis = lines.join('\n'); c.rolls = []; c.overrides = []; c.pageSeconds = 4; delete c.wallWindow; c.nextMark = 0; c.bigTime = 'start';
  };
  /* One look at the frame once it has come to rest on a page: it waits while the frame is still sliding or fading to it, while it is
     still on the page that starts at `not`, or until it is on the page that starts at `want`. */
  const frame = (page, opts) => page.waitForFunction(opts => {
    const g = Array.from(document.querySelectorAll('.wall .grid.paged')).sort((a, b) => b.children.length - a.children.length)[0]; if (!g) return null;
    const tiles = Array.from(g.children), on = tiles.filter(t => !t.classList.contains('off-page')), time = t => t.querySelector('.time').textContent;
    if (!on.length || Math.abs(g.scrollTop - (on[0].offsetTop - tiles[0].offsetTop)) > 1 || g.getAnimations({ subtree: true }).length) return null;
    if ((opts.not && time(on[0]) === opts.not) || (opts.want && time(on[0]) !== opts.want)) return null;
    const r = e => e.getBoundingClientRect(), box = r(g), col = r(g.closest('.wcol')), cs = getComputedStyle(g); /* the frame's window has no border: its box is where it cuts */
    const rowsOf = list => list.map(t => t.offsetTop).filter((v, i, all) => all.indexOf(v) === i), rowTops = rowsOf(on);
    return { first: time(on[0]), last: time(on[on.length - 1]), shown: on.map(time), all: tiles.map(time), rows: rowsOf(tiles).length, rowsShown: rowTops.length, dots: g.closest('section').querySelector('.pg').textContent.replace(/\s/g, '').length,
      /* every tile of the page whole inside the frame's window, and inside its column */
      whole: on.every(t => { const x = r(t); return x.top >= box.top - 0.5 && x.bottom <= box.bottom + 0.5 && x.left >= box.left - 0.5 && x.right <= box.right + 0.5 && x.bottom <= col.bottom + 0.5; }),
      /* a row is on the page whole or not at all, and the rows are one height, so a page ends where a row ends */
      wholeRows: tiles.every(t => rowTops.indexOf(t.offsetTop) < 0 || on.indexOf(t) >= 0), oneHeight: on.every(t => Math.abs(r(t).height - r(on[0]).height) <= 0.5),
      restUnseen: tiles.filter(t => on.indexOf(t) < 0).every(t => getComputedStyle(t).opacity === '0'),
      /* the window keeps the height of its rows: it does not grow with the frame and show the top of the next row */
      window: Math.abs((box.height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)) - (r(on[on.length - 1]).bottom - r(on[0]).top)) <= 1 };
  }, opts || {}, { timeout: 30000 }).then(hnd => hnd.jsonValue());
  {
    const { ctx, page } = await open('contrast', { width: 1280, height: 720 }, WEDNESDAY, crowd);
    const v = await look(page);
    ok('a morning of 44 minyanim on a 720p screen: the frame turns pages, and still every column fits, both donation panels are whole and nothing is cut', [v.pagedFrames >= 1, v.columnsFit, v.noScroll, v.panelsWhole, v.cut], [true, true, true, [true, true], []]);
    /* once round its pages, whichever of them it happens to be on */
    const pages = []; let f = await frame(page);
    ok('it counts its pages by rows: ' + f.rows + ' rows, ' + f.rowsShown + ' to a page, and a dot for each page', [f.dots, f.rowsShown >= 1 && f.rowsShown < f.rows], [Math.ceil(f.rows / f.rowsShown), true]);
    for (let i = 0; i < f.dots; i++) {
      const cutNow = (await look(page)).cut;
      ok('the page from ' + f.first + ' to ' + f.last + ': every tile whole, whole rows of one height, the tiles of the other pages out of sight, the window exactly its rows, nothing cut', [f.whole, f.wholeRows, f.oneHeight, f.restUnseen, f.window, cutNow], [true, true, true, true, true, []]);
      pages.push(f);
      if (i < f.dots - 1) f = await frame(page, { not: f.first });
    }
    const all = pages[0].all, start = pages.findIndex(p => p.first === all[0]), lastPage = pages[(start + pages.length - 1) % pages.length], seen = all.filter(t => pages.some(p => p.shown.indexOf(t) >= 0));
    ok('one page starts at the first minyan, the one before it ends on the last, each is as full as the others, and between them they show every minyan', [start >= 0, lastPage && lastPage.last, pages.every(p => p.rowsShown === pages[0].rowsShown), seen.length], [true, all[all.length - 1], true, all.length]);
    await page.screenshot({ path: 'test/shot-screenfit-pages.png' });
    await ctx.close();
  }
  /* the next minyan in the top row of a page: its badge and its ring reach above the row, and still show whole */
  {
    const { ctx, page } = await open('hallway', { width: 1280, height: 720 }, Date.UTC(2026, 10, 18, 10, 55), crowd);
    const f = await frame(page, { want: '6:00' }), v = await look(page);
    ok('at 5:55 the next minyan is the first tile of the first page: its הבא badge and its ring are not cut by the frame\'s window', [await page.locator('.wall .grid.paged .tile.next .time').first().textContent(), f.first, v.cut, v.columnsFit], ['6:00', '6:00', [], true]);
    await ctx.close();
  }

  await browser.close();
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
  console.log(fails ? fails + ' FAILED' : 'all ok');
  process.exit(fails || errors.length ? 1 : 0);
})().catch(e => { console.log('ERROR', e.message); process.exit(1); });
