/**
 * Single source of truth for what things cost.
 *
 * Both api/create-order.js and api/verify-payment.js import this, so the list of
 * amounts the verifier will accept can never drift out of sync with the amounts
 * the order creator charges. Change a price here and nowhere else.
 *
 * All amounts are in PAISE (₹299 = 29900).
 */

const BASE = {
  standard: { amount: 29900, label: '0 → 1300 Orders A Day — Complete Playbook' }
};

// Discount codes. Anything not listed here silently pays full price.
const COUPONS = {
  // Auto-applied on the checkout page for everyone, for the launch period.
  LAUNCH50: { amount: 24900, off: 5000, label: '0 → 1300 Orders Playbook (₹50 launch discount)' }
};

// Applied automatically at checkout. Set to '' to turn the launch offer off —
// the checkout page reads this via its own display copy, but the SERVER is what
// actually decides the price.
const AUTO_COUPON = 'LAUNCH50';

// The order bump offered on the checkout page.
// To change what you're bumping, edit this block only — the checkout page and
// both API endpoints read from it.
const BUMP = {
  id: 'ad-launch',
  amount: 4900,                                   // ₹49
  strikethrough: 99900,                           // shown as "was ₹999"
  label: 'The 60-Minute Ad Launch — guided walkthrough'
};

/**
 * Optional internal test coupon, for doing a real end-to-end payment cheaply.
 *
 * The code lives ONLY in the TEST_COUPON_CODE environment variable, never in
 * this file — this repository is public, so a hardcoded code would let anyone
 * buy the playbook for ₹29. Leave the variable unset and no test coupon exists.
 */
const TEST_AMOUNT = 2900; // ₹29

function testCoupon() {
  const code = String(process.env.TEST_COUPON_CODE || '').trim().toUpperCase();
  if (!code) return null;
  return { code: code, amount: TEST_AMOUNT, label: '0 → 1300 Orders Playbook (internal test)' };
}

function normaliseCoupon(raw) {
  if (typeof raw !== 'string') return '';
  const code = raw.trim().toUpperCase();
  if (Object.prototype.hasOwnProperty.call(COUPONS, code)) return code;
  const test = testCoupon();
  return test && test.code === code ? code : '';
}

/**
 * Work out what to charge. The browser only ever sends a coupon string and a
 * bump boolean — never an amount.
 */
function quote(couponRaw, wantsBump) {
  const coupon = normaliseCoupon(couponRaw);
  const test = testCoupon();
  const base = coupon
    ? (test && test.code === coupon ? test : COUPONS[coupon])
    : BASE.standard;
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
  // Only accepted while TEST_COUPON_CODE is set; clearing it in Vercel makes
  // ₹29 payments fail verification again.
  if (testCoupon()) bases.push(TEST_AMOUNT);
  const all = [];
  bases.forEach(function (b) {
    all.push(b);
    all.push(b + BUMP.amount);
  });
  return new Set(all);
}

module.exports = {
  BASE, COUPONS, BUMP, AUTO_COUPON, TEST_AMOUNT,
  quote, validAmounts, normaliseCoupon, testCoupon
};
