"use strict";

/**
 * Pocketsflow subscription webhooks — minimal, verified receiver.
 *
 * Run:  cp .env.example .env  (paste your signing secret)  ->  npm install  ->  npm start
 * Test: node sign-and-send.js customer.subscription.created
 *
 * Key points this file demonstrates:
 *  - Verify the HMAC-SHA256 signature against the RAW request body.
 *  - Route on the X-Pocketsflow-Event header.
 *  - Acknowledge fast (2xx); do slow work afterwards.
 *  - Be idempotent (the same event can arrive more than once).
 */

require("dotenv").config();
const express = require("express");
const crypto = require("crypto");

const PORT = process.env.PORT || 4000;
const SECRET = process.env.POCKETSFLOW_WEBHOOK_SECRET;

if (!SECRET) {
  console.error(
    "Missing POCKETSFLOW_WEBHOOK_SECRET. Copy .env.example to .env and paste your webhook signing secret."
  );
  process.exit(1);
}

const app = express();

/**
 * Verify the signature over the EXACT bytes received.
 * The signed JSON already contains a `webhookId` field, so hashing a
 * re-serialized object would produce different bytes and fail. That is why we
 * use express.raw() (below) and never JSON.parse before verifying.
 */
function isValidSignature(rawBody, signatureHeader) {
  if (!signatureHeader) return false;
  const expected = crypto
    .createHmac("sha256", SECRET)
    .update(rawBody)
    .digest("hex");
  const a = Buffer.from(signatureHeader, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Simple in-memory idempotency guard. Use a database (or Redis) in production.
const processed = new Set();

/**
 * Mount express.raw() on the webhook route so `req.body` is a Buffer of the
 * raw bytes — required for signature verification.
 */
app.post(
  "/webhooks",
  express.raw({ type: "application/json" }),
  (req, res) => {
    const signature = req.header("X-Pocketsflow-Signature");
    const event = req.header("X-Pocketsflow-Event");
    const rawBody = req.body; // Buffer

    if (!isValidSignature(rawBody, signature)) {
      console.warn("Rejected webhook: bad signature", { event });
      return res.status(401).send("invalid signature");
    }

    const payload = JSON.parse(rawBody.toString("utf8"));

    // Acknowledge immediately — Pocketsflow gives ~5s and does not retry.
    res.status(200).send("ok");

    // Idempotency: key on a stable id per subscriber + event.
    const key = `${event}:${payload.subscriptionCustomerId || payload.webhookId}`;
    if (processed.has(key)) {
      console.log("Duplicate event ignored:", key);
      return;
    }
    processed.add(key);

    handleEvent(event, payload);
  }
);

// A tiny health check so you can confirm the server is up.
app.get("/", (_req, res) => res.send("Pocketsflow subscription webhook receiver is running."));

/**
 * Your business logic. Everything here runs AFTER the 2xx ack.
 * Amounts in webhook payloads are in the smallest currency unit (cents).
 */
function handleEvent(event, payload) {
  switch (event) {
    case "customer.subscription.created":
      // Fires once when the subscription activates. Grant access here.
      console.log("✅ Subscription started", {
        subscriber: payload.subscriptionCustomerId,
        email: payload.customer?.email,
        status: payload.status,
        clientReferenceId: payload.clientReferenceId,
        metadata: payload.metadata,
      });
      break;

    case "customer.subscription.updated":
      // State change: past_due, recovery, cancel scheduled, resumed, etc.
      // Do NOT dedupe this on customer id — it is a recurring signal.
      console.log("🔄 Subscription updated", {
        subscriber: payload.subscriptionCustomerId,
        status: payload.status,
        cancelAtPeriodEnd: payload.subscriptionCustomer?.cancelAtPeriodEnd,
        paused: payload.subscriptionCustomer?.paused,
      });
      break;

    case "customer.subscription.deleted":
      // Fully cancelled / access ended. Revoke access.
      console.log("⛔ Subscription ended", {
        subscriber: payload.subscriptionCustomerId,
      });
      break;

    case "customer.subscription.pause":
      // Billing paused but access is retained.
      console.log("⏸️  Subscription paused (access retained)", {
        subscriber: payload.subscriptionCustomerId,
      });
      break;

    case "customer.subscription.resumed":
      console.log("▶️  Subscription resumed", {
        subscriber: payload.subscriptionCustomerId,
      });
      break;

    case "customer.subscription.trial_will_end":
      console.log("⏳ Trial ending soon", {
        subscriber: payload.subscriptionCustomerId,
        email: payload.customer?.email,
      });
      break;

    case "invoice.payment_succeeded":
      // A renewal was charged. Extend access to the new period.
      console.log("💳 Renewal charged", {
        subscriber: payload.subscriptionCustomerId,
      });
      break;

    case "invoice.payment_failed":
      // Renewal failed — start dunning / warn the customer.
      console.log("⚠️  Renewal failed", {
        subscriber: payload.subscriptionCustomerId,
      });
      break;

    case "payment_intent.succeeded":
    case "payment_intent.payment_failed":
      console.log(`ℹ️  ${event}`, { webhookId: payload.webhookId });
      break;

    default:
      console.log("Unhandled event:", event);
  }
}

app.listen(PORT, () => {
  console.log(`Listening for Pocketsflow webhooks on http://localhost:${PORT}/webhooks`);
});
