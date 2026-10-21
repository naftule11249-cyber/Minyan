
/* ---- Cloudflare Worker. Variables: CONFIG_URL (required) = https://YOUR-SITE/config.json,
   TWILIO_AUTH_TOKEN (optional) rejects requests that were not signed by Twilio.
   POST from Twilio -> TwiML reply. GET ?q=text -> plain-text reply, handy for testing. ---- */
function escapeXml(s) { return s.replace(/[<>&'"]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]; }); }
async function twilioSignatureOk(request, params, token) {
  var data = request.url;
  Object.keys(params).sort().forEach(function (k) { data += k + params[k]; });
  var key = await crypto.subtle.importKey('raw', new TextEncoder().encode(token), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  var mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)));
  var b64 = btoa(String.fromCharCode.apply(null, mac));
  return b64 === (request.headers.get('X-Twilio-Signature') || '');
}
export default {
  async fetch(request, env) {
    var isPost = request.method === 'POST', body = '', params = {};
    if (isPost) {
      var form = await request.formData();
      form.forEach(function (v, k) { params[k] = v; });
      body = params.Body || '';
      if (env.TWILIO_AUTH_TOKEN && !(await twilioSignatureOk(request, params, env.TWILIO_AUTH_TOKEN))) return new Response('forbidden', { status: 403 });
    } else {
      var u = new URL(request.url);
      body = u.searchParams.get('q') || u.searchParams.get('Body') || '';
    }
    var text;
    try {
      var cfg = await (await fetch(env.CONFIG_URL, { cf: { cacheTtl: 60, cacheEverything: true } })).json();
      text = MinyanSms.buildReply(cfg, body, Date.now()).text;
    } catch (e) { text = 'Sorry, the schedule is unavailable right now. / הלוח אינו זמין כרגע'; }
    if (isPost) return new Response('<?xml version="1.0" encoding="UTF-8"?><Response>' + (text ? '<Message>' + escapeXml(text) + '</Message>' : '') + '</Response>', { headers: { 'content-type': 'text/xml; charset=utf-8' } });
    return new Response(text, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
};
