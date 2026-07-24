"use strict";

/**
 * Local test helper: sign a sample payload the way Pocketsflow does and POST it
 * to your running receiver — no real subscription or tunnel required.
 *
 *   node sign-and-send.js customer.subscription.created
 *
 * It reads fixtures/<event>.json, injects a webhookId (as the real delivery
 * does), signs the RAW JSON bytes with your POCKETSFLOW_WEBHOOK_SECRET, and
 * sends it with the same headers a real delivery uses.
 */

require("dotenv").config();
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const SECRET = process.env.POCKETSFLOW_WEBHOOK_SECRET;
const PORT = process.env.PORT || 4000;
const URL = process.env.TARGET_URL || `http://localhost:${PORT}/webhooks`;

const event = process.argv[2] || "customer.subscription.created";
const fixturePath = path.join(__dirname, "fixtures", `${event}.json`);

if (!SECRET) {
  console.error("Missing POCKETSFLOW_WEBHOOK_SECRET (see .env.example).");
  process.exit(1);
}
if (!fs.existsSync(fixturePath)) {
  console.error(`No fixture for "${event}". Available:`);
  for (const f of fs.readdirSync(path.join(__dirname, "fixtures"))) {
    console.error("  -", f.replace(/\.json$/, ""));
  }
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

// The real delivery injects webhookId into the body before signing.
const body = JSON.stringify({ ...data, webhookId: data.webhookId || "whk_local_test" });
const signature = crypto.createHmac("sha256", SECRET).update(body).digest("hex");

async function main() {
  const res = await fetch(URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Pocketsflow-Signature": signature,
      "X-Pocketsflow-Event": event,
      "X-Pocketsflow-Timestamp": Date.now().toString(),
    },
    body,
  });
  console.log(`POST ${URL} [${event}] -> ${res.status} ${await res.text()}`);
}

main().catch((err) => {
  console.error("Failed to send. Is the server running (npm start)?");
  console.error(err.message);
  process.exit(1);
});
