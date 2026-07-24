# Pocketsflow — Subscriptions example

A tiny, self-contained example that shows the two things you need to sell a
**subscription** with [Pocketsflow](https://pocketsflow.com) from your own site:

1. **`embed/`** — how to put a subscription checkout on your website (a plain
   redirect link, a popup, or an inline embed). No build step, no framework.
2. **`webhooks/`** — a minimal Node/Express server that receives Pocketsflow
   webhooks, **verifies the signature**, and reacts to subscription lifecycle
   events (activation, renewal, cancellation, …).

> Pocketsflow runs payments on Whop under the hood, but you never touch Whop.
> You embed a hosted checkout and consume normalized Pocketsflow webhooks — that
> is the entire integration surface.

---

## What you need first

From your Pocketsflow dashboard:

| Value | Where to find it |
| --- | --- |
| **Subdomain** | Your storefront subdomain, e.g. `acme` in `acme.pocketsflow.com`. |
| **Subscription ID** | Open the subscription → **Share** → it's the `subscriptionId` in the generated link/snippet. |
| **Webhook signing secret** | **Developers → Webhooks → Add endpoint**. The secret is shown **once** on creation — copy it then. |

---

## 1. Embed a subscription checkout — `embed/`

Open [`embed/index.html`](embed/index.html) in a browser (or serve the folder,
e.g. `npx serve embed`). Replace `YOUR_SUBDOMAIN` and `YOUR_SUBSCRIPTION_ID`.

There are three ways to embed, all shown in that file:

### a) Hosted checkout link (simplest)

```html
<a href="https://YOUR_SUBDOMAIN.pocketsflow.com/checkout?subscriptionId=YOUR_SUBSCRIPTION_ID">
  Subscribe
</a>
```

### b) Popup checkout (recommended)

Load the script once, then open the checkout from any button:

```html
<script
  src="https://app.pocketsflow.com/pocketsflow-popup.js"
  data-subdomain="YOUR_SUBDOMAIN"
></script>

<button onclick="subscribe()">Subscribe</button>

<script>
  function subscribe() {
    window.openPocketsflowCheckout({
      type: "subscription",
      subscriptionId: "YOUR_SUBSCRIPTION_ID",
      subdomain: "YOUR_SUBDOMAIN",
      isDarkMode: true,
      // Optional: prefill/lock the email, attach correlation data
      // customerEmail: "buyer@example.com",
      // lockEmail: true,
      // clientReferenceId: "your-user-id-123",
      // metadata: { plan: "pro" },
      onSuccess: (data) => {
        // UX signal only — see the note below. Fulfill via the webhook.
        console.log("checkout success", data);
      },
    });
  }
</script>
```

### c) Inline embed (checkout rendered inside your page)

Same call, plus `embedDivId` pointing at a `<div>` you control — see
[`embed/inline-embed.html`](embed/inline-embed.html).

> **Important:** the `onSuccess` callback fires in the browser and is a **UX
> signal**, not proof of entitlement. Grant access / provision the subscription
> from the **webhook** (`customer.subscription.created`), which is
> server-verified.

---

## 2. Receive & verify webhooks — `webhooks/`

```bash
cd webhooks
cp .env.example .env          # then paste your signing secret into .env
npm install
npm start                     # listens on http://localhost:4000/webhooks
```

Point your Pocketsflow webhook endpoint at a public URL for this server. In
development, tunnel it:

```bash
npx localtunnel --port 4000   # or ngrok http 4000
# use the https URL + /webhooks as the endpoint in the dashboard
```

### Test it locally without a real event

`sign-and-send.js` signs one of the sample payloads in `fixtures/` with your
secret (exactly the way Pocketsflow signs) and POSTs it to your running server:

```bash
npm start                                   # in one terminal
node sign-and-send.js customer.subscription.created   # in another
```

### How verification works (the load-bearing part)

Every delivery includes these headers:

| Header | Meaning |
| --- | --- |
| `X-Pocketsflow-Signature` | Hex **HMAC-SHA256** of the **raw request body**, keyed with your signing secret. |
| `X-Pocketsflow-Event` | The event name, e.g. `customer.subscription.created`. Route on this. |
| `X-Pocketsflow-Timestamp` | Epoch milliseconds. Informational — **not** part of the signature. |

You must hash the **raw bytes** of the body — the signed JSON already contains a
`webhookId` field, so re-serializing the parsed object will change the bytes and
break verification. That's why the server mounts `express.raw()` on the webhook
route.

```js
const expected = crypto
  .createHmac("sha256", process.env.POCKETSFLOW_WEBHOOK_SECRET)
  .update(rawBody) // the exact bytes received
  .digest("hex");

const ok =
  signatureHeader.length === expected.length &&
  crypto.timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expected));
```

### Delivery guarantees (design for these)

- **One attempt, ~5s timeout, no automatic retry.** Acknowledge with a `2xx`
  quickly, then do slow work asynchronously.
- **At-most-once**, so reconcile with the API (`GET /subscriptions/subscribers`,
  `GET /payments?type=subscription`) if you need certainty.
- **Idempotency:** the same event may arrive more than once in edge cases — key
  on a stable id before acting. This example keys on `subscriptionCustomerId`
  (+ event) with an in-memory set; use a database in production.
- Amounts inside webhook payloads are in the **smallest currency unit (cents)**.

### Subscription events this server handles

| Event | When | What the demo does |
| --- | --- | --- |
| `customer.subscription.created` | Subscription activated (fires once) | Grant access |
| `customer.subscription.updated` | State change (past_due, cancel scheduled, resumed, …) | Re-sync state |
| `customer.subscription.deleted` | Fully cancelled / access ended | Revoke access |
| `customer.subscription.pause` | Billing paused, **access retained** | Note paused |
| `customer.subscription.resumed` | Resumed after pause | Restore billing |
| `customer.subscription.trial_will_end` | Trial ending soon | Nudge the customer |
| `invoice.payment_succeeded` | Renewal charged | Extend access |
| `invoice.payment_failed` | Renewal failed | Dunning / warn |
| `payment_intent.succeeded` / `payment_intent.payment_failed` | Low-level payment result | Log |

Do **not** dedupe `customer.subscription.updated` on customer id — it is a
recurring state-change signal.

---

## Docs

- Subscriptions API quickstart — https://docs.pocketsflow.com/api-reference/subscriptions-quickstart
- Webhook events reference — https://docs.pocketsflow.com/api-webhooks/events
- Verifying webhooks — https://docs.pocketsflow.com/api-webhooks/authentication-and-security

## License

MIT — see [LICENSE](LICENSE). This is example code; use it as a starting point.
