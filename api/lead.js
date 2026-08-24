/**
 * POST /api/lead
 *
 * Called the moment someone submits the checkout form — BEFORE the payment
 * modal opens. This is the whole point of having a checkout page: if they
 * abandon at the payment step you still have their email and can follow up.
 *
 * Optional environment variable:
 *   LEAD_WEBHOOK_URL   Zapier / Make / n8n / CRM endpoint to forward leads to.
 *                      Unset = leads are still written to the Vercel logs.
 *
 * Deliberately never fails the checkout: if lead capture breaks we still return
 * 200 so the buyer can pay. Losing a lead is bad; losing a sale is worse.
 */

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_) { body = {}; }
  }
  body = body || {};

  const clean = function (v, max) {
    return typeof v === 'string' ? v.trim().slice(0, max) : '';
  };

  const lead = {
    name: clean(body.name, 120),
    email: clean(body.email, 200),
    contact: clean(body.contact, 20),
    coupon: clean(body.coupon, 40) || 'none',
    bump: body.bump === true,
    product: '1300-orders-playbook',
    stage: 'checkout_started',
    at: new Date().toISOString()
  };

  // Basic sanity check — don't forward obvious junk.
  if (!lead.email || lead.email.indexOf('@') < 1) {
    return res.status(400).json({ error: 'A valid email is required.' });
  }

  console.log('LEAD ' + JSON.stringify(lead));

  const relay = process.env.LEAD_WEBHOOK_URL;
  if (relay) {
    try {
      const r = await fetch(relay, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(lead)
      });
      if (!r.ok) console.error('lead: relay returned', r.status);
    } catch (err) {
      console.error('lead: relay failed', err && err.message);
    }
  }

  return res.status(200).json({ ok: true });
};
