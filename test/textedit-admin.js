/* Back end → Settings → Send → "Changes by text", and the board reading the texted changes. The text service is played by this test:
   the numbers are read and saved with the admin PIN, nothing needs setting up, and what was texted in lies over the day on the board. */
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
  const errors = []; let fails = 0;
  const same = (g, w) => w instanceof RegExp ? w.test(String(g)) : Array.isArray(w) ? Array.isArray(g) && g.length === w.length && w.every((x, i) => same(g[i], x)) : JSON.stringify(g === undefined ? null : g) === JSON.stringify(w === undefined ? null : w);
  const ok = (name, got, want) => { const pass = same(got, want); if (!pass) fails++; console.log((pass ? 'ok   ' : 'FAIL ') + name + (pass ? '' : ' got ' + JSON.stringify(got) + ' want ' + (Array.isArray(want) ? want.map(String).join(' , ') : want))); };
  const PIN = process.env.MINYAN_PIN || '1234', CORS = { 'Access-Control-Allow-Origin': '*', 'content-type': 'application/json' };
  const svc = { editors: [{ number: '+17185550101', name: 'גבאי א' }], log: [{ at: Date.UTC(2026, 10, 22, 15, 0), who: 'גבאי א', text: 'cancel mincha 2:00', ok: true, reply: 'Cancelled: Mincha 2:00 ברך משה, today (Sunday).' }, { at: Date.UTC(2026, 10, 22, 14, 0), who: 'גבאי א', text: 'cancel mincha 2:07', ok: false, reply: 'No Mincha at 2:07 today.' }],
    ready: { trust: '', twilioFrom: '' }, lastText: undefined, days: {}, calls: [], tw: [], down: false };
  async function open(width, path) {
    const ctx = await browser.newContext({ viewport: { width: width, height: 900 }, locale: 'en-US', timezoneId: 'America/New_York', serviceWorkers: 'block' });
    await ctx.route('https://*.workers.dev/**', route => route.abort()); /* nothing here may reach the real text service; the routes below play its part */
    await ctx.route('**/changes', route => svc.down ? route.abort() : route.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ days: svc.days }) }));
    await ctx.route('**/editors', async route => {
      const body = JSON.parse(route.request().postData() || '{}'); svc.calls.push(body);
      if (svc.down) return route.abort();
      if (body.pin !== PIN) return route.fulfill({ status: 403, headers: CORS, body: JSON.stringify({ error: 'wrong PIN' }) });
      if (typeof body.twilioKey === 'string') { svc.tw.push(body.twilioKey + '|' + (body.twilioSid || '')); svc.ready = body.twilioKey ? { trust: 'signature', twilioFrom: 'device', twilioAccount: !!body.twilioSid } : { trust: 'account', twilioFrom: '', twilioAccount: false }; }
      if (body.forgetAccount) svc.ready = { trust: '', twilioFrom: '' };
      if (typeof body.clearDay === 'string') delete svc.days[body.clearDay];
      let tried; if (typeof body.tryText === 'string') tried = /מנחה פון 2/.test(body.tryText) ? { change: true, by: 'ai', read: 'move mincha 14:00 לב אהרן', reply: 'געטוישט: מנחה 2:00 ברך משה → 2:00 לב אהרן, היינט (זונטאג).\nעס וועט זיין אויפן סקרין אין א מינוט.', ai: true } : { change: false, by: 'none', ordinary: true, reply: 'מנין הבא: מנחה 2:00', ai: true };
      if (Array.isArray(body.editors)) svc.editors = body.editors.map(e => ({ number: '+1' + e.number.replace(/\D/g, '').slice(-10), name: e.name }));
      route.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ editors: svc.editors, log: svc.log, ready: svc.ready, lastText: svc.lastText, days: svc.days, tried }) });
    });
    const page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message));
    page.on('console', x => { if (x.type() === 'error' && !/ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|ERR_INTERNET|ERR_CONNECTION|ERR_FAILED|Failed to load resource/.test(x.text())) errors.push(x.text()); });
    await page.goto('http://localhost:8790/' + (path || 'admin.html'), { waitUntil: 'networkidle' });
    if (!path) { await page.fill('#pin-input', PIN); await page.press('#pin-input', 'Enter'); await page.waitForSelector('#tab-home');
      await page.click('#tab-settings'); await page.locator('.subtabs button', { hasText: 'Send' }).click(); await page.waitForSelector('#te-box'); }
    return { ctx, page };
  }
  let { ctx, page } = await open(1280);
  await page.waitForSelector('#te-status');
  ok('the numbers come by themselves, with the PIN typed at the door', [svc.calls.length, svc.calls[0].pin === PIN, await page.locator('.te-row').count(), await page.locator('.te-row input[type=tel]').first().inputValue()], [1, true, 1, '(718) 555-0101']);
  ok('before signing in: one step, no GitHub anywhere', [await page.locator('#te-status').getAttribute('class'), /^One step to go\./.test(await page.locator('#te-status').textContent()), /^No text has reached the text service yet/.test(await page.locator('#te-last').textContent()), /GitHub|GITHUB/.test(await page.locator('#te-box').textContent())], ['te-status warn', true, true, false]);
  ok('the page does not count these as unsaved changes', await page.locator('.abar .status.dirty').count(), 0);
  await page.click('#te-add'); await page.locator('.te-row').nth(1).locator('input[type=text]').fill('משה אליעזר'); await page.locator('.te-row').nth(1).locator('input[type=tel]').fill('718 555');
  await page.click('#te-save');
  ok('a number that is not a phone number is not sent', [await page.locator('#te-msg').textContent(), svc.calls.length], [/^Check the number for משה אליעזר/, 1]);
  await page.locator('.te-row').nth(1).locator('input[type=tel]').fill('718-555-0102'); await page.click('#te-save'); await page.waitForFunction(() => /^Saved/.test(document.querySelector('#te-msg').textContent));
  ok('saved through the service', [svc.editors.map(e => e.number + ' ' + e.name), await page.locator('#te-msg').textContent(), await page.locator('.abar .status.dirty').count()], [['+17185550101 גבאי א', '+17185550102 משה אליעזר'], 'Saved. 2 numbers can text changes.', 0]);
  await page.locator('.te-row').first().locator('button').click(); await page.click('#te-save'); await page.waitForFunction(() => /1 number can/.test(document.querySelector('#te-msg').textContent));
  ok('removed and saved', svc.editors.map(e => e.name), ['משה אליעזר']);
  /* the first text arrives: ready */
  svc.ready = { trust: 'signature', twilioFrom: 'device', twilioAccount: true }; svc.lastText = { at: Date.UTC(2026, 10, 22, 16, 9), signed: true, hadSignature: true };
  svc.days = { '2026-11-24': { mincha: { line: '14:15 לב אהרן', base: null, at: 1 } } };
  await page.click('#te-refresh'); await page.waitForSelector('#te-status.ok');
  ok('after the first text: Ready, with when it came', [/^Ready\. A text from one of these numbers changes the schedule/.test(await page.locator('#te-status').textContent()), /Last text to reach the text service: 11\/22, 11:09 AM\. It was accepted/.test(await page.locator('#te-last').textContent())], [true, true]);
  await page.locator('#te-days summary').click();
  ok('the days changed by text right now, by day and tefilla', [await page.locator('.te-day').count(), /Tue .*11\/24.*מנחה/.test(await page.locator('.te-day').first().textContent())], [1, true]);
  page.once('dialog', d => d.accept()); await page.locator('.te-day button').click(); await page.waitForFunction(() => /back to the regular schedule\.$/.test(document.querySelector('#te-msg').textContent));
  ok('a day put back from here', [svc.calls.filter(c => c.clearDay).map(c => c.clearDay), Object.keys(svc.days), await page.locator('.te-day').count()], [['2026-11-24'], [], 0]);
  await page.locator('details.te-more', { hasText: 'Last changes' }).locator('summary').click();
  ok('the last changes by text: who, what, and what was answered', [await page.locator('.te-log').count(), await page.locator('.te-log.no').count(), /גבאי א.*cancel mincha 2:00.*✓ Cancelled/.test((await page.locator('.te-log').first().textContent()))], [2, 1, true]);
  /* a text from somewhere else */
  /* signing in to Twilio */
  svc.ready = { trust: '', twilioFrom: '', twilioAccount: false }; await page.click('#te-refresh'); await page.waitForSelector('#te-givetw');
  ok('not signed in: one step, the sign-in boxes', [/^One step to go\. One step: sign in to Twilio/.test(await page.locator('#te-status').textContent()), await page.locator('#te-twsid').count(), await page.locator('#te-twkey').count()], [true, 1, 1]);
  await page.fill('#te-twsid', 'AC0123'); await page.click('#te-givetw');
  ok('both boxes are needed', [await page.locator('#te-msg').textContent(), svc.tw.length], ['Paste both the Account SID and the Auth Token.', 0]);
  await page.fill('#te-twsid', ' AC' + 'b'.repeat(32) + ' '); await page.fill('#te-twkey', 'c'.repeat(32)); await page.click('#te-givetw'); await page.waitForFunction(() => /Signed in to Twilio/.test(document.querySelector('#te-msg').textContent));
  ok('signed in: sent tidied, Ready, the values are not on the page, sign out is there', [svc.tw, /^Ready\./.test(await page.locator('#te-status').textContent()), /cccccccc|bbbbbbbb/.test(await page.locator('#te-box').innerHTML()), await page.locator('#te-forgettw').count(), await page.locator('.abar .status.dirty').count()], [['c'.repeat(32) + '|AC' + 'b'.repeat(32)], true, false, 1, 0]);
  /* room numbers belong to the settings */
  ok('room numbers as the settings have them', await page.locator('#te-rooms .te-room').evaluateAll(els => els.map(e => e.querySelector('input').value + ' ' + e.textContent.trim())), ['2 ברך משה', '1 דברי יואל', '4 לב אהרן', '3 שלמה יודא', '5 היכל אדל', ' היכל ביהמ״ד', '6 היכל חנה']);
  await page.locator('#te-rooms input[aria-label="Number for היכל ביהמ״ד"]').fill('7');
  ok('a room number is an ordinary change: Save takes it', await page.locator('.abar .status.dirty').count(), 1);
  await page.locator('.abar button.primary, button.btn.primary', { hasText: /^Save$/ }).first().click(); await page.waitForTimeout(600);
  ok('saved in the settings, and the numbers are not', [await page.evaluate(() => JSON.parse(localStorage.getItem('minyan-config')).roomNumbers), /5550102|5550101/.test(await page.evaluate(() => localStorage.getItem('minyan-config')))], [{ 1: 'דברי יואל', 2: 'ברך משה', 3: 'שלמה יודא', 4: 'לב אהרן', 5: 'היכל אדל', 6: 'היכל חנה', 7: 'היכל ביהמ״ד' }, false]);
  svc.down = true; await page.click('#te-save'); await page.waitForFunction(() => /^Not saved/.test(document.querySelector('#te-msg').textContent));
  ok('the service not answering: said in words, the rows stay', [await page.locator('#te-msg').textContent(), await page.locator('.te-row').count()], [/^Not saved: /, 1]);
  await ctx.close();

  /* the board: a texted change lies over that day, and goes when the service no longer has it */
  svc.down = false; svc.days = { '2026-11-24': { mincha: { line: '14:15 לב אהרן\n16:00 ברך משה', base: null, at: 1 } } };
  ({ ctx, page } = await open(1280, 'index.html?at=2026-11-24T09:00')); await page.waitForTimeout(700);
  const mincha = () => page.evaluate(() => { const s = Array.from(document.querySelectorAll('section.tefilla')).find(x => /מנחה/.test(x.querySelector('h3').textContent)); return Array.from(s.querySelectorAll('.tile')).map(t => t.querySelector('.time').textContent + ' ' + t.querySelector('.room').textContent); });
  const shacharis = () => page.evaluate(() => { const s = Array.from(document.querySelectorAll('section.tefilla')).find(x => /שחרית/.test(x.querySelector('h3').textContent)); return s.querySelectorAll('.tile').length; });
  ok('the board shows the day as texted, for that tefilla only', [await mincha(), await shacharis() > 10, await page.evaluate(() => !!JSON.parse(localStorage.getItem('minyan-config') || '{}').overrides && JSON.parse(localStorage.getItem('minyan-config')).overrides.length)], [['2:15 לב אהרן', '4:00 ברך משה'], true, false]);
  svc.down = true; await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(500);
  ok('with the service out of reach the board keeps the last changes it saw', await mincha(), ['2:15 לב אהרן', '4:00 ברך משה']);
  svc.down = false; svc.days = {}; await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(700);
  ok('taken back: the regular list again', (await mincha()).length > 4, true);
  await ctx.close();
  /* a phone: nothing wider than the screen */
  svc.ready = { trust: '', twilioFrom: '', twilioAccount: false }; ({ ctx, page } = await open(390)); await page.waitForSelector('#te-status');
  ok('phone: the card fits', await page.evaluate(() => { const b = document.querySelector('#te-box'); return [b.scrollWidth <= b.clientWidth + 1, Array.from(document.querySelectorAll('#te-box button')).filter(x => x.offsetParent).every(x => x.getBoundingClientRect().height >= 36)]; }), [true, true]);
  await ctx.close(); await browser.close();
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
  if (fails || errors.length) process.exit(1); else console.log('textedit-admin: all good');
})().catch(e => { console.log('ERROR', e.message); process.exit(1); });
