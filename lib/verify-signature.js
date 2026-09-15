// Shared PayPal webhook signature verification logic.
// Used by both the Netlify function (netlify/functions/paypal-webhook.js)
// and the standalone Express server (server.js), so the two hosting paths
// can't drift out of sync.
//
// Based on PayPal's official self-verification sample:
// https://developer.paypal.com/api/rest/webhooks/rest/#link-selfverificationmethod

const crypto = require("crypto");
const crc32 = require("buffer-crc32");

// Certs are reused for many events, so cache them in memory for the life of
// the process (or the warm container, on serverless).
const certCache = new Map();

async function getCert(certUrl) {
  if (certCache.has(certUrl)) return certCache.get(certUrl);
  const res = await fetch(certUrl);
  if (!res.ok) {
    throw new Error(`Failed to download cert from ${certUrl}: ${res.status}`);
  }
  const pem = await res.text();
  certCache.set(certUrl, pem);
  return pem;
}

async function verifyPaypalSignature(rawBody, headers, webhookId) {
  const transmissionId = headers["paypal-transmission-id"];
  const timeStamp = headers["paypal-transmission-time"];
  const certUrl = headers["paypal-cert-url"];
  const transmissionSig = headers["paypal-transmission-sig"];

  if (!transmissionId || !timeStamp || !certUrl || !transmissionSig) {
    console.warn("Missing one or more PayPal signature headers");
    return false;
  }

  if (!webhookId) {
    throw new Error(
      "PAYPAL_WEBHOOK_ID env var is not set — copy the Webhook ID from your " +
        "PayPal app's webhook subscription and set it as an environment variable."
    );
  }

  const crc = parseInt("0x" + crc32(rawBody).toString("hex"));
  const message = `${transmissionId}|${timeStamp}|${webhookId}|${crc}`;

  const certPem = await getCert(certUrl);
  const signatureBuffer = Buffer.from(transmissionSig, "base64");

  const verifier = crypto.createVerify("SHA256");
  verifier.update(message);
  return verifier.verify(certPem, signatureBuffer);
}

module.exports = { verifyPaypalSignature };
