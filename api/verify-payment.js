/**
 * POST /api/verify-payment
 *
 * Confirms a completed Checkout payment before handing over the product.
 *
 * Two independent checks, both required:
 *   1. HMAC signature — proves Razorpay (not the browser) produced this result.
 *   2. Server-side fetch of the payment — proves it was actually captured for
 *      the amount we asked for. Without this, a signature replayed from a
 *      cheaper order would still pass step 1.
 *
 * Required environment variables:
 *   RAZORPAY_KEY_ID
 *   RAZORPAY_KEY_SECRET
 *   PLAYBOOK_DOWNLOAD_URL   where buyers are sent after a verified payment
 */

const crypto = require('node:crypto');
const { validAmounts } = require('../lib/pricing.js');

// Derived from lib/pricing.js so it can never drift out of sync with what
// create-order actually charges.
const VALID_AMOUNTS = validAmounts();

function safeEqual(a, b) {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    console.error('verify-payment: Razorpay env vars not configured');
    return res.status(500).json({ error: 'Payments are not configured yet.' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_) { body = {}; }
  }
  body = body || {};

  const orderId = body.razorpay_order_id;
  const paymentId = body.razorpay_payment_id;
  const signature = body.razorpay_signature;

  if (!orderId || !paymentId || !signature) {
    return res.status(400).json({ error: 'Missing payment details.' });
  }

  // --- 1. signature ---------------------------------------------------------
  const expected = crypto
    .createHmac('sha256', keySecret)
    .update(orderId + '|' + paymentId)
    .digest('hex');

  if (!safeEqual(expected, String(signature))) {
    console.warn('verify-payment: signature mismatch', { orderId, paymentId });
    return res.status(400).json({ error: 'Payment could not be verified.' });
  }

  // --- 2. confirm the payment really was captured ---------------------------
  try {
    const rp = await fetch('https://api.razorpay.com/v1/payments/' + encodeURIComponent(paymentId), {
      headers: {
        Authorization: 'Basic ' + Buffer.from(keyId + ':' + keySecret).toString('base64')
      }
    });
    const payment = await rp.json();

    if (!rp.ok) {
      console.error('verify-payment: could not fetch payment', rp.status, payment);
      return res.status(502).json({ error: 'Payment could not be verified.' });
    }

    const captured = payment.status === 'captured' || payment.status === 'authorized';
    const amountOk = VALID_AMOUNTS.has(payment.amount);
    const orderOk = payment.order_id === orderId;

    if (!captured || !amountOk || !orderOk) {
      console.warn('verify-payment: payment failed checks', {
        status: payment.status, amount: payment.amount, order_id: payment.order_id
      });
      return res.status(400).json({ error: 'Payment could not be verified.' });
    }

    return res.status(200).json({
      ok: true,
      paymentId,
      downloadUrl: process.env.PLAYBOOK_DOWNLOAD_URL || ''
    });
  } catch (err) {
    console.error('verify-payment: unexpected failure', err);
    return res.status(500).json({ error: 'Payment could not be verified.' });
  }
};
