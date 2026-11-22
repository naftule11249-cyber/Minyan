
/* ---- Cloudflare Worker: text/WhatsApp responder, reminder texts, daily schedule texts and app notifications.
   Bindings: KV namespace SUBS. Variables: CONFIG_URL (required), ALLOWED_ORIGIN (the website address), VAPID_SUBJECT (mailto:…).
   Optional secret BROADCAST_KEY: a second way to authorise the admin page's "Send a notification", besides the admin PIN.
   Secrets (wrangler secret put): TWILIO_AUTH_TOKEN (also verifies Twilio's signature), TWILIO_ACCOUNT_SID, TWILIO_FROM (+1718…),
   WA_FROM (whatsapp:+1718…, optional), WA_CONTENT_SID (optional WhatsApp template), VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY.
   Cron trigger every 5 minutes (wrangler.toml) sends what is due.
   Changes by text: the secret GITHUB_TOKEN (a fine-grained token, this repository only, Contents: read and write) lets the gabbaim
   named on the admin page change one day's minyanim by a text. Without it those texts are answered "not set up yet". The repository,
   branch and file come from the site's config (githubRepo / githubBranch / githubPath); GITHUB_REPO, GITHUB_BRANCH and GITHUB_PATH
   override them. The numbers that may do it are kept in KV ("editors"), never in the public config. ---- */
async function sha256Hex(str) { var b = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str))), s = '', i; for (i = 0; i < b.length; i++) s += ('0' + b[i].toString(16)).slice(-2); return s; }
function escapeXml(s) { return s.replace(/[<>&'"]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]; }); }
async function twilioSignatureOk(request, params, token) {
  var data = request.url;
  Object.keys(params).sort().forEach(function (k) { data += k + params[k]; });
  var key = await crypto.subtle.importKey('raw', new TextEncoder().encode(token), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  var mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)));
  return btoa(String.fromCharCode.apply(null, mac)) === (request.headers.get('X-Twilio-Signature') || '');
}
/* the published schedule, fresh within a minute or two of a publish: the address changes by the minute, so the site's CDN copy is passed by */
async function loadConfig(env) { return (await fetch(env.CONFIG_URL + (env.CONFIG_URL.indexOf('?') < 0 ? '?' : '&') + 't=' + Math.floor(Date.now() / 60000), { cf: { cacheTtl: 60, cacheEverything: true } })).json(); }
function twiml(text) { return new Response('<?xml version="1.0" encoding="UTF-8"?><Response>' + (text ? '<Message>' + escapeXml(text) + '</Message>' : '') + '</Response>', { headers: { 'content-type': 'text/xml; charset=utf-8' } }); }
function cors(env, extra) { return Object.assign({ 'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'content-type' }, extra || {}); }
function json(env, obj, status) { return new Response(JSON.stringify(obj), { status: status || 200, headers: cors(env, { 'content-type': 'application/json' }) }); }
async function sendTwilio(env, to, body) {
  var isWa = /^whatsapp:/.test(to), from = isWa ? env.WA_FROM : env.TWILIO_FROM;
  if (!from || !env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) return false;
  var form = new URLSearchParams({ To: to, From: from });
  if (isWa && env.WA_CONTENT_SID) { form.set('ContentSid', env.WA_CONTENT_SID); form.set('ContentVariables', JSON.stringify({ 1: body })); } else form.set('Body', body);
  var r = await fetch('https://api.twilio.com/2010-04-01/Accounts/' + env.TWILIO_ACCOUNT_SID + '/Messages.json', {
    method: 'POST', headers: { Authorization: 'Basic ' + btoa(env.TWILIO_ACCOUNT_SID + ':' + env.TWILIO_AUTH_TOKEN), 'content-type': 'application/x-www-form-urlencoded' }, body: form });
  return r.ok;
}
/* VAPID keys for app notifications: from the secrets when set, otherwise made once on first use and kept in KV, so there is nothing to configure */
async function vapidKeys(env) {
  if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) return { pub: env.VAPID_PUBLIC_KEY, priv: env.VAPID_PRIVATE_KEY };
  var saved = await env.SUBS.get('vapid', 'json');
  if (saved && saved.pub && saved.priv) return saved;
  var kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  var jwk = await crypto.subtle.exportKey('jwk', kp.privateKey), raw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey)), s = '', i;
  for (i = 0; i < raw.length; i++) s += String.fromCharCode(raw[i]);
  saved = { pub: btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''), priv: jwk.d };
  await env.SUBS.put('vapid', JSON.stringify(saved));
  return saved;
}
async function pushEnv(env) { var k = await vapidKeys(env); return { VAPID_SUBJECT: env.VAPID_SUBJECT || 'https://minyan.cascadeshul.org', VAPID_PUBLIC_KEY: k.pub, VAPID_PRIVATE_KEY: k.priv }; }
async function allSubscriptions(env) {
  var out = [], cursor;
  do {
    var page = await env.SUBS.list({ cursor: cursor });
    for (var i = 0; i < page.keys.length; i++) if (/^(sub|push):/.test(page.keys[i].name)) out.push(page.keys[i].name);
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return out;
}
/* The admin PIN (the site's config carries its hash) or the BROADCAST_KEY secret; ten wrong tries lock that address out for an hour.
   Resolves to null when the caller is the gabbai, otherwise to the refusal to send back. */
async function adminRefusal(request, env, body, cfg) {
  var ip = request.headers.get('cf-connecting-ip') || 'unknown', failKey = 'bcfail:' + ip, fails = +(await env.SUBS.get(failKey)) || 0;
  if (fails >= 10) return json(env, { error: 'too many wrong tries; try again in an hour' }, 429);
  var hasPin = !!(cfg.pinHash || cfg.pin), okKey = !!env.BROADCAST_KEY && body.key === env.BROADCAST_KEY;
  var okPin = hasPin && typeof body.pin === 'string' && body.pin !== '' && (cfg.pinHash ? (await sha256Hex(body.pin)) === cfg.pinHash : body.pin === String(cfg.pin));
  if (okKey || okPin) return null;
  await env.SUBS.put(failKey, String(fails + 1), { expirationTtl: 3600 });
  return json(env, { error: hasPin ? 'wrong PIN' : 'set an admin PIN first' }, 403);
}

/* ---- changes by text: a gabbai's number texts "add mincha 2:15", and that day's schedule on the website changes (src/edit.js) ---- */
function phoneDigits(n) { var d = String(n || '').replace(/\D/g, ''); return d.length === 10 ? '1' + d : d; } /* +1 718 555 1234 = whatsapp:+17185551234 = 7185551234 */
function b64ToUtf8(b64) { var bin = atob(String(b64).replace(/\s+/g, '')), bytes = new Uint8Array(bin.length), i; for (i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); return new TextDecoder().decode(bytes); }
function utf8ToB64(str) { var bytes = new TextEncoder().encode(str), bin = '', i; for (i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192)); return btoa(bin); }
function ghTarget(env, cfg) { return { repo: env.GITHUB_REPO || cfg.githubRepo, branch: env.GITHUB_BRANCH || cfg.githubBranch || 'main', path: env.GITHUB_PATH || cfg.githubPath || 'docs/config.json' }; }
function ghUrl(t) { return 'https://api.github.com/repos/' + t.repo + '/contents/' + t.path.split('/').map(encodeURIComponent).join('/'); }
function ghHeaders(env) { return { Authorization: 'Bearer ' + env.GITHUB_TOKEN, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'minyan-board-texts', 'content-type': 'application/json' }; }
/* Read the settings as they are on GitHub this second (not the site's copy, which runs a minute or two behind), change them, write
   them back as the admin page's Publish does. If someone else wrote in between, read again and try once more. */
async function changeSettings(env, siteCfg, change) {
  var t = ghTarget(env, siteCfg), tries = 0;
  if (!t.repo) throw new Error('no repository');
  for (;;) {
    var r = await fetch(ghUrl(t) + '?ref=' + encodeURIComponent(t.branch), { headers: ghHeaders(env) });
    if (!r.ok) throw new Error('GitHub ' + r.status);
    var file = await r.json(), res = change(JSON.parse(b64ToUtf8(file.content)));
    if (!res.cfg) return res; /* nothing to write: not understood, not found, … */
    var w = await fetch(ghUrl(t), { method: 'PUT', headers: ghHeaders(env), body: JSON.stringify({ message: 'Update minyan schedule (by text)', content: utf8ToB64(JSON.stringify(res.cfg, null, 1)), branch: t.branch, sha: file.sha }) });
    if (w.ok) return res;
    if (w.status !== 409 || ++tries > 1) throw new Error('GitHub ' + w.status);
  }
}
async function editLog(env, entry) { var log = (await env.SUBS.get('editlog', 'json')) || []; log.unshift(entry); await env.SUBS.put('editlog', JSON.stringify(log.slice(0, 30))); }
/* The reply to a gabbai's change, or null when this text is not one (the sender is not on the list, or it is an ordinary text). */
async function textEdit(env, cfg, text, from) {
  if (!MinyanEdit.parse(text)) return null;
  var who = phoneDigits(from), ed = ((await env.SUBS.get('editors', 'json')) || []).filter(function (e) { return e.n === who; })[0];
  if (!ed) return null;
  var now = Date.now(), first = MinyanEdit.run(cfg, text, now), L = MinyanEdit.T[first.lang], undoKey = 'undo:' + who, res;
  function note(ok, reply) { return editLog(env, { at: now, who: ed.name || ('…' + who.slice(-4)), text: String(text).trim().slice(0, 140), ok: ok, reply: String(reply).split('\n')[0].slice(0, 200) }); }
  if (MinyanNotify.holyNow(cfg, now)) { await note(false, 'Shabbos / Yom Tov: nothing changed, nothing answered'); return ''; } /* nothing is changed or sent on Shabbos and Yom Tov */
  if (!first.wantsUndo && !first.cfg) { if (MinyanEdit.parse(text).action !== 'help') await note(false, first.reply); return first.reply; } /* examples, or a text that does not add up: no need to ask GitHub */
  if (!env.GITHUB_TOKEN) { await note(false, 'not set up: the service has no GITHUB_TOKEN'); return L.notSetUp; }
  try {
    if (first.wantsUndo) {
      var rec = await env.SUBS.get(undoKey, 'json');
      if (!rec) return L.noUndo;
      res = await changeSettings(env, cfg, function (c) { return MinyanEdit.undo(c, rec, first.lang, now); });
      if (res.cfg) await env.SUBS.delete(undoKey);
    } else {
      res = await changeSettings(env, cfg, function (c) { return MinyanEdit.run(c, text, now); });
      if (res.cfg) await env.SUBS.put(undoKey, JSON.stringify(res.undo), { expirationTtl: 86400 });
    }
  } catch (e) { await note(false, 'not saved: ' + (e && e.message || e)); return L.failed; }
  await note(!!res.cfg, res.reply);
  return res.reply;
}

export default {
  async fetch(request, env) {
    var url = new URL(request.url), path = url.pathname.replace(/\/+$/, '');
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors(env) });
    if (path === '/push/key') return new Response((await vapidKeys(env)).pub, { headers: cors(env, { 'content-type': 'text/plain' }) });
    if (path === '/push/subscribe' && request.method === 'POST') {
      var body = await request.json().catch(function () { return null; });
      if (!body || !body.subscription || !body.subscription.endpoint || !body.subscription.keys) return json(env, { error: 'bad request' }, 400);
      var id = body.id && /^[a-z0-9]{8,32}$/.test(body.id) ? body.id : crypto.randomUUID().replace(/-/g, '').slice(0, 20);
      var sub = { channel: 'push', push: { endpoint: body.subscription.endpoint, keys: body.subscription.keys }, reminders: (body.reminders || []).slice(0, 10).map(function (r) { var lead = Math.min(180, Math.max(1, +r.lead || 10)), o; if (/^(alos|sunrise|shema|tefilla|chatzos|minchag|plag|candles|sunset|tzeis|tzeis60|tzeis72)$/.test(r.zman || '')) o = { zman: r.zman, lead: lead }; else { o = { tefilla: String(r.tefilla), time: r.time == null ? null : +r.time, lead: lead }; if (o.time == null && /^(first|last|before:(chatzos|tefilla|shema|sunset|tzeis|plag|minchag))$/.test(r.pick || '')) o.pick = r.pick; if (r.ref === 'milestone') o.ref = 'milestone'; } if (/^\d{4}-\d{2}-\d{2}$/.test(r.once || '')) o.once = r.once; return o; }),
        daily: body.daily == null ? null : +body.daily, lang: body.lang === 'en' ? 'en' : 'he', updated: Date.now() };
      await env.SUBS.put('push:' + id, JSON.stringify(sub));
      return json(env, { id: id });
    }
    if (path === '/push/unsubscribe' && request.method === 'POST') {
      var b2 = await request.json().catch(function () { return {}; });
      if (b2.id && /^[a-z0-9]{8,32}$/.test(b2.id)) await env.SUBS.delete('push:' + b2.id);
      return json(env, { ok: true });
    }
    /* The gabbai sends a notification to every device that turned reminders on. Authorised by the admin PIN (the site's config carries its hash)
       or the BROADCAST_KEY secret; ten wrong tries lock that address out for an hour. {test: id} sends to that one device only. */
    if (path === '/push/broadcast' && request.method === 'POST') {
      var bb = await request.json().catch(function () { return null; });
      if (!bb) return json(env, { error: 'bad request' }, 400);
      var bcfg = await loadConfig(env);
      if (MinyanNotify.holyNow(bcfg, Date.now())) return json(env, { error: 'Nothing is sent on Shabbos or Yom Tov.' }, 409); /* no notifications on Shabbos and Yom Tov */
      var refused = await adminRefusal(request, env, bb, bcfg);
      if (refused) return refused;
      var title = String(bb.title || bcfg.name || '').trim().slice(0, 80), text = String(bb.body || '').trim().slice(0, 300);
      if (!text) return json(env, { error: 'empty message' }, 400);
      var names = await allSubscriptions(env), payload = JSON.stringify({ title: title, body: text, tag: 'gabbai-' + Date.now() }), penv = await pushEnv(env), sent = 0, failed = 0, gone = 0, k;
      if (bb.test) names = names.filter(function (nm) { return nm === 'push:' + bb.test; });
      for (k = 0; k < names.length; k++) {
        var ps = await env.SUBS.get(names[k], 'json');
        if (!ps || ps.channel !== 'push') continue;
        try {
          var pr = await WebPush.send(ps.push, payload, penv);
          if (pr.status === 404 || pr.status === 410) { await env.SUBS.delete(names[k]); gone++; } else if (pr.status < 300) sent++; else failed++;
        } catch (e) { failed++; }
      }
      return json(env, { sent: sent, failed: failed, gone: gone });
    }
    /* Who may change the schedule by a text: the admin page reads and saves the list here, with the admin PIN. The numbers live in KV
       only. Also tells the page whether the service can do it yet, and the last changes that were texted in. */
    if (path === '/editors' && request.method === 'POST') {
      var eb = await request.json().catch(function () { return null; });
      if (!eb) return json(env, { error: 'bad request' }, 400);
      var no = await adminRefusal(request, env, eb, await loadConfig(env));
      if (no) return no;
      if (Array.isArray(eb.editors)) {
        var seen = {}, clean = [];
        eb.editors.slice(0, 20).forEach(function (e) { var n = phoneDigits(e && e.number); if (/^\d{11,15}$/.test(n) && !seen[n]) { seen[n] = 1; clean.push({ n: n, name: String(e.name || '').trim().slice(0, 40) }); } });
        await env.SUBS.put('editors', JSON.stringify(clean));
      }
      return json(env, { editors: ((await env.SUBS.get('editors', 'json')) || []).map(function (e) { return { number: '+' + e.n, name: e.name }; }),
        log: (await env.SUBS.get('editlog', 'json')) || [], ready: { github: !!env.GITHUB_TOKEN, twilio: !!env.TWILIO_AUTH_TOKEN } });
    }
    /* Twilio webhook (SMS or WhatsApp): POST form. GET ?q=text[&from=+1…] answers in plain text for testing. */
    var isPost = request.method === 'POST', text = '', params = {}, from = '';
    if (isPost) {
      var form = await request.formData();
      form.forEach(function (v, k) { params[k] = v; });
      text = params.Body || ''; from = params.From || '';
      if (env.TWILIO_AUTH_TOKEN && !(await twilioSignatureOk(request, params, env.TWILIO_AUTH_TOKEN))) return new Response('forbidden', { status: 403 });
    } else { text = url.searchParams.get('q') || url.searchParams.get('Body') || ''; from = url.searchParams.get('from') || ''; }
    var reply;
    try {
      var cfg = await loadConfig(env), cmd = MinyanNotify.parseCommand(text, cfg);
      /* a change to the schedule: only by a text Twilio signed (so the sender's number is real), never by the test address */
      var edited = isPost && env.TWILIO_AUTH_TOKEN ? await textEdit(env, cfg, text, from) : null;
      if (edited != null) reply = edited;
      else if (cmd) {
        if (!from) reply = MinyanNotify.T[cmd.lang].notAvail;
        else {
          var key = 'sub:' + from, s = (await env.SUBS.get(key, 'json')) || {};
          s.channel = /^whatsapp:/.test(from) ? 'whatsapp' : 'sms'; s.to = from;
          reply = MinyanNotify.apply(cmd, s, cfg);
          if (!s.reminders.length && s.daily == null) await env.SUBS.delete(key); else await env.SUBS.put(key, JSON.stringify(s));
        }
      } else reply = MinyanSms.buildReply(cfg, text, Date.now()).text;
    } catch (e) { reply = 'Sorry, the schedule is unavailable right now. / הלוח אינו זמין כרגע'; }
    if (isPost) return twiml(reply);
    return new Response(reply, { headers: cors(env, { 'content-type': 'text/plain; charset=utf-8' }) });
  },
  async scheduled(event, env) {
    var cfg = await loadConfig(env), now = Date.now(), names = await allSubscriptions(env), i, j;
    for (i = 0; i < names.length; i++) {
      var sub = await env.SUBS.get(names[i], 'json');
      if (!sub) continue;
      if (MinyanNotify.prune(cfg, sub, now)) { /* a "today only" reminder whose day has passed */
        if (!sub.reminders.length && sub.daily == null) { await env.SUBS.delete(names[i]); continue; }
        await env.SUBS.put(names[i], JSON.stringify(sub));
      }
      var due = MinyanNotify.due(cfg, sub, now, 5);
      for (j = 0; j < due.length; j++) {
        var sentKey = 'sent:' + names[i] + ':' + due[j].key;
        if (await env.SUBS.get(sentKey)) continue;
        await env.SUBS.put(sentKey, '1', { expirationTtl: 86400 });
        try {
          if (sub.channel === 'push') {
            var r = await WebPush.send(sub.push, JSON.stringify({ title: due[j].title, body: due[j].text, tag: due[j].key }), await pushEnv(env));
            if (r.status === 404 || r.status === 410) await env.SUBS.delete(names[i]);
          } else await sendTwilio(env, sub.to, due[j].text);
        } catch (e) {}
      }
    }
  }
};
