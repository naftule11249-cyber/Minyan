/* webpush.js — Web Push (RFC 8291 aes128gcm + VAPID) with WebCrypto only; runs in a Cloudflare Worker or Node 22. */
var WebPush = (function () {
  'use strict';
  var enc = new TextEncoder();
  function b64u(buf) { var s = '', a = new Uint8Array(buf), i; for (i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function fromB64u(str) { str = String(str).replace(/-/g, '+').replace(/_/g, '/'); while (str.length % 4) str += '='; var bin = atob(str), out = new Uint8Array(bin.length), i; for (i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
  function concat() { var len = 0, i, out, off = 0; for (i = 0; i < arguments.length; i++) len += arguments[i].length; out = new Uint8Array(len); for (i = 0; i < arguments.length; i++) { out.set(arguments[i], off); off += arguments[i].length; } return out; }
  function hkdf(salt, ikm, info, len) {
    return crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']).then(function (key) { return crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: salt, info: info }, key, len * 8); }).then(function (bits) { return new Uint8Array(bits); });
  }
  /* VAPID keys: public = base64url of the 65-byte uncompressed P-256 point, private = base64url of the 32-byte scalar */
  function importVapidPrivate(pub, priv) {
    var p = fromB64u(pub);
    return crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: b64u(p.slice(1, 33)), y: b64u(p.slice(33, 65)), d: priv, ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  }
  function vapidAuth(endpoint, subject, pub, priv) {
    var aud = new URL(endpoint).origin;
    var header = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))), claims = b64u(enc.encode(JSON.stringify({ aud: aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
    var data = enc.encode(header + '.' + claims);
    return importVapidPrivate(pub, priv).then(function (key) { return crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, data); })
      .then(function (sig) { return 'vapid t=' + header + '.' + claims + '.' + b64u(sig) + ', k=' + pub; });
  }
  /* Encrypt `payload` for a PushSubscription's keys (p256dh, auth). Resolves to the request body bytes. */
  function encrypt(payload, p256dh, auth) {
    var uaPub = fromB64u(p256dh), authSecret = fromB64u(auth), salt = crypto.getRandomValues(new Uint8Array(16)), asPub;
    return crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']).then(function (kp) {
      return crypto.subtle.exportKey('raw', kp.publicKey).then(function (raw) { asPub = new Uint8Array(raw); return crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []); })
        .then(function (uaKey) { return crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, kp.privateKey, 256); });
    }).then(function (shared) {
      return hkdf(authSecret, new Uint8Array(shared), concat(enc.encode('WebPush: info\0'), uaPub, asPub), 32);
    }).then(function (ikm) {
      return Promise.all([hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16), hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12)]);
    }).then(function (keys) {
      var plain = concat(enc.encode(payload), new Uint8Array([2]));
      return crypto.subtle.importKey('raw', keys[0], 'AES-GCM', false, ['encrypt']).then(function (k) { return crypto.subtle.encrypt({ name: 'AES-GCM', iv: keys[1] }, k, plain); });
    }).then(function (cipher) {
      return concat(salt, new Uint8Array([0, 0, 16, 0]), new Uint8Array([asPub.length]), asPub, new Uint8Array(cipher));
    });
  }
  /* Send to one subscription {endpoint, keys:{p256dh, auth}}. Resolves to the fetch Response (404/410 = subscription gone). */
  function send(sub, payload, env) {
    return Promise.all([encrypt(payload, sub.keys.p256dh, sub.keys.auth), vapidAuth(sub.endpoint, env.VAPID_SUBJECT || 'mailto:admin@example.com', env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY)]).then(function (r) {
      return fetch(sub.endpoint, { method: 'POST', headers: { 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', 'TTL': '3600', 'Urgency': 'high', 'Authorization': r[1] }, body: r[0] });
    });
  }
  return { send: send, encrypt: encrypt, vapidAuth: vapidAuth, b64u: b64u, fromB64u: fromB64u };
})();
if (typeof module !== 'undefined') module.exports = WebPush;
