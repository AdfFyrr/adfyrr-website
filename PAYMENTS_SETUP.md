# Razorpay setup — 0 → 1300 Orders Playbook

Checkout runs as a **modal on the sales page** (no redirect away, which is the
higher-converting pattern). Three files do the work:

| File | Role |
|---|---|
| `api/create-order.js` | Creates the order. **Decides the price server-side.** |
| `api/verify-payment.js` | Verifies the HMAC signature + confirms the payment was captured. |
| `api/razorpay-webhook.js` | Server-to-server fulfilment net — fires even if the buyer closes the tab. |
| `courses/thank-you.html` | Post-purchase page with the download link. |
| `scripts/test-razorpay.js` | Local smoke test. Refuses to run with live keys. |

No dependencies, no build step — plain Node functions using `fetch` and the
built-in `crypto` module.

---

## 1. Rotate the leaked key first ⚠️

The live Key Secret was pasted into a chat transcript on 2026-07-29 and must be
treated as compromised. Anyone holding it can issue refunds and read customer
payment data.

**Razorpay Dashboard → Account & Settings → API Keys → Regenerate Live Key**

This gives you a new Key ID *and* Secret. Use the new pair everywhere below.

## 2. Set the environment variables

Vercel → project `adfyrr-website` → Settings → Environment Variables.
Add these for **Production** (and Preview if you want to test there):

| Name | Value | Notes |
|---|---|---|
| `RAZORPAY_KEY_ID` | `rzp_live_…` | Public half. Sent to the browser — that's expected. |
| `RAZORPAY_KEY_SECRET` | the secret half | **Never** put this in a file or in the HTML. |
| `PLAYBOOK_DOWNLOAD_URL` | link to the deliverables | Shown only after a verified payment. |
| `RAZORPAY_WEBHOOK_SECRET` | see step 3 | Signs the webhook payloads. |
| `FULFILMENT_WEBHOOK_URL` | *(optional)* Zapier/Make/n8n URL | Sends the delivery email. Blank = log only. |

Redeploy after adding them — Vercel only injects env vars at build/run time.

## 3. Create the webhook

**Razorpay Dashboard → Account & Settings → Webhooks → Add New Webhook**

| Field | Value |
|---|---|
| Webhook URL | `https://adfyrr.com/api/razorpay-webhook` |
| Secret | invent a long random string — put the *same* value in `RAZORPAY_WEBHOOK_SECRET` |
| Active events | `payment.captured` **(required)**, `payment.failed`, `refund.processed` |

`payment.captured` is the one that matters: it's what fulfils an order when the
buyer's browser never came back. The other two are for visibility.

Deploy first, then hit **Send test webhook** in the dashboard and confirm you see
a `200` there and an `ORDER_PAID` line in the Vercel function logs. If the test
webhook returns 400, the signature failed — see the raw-body note at the top of
`api/razorpay-webhook.js`.

## 4. Test in test mode before going live

**Locally**, without deploying:

```bash
cp .env.example .env      # fill in your rzp_test_ pair
node scripts/test-razorpay.js
```

That proves the credentials work, the pricing is server-controlled, and forged
signatures are rejected. It refuses to run with live keys.

**Then end-to-end**: deploy to a Vercel preview with the `rzp_test_…` pair and buy
once with card `4111 1111 1111 1111` (any future expiry, any CVV). Confirm:

- the modal opens and takes the payment
- you land on `thank-you.html` with a Payment ID shown
- the payment appears in your Razorpay dashboard
- the webhook fired (`ORDER_PAID` in the Vercel logs)
- the download button points where you expect

Then switch to live keys.

## 4. Where the price lives

`api/create-order.js`:

```js
const PRICES = {
  standard: { amount: 49900, … },  // ₹499
  SCALE100: { amount: 39900, … }   // ₹399, the exit-intent code
};
```

Amounts are in **paise**. If you change a price, change `VALID_AMOUNTS` in
`api/verify-payment.js` to match, or verification will start rejecting real
payments.

The browser cannot influence the price — it only sends a coupon code, and an
unrecognised code silently pays full price.

---

## Known gaps — read before you scale traffic

**1. Delivery email is not wired yet.** The webhook verifies and records every
paid order (`ORDER_PAID` in the Vercel logs), so nothing is lost — but until you
set `FULFILMENT_WEBHOOK_URL` to a Zapier/Make/n8n hook that sends the email,
a buyer who closes the tab early won't automatically receive their link. You'd be
reconciling from the logs by hand. Fine for the first few sales, not at ad-spend
volume.

**2. The download URL is a shared secret.** It's only handed out after
verification, but once someone has it they can share it. Fine for a ₹499 product;
if that changes, move to signed, expiring links.

**3. No email receipt is sent by this code.** Razorpay can send its own payment
receipt (Dashboard → Settings → Email Notifications). The thank-you page tells
buyers a receipt is coming, so either enable that or reword the page.

**4. The thank-you page is not access-controlled.** It reads `sessionStorage`, so
someone could hand-craft an entry — but they'd need the download URL, which is
the thing being protected. It stops accidental access, not a determined attacker.

**5. Legal/compliance.** You already have refund, terms and privacy pages, which
Razorpay requires. Note that the sales page currently carries invented
testimonials, a fake buyer count and simulated purchase notifications — under the
CCPA dark-patterns guidelines (2023) those are a real risk once you're taking
money. Replace them with genuine data or remove them.
