// Round-trip check of the Web Push encryption and VAPID signature using Node's WebCrypto (the same API the worker uses).
const WebPush = require('../sms/webpush.js'); const { subtle } = require('crypto').webcrypto;
const enc = new TextEncoder(), dec = new TextDecoder();
(async () => {
  // a browser-side subscription: ECDH key pair + 16-byte auth secret
  const ua = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const uaPubRaw = new Uint8Array(await subtle.exportKey('raw', ua.publicKey)), auth = crypto.getRandomValues(new Uint8Array(16));
  const payload = JSON.stringify({ title: 'תזכורת: מנחה', body: 'מנחה – ברך משה 5:45, בעוד 15 דק׳' });
  const body = await WebPush.encrypt(payload, WebPush.b64u(uaPubRaw), WebPush.b64u(auth));
  // decrypt as the browser would (RFC 8291)
  const salt = body.slice(0, 16), rs = new DataView(body.buffer).getUint32(16), idlen = body[20], asPub = body.slice(21, 21 + idlen), cipher = body.slice(21 + idlen);
  const asKey = await subtle.importKey('raw', asPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: asKey }, ua.privateKey, 256));
  const hk = async (s, ikm, info, len) => new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: s, info }, await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']), len * 8));
  const info = new Uint8Array([...enc.encode('WebPush: info\0'), ...uaPubRaw, ...asPub]);
  const ikm = await hk(auth, shared, info, 32), cek = await hk(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16), nonce = await hk(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const plain = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: nonce }, await subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']), cipher));
  const text = dec.decode(plain.slice(0, plain.length - 1));
  console.log('record size', rs, '| delimiter', plain[plain.length - 1], '| roundtrip ok:', text === payload);
  // VAPID: sign with our key format, verify with WebCrypto
  const kp = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await subtle.exportKey('jwk', kp.privateKey), pub = WebPush.b64u(await subtle.exportKey('raw', kp.publicKey));
  const authz = await WebPush.vapidAuth('https://fcm.googleapis.com/fcm/send/abc', 'mailto:test@example.com', pub, jwk.d);
  const m = /^vapid t=([^,]+), k=(.+)$/.exec(authz); const [h, c, sig] = m[1].split('.');
  const verified = await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, kp.publicKey, WebPush.fromB64u(sig), enc.encode(h + '.' + c));
  const claims = JSON.parse(dec.decode(WebPush.fromB64u(c)));
  console.log('vapid verified:', verified, '| aud', claims.aud, '| k matches', m[2] === pub);
  if (!(text === payload && verified && claims.aud === 'https://fcm.googleapis.com')) { console.log('FAIL'); process.exit(1); }
  console.log('ALL PASS');
})();
