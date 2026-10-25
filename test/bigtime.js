/* Big number on the tiles: the start by default, הודו when the viewer flips the footer switch; next minyan and countdown follow. Clock frozen Sunday 25 Oct 2026 9:22. */
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
  const errors = []; let fails = 0;
  const ok = (name, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) console.log('ok   ' + name); else { fails++; console.log('FAIL ' + name + ' got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want)); } };
  async function open(pref) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'he', timezoneId: 'America/New_York', serviceWorkers: 'block' });
    const fixed = Date.UTC(2026, 9, 25, 13, 22);
    await ctx.addInitScript(({ fixed, pref }) => { const real = Date.now; const start = real(); Date.now = () => fixed + (real() - start); try { if (pref) localStorage.setItem('minyan-big', pref); } catch (e) {} }, { fixed, pref });
    const page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|ERR_INTERNET|ERR_CONNECTION/.test(m.text())) errors.push(m.text()); });
    await page.goto('http://localhost:8790/index.html', { waitUntil: 'networkidle' }); await page.waitForTimeout(400);
    return { ctx, page };
  }
  const tileFor = async (page, time) => (await page.locator('.tile').filter({ hasText: time }).first().textContent()).replace(/\s+/g, ' ').trim();
  let { ctx, page } = await open(null);
  ok('default: next is the 9:30 start', await page.locator('section.next .time').textContent(), '9:30');
  ok('default: הודו small under it', await page.locator('section.next .ms').textContent(), 'הודו 9:40');
  ok('default: tile shows start big', /^ברך משה9:15הודו 9:25$/.test(await tileFor(page, 'הודו 9:25')), true);
  ok('switch in the footer, on start', await page.locator('#big-time').inputValue(), 'start');
  await page.selectOption('#big-time', 'milestone'); await page.waitForTimeout(300);
  ok('flipped: next is the 9:15 minyan, הודו 9:25 big', [await page.locator('section.next .time').textContent(), await page.locator('section.next .ms').textContent()], ['9:25', 'ברכות 9:15']);
  ok('flipped: countdown runs to 9:25 (about 3 min)', /^00:0[23]:/.test(await page.locator('section.next .count').textContent()), true);
  ok('flipped: tile shows הודו big, ברכות small', /^ברך משה9:25ברכות 9:15$/.test(await tileFor(page, 'ברכות 9:15')), true);
  ok('mincha tiles unchanged (no milestone)', (await page.locator('.tile .ms').allTextContents()).every(t => /^(ברכות|הודו) /.test(t)), true);
  await ctx.close();
  ({ ctx, page } = await open('milestone'));
  ok('the choice is remembered on this device', [await page.locator('#big-time').inputValue(), await page.locator('section.next .time').textContent()], ['milestone', '9:25']);
  await ctx.close(); await browser.close();
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
  if (fails || errors.length) process.exit(1); else console.log('bigtime: all good');
})();
