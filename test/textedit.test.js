/* Changes by text, end to end in the Worker bundle: a fake KV, texts posted as Twilio posts them. The service keeps the one-day
   changes itself and gives them out at /changes; nothing is written to the website. Clock: Sunday 22 Nov 2026, 10:00 in New York. */
const crypto = require('crypto');
global.Cal = require('../src/cal.js');
const Engine = require('../src/engine.js');
const base = JSON.parse(JSON.stringify(require('../config.default.json'))); base.overrides = [];
const PIN = process.env.MINYAN_PIN || '1234';
(async () => {
  const worker = (await import('../sms/dist/worker.js')).default;
  let fails = 0;
  const same = (g, w) => w instanceof RegExp ? w.test(String(g)) : Array.isArray(w) ? Array.isArray(g) && g.length === w.length && w.every((x, i) => same(g[i], x)) : JSON.stringify(g === undefined ? null : g) === JSON.stringify(w === undefined ? null : w);
  const ok = (name, got, want) => { const pass = same(got, want); if (!pass) fails++; console.log((pass ? 'ok   ' : 'FAIL ') + name + (pass ? '' : ' -> ' + JSON.stringify(got) + ' want ' + (Array.isArray(want) ? want.map(String).join(' , ') : want))); };
  const store = new Map();
  const SUBS = { get: async (k, t) => { const v = store.get(k); return v == null ? null : t === 'json' ? JSON.parse(v) : v; }, put: async (k, v) => { store.set(k, v); }, delete: async k => { store.delete(k); }, list: async () => ({ keys: [...store.keys()].map(name => ({ name })), list_complete: true }) };
  const env = { SUBS, CONFIG_URL: 'https://minyan.cascadeshul.org/config.json', ALLOWED_ORIGIN: 'https://minyan.cascadeshul.org' }; /* as the live service is: no secrets for this at all */
  let site = JSON.parse(JSON.stringify(base)); const outside = [];
  global.fetch = async (url) => {
    url = String(url);
    if (url.split('?')[0] === env.CONFIG_URL) return new Response(JSON.stringify(site), { headers: { 'content-type': 'application/json' } });
    outside.push(url); throw new Error('unexpected fetch ' + url);
  };
  const realNow = Date.now; let now = Cal.epochFromWall(Cal.rdFromGreg(2026, 11, 22), 10 * 60, 'America/New_York'); Date.now = () => now;
  const HOOK = 'https://w.example/', SID = 'AC' + '0123456789abcdef'.repeat(2), TOKEN = '0123456789abcdef'.repeat(2); /* made up, and put together here so that nothing in this file has the shape of a real Twilio ID */
  const sign = (params, token) => crypto.createHmac('sha1', token || TOKEN).update(HOOK + Object.keys(params).sort().map(k => k + params[k]).join('')).digest('base64');
  const sms = async (from, text, o) => { o = o || {}; const params = { From: from, Body: text, To: '+19298287677', AccountSid: o.sid || SID }; const headers = { 'content-type': 'application/x-www-form-urlencoded' }; if (!o.noSig) headers['X-Twilio-Signature'] = sign(params, o.token); const r = await worker.fetch(new Request(o.url || HOOK, { method: 'POST', headers, body: new URLSearchParams(params) }), o.env || env); const x = await r.text(); return { status: r.status, text: (/<Message>([\s\S]*)<\/Message>/.exec(x) || [, ''])[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&apos;/g, "'").replace(/&gt;/g, '>') }; };
  const editors = (body, e) => worker.fetch(new Request('https://w.example/editors', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '9.9.9.9' }, body: JSON.stringify(body) }), e || env);
  const changes = async () => (await (await worker.fetch(new Request('https://w.example/changes'), env)).json()).days;
  /* the day as everyone sees it: the published settings with the service's changes laid over, as the board does */
  const day = async (tef, iso) => { const c = Engine.withDayLines(site, await changes()), e = Engine(c), m = /(\d+)-(\d+)-(\d+)/.exec(iso || '2026-11-22'); return (e.scheduleFor(Cal.rdFromGreg(+m[1], +m[2], +m[3])).byTefilla[tef] || []).map(x => e.fmtTime(x.start) + (x.room ? ' ' + x.room : '')); };
  const GABBAI = '+17185550101', OTHER = '+17185550999';

  /* the list of numbers: by the admin PIN only, kept in the service */
  let r = await editors({ pin: '0000', editors: [{ number: OTHER, name: 'x' }] });
  ok('the list cannot be read or changed with a wrong PIN', [r.status, store.has('editors')], [403, false]);
  r = await editors({ pin: PIN, editors: [{ number: '(718) 555-0101', name: 'גבאי א' }, { number: '+1 718 555 0102', name: 'גבאי ב' }, { number: '718-555-0101', name: 'twice' }, { number: '12', name: 'not a number' }] });
  let j = await r.json();
  ok('saved with the PIN: numbers tidied, a repeat and a non-number left out; no text has come yet', [r.status, j.editors, j.ready], [200, [{ number: '+17185550101', name: 'גבאי א' }, { number: '+17185550102', name: 'גבאי ב' }], { trust: '', twilioFrom: '', twilioAccount: false }]);

  /* who is believed */
  const viaGet = await (await worker.fetch(new Request(HOOK + '?q=' + encodeURIComponent('cancel mincha 2:00') + '&from=' + encodeURIComponent(GABBAI)), env)).text();
  ok('the test address cannot change anything, whatever number it claims', [/Cancelled/.test(viaGet), await changes()], [false, {}]);
  r = await sms(GABBAI, 'cancel mincha 2:00', { noSig: true, sid: 'none' });
  ok('a post with no Twilio account on it is answered as an ordinary text and changes nothing', [r.status, /^Cancelled/.test(r.text), await changes(), store.has('twsid')], [200, false, {}, false]);
  r = await sms(OTHER, 'מנחה', { noSig: true });
  ok('the first text carrying a Twilio account says which account is the shul\'s, even when it was passed on without Twilio\'s signature', [/מנחה/.test(r.text), store.get('twsid'), (await (await editors({ pin: PIN })).json()).ready.trust], [true, SID, 'account']);
  r = await sms(OTHER, 'cancel mincha 2:00');
  ok('a number that is not on the list gets the ordinary answer, and nothing changes', [/Mincha|מנחה/.test(r.text), /^Cancelled/.test(r.text), await changes()], [true, false, {}]);
  r = await sms(GABBAI, 'cancel mincha 2:00', { sid: 'AC' + 'f'.repeat(32) });
  ok('a gabbai\'s number arriving from another Twilio account is not believed', [/^Cancelled/.test(r.text), await changes(), (await (await editors({ pin: PIN })).json()).lastText.signed], [false, {}, false]);
  j = (await (await editors({ pin: PIN })).json()).lastText;
  ok('the shape of the last text is noted, never what it said or who sent it', [j.fields, j.hasAccount, j.headers.some(h => /^x-twilio-signature$/i.test(h)), /5550101|cancel/.test(JSON.stringify(j))], [['AccountSid', 'Body', 'From', 'To'], true, true, false]);
  r = await sms(GABBAI, 'מנחה');
  ok('a gabbai\'s ordinary text is answered as always', [/מנחה/.test(r.text), await changes()], [true, {}]);

  /* a change */
  const before = await day('mincha');
  r = await sms(GABBAI, 'לייג צו מנחה 2:15 לב אהרן');
  ok('add: answered, kept by the service, and on the day as the board sees it', [r.text.split('\n')[0], (await day('mincha')).includes('2:15 לב אהרן'), Object.keys(await changes()), Object.keys((await changes())['2026-11-22'])], ['צוגעלייגט: מנחה 2:15 לב אהרן, היינט (זונטאג).', true, ['2026-11-22'], ['mincha']]);
  ok('nothing was sent anywhere but to the site for its settings; the other days and tefillos are as they were', [outside, await day('shacharis'), await day('mincha', '2026-11-23')], [[], (() => { const e = Engine(base); return e.scheduleFor(Cal.rdFromGreg(2026, 11, 22)).byTefilla.shacharis.map(x => e.fmtTime(x.start) + ' ' + x.room); })(), (() => { const e = Engine(base); return e.scheduleFor(Cal.rdFromGreg(2026, 11, 23)).byTefilla.mincha.map(x => e.fmtTime(x.start) + ' ' + x.room); })()]);
  r = await sms('whatsapp:+17185550102', 'cancel mincha 2:00');
  ok('the second gabbai, by WhatsApp: the change builds on the first one', [r.text.split('\n')[0], (await day('mincha')).includes('2:15 לב אהרן'), (await day('mincha')).includes('2:00 ברך משה')], ['Cancelled: Mincha 2:00 ברך משה, today (Sunday).', true, false]);
  r = await sms(GABBAI, 'cancel mincha 2:00');
  ok('what is no longer there is not found', /^No Mincha at 2:00 today/.test(r.text), true);
  r = await sms(OTHER, 'mincha');
  ok('the answers to everyone else follow the change', [/2:15/.test(r.text), /2:00/.test(r.text)], [true, false]);

  /* undo: each sender their own last change */
  r = await sms(GABBAI, 'צוריק');
  ok('undo takes back the sender\'s own change and leaves the other gabbai\'s', [r.text.split('\n')[0], (await day('mincha')).includes('2:15 לב אהרן'), (await day('mincha')).includes('2:00 ברך משה')], ['צוריקגעצויגן: צוגעלייגט: מנחה 2:15 לב אהרן, היינט (זונטאג).', false, false]);
  r = await sms(GABBAI, 'undo');
  ok('a second undo has nothing to take back', r.text, /^Nothing to undo/);
  r = await sms('+17185550102', 'undo');
  ok('the other gabbai\'s undo: the day is the regular one again and the service holds nothing', [/^Undone: Cancelled: Mincha 2:00/.test(r.text), await changes(), await day('mincha')], [true, {}, before]);

  /* together with the back end */
  r = await sms(GABBAI, 'add maariv 9:15 ברך משה');
  site = JSON.parse(JSON.stringify(base)); site.savedAt = now + 5; site.banner = { text: 'x' }; /* something else is published: the change stays */
  ok('a publish of something else leaves the texted change in place', (await day('maariv')).includes('9:15 ברך משה'), true);
  site.overrides = [{ date: '2026-11-22', label: 'שינוי להיום', lines: { maariv: '20:00 דברי יואל' } }]; /* the back end gives that day's maariv a list of its own */
  ok('once the back end gives that tefilla its own list for the day, the back end\'s stands', await day('maariv'), ['8:00 דברי יואל']);
  r = await sms(GABBAI, 'add maariv 9:25');
  ok('and a new text builds on the back end\'s list', [r.text.split('\n')[0], await day('maariv')], ['Added: Maariv 9:25, today (Sunday).', ['8:00 דברי יואל', '9:25']]);
  r = await sms(GABBAI, 'cancel maariv 8:00'); r = await sms(GABBAI, 'cancel maariv 9:25');
  ok('a tefilla emptied by texts shows none that day, not the regular list', [await day('maariv'), (await changes())['2026-11-22'].maariv.line], [[], '# בוטל להיום']);
  site = JSON.parse(JSON.stringify(base)); store.delete('textdays');

  /* the stronger lock: the Twilio Auth Token pasted into the card */
  j = await (await editors({ pin: PIN, twilioKey: 'short' })).json();
  ok('something that is not a Twilio token is not kept', [/32 letters and digits/.test(j.keyError), j.ready.trust], [true, 'account']);
  j = await (await editors({ pin: PIN, twilioKey: ' ' + TOKEN + ' ' })).json();
  ok('the token is kept and never sent back; every text is now checked by its signature', [j.ready, /0123456789abcdef/.test(JSON.stringify(j))], [{ trust: 'signature', twilioFrom: 'device', twilioAccount: false }, false]);
  r = await sms(GABBAI, 'add mincha 2:15', { token: 'f'.repeat(32) });
  ok('a text signed with something else is still answered, but cannot change anything', [r.status, /^Added/.test(r.text), await changes()], [200, false, {}]);
  r = await sms(GABBAI, 'add mincha 2:15');
  ok('a properly signed one can', [r.text.split('\n')[0], (await day('mincha')).includes('2:15')], ['Added: Mincha 2:15, today (Sunday).', true]);
  const bare = { From: GABBAI, Body: 'undo', To: '+19298287677', AccountSid: SID }, bareSig = crypto.createHmac('sha1', TOKEN).update('https://w.example' + Object.keys(bare).sort().map(k => k + bare[k]).join('')).digest('base64');
  r = await worker.fetch(new Request('https://w.example/', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': bareSig }, body: new URLSearchParams(bare) }), env);
  ok('an address typed into Twilio without its final slash is the same address', [r.status, /Undone: Added: Mincha 2:15/.test(await r.text())], [200, true]);
  const withSecret = Object.assign({}, env, { TWILIO_AUTH_TOKEN: TOKEN });
  r = await sms(GABBAI, 'מנחה', { env: withSecret, token: 'f'.repeat(32) });
  ok('with the token as the service\'s own secret an unsigned text is refused outright, as before', r.status, 403);
  j = await (await editors({ pin: PIN, twilioKey: '' })).json();
  ok('token taken back: the account lock is still there', j.ready, { trust: 'account', twilioFrom: '', twilioAccount: false });
  j = await (await editors({ pin: PIN, forgetAccount: true })).json();
  ok('and that can be started over too', [j.ready.trust, store.has('twsid')], ['', false]);
  await sms(OTHER, 'מנחה');

  /* a text in the gabbai's own words: the AI fills in a form, the form becomes a plain command, and the rest is as always */
  const asked = []; let form = null, aiDown = false;
  const withAi = Object.assign({}, env, { AI: { run: async (model, input) => { asked.push(input.messages[1].content); if (aiDown) throw new Error('AI is busy'); return { response: typeof form === 'function' ? form(input) : form }; } } });
  const say = (from, text) => sms(from, text, { env: withAi });
  store.delete('textdays');
  r = await say(GABBAI, 'לייג צו מנחה 2:15 לב אהרן'); await say(GABBAI, 'צוריק');
  r = await say(GABBAI, 'מנחה');
  ok('a text written the plain way, and an ordinary one, never go to the AI', asked, []);
  form = input => { ok('the AI is told the day, the rooms with their numbers and today\'s minyanim', [/Now: sunday, 10:00/.test(input.messages[0].content), /- לב אהרן \(room number 4\)/.test(input.messages[0].content), /mincha \(מנחה\): 12:12 ברך משה, 14:00 ברך משה/.test(input.messages[0].content)], [true, true, true]); return { intent: 'move', tefilla: 'mincha', time: '14:00', new_time: null, room: 'לב אהרן', day: 'today' }; };
  r = await say(GABBAI, 'מאך די מנחה פון 2 אין לב אהרן היינט');
  ok('his own words: understood, done, and said back in his language with what was done', [r.text.split('\n')[0], (await day('mincha')).includes('2:00 לב אהרן'), asked.length], ['געטוישט: מנחה 2:00 ברך משה → 2:00 לב אהרן, היינט (זונטאג).', true, 1]);
  form = { intent: 'undo' }; r = await say(GABBAI, 'טעות, נעם עס צוריק');
  ok('"take it back" in his own words is undo', [/^צוריקגעצויגן: געטוישט: מנחה 2:00/.test(r.text), await changes()], [true, {}]);
  form = '{"intent":"cancel","tefilla":"maariv","time":"21:30","new_time":null,"room":null,"day":"tomorrow"}';
  r = await say(GABBAI, 'pls no maariv 930 tmrw');
  ok('the form may come back as text; English gets an English answer', [r.text.split('\n')[0], Object.keys(await changes())], ['Cancelled: Maariv 9:30 דברי יואל, tomorrow (Monday).', ['2026-11-23']]);
  await say(GABBAI, 'undo');
  form = { intent: 'add', tefilla: 'mincha', time: '14:15', room: 'the big hall upstairs', day: 'someday' };
  r = await say(GABBAI, 'add a mincha quarter past two in the big hall upstairs');
  ok('a room or a day the AI made up is left out, never written in', [r.text.split('\n')[0], (await changes())['2026-11-22'].mincha.line.includes('14:15\n') || /14:15$/.test((await changes())['2026-11-22'].mincha.line)], ['Added: Mincha 2:15, today (Sunday).', true]);
  await say(GABBAI, 'undo');
  form = { intent: 'add', tefilla: 'mincha', time: '14:15', room: '4' }; r = await say(GABBAI, 'נאך א מנחה 2:15 אין חדר פיר');
  ok('a room given back as its number is that room', r.text.split('\n')[0], 'צוגעלייגט: מנחה 2:15 לב אהרן, היינט (זונטאג).');
  await say(GABBAI, 'צוריק');
  form = { intent: 'cancel', tefilla: 'mincha', time: '14:07' }; r = await say(GABBAI, 'די מנחה פון זיבן נאך צוויי איז אפגעזאגט');
  ok('understood but no such minyan: said so, with what there is, and nothing changes', [/^נישט געפונען מנחה 2:07 היינט/.test(r.text), await changes()], [true, {}]);
  form = { intent: 'none' }; let n0 = asked.length; r = await say(GABBAI, 'ווען איז די לעצטע מנחה היינט ביטע?');
  ok('a question is answered as anyone\'s text', [/מנחה/.test(r.text), /נישט פארשטאנען/.test(r.text), asked.length - n0, await changes()], [true, false, 1, {}]);
  form = { intent: 'add', tefilla: 'mincha', time: '14:15' }; n0 = asked.length; r = await say(OTHER, 'please add a mincha at 2:15 today thanks');
  ok('someone not on the list is never read by the AI and changes nothing', [asked.length - n0, /^Added/.test(r.text), await changes()], [0, false, {}]);
  aiDown = true; r = await say(GABBAI, 'מאך די מנחה פון 2 אין לב אהרן');
  ok('the AI not answering: the text is answered as an ordinary one, nothing breaks', [r.status, /מנחה/.test(r.text), await changes()], [200, true, {}]);
  r = await say(GABBAI, 'cancel mincha 2:00'); await say(GABBAI, 'undo');
  ok('and the plain way works without it', r.text.split('\n')[0], 'Cancelled: Mincha 2:00 ברך משה, today (Sunday).');
  aiDown = false; form = { intent: 'move', tefilla: 'mincha', time: '14:00', new_time: '14:20' };
  j = await (await editors({ pin: PIN, tryText: 'רוק די 2:00 מנחה אויף 2:20' }, withAi)).json();
  ok('"Try a text" from the back end: what it would do and answer, without doing it', [j.tried.change, j.tried.by, j.tried.reply.split('\n')[0], await changes(), j.ai], [true, 'rules', 'געטוישט: מנחה 2:00 ברך משה → 2:20 ברך משה, היינט (זונטאג).', {}, true]);
  j = await (await editors({ pin: PIN, tryText: 'די צוויי אזייגער מנחה וועט זיין צוואנציג נאך' }, withAi)).json();
  ok('and for a text in his own words it shows how it was read', [j.tried.change, j.tried.by, j.tried.read, await changes()], [true, 'ai', 'move mincha 14:00 to 14:20', {}]);
  j = await (await editors({ pin: PIN, tryText: 'מנחה' }, withAi)).json();
  ok('an ordinary text tried: the ordinary answer', [j.tried.change, j.tried.ordinary, /מנחה/.test(j.tried.reply)], [false, true, true]);
  store.delete('textdays'); store.delete('undo:17185550101');

  /* the shul's relay (the hotline's Twilio Function) passes texts on without a signature: checked with Twilio by the message ID */
  store.delete('twsid'); store.delete('twkey'); store.delete('twacct'); store.delete('textdays');
  const ACCT = 'AC' + 'b'.repeat(32), TOK = 'c'.repeat(32), twMsgs = {}; let twAsked = 0;
  const realFetch = global.fetch;
  global.fetch = async (url, init) => { url = String(url);
    if (url === 'https://api.twilio.com/2010-04-01/Accounts/' + ACCT + '.json') return new Response('{}', { status: (init.headers.Authorization === 'Basic ' + Buffer.from(ACCT + ':' + TOK).toString('base64')) ? 200 : 401 });
    const m = /Accounts\/(AC\w+)\/Messages\/(\w+)\.json$/.exec(url);
    if (m) { twAsked++; if (init.headers.Authorization !== 'Basic ' + Buffer.from(ACCT + ':' + TOK).toString('base64')) return new Response('{}', { status: 401 }); return twMsgs[m[2]] ? new Response(JSON.stringify(twMsgs[m[2]])) : new Response('{}', { status: 404 }); }
    return realFetch(url, init); };
  const relay = async (from, text, o) => { o = o || {}; const msid = o.msid || ('SM' + crypto.randomBytes(16).toString('hex'));
    if (!o.fake) twMsgs[msid] = { direction: 'inbound', from: from.replace('whatsapp:', ''), to: '+19298287677', body: o.realBody || text };
    const params = { Body: text, From: from, To: '+19298287677', MessageSid: msid };
    const res = await worker.fetch(new Request(HOOK, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'node' }, body: new URLSearchParams(params) }), env); const x = await res.text(); return { status: res.status, text: (/<Message>([\s\S]*)<\/Message>/.exec(x) || [, ''])[1], msid }; };
  r = await relay(GABBAI, 'cancel mincha 2:00');
  ok('before signing in, a relayed text changes nothing and Twilio is not asked', [/^Cancelled/.test(r.text), await changes(), twAsked], [false, {}, 0]);
  j = await (await editors({ pin: PIN, twilioSid: ACCT, twilioKey: 'd'.repeat(32) })).json();
  ok('a wrong Auth Token is caught at once and nothing is kept', [/does not accept/.test(j.keyError), store.has('twkey'), store.has('twacct')], [true, false, false]);
  j = await (await editors({ pin: PIN, twilioSid: 'AC123', twilioKey: TOK })).json();
  ok('nor an SID that is not one', [/Account SID/.test(j.keyError), store.has('twacct')], [true, false]);
  j = await (await editors({ pin: PIN, twilioSid: ACCT, twilioKey: TOK })).json();
  ok('signed in: both kept, never sent back', [j.keyError, j.ready.trust, j.ready.twilioAccount, new RegExp(TOK).test(JSON.stringify(j))], [undefined, 'signature', true, false]);
  r = await relay(GABBAI, 'cancel mincha 2:00');
  ok('a gabbai text through the relay, which Twilio confirms, changes the day', [r.text.split('\n')[0], (await day('mincha')).includes('2:00 ברך משה')], ['Cancelled: Mincha 2:00 ברך משה, today (Sunday).', false]);
  r = await relay(GABBAI, 'undo');
  ok('and undo', [/^Undone/.test(r.text), await changes()], [true, {}]);
  const again = r.msid; r = await relay(GABBAI, 'undo', { msid: again });
  ok('the same message ID again (a copied request) is not believed twice', /^Undone|^Nothing to undo/.test(r.text) && !/^Undone/.test(r.text) || !/^Undone/.test(r.text), true);
  r = await relay(GABBAI, 'cancel mincha 2:00', { fake: true });
  ok('a made-up message ID Twilio does not have changes nothing', [/^Cancelled/.test(r.text), await changes()], [false, {}]);
  r = await relay(GABBAI, 'cancel mincha 2:00', { realBody: 'hello' });
  ok('a real message ID with other words than it had changes nothing', [/^Cancelled/.test(r.text), await changes()], [false, {}]);
  r = await relay(OTHER, 'cancel mincha 2:00');
  ok('someone not on the list changes nothing', [/^Cancelled/.test(r.text), await changes()], [false, {}]);
  j = await (await editors({ pin: PIN, twilioKey: '', twilioSid: '' })).json();
  ok('signed out: both gone', [store.has('twkey'), store.has('twacct'), j.ready.twilioAccount], [false, false, false]);
  global.fetch = realFetch;

  /* odds and ends */
  r = await sms(GABBAI, 'גבאי');
  ok('examples for a gabbai', r.text, /^טוישן א מנין דורך טעקסט/);
  r = await sms(OTHER, 'גבאי');
  ok('but not for anyone else', /טוישן א מנין/.test(r.text), false);
  r = await sms(GABBAI, 'add mincha 2:15 tuesday');
  now = Cal.epochFromWall(Cal.rdFromGreg(2026, 11, 25), 10 * 60, 'America/New_York');
  ok('a day that has gone by is no longer given out', [Object.keys(await changes()), store.has('textdays')], [[], true]);
  now = Cal.epochFromWall(Cal.rdFromGreg(2026, 11, 28), 10 * 60, 'America/New_York');
  r = await sms(GABBAI, 'add mincha 2:15');
  ok('on Shabbos nothing is changed and nothing is answered', [r.text, await changes()], ['', {}]);

  /* the log the admin page shows */
  j = await (await editors({ pin: PIN })).json();
  ok('the last changes, newest first, by name', [j.log.length >= 10, j.log[0].who, j.log[0].ok, j.log.some(x => /9\.9\.9|0123456789abcdef/.test(JSON.stringify(x)))], [true, 'גבאי א', false, false]);
  ok('the numbers are nowhere in what the board is given', /5550101|5550102/.test(JSON.stringify(await (await worker.fetch(new Request('https://w.example/changes'), env)).text())), false);
  Date.now = realNow;
  console.log(fails ? fails + ' FAILURES' : 'textedit: all good');
  if (fails) process.exit(1);
})().catch(e => { console.log('ERROR', e); process.exit(1); });
