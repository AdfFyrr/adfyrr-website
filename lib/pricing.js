/**
 * Single source of truth for what things cost.
 *
 * Both api/create-order.js and api/verify-payment.js import this, so the list of
 * amounts the verifier will accept can never drift out of sync with the amounts
 * the order creator charges. Change a price here and nowhere else.
 *
 * All amounts are in PAISE (₹499 = 49900).
 */

const BASE = {
  standard: { amount: 49900, label: '0 → 1300 Orders A Day — Complete Playbook' }
};

// Discount codes. Anything not listed here silently pays full price.
const COUPONS = {
  // Auto-applied on the checkout page for everyone, for the launch period.
  LAUNCH199: { amount: 30000, off: 19900, label: '0 → 1300 Orders Playbook (₹199 launch discount)' },
  SCALE100:  { amount: 39900, off: 10000, label: '0 → 1300 Orders Playbook (₹100 off)' }
};

// Applied automatically at checkout. Set to '' to turn the launch offer off —
// the checkout page reads this via its own display copy, but the SERVER is what
// actually decides the price.
const AUTO_COUPON = 'LAUNCH199';

// The order bump offered on the checkout page.
// To change what you're bumping, edit this block only — the checkout page and
// both API endpoints read from it.
const BUMP = {
  id: 'ad-launch',
  amount: 4900,                                   // ₹49
  strikethrough: 99900,                           // shown as "was ₹999"
  label: 'The 60-Minute Ad Launch — guided walkthrough'
};

function normaliseCoupon(raw) {
  if (typeof raw !== 'string') return '';
  const code = raw.trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(COUPONS, code) ? code : '';
}

/**
 * Work out what to charge. The browser only ever sends a coupon string and a
 * bump boolean — never an amount.
 */
function quote(couponRaw, wantsBump) {
  const coupon = normaliseCoupon(couponRaw);
  const base = coupon ? COUPONS[coupon] : BASE.standard;
  const bump = wantsBump === true || wantsBump === 'true';

  return {
    coupon: coupon || 'none',
    baseAmount: base.amount,
    bumpAmount: bump ? BUMP.amount : 0,
    amount: base.amount + (bump ? BUMP.amount : 0),
    bump: bump,
    label: bump ? base.label + ' + ' + BUMP.label : base.label
  };
}

/** Every total a legitimate order could add up to. Used by the verifier. */
function validAmounts() {
  const bases = [BASE.standard.amount].concat(
    Object.keys(COUPONS).map(function (k) { return COUPONS[k].amount; })
  );
  const all = [];
  bases.forEach(function (b) {
    all.push(b);
    all.push(b + BUMP.amount);
  });
  return new Set(all);
}

module.exports = { BASE, COUPONS, BUMP, AUTO_COUPON, quote, validAmounts, normaliseCoupon };
