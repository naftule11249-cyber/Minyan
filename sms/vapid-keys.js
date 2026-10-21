#!/usr/bin/env node
// Prints a VAPID key pair for app notifications. Run once: node sms/vapid-keys.js
const { subtle } = require('crypto').webcrypto;
const b64u = buf => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
(async () => {
  const kp = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await subtle.exportKey('jwk', kp.privateKey), raw = await subtle.exportKey('raw', kp.publicKey);
  console.log('VAPID_PUBLIC_KEY=' + b64u(raw));
  console.log('VAPID_PRIVATE_KEY=' + jwk.d);
  console.log('Keep the private key secret (wrangler secret put VAPID_PRIVATE_KEY). The public key also goes into the worker.');
})();
