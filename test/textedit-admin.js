/* Back end → Settings → Send → "Changes by text": the numbers are read and saved through the text service with the admin PIN (the service is
   played by this test), the status says whether texting can work yet, and room numbers are part of the page's own settings. */
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
  const errors = []; let fails = 0;
  const same = (g, w) => w instanceof RegExp ? w.test(String(g)) : Array.isArray(w) ? Array.isArray(g) && g.length === w.length && w.every((x, i) => same(g[i], x)) : JSON.stringify(g === undefined ? null : g) === JSON.stringify(w === undefined ? null : w);
  const ok = (name, got, want) => { const pass = same(got, want); if (!pass) fails++; console.log((pass ? 'ok   ' : 'FAIL ') + name + (pass ? '' : ' got ' + JSON.stringify(got) + ' want ' + (Array.isArray(want) ? want.map(String).join(' , ') : want))); };
  const PIN = process.env.MINYAN_PIN || '1234';
  const svc = { editors: [{ number: '+17185550101', name: 'גבאי א' }], log: [{ at: Date.UTC(2026, 10, 22, 15, 0), who: 'גבאי א', text: 'cancel mincha 2:00', ok: true, reply: 'Cancelled: Mincha 2:00 ברך משה, today (Sunday).' }, { at: Date.UTC(2026, 10, 22, 14, 0), who: 'גבאי א', text: 'cancel mincha 2:07', ok: false, reply: 'No Mincha at 2:07 today.' }], ready: { github: false, twilio: true }, calls: [], keys: [], tw: [], lastText: undefined, down: false };
  async function open(width) {
    const ctx = await browser.newContext({ viewport: { width: width, height: 900 }, locale: 'en-US', timezoneId: 'America/New_York', serviceWorkers: 'block' });
    await ctx.route('https://*.workers.dev/**', route => route.abort()); /* nothing here may reach the real text service; the route below plays its part */
    await ctx.route('**/editors', async route => {
      const body = JSON.parse(route.request().postData() || '{}'); svc.calls.push(body);
      const cors = { 'Access-Control-Allow-Origin': '*', 'content-type': 'application/json' };
      if (svc.down) return route.abort();
      if (body.pin !== PIN) return route.fulfill({ status: 403, headers: cors, body: JSON.stringify({ error: 'wrong PIN' }) });
      if (typeof body.githubKey === 'string') { svc.keys.push(body.githubKey); if (body.githubKey === 'github_pat_FROMTHISDEVICE0123456789') svc.ready = { github: true, twilio: true, keyFrom: 'device' }; else if (!body.githubKey) svc.ready = { github: false, twilio: true, keyFrom: '' }; }
      if (typeof body.twilioKey === 'string') { svc.tw.push(body.twilioKey); svc.ready = Object.assign({}, svc.ready, { twilio: !!body.twilioKey, twilioFrom: body.twilioKey ? 'device' : '' }); }
      if (Array.isArray(body.editors)) svc.editors = body.editors.map(e => ({ number: '+1' + e.number.replace(/\D/g, '').slice(-10), name: e.name }));
      route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ editors: svc.editors, log: svc.log, ready: svc.ready, lastText: svc.lastText }) });
    });
    const page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message));
    page.on('console', x => { if (x.type() === 'error' && !/ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|ERR_INTERNET|ERR_CONNECTION|ERR_FAILED|Failed to load resource/.test(x.text())) errors.push(x.text()); });
    await page.goto('http://localhost:8790/admin.html', { waitUntil: 'networkidle' });
    await page.fill('#pin-input', PIN); await page.press('#pin-input', 'Enter'); await page.waitForSelector('#tab-home');
    await page.click('#tab-settings'); await page.locator('.subtabs button', { hasText: 'Send' }).click(); await page.waitForSelector('#te-box');
    return { ctx, page };
  }
  let { ctx, page } = await open(1280);
  await page.waitForSelector('#te-status');
  ok('the numbers come by themselves, with the PIN typed at the door', [svc.calls.length, svc.calls[0].pin === PIN, await page.locator('.te-row').count(), await page.locator('.te-row input[type=tel]').first().inputValue()], [1, true, 1, '(718) 555-0101']);
  ok('not ready yet: says which step is left; a device with no GitHub key is sent to Publish first', [await page.locator('#te-status').getAttribute('class'), /One step is left/.test(await page.locator('#te-status').textContent()), /Settings → Publish/.test(await page.locator('#te-setup').textContent()), await page.locator('#te-usekey').count(), /GITHUB_TOKEN/.test(await page.locator('.te-steps').textContent())], ['te-status warn', true, true, 0, true]);
  ok('the page does not count these as unsaved changes', await page.locator('.abar .status.dirty').count(), 0);
  await page.click('#te-add'); await page.locator('.te-row').nth(1).locator('input[type=text]').fill('משה אליעזר'); await page.locator('.te-row').nth(1).locator('input[type=tel]').fill('718 555');
  await page.click('#te-save');
  ok('a number that is not a phone number is not sent', [await page.locator('#te-msg').textContent(), svc.calls.length], [/^Check the number for משה אליעזר/, 1]);
  await page.locator('.te-row').nth(1).locator('input[type=tel]').fill('718-555-0102'); await page.click('#te-save'); await page.waitForFunction(() => /^Saved/.test(document.querySelector('#te-msg').textContent));
  ok('saved through the service', [svc.editors.map(e => e.number + ' ' + e.name), await page.locator('#te-msg').textContent(), await page.locator('.abar .status.dirty').count()], [['+17185550101 גבאי א', '+17185550102 משה אליעזר'], 'Saved. 2 numbers can text changes.', 0]);
  await page.locator('.te-row').first().locator('button').click(); await page.click('#te-save'); await page.waitForFunction(() => /1 number can/.test(document.querySelector('#te-msg').textContent));
  ok('removed and saved', svc.editors.map(e => e.name), ['משה אליעזר']);
  /* the device that publishes hands its key over with one press */
  await page.evaluate(() => localStorage.setItem('minyan-github', JSON.stringify({ repo: 'naftule11249-cyber/Minyan', branch: 'main', path: 'docs/config.json', token: 'github_pat_FROMTHISDEVICE0123456789' })));
  await page.click('#te-recheck'); await page.waitForSelector('#te-usekey');
  ok('with the Publish key on this device: one button', /already has the GitHub key/.test(await page.locator('#te-setup').textContent()), true);
  await page.click('#te-usekey'); await page.waitForSelector('#te-status.ok');
  ok('pressed: the key went to the service, the card says Ready, the setup is gone, the key is not shown anywhere', [svc.keys, /^Ready\./.test(await page.locator('#te-status').textContent()), await page.locator('#te-setup').count(), /github_pat/.test(await page.locator('#te-box').innerHTML()), await page.locator('#te-msg').textContent()], [['github_pat_FROMTHISDEVICE0123456789'], true, 0, false, 'Done. The text service can save changes now.']);
  ok('and it can be taken back', await page.locator('#te-forget').count(), 1);
  await page.locator('details.te-more', { hasText: 'Last changes' }).locator('summary').click();
  ok('the last changes by text: who, what, and what was answered', [await page.locator('.te-log').count(), await page.locator('.te-log.no').count(), /גבאי א.*cancel mincha 2:00.*✓ Cancelled/.test((await page.locator('.te-log').first().textContent()))], [2, 1, true]);
  /* room numbers belong to the settings */
  ok('room numbers as the settings have them', await page.locator('#te-rooms .te-room').evaluateAll(els => els.map(e => e.querySelector('input').value + ' ' + e.textContent.trim())), ['2 ברך משה', '1 דברי יואל', '4 לב אהרן', '3 שלמה יודא', '5 היכל אדל', ' היכל ביהמ״ד', '6 היכל חנה']);
  await page.locator('#te-rooms input[aria-label="Number for היכל ביהמ״ד"]').fill('7');
  ok('a room number is an ordinary change: Save takes it', await page.locator('.abar .status.dirty').count(), 1);
  await page.locator('.abar button.primary, button.btn.primary', { hasText: /^Save$/ }).first().click(); await page.waitForTimeout(600);
  ok('saved in the settings', await page.evaluate(() => JSON.parse(localStorage.getItem('minyan-config')).roomNumbers), { 1: 'דברי יואל', 2: 'ברך משה', 3: 'שלמה יודא', 4: 'לב אהרן', 5: 'היכל אדל', 6: 'היכל חנה', 7: 'היכל ביהמ״ד' });
  ok('and the numbers are not in the settings', /5550102|5550101/.test(await page.evaluate(() => localStorage.getItem('minyan-config'))), false);
  /* the service not answering */
  svc.down = true; await page.click('#te-save'); await page.waitForFunction(() => /^Not saved/.test(document.querySelector('#te-msg').textContent));
  ok('the service not answering: said in words, the rows stay', [await page.locator('#te-msg').textContent(), await page.locator('.te-row').count()], [/^Not saved: /, 1]);
  await page.screenshot({ path: 'test/shot-textedit.png', fullPage: false });
  await ctx.close();
  /* a service with no Twilio token: pasted here, handed over; and the line that says whether texts arrive */
  svc.down = false; svc.ready = { github: false, twilio: false, keyFrom: '', twilioFrom: '' }; svc.lastText = undefined;
  ({ ctx, page } = await open(1280)); await page.waitForSelector('#te-status');
  ok('nothing set up: two steps, in order, and no text has arrived yet', [/Two things are missing/.test(await page.locator('#te-status').textContent()), /^Step 1: the Twilio token/.test(await page.locator('#te-twilio').textContent()), /^Step 2: let the text service save changes/.test(await page.locator('#te-setup').textContent()), /^No text has reached the text service yet/.test(await page.locator('#te-last').textContent())], [true, true, true, true]);
  await page.click('#te-givetw');
  ok('an empty box is not sent', [await page.locator('#te-msg').textContent(), svc.tw.length], ['Paste the Auth Token first.', 0]);
  await page.fill('#te-twkey', '0123456789abcdef0123456789abcdef'); await page.click('#te-givetw'); await page.waitForFunction(() => !document.querySelector('#te-twilio'));
  ok('pasted and given: the step is gone, the next one is the last, the token is not on the page', [svc.tw, /^Last step: let the text service/.test(await page.locator('#te-setup').textContent()), /0123456789abcdef/.test(await page.locator('#te-box').innerHTML()), await page.locator('#te-forgettw').count(), await page.locator('.abar .status.dirty').count()], [['0123456789abcdef0123456789abcdef'], true, false, 1, 0]);
  svc.lastText = { at: Date.UTC(2026, 10, 22, 16, 5), signed: false, hadSignature: true }; await page.click('#te-refresh'); await page.waitForFunction(() => /Last text to reach/.test(document.querySelector('#te-last').textContent));
  ok('a text that did not check out says the token is probably wrong', /did NOT check out against the Twilio token/.test(await page.locator('#te-last').textContent()), true);
  svc.lastText = { at: Date.UTC(2026, 10, 22, 16, 9), signed: true, hadSignature: true }; await page.click('#te-refresh'); await page.waitForFunction(() => /checked out as coming from Twilio/.test(document.querySelector('#te-last').textContent));
  ok('one that did says so, with its time', /Last text to reach the text service: 11\/22, 11:09 AM\. It checked out/.test(await page.locator('#te-last').textContent()), true);
  await ctx.close();
  /* a phone: nothing wider than the screen */
  svc.ready = { github: false, twilio: false, keyFrom: '', twilioFrom: '' }; ({ ctx, page } = await open(390)); await page.waitForSelector('#te-status');
  ok('phone: the card fits', await page.evaluate(() => { const b = document.querySelector('#te-box'); return [b.scrollWidth <= b.clientWidth + 1, Array.from(document.querySelectorAll('#te-box button')).every(x => x.getBoundingClientRect().height >= 36)]; }), [true, true]);
  await ctx.close(); await browser.close();
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
  if (fails || errors.length) process.exit(1); else console.log('textedit-admin: all good');
})().catch(e => { console.log('ERROR', e.message); process.exit(1); });
