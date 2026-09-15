// Standalone Express server exposing both PayPal listeners.
// Use this for Render (or any host that runs a persistent Node process,
// as opposed to Netlify's per-request serverless functions).
//
// Start command: node server.js  (or `npm start`, see package.json)
// Render (and most hosts) inject the port to bind via process.env.PORT.

const express = require("express");
const { verifyPaypalSignature } = require("./lib/verify-signature");
const { computeShippingResponse } = require("./lib/shipping-logic");

const app = express();
const PORT = process.env.PORT || 3000;
const WEBHOOK_ID = process.env.PAYPAL_WEBHOOK_ID;

app.get("/", (req, res) => {
  res.send("PayPal listener is running.");
});

// --- Webhook listener ------------------------------------------------------
// Needs the RAW request body (unparsed) to compute the CRC32 for signature
// verification, so this route uses express.raw() instead of express.json().
app.post(
  "/paypal-webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const rawBody = req.body.toString("utf8");
    const headers = req.headers;

    console.log("PayPal webhook received:", {
      transmissionId: headers["paypal-transmission-id"],
      eventHeaderTime: headers["paypal-transmission-time"],
    });

    let isValid = false;
    try {
      isValid = await verifyPaypalSignature(rawBody, headers, WEBHOOK_ID);
    } catch (err) {
      console.error("Signature verification error:", err.message);
      return res.status(500).send("Verification error");
    }

    if (!isValid) {
      console.warn("Signature verification FAILED — rejecting event");
      return res.status(401).send("Invalid signature");
    }

    let data;
    try {
      data = JSON.parse(rawBody);
    } catch (err) {
      console.error("Body was not valid JSON:", err.message);
      return res.status(400).send("Bad request");
    }

    console.log("Verified PayPal event:", data.event_type, data.id);

    // TODO: act on data.event_type here, e.g.
    // if (data.event_type === "PAYMENT.CAPTURE.COMPLETED") { ...fulfill order... }

    res.status(200).send("OK");
  }
);

// --- Shipping callback listener ---------------------------------------
app.post("/paypal-shipping-callback", express.json(), async (req, res) => {
  const cartId = req.query.cart_id || "default";

  console.log("Shipping callback received", {
    orderId: req.body.id,
    cartId,
    address: req.body.shipping_address,
    chosenOptionId: req.body.shipping_option?.id,
  });

  const { statusCode, body } = computeShippingResponse({ ...req.body, cartId });

  console.log("Responding with", statusCode, body);

  res.status(statusCode).json(body);
});

app.listen(PORT, () => {
  console.log(`PayPal listener server running on port ${PORT}`);
});
