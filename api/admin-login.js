/**
 * POST /api/admin-login   { password }
 * GET  /api/admin-login   → { authed: true|false }
 *
 * Gates the admin panel. On success it sets a signed, HttpOnly, Secure cookie
 * that expires in 8 hours. The cookie is an HMAC, so it cannot be forged
 * without ADMIN_SESSION_SECRET.
 *
 * Required environment variables:
 *   ADMIN_PASSWORD         the password you type into /admin
 *   ADMIN_SESSION_SECRET   any long random string (used to sign the cookie)
 */

const crypto = require('node:crypto');

const COOKIE = 'adfyrr_admin';
const TTL_MS = 8 * 60 * 60 * 1000;

function safeEqual(a, b) {
  const x = Buffer.from(String(a), 'utf8');
  const y = Buffer.from(String(b), 'utf8');
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

function sign(exp, secret) {
  return crypto.createHmac('sha256', secret).update(String(exp)).digest('hex');
}

function makeToken(secret) {
  const exp = Date.now() + TTL_MS;
  return exp + '.' + sign(exp, secret);
}

/** Exported so the data endpoint can reuse it. */
function verifyToken(token, secret) {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const exp = parseInt(parts[0], 10);
  if (!exp || exp < Date.now()) return false;
  return safeEqual(parts[1], sign(exp, secret));
}

function readCookie(req, name) {
  const raw = req.headers && req.headers.cookie;
  if (!raw) return '';
  const hit = raw.split(';').map(function (s) { return s.trim(); })
    .find(function (s) { return s.indexOf(name + '=') === 0; });
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : '';
}

module.exports = async function handler(req, res) {
  const password = process.env.ADMIN_PASSWORD;
  const secret = process.env.ADMIN_SESSION_SECRET;

  if (!password || !secret) {
    console.error('admin-login: ADMIN_PASSWORD / ADMIN_SESSION_SECRET not configured');
    return res.status(500).json({ error: 'Admin panel is not configured yet.' });
  }

  if (req.method === 'GET') {
    return res.status(200).json({ authed: verifyToken(readCookie(req, COOKIE), secret) });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { body = {}; } }
  body = body || {};

  if (body.logout) {
    res.setHeader('Set-Cookie', COOKIE + '=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0');
    return res.status(200).json({ ok: true, authed: false });
  }

  // Constant-time compare, and a small delay so this can't be brute-forced fast.
  const ok = typeof body.password === 'string' && safeEqual(body.password, password);
  await new Promise(function (r) { setTimeout(r, 400); });

  if (!ok) {
    console.warn('admin-login: failed attempt');
    return res.status(401).json({ error: 'Incorrect password.' });
  }

  res.setHeader('Set-Cookie',
    COOKIE + '=' + makeToken(secret) +
    '; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=' + Math.floor(TTL_MS / 1000));
  return res.status(200).json({ ok: true, authed: true });
};

module.exports.verifyToken = verifyToken;
module.exports.readCookie = readCookie;
module.exports.COOKIE = COOKIE;
