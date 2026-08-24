#!/usr/bin/env node
/**
 * Local smoke test for the Razorpay integration.
 *
 *   1. cp .env.example .env   and fill in your TEST keys
 *   2. node scripts/test-razorpay.js
 *
 * Creates a real order in Razorpay's TEST environment (no money moves) to prove
 * the credentials and the order-creation path work, then checks the signature
 * and webhook logic offline.
 *
 * Refuses to run with live keys.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');

// --- tiny .env loader (no dependencies) ------------------------------------
const envPath = path.join(ROOT, '.env');
if (!fs.existsSync(envPath)) {
  console.error('\n  No .env file found.\n');
  console.error('  Run:  cp .env.example .env');
  console.error('  then fill in your TEST keys (rzp_test_...) and re-run.\n');
  process.exit(1);
}
fs.readFileSync(envPath, 'utf8').split('\n').forEach(function (line) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
});

const keyId = process.env.RAZORPAY_KEY_ID || '';
const keySecret = process.env.RAZORPAY_KEY_SECRET || '';

// --- safety guard -----------------------------------------------------------
if (keyId.startsWith('rzp_live')) {
  console.error('\n  REFUSING TO RUN: .env contains a LIVE key (' + keyId.slice(0, 12) + '…).');
  console.error('  This script creates real orders. Use your rzp_test_ pair instead.\n');
  process.exit(1);
}
if (!keyId.startsWith('rzp_test')) {
  console.error('\n  RAZORPAY_KEY_ID does not look like a test key (expected rzp_test_…).\n');
  process.exit(1);
}
if (!keySecret || keySecret === 'your_test_key_secret') {
  console.error('\n  RAZORPAY_KEY_SECRET is not filled in.\n');
  process.exit(1);
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log('  ' + (ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  → ' + detail : ''));
}

function mockRes() {
  const out = {};
  return {
    out,
    status(c) { out.code = c; return this; },
    json(j) { out.body = j; return this; },
    setHeader() { return this; }
  };
}

(async function run() {
  console.log('\nRazorpay integration smoke test (TEST mode)\n');

  // 1. credentials + live order creation against Razorpay's test API
  const createOrder = require(path.join(ROOT, 'api', 'create-order.js'));
  let res = mockRes();
  await createOrder({ method: 'POST', body: {} }, res);
  const ok1 = res.out.code === 200 && res.out.body && /^order_/.test(res.out.body.orderId || '');
  check('credentials accepted, ₹499 order created', ok1,
    ok1 ? res.out.body.orderId + '  amount=' + res.out.body.amount : JSON.stringify(res.out.body));

  if (!ok1) {
    console.error('\n  Razorpay rejected the request — check the key pair in .env.\n');
    process.exit(1);
  }
  const orderId = res.out.body.orderId;

  // 2. coupon pricing
  res = mockRes();
  await createOrder({ method: 'POST', body: { coupon: 'SCALE100' } }, res);
  check('SCALE100 coupon prices at ₹399', res.out.body && res.out.body.amount === 39900,
    res.out.body && ('amount=' + res.out.body.amount));

  // 3. a browser-supplied amount must be ignored
  res = mockRes();
  await createOrder({ method: 'POST', body: { amount: 100 } }, res);
  check('browser-supplied amount ignored', res.out.body && res.out.body.amount === 49900,
    res.out.body && ('amount=' + res.out.body.amount));

  // 4. signature verification rejects a forgery
  const verify = require(path.join(ROOT, 'api', 'verify-payment.js'));
  res = mockRes();
  await verify({ method: 'POST', body: {
    razorpay_order_id: orderId, razorpay_payment_id: 'pay_fake', razorpay_signature: 'deadbeef'
  } }, res);
  check('forged payment signature rejected', res.out.code === 400);

  // 5. webhook signature logic
  const whSecret = process.env.RAZORPAY_WEBHOOK_SECRET || '';
  if (whSecret && whSecret !== 'whsec_choose_something_long_and_random') {
    const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity:
      { id: 'pay_x', order_id: orderId, amount: 49900, currency: 'INR', notes: {} } } } });
    const good = crypto.createHmac('sha256', whSecret).update(body, 'utf8').digest('hex');
    const wh = require(path.join(ROOT, 'api', 'razorpay-webhook.js'));

    res = mockRes();
    await wh({ method: 'POST', readable: false, body: JSON.parse(body),
      headers: { 'x-razorpay-signature': good } }, res);
    check('webhook accepts a correctly signed payload', res.out.code === 200);

    res = mockRes();
    await wh({ method: 'POST', readable: false, body: JSON.parse(body),
      headers: { 'x-razorpay-signature': 'deadbeef' } }, res);
    check('webhook rejects a forged payload', res.out.code === 400);
  } else {
    console.log('  SKIP  webhook checks (RAZORPAY_WEBHOOK_SECRET not set in .env)');
  }

  const failed = results.filter(function (r) { return !r.ok; }).length;
  console.log('\n' + (results.length - failed) + '/' + results.length + ' passed\n');

  if (!failed) {
    console.log('  Next: deploy to a Vercel preview with the TEST keys and buy once');
    console.log('  with card 4111 1111 1111 1111 (any future expiry, any CVV).\n');
  }
  process.exit(failed ? 1 : 0);
})().catch(function (err) {
  console.error('\n  Unexpected failure:', err && err.message, '\n');
  process.exit(1);
});
