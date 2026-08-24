/**
 * GET /api/admin-data?days=0
 *
 * Powers the admin panel. Everything is read live from Razorpay, so there is no
 * database to run or keep in sync:
 *
 *   sales     = payments with status "captured"
 *   abandoned = orders that were created but never reached "paid" — these carry
 *               the name/email/phone we attached in create-order.js, so they are
 *               a genuine follow-up list, not just a count.
 *
 * Requires a valid admin session cookie (see api/admin-login.js).
 */

const { verifyToken, readCookie, COOKIE } = require('./admin-login.js');

function rzpGet(path, keyId, keySecret) {
  return fetch('https://api.razorpay.com/v1/' + path, {
    headers: {
      Authorization: 'Basic ' + Buffer.from(keyId + ':' + keySecret).toString('base64')
    }
  }).then(function (r) {
    return r.json().then(function (d) { return { ok: r.ok, status: r.status, data: d }; });
  });
}

function startOfDayIST(daysAgo) {
  // Razorpay wants unix seconds. IST is UTC+5:30.
  const IST = 5.5 * 3600 * 1000;
  const nowIST = new Date(Date.now() + IST);
  nowIST.setUTCHours(0, 0, 0, 0);
  const startUTC = nowIST.getTime() - IST - (daysAgo * 86400000);
  return Math.floor(startUTC / 1000);
}

module.exports = async function handler(req, res) {
  const sessionSecret = process.env.ADMIN_SESSION_SECRET;
  if (!sessionSecret || !verifyToken(readCookie(req, COOKIE), sessionSecret)) {
    return res.status(401).json({ error: 'Not signed in.' });
  }

  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  // Configuration status — shown so you can see at a glance what's wired up.
  const config = {
    keyId: keyId ? keyId : null,
    mode: keyId ? (keyId.indexOf('rzp_live') === 0 ? 'live' : 'test') : null,
    keySecretSet: !!keySecret,
    webhookSecretSet: !!process.env.RAZORPAY_WEBHOOK_SECRET,
    downloadUrlSet: !!process.env.PLAYBOOK_DOWNLOAD_URL,
    leadRelaySet: !!process.env.LEAD_WEBHOOK_URL,
    fulfilmentRelaySet: !!process.env.FULFILMENT_WEBHOOK_URL
  };

  if (!keyId || !keySecret) {
    return res.status(200).json({ config: config, error: 'Razorpay keys are not configured.' });
  }

  const days = Math.max(0, Math.min(30, parseInt(req.query && req.query.days, 10) || 0));
  const from = startOfDayIST(days);
  const to = Math.floor(Date.now() / 1000);
  const range = 'from=' + from + '&to=' + to + '&count=100';

  try {
    const [pay, ord] = await Promise.all([
      rzpGet('payments?' + range, keyId, keySecret),
      rzpGet('orders?' + range, keyId, keySecret)
    ]);

    if (!pay.ok || !ord.ok) {
      const detail = (pay.data && pay.data.error) || (ord.data && ord.data.error) || {};
      console.error('admin-data: Razorpay error', pay.status, ord.status, detail);
      return res.status(200).json({
        config: config,
        error: detail.description || 'Razorpay rejected the request — check the API keys.'
      });
    }

    const payments = (pay.data.items || []);
    const orders = (ord.data.items || []);

    const captured = payments.filter(function (p) { return p.status === 'captured'; });
    const failed = payments.filter(function (p) { return p.status === 'failed'; });

    const sales = captured.map(function (p) {
      return {
        id: p.id,
        amount: p.amount,
        at: p.created_at,
        email: p.email || (p.notes && p.notes.email) || '',
        contact: p.contact || (p.notes && p.notes.contact) || '',
        name: (p.notes && p.notes.name) || '',
        method: p.method || '',
        coupon: (p.notes && p.notes.coupon) || 'none',
        bump: (p.notes && p.notes.bump) === 'yes'
      };
    });

    // An order that never reached "paid" is an abandoned checkout.
    const abandoned = orders
      .filter(function (o) { return o.status !== 'paid'; })
      .map(function (o) {
        return {
          id: o.id,
          amount: o.amount,
          at: o.created_at,
          status: o.status,
          name: (o.notes && o.notes.name) || '',
          email: (o.notes && o.notes.email) || '',
          contact: (o.notes && o.notes.contact) || '',
          coupon: (o.notes && o.notes.coupon) || 'none',
          bump: (o.notes && o.notes.bump) === 'yes'
        };
      });

    const revenue = captured.reduce(function (s, p) { return s + p.amount; }, 0);
    const started = orders.length;

    return res.status(200).json({
      config: config,
      range: { from: from, to: to, days: days },
      totals: {
        revenue: revenue,
        sales: captured.length,
        failed: failed.length,
        abandoned: abandoned.length,
        started: started,
        conversion: started ? Math.round((captured.length / started) * 1000) / 10 : 0,
        aov: captured.length ? Math.round(revenue / captured.length) : 0,
        bumpTake: captured.length
          ? Math.round((sales.filter(function (s) { return s.bump; }).length / captured.length) * 1000) / 10
          : 0
      },
      sales: sales,
      abandoned: abandoned
    });
  } catch (err) {
    console.error('admin-data: unexpected failure', err);
    return res.status(500).json({ config: config, error: 'Could not load data.' });
  }
};
