/* The sponsor panels on the board (the website and the app): one above the other in the order the back end gives them — פרנס החודש
   first, the smaller ones under it — at every width, never side by side. The sponsor's own mark is always in view: beside the name
   where the panel is wide enough, under the name on a phone. The name keeps to one line with its titles small around it, and a name
   too long for the panel breaks between words. The hallway screen keeps its own layout. Clock frozen Wed 18 Nov 2026, 9:10 AM. */
const { chromium } = require('playwright');
const BASE = 'http://localhost:8790/', FIXED = Date.UTC(2026, 10, 18, 14, 10);
const NOTICES = [
  { title: 'פרנס חודש כסלו', lead: 'רון שיר ושבח למע״כ הרבני הנכבד והמרום כש״ת', name: 'מו״ה יעקב יואל פריעדמאן הי״ו', logo: 'horizon.png', body: 'מחשובי מתפללי ולומדי בית מדרשינו\nלעילוי נשמת זקנתו מרת רבקה רחל בת ר׳ חיים ע״ה\nיארצייט ד׳ כסלו', size: 'big', from: '2026-11-11', to: '2026-12-10' },
  { title: 'נר למאור לחודש כסלו', lead: 'נתנדב לעילוי נשמת', name: 'ר׳ דוד ב״ר משה אלי׳ עסטרייכער ע״ה', body: 'נפטר כ״ז כסלו תשפ״ד · ג׳ דחנוכה · ת.נ.צ.ב.ה.', size: 'small', from: '2026-11-11', to: '2026-12-10' }];
const LONG = [{ title: 'פרנס השבוע', name: 'הרה״ח מו״ה אברהם יהושע העשיל אייזענבערגער־ראטטענבערג שליט״א', logo: 'horizon.png', body: 'לרגל שמחת נישואי בנו', size: 'big', from: '2026-11-11', to: '2026-12-10' }];
(async () => {
  const browser = await chromium.launch(); const errors = []; let fails = 0;
  const ok = (name, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) console.log('ok   ' + name); else { fails++; console.log('FAIL ' + name + ' got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want)); } };
  async function open(path, viewport, notices) {
    const ctx = await browser.newContext({ viewport, locale: 'he', timezoneId: 'America/New_York', serviceWorkers: 'block' });
    await ctx.addInitScript(({ fixed }) => { const real = Date.now; const start = real(); Date.now = () => fixed + (real() - start); }, { fixed: FIXED });
    await ctx.route('**/config.json*', async route => {
      const res = await route.fetch(); const c = JSON.parse(await res.text());
      c.notices = JSON.parse(JSON.stringify(notices || NOTICES)); delete c.donationKinds; c.banner = { text: '', from: '', until: '' };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(c) });
    });
    const page = await ctx.newPage(); page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/ERR_|Failed to load resource|favicon/.test(m.text())) errors.push(m.text()); });
    await page.goto(BASE + path, { waitUntil: 'networkidle' }); await page.waitForSelector('.sponsor'); await page.waitForTimeout(700);
    return { ctx, page };
  }
  /* what a pair of eyes would check, in numbers */
  const look = page => page.evaluate(() => {
    const W = window.innerWidth, r = e => e.getBoundingClientRect();
    const lines = e => Math.round(r(e).height / parseFloat(getComputedStyle(e).lineHeight));
    const panels = Array.from(document.querySelectorAll('.sponsors .sponsor')).map(p => {
      const n = p.querySelector('.n'), g = p.querySelector('.slogo'), t = p.querySelector('.t'), lead = p.querySelector('.lead'), pr = r(p), nr = r(n), gr = g ? r(g) : null;
      /* the words of the name themselves, not the box they sit in */
      const words = Array.from(n.children).map(r), wl = Math.min.apply(null, words.map(x => x.left)), wr = Math.max.apply(null, words.map(x => x.right));
      return { title: t.textContent, top: Math.round(pr.top), bottom: Math.round(pr.bottom), left: Math.round(pr.left), width: Math.round(pr.width), inPage: pr.left >= 0 && pr.right <= W + 1,
        nameLines: lines(n), nameSize: parseFloat(getComputedStyle(n).fontSize), titleLines: lines(t), leadLines: lead ? lines(lead) : 0, nameInside: wl >= pr.left && wr <= pr.right, nameCentred: Math.abs((wl + wr) / 2 - (pr.left + pr.right) / 2) <= 3,
        honSmall: Array.from(n.querySelectorAll('.hon')).every(h => parseFloat(getComputedStyle(h).fontSize) < 0.7 * parseFloat(getComputedStyle(n).fontSize)),
        logo: gr ? { w: Math.round(gr.width), h: Math.round(gr.height), inside: gr.left >= pr.left && gr.right <= pr.right && gr.top >= pr.top && gr.bottom <= pr.bottom, loaded: g.complete && g.naturalWidth > 0,
          beside: (gr.right <= wl + 1 || gr.left >= wr - 1) && gr.top < nr.bottom && gr.bottom > nr.top, under: gr.top >= nr.bottom - 1, centred: Math.abs((gr.left + gr.right) / 2 - (pr.left + pr.right) / 2) <= 3 } : null };
    });
    return { panels, noSideways: document.documentElement.scrollWidth <= W, firstBelowHeader: panels.length ? panels[0].top >= Math.round(r(document.querySelector('header.top')).bottom) : null };
  });

  for (const [w, h, name, logoPlace] of [[360, 740, 'a small phone', 'under'], [390, 844, 'a phone', 'under'], [690, 1000, 'a tablet', 'beside'], [1280, 900, 'a computer', 'beside']]) {
    const { ctx, page } = await open('index.html', { width: w, height: h });
    const v = await look(page), [a, b] = v.panels;
    ok(name + ' (' + w + 'px): פרנס החודש stands above נר למאור, one panel to a row, nothing off the page', [v.panels.map(p => p.title), b.top >= a.bottom, a.left === b.left && a.width === b.width, a.inPage && b.inPage, v.noSideways, v.firstBelowHeader],
      [['פרנס חודש כסלו', 'נר למאור לחודש כסלו'], true, true, true, true, true]);
    ok(name + ': the sponsor\'s mark is there to be seen, ' + (logoPlace === 'under' ? 'under the name in the middle' : 'beside the name, which keeps the middle'), [a.logo.loaded, a.logo.w >= 80 && a.logo.h >= 16, a.logo.inside, a.logo[logoPlace], logoPlace === 'under' ? a.logo.centred : a.nameCentred],
      [true, true, true, true, true]);
    ok(name + ': each name is one line inside its panel, its titles small beside it, and the big panel\'s name the larger', [a.nameLines, b.nameLines, a.nameInside && b.nameInside, a.honSmall && b.honSmall, a.nameSize > b.nameSize * 1.05, a.titleLines, b.titleLines],
      [1, 1, true, true, true, 1, 1]);
    await page.screenshot({ path: 'test/shot-sponsors-' + w + '.png' });
    await ctx.close();
  }

  /* a line under the name that is too long for a phone breaks into even halves, not one word alone */
  let { ctx, page } = await open('index.html', { width: 390, height: 844 });
  ok('a long line under the name breaks evenly: no last word left by itself', await page.evaluate(() => {
    const bl = Array.from(document.querySelectorAll('.sponsor.sp-big .b .bl')), long = bl[1], rng = document.createRange(); rng.selectNodeContents(long);
    /* a row is told by where its pieces' middles fall: the small titles sit on the same line as the words beside them */
    const lh = parseFloat(getComputedStyle(long).lineHeight), top = long.getBoundingClientRect().top, rows = {};
    Array.from(rng.getClientRects()).forEach(c => { if (c.width < 1) return; const k = Math.floor((c.top + c.height / 2 - top) / lh); rows[k] = (rows[k] || 0) + c.width; });
    const ws = Object.keys(rows).map(k => rows[k]);
    return [bl.length, ws.length, Math.min.apply(null, ws) / Math.max.apply(null, ws) > 0.45];
  }), [3, 2, true]);
  await ctx.close();

  /* a name too long for the panel */
  for (const [w, h, name] of [[360, 740, 'a small phone'], [1280, 900, 'a computer']]) {
    ({ ctx, page } = await open('index.html', { width: w, height: h }, LONG));
    const v = await look(page), a = v.panels[0];
    ok(name + ': a very long name stays inside its panel, broken between words' + (w < 500 ? '' : ' if at all') + ', and the page does not scroll sideways', [a.nameInside, a.nameLines <= 3, a.nameLines >= (w < 500 ? 2 : 1), a.logo.inside && a.logo.w >= 60, v.noSideways], [true, true, true, true, true]);
    if (w < 500) ok(name + ': the break falls between words, never inside one', await page.evaluate(() => Array.from(document.querySelectorAll('.sponsor .n > span')).every(sp => { const rs = sp.getClientRects(); return sp.textContent.indexOf(' ') >= 0 || rs.length === 1; })), true);
    await ctx.close();
  }

  /* the hallway screen keeps its own arrangement: the mark at the side, the name in the middle of the panel, on one line */
  ({ ctx, page } = await open('index.html?view=display&full=1', { width: 1920, height: 1080 }));
  const wall = await page.evaluate(() => {
    const p = document.querySelector('.wall .sponsor.sp-big'), n = p.querySelector('.n'), g = p.querySelector('.slogo'), pr = p.getBoundingClientRect(), gr = g.getBoundingClientRect();
    const words = Array.from(n.children).map(e => e.getBoundingClientRect()), wl = Math.min.apply(null, words.map(x => x.left)), wr = Math.max.apply(null, words.map(x => x.right));
    return [Math.abs((wl + wr) / 2 - (pr.left + pr.right) / 2) <= 3, gr.right <= wl || gr.left >= wr, gr.width >= 60, Math.round(n.getBoundingClientRect().height / parseFloat(getComputedStyle(n).lineHeight)),
      document.querySelectorAll('.wall .sponsor').length, Array.from(document.querySelectorAll('.wall .sponsor')).every((s, i, all) => !i || s.getBoundingClientRect().top >= all[i - 1].getBoundingClientRect().bottom)];
  });
  ok('the hallway screen is as it was: the name in the middle on one line, the mark at its side, the panels one under the other', wall, [true, true, true, 1, 2, true]);
  await ctx.close();

  await browser.close();
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
  console.log(fails ? fails + ' FAILED' : 'all ok');
  process.exit(fails || errors.length ? 1 : 0);
})().catch(e => { console.log('ERROR', e.message); process.exit(1); });
