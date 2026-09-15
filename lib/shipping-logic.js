// Shared PayPal server-side shipping callback logic.
// Used by both the Netlify function (netlify/functions/paypal-shipping-callback.js)
// and the standalone Express server (server.js).
//
// Based on: https://developer.paypal.com/docs/checkout/standard/customize/shipping-module/

// ---------------------------------------------------------------------------
// 1. Cart lookup — REPLACE THIS with your real order/cart storage.
//
// IMPORTANT: PayPal validates that the item_total (and tax_total) you return
// here match what the order was actually created with. A hardcoded demo
// value that doesn't match your real test order's item total will get
// rejected with a 422 "ITEM_TOTAL_MISMATCH" from PayPal's own shiptaxcalcserv
// — the callback response you sent never even reaches the buyer's review
// page in that case. If cartId isn't one you have real data for, we fall
// back to the order's own current amount (from the callback payload) instead
// of a fixed number, so ad hoc testing doesn't trip this validation. We also
// default the fallback tax rate to 0, since inventing a tax that wasn't part
// of the original order causes the same class of mismatch.
// ---------------------------------------------------------------------------
const DEMO_CARTS = {
  // Add real cart_id -> { itemTotal, taxRate } entries here once you're
  // wiring this up to actual order data.
};

function getCart(cartId, fallbackAmount) {
  if (DEMO_CARTS[cartId]) return DEMO_CARTS[cartId];

  const itemTotal = fallbackAmount != null ? Number(fallbackAmount) : 100.0;
  return { itemTotal, taxRate: 0 };
}

// ---------------------------------------------------------------------------
// 2. Shipping rules — REPLACE with your real rate logic.
// ---------------------------------------------------------------------------
const SUPPORTED_COUNTRIES = new Set(["US", "CA"]);

function getShippingOptions(address) {
  if (address.country_code === "US") {
    return [
      { id: "FREE", amount: "0.00", type: "SHIPPING", label: "Free Shipping (5-7 days)" },
      { id: "STD", amount: "7.00", type: "SHIPPING", label: "Standard Shipping (3-5 days)" },
      { id: "EXP", amount: "18.00", type: "SHIPPING", label: "Express Shipping (1-2 days)" },
    ];
  }
  if (address.country_code === "CA") {
    return [
      { id: "INTL_STD", amount: "15.00", type: "SHIPPING", label: "International Standard" },
      { id: "INTL_EXP", amount: "35.00", type: "SHIPPING", label: "International Express" },
    ];
  }
  return [];
}

function currency(value) {
  return { currency_code: "USD", value: Number(value).toFixed(2) };
}

function buildSuccessResponse({ orderId, referenceId, cart, options, selectedOptionId }) {
  const selected = selectedOptionId
    ? options.find((o) => o.id === selectedOptionId) || options[0]
    : options[0];

  const shippingOptions = options.map((o) => ({
    id: o.id,
    amount: currency(o.amount),
    type: o.type,
    label: o.label,
    selected: o.id === selected.id,
  }));

  const itemTotal = cart.itemTotal;
  const taxTotal = Math.round(itemTotal * cart.taxRate * 100) / 100;
  const shippingAmount = Number(selected.amount);
  const total = Math.round((itemTotal + taxTotal + shippingAmount) * 100) / 100;

  return {
    id: orderId,
    purchase_units: [
      {
        reference_id: referenceId,
        amount: {
          currency_code: "USD",
          value: total.toFixed(2),
          breakdown: {
            item_total: currency(itemTotal),
            tax_total: currency(taxTotal),
            shipping: currency(shippingAmount),
          },
        },
        shipping_options: shippingOptions,
      },
    ],
  };
}

function declineBody(issue) {
  return { name: "UNPROCESSABLE_ENTITY", details: [{ issue }] };
}

/**
 * Pure function: takes the parsed callback payload + cartId, returns
 * { statusCode, body } where body is a plain JS object (caller serializes it).
 */
function computeShippingResponse({ id: orderId, shipping_address: address, shipping_option: chosenOption, purchase_units, cartId }) {
  const referenceId = purchase_units?.[0]?.reference_id;

  if (!address) {
    return { statusCode: 400, body: { error: "Missing shipping_address" } };
  }

  if (!SUPPORTED_COUNTRIES.has(address.country_code)) {
    console.log(`Declining: unsupported country ${address.country_code}`);
    return { statusCode: 422, body: declineBody("COUNTRY_ERROR") };
  }

  const options = getShippingOptions(address);
  if (options.length === 0) {
    return { statusCode: 422, body: declineBody("ADDRESS_ERROR") };
  }

  if (chosenOption && !options.some((o) => o.id === chosenOption.id)) {
    console.log(`Declining: shipping option ${chosenOption.id} unavailable for this address`);
    return { statusCode: 422, body: declineBody("METHOD_UNAVAILABLE") };
  }

  const cart = getCart(cartId, purchase_units?.[0]?.amount?.value);
  const body = buildSuccessResponse({
    orderId,
    referenceId,
    cart,
    options,
    selectedOptionId: chosenOption?.id,
  });

  return { statusCode: 200, body };
}

module.exports = { computeShippingResponse, getCart, getShippingOptions };
