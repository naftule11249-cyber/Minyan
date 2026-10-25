
/* ---- Cloudflare Worker: text/WhatsApp responder, reminder texts, daily schedule texts and app notifications.
   Bindings: KV namespace SUBS. Variables: CONFIG_URL (required), ALLOWED_ORIGIN (the website address), VAPID_SUBJECT (mailto:…).
   Secrets (wrangler secret put): TWILIO_AUTH_TOKEN (also verifies Twilio's signature), TWILIO_ACCOUNT_SID, TWILIO_FROM (+1718…),
   WA_FROM (whatsapp:+1718…, optional), WA_CONTENT_SID (optional WhatsApp template), VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY.
   Cron trigger every 5 minutes (wrangler.toml) sends what is due. ---- */
function escapeXml(s) { return s.replace(/[<>&'"]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]; }); }
async function twilioSignatureOk(request, params, token) {
  var data = request.url;
  Object.keys(params).sort().forEach(function (k) { data += k + params[k]; });
  var key = await crypto.subtle.importKey('raw', new TextEncoder().encode(token), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  var mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)));
  return btoa(String.fromCharCode.apply(null, mac)) === (request.headers.get('X-Twilio-Signature') || '');
}
async function loadConfig(env) { return (await fetch(env.CONFIG_URL, { cf: { cacheTtl: 60, cacheEverything: true } })).json(); }
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
export default {
  async fetch(request, env) {
    var url = new URL(request.url), path = url.pathname.replace(/\/+$/, '');
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors(env) });
    if (path === '/push/key') return new Response((await vapidKeys(env)).pub, { headers: cors(env, { 'content-type': 'text/plain' }) });
    if (path === '/push/subscribe' && request.method === 'POST') {
      var body = await request.json().catch(function () { return null; });
      if (!body || !body.subscription || !body.subscription.endpoint || !body.subscription.keys) return json(env, { error: 'bad request' }, 400);
      var id = body.id && /^[a-z0-9]{8,32}$/.test(body.id) ? body.id : crypto.randomUUID().replace(/-/g, '').slice(0, 20);
      var sub = { channel: 'push', push: { endpoint: body.subscription.endpoint, keys: body.subscription.keys }, reminders: (body.reminders || []).slice(0, 10).map(function (r) { var lead = Math.min(180, Math.max(1, +r.lead || 10)), o; if (/^(alos|sunrise|shema|tefilla|chatzos|minchag|plag|candles|sunset|tzeis|tzeis72)$/.test(r.zman || '')) o = { zman: r.zman, lead: lead }; else { o = { tefilla: String(r.tefilla), time: r.time == null ? null : +r.time, lead: lead }; if (o.time == null && /^(first|last|before:(chatzos|tefilla|shema|sunset|tzeis|plag|minchag))$/.test(r.pick || '')) o.pick = r.pick; } if (/^\d{4}-\d{2}-\d{2}$/.test(r.once || '')) o.once = r.once; return o; }),
        daily: body.daily == null ? null : +body.daily, lang: body.lang === 'en' ? 'en' : 'he', updated: Date.now() };
      await env.SUBS.put('push:' + id, JSON.stringify(sub));
      return json(env, { id: id });
    }
    if (path === '/push/unsubscribe' && request.method === 'POST') {
      var b2 = await request.json().catch(function () { return {}; });
      if (b2.id && /^[a-z0-9]{8,32}$/.test(b2.id)) await env.SUBS.delete('push:' + b2.id);
      return json(env, { ok: true });
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
      if (cmd) {
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
