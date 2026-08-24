/**
 * POST /api/razorpay-webhook
 *
 * Razorpay calls this server-to-server, so fulfilment no longer depends on the
 * buyer's browser staying open. This is the safety net for "paid but closed the
 * tab before the thank-you page loaded".
 *
 * Required environment variables:
 *   RAZORPAY_WEBHOOK_SECRET   the secret you set when creating the webhook
 *   FULFILMENT_WEBHOOK_URL    (optional) Zapier / Make / n8n URL that sends the
 *                             delivery email. Leave unset to just log.
 *
 * Events to subscribe to in the Razorpay dashboard:
 *   payment.captured  (required — this is the one that fulfils the order)
 *   payment.failed    (optional — useful for spotting a broken checkout)
 *   refund.processed  (optional — so you can revoke access)
 *
 * NOTE ON RAW BODY: the signature is an HMAC of the exact bytes Razorpay sent.
 * Vercel's Node runtime may have already parsed the body, so we read the raw
 * stream when it is still available and fall back to a re-serialised body when
 * it is not. Confirm with Razorpay's "Send test webhook" button after deploying.
 */

const crypto = require('node:crypto');

function readRawBody(req) {
  return new Promise(function (resolve) {
    // If the platform already consumed and parsed the stream, req.readable is false.
    if (!req.readable) return resolve(null);
    var chunks = [];
    var done = false;
    var finish = function (val) { if (!done) { done = true; resolve(val); } };
    req.on('data', function (c) { chunks.push(Buffer.from(c)); });
    req.on('end', function () { finish(chunks.length ? Buffer.concat(chunks).toString('utf8') : null); });
    req.on('error', function () { finish(null); });
    setTimeout(function () { finish(chunks.length ? Buffer.concat(chunks).toString('utf8') : null); }, 4000);
  });
}

function signatureMatches(raw, header, secret) {
  if (!raw || !header) return false;
  var expected = crypto.createHmac('sha256', secret).update(raw, 'utf8').digest('hex');
  var a = Buffer.from(expected, 'utf8');
  var b = Buffer.from(String(header), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  var secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    console.error('webhook: RAZORPAY_WEBHOOK_SECRET not configured');
    return res.status(500).json({ error: 'Not configured' });
  }

  var header = req.headers['x-razorpay-signature'];

  // Prefer the untouched bytes; fall back to re-serialising the parsed body.
  var raw = await readRawBody(req);
  var usedFallback = false;
  if (!raw && req.body) {
    raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    usedFallback = true;
  }

  if (!signatureMatches(raw, header, secret)) {
    console.warn('webhook: signature mismatch — rejecting', { usedFallback: usedFallback });
    // 400 tells Razorpay not to keep retrying a payload we will never accept.
    return res.status(400).json({ error: 'Invalid signature' });
  }

  var payload;
  try {
    payload = typeof raw === 'string' ? JSON.parse(raw) : req.body;
  } catch (_) {
    return res.status(400).json({ error: 'Bad payload' });
  }

  var event = payload && payload.event;
  var entity = payload && payload.payload && payload.payload.payment
    && payload.payload.payment.entity;

  // Acknowledge fast. Razorpay retries on non-2xx, and a slow handler causes
  // duplicate deliveries.
  res.status(200).json({ received: true });

  try {
    if (event === 'payment.captured' && entity) {
      var order = {
        event: event,
        paymentId: entity.id,
        orderId: entity.order_id,
        amount: entity.amount,
        currency: entity.currency,
        email: entity.email || (entity.notes && entity.notes.email) || '',
        contact: entity.contact || '',
        product: (entity.notes && entity.notes.product) || 'unknown',
        coupon: (entity.notes && entity.notes.coupon) || 'none',
        capturedAt: new Date().toISOString()
      };

      // Structured log — searchable in the Vercel dashboard, and enough to
      // reconcile manually if downstream delivery ever breaks.
      console.log('ORDER_PAID ' + JSON.stringify(order));

      var relay = process.env.FULFILMENT_WEBHOOK_URL;
      if (relay) {
        var r = await fetch(relay, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(Object.assign({
            downloadUrl: process.env.PLAYBOOK_DOWNLOAD_URL || ''
          }, order))
        });
        if (!r.ok) console.error('webhook: fulfilment relay failed', r.status);
      }
    } else if (event === 'payment.failed' && entity) {
      console.warn('PAYMENT_FAILED ' + JSON.stringify({
        paymentId: entity.id,
        orderId: entity.order_id,
        reason: entity.error_description || entity.error_reason || 'unknown'
      }));
    } else if (event === 'refund.processed') {
      console.log('REFUND ' + JSON.stringify(payload.payload && payload.payload.refund
        && payload.payload.refund.entity || {}));
    }
  } catch (err) {
    // Response already sent; log so it can be reconciled from the dashboard.
    console.error('webhook: post-ack processing failed', err);
  }
};
