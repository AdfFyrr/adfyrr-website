/**
 * POST /api/create-order
 *
 * Creates a Razorpay order server-side and returns the order id plus the
 * PUBLIC key id for Checkout.
 *
 * The price is decided HERE, never taken from the browser — otherwise anyone
 * could open devtools and buy the playbook for ₹1.
 *
 * Required environment variables (set them in the Vercel dashboard, never in code):
 *   RAZORPAY_KEY_ID      e.g. rzp_live_xxxxxxxxxxxx   (public, safe to expose)
 *   RAZORPAY_KEY_SECRET  the secret half              (NEVER sent to the browser)
 */

const { quote } = require('../lib/pricing.js');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    console.error('create-order: RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET not configured');
    return res.status(500).json({ error: 'Payments are not configured yet.' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_) { body = {}; }
  }
  body = body || {};

  // The browser sends only a coupon string and a bump flag — never an amount.
  const tier = quote(body.coupon, body.bump);

  const notes = {
    product: '1300-orders-playbook',
    coupon: tier.coupon,
    bump: tier.bump ? 'yes' : 'no'
  };
  if (typeof body.email === 'string' && body.email.length < 200) notes.email = body.email;
  if (typeof body.name === 'string' && body.name.length < 120) notes.name = body.name;
  if (typeof body.contact === 'string' && body.contact.length < 20) notes.contact = body.contact;

  try {
    const rp = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Basic ' + Buffer.from(keyId + ':' + keySecret).toString('base64')
      },
      body: JSON.stringify({
        amount: tier.amount,
        currency: 'INR',
        receipt: 'pb1300_' + Date.now().toString(36),
        notes
      })
    });

    const order = await rp.json();

    if (!rp.ok) {
      // Log the real reason server-side; keep the client message generic.
      console.error('create-order: Razorpay rejected the order', rp.status, order);
      return res.status(502).json({ error: 'Could not start the payment. Please try again.' });
    }

    return res.status(200).json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId,                 // public key id — safe in the browser
      description: tier.label,
      breakdown: {
        base: tier.baseAmount,
        bump: tier.bumpAmount,
        coupon: tier.coupon
      }
    });
  } catch (err) {
    console.error('create-order: unexpected failure', err);
    return res.status(500).json({ error: 'Could not start the payment. Please try again.' });
  }
};
