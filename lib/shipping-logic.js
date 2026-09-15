// Shared PayPal server-side shipping callback logic.
// Used by both the Netlify function (netlify/functions/paypal-shipping-callback.js)
// and the standalone Express server (server.js).
//
// Based on: https://developer.paypal.com/docs/checkout/standard/customize/shipping-module/

// ---------------------------------------------------------------------------
// 1. Cart lookup — REPLACE THIS with your real order/cart storage.
// ---------------------------------------------------------------------------
const DEMO_CARTS = {
  default: { itemTotal: 100.0, taxRate: 0.0825 },
};

function getCart(cartId) {
  return DEMO_CARTS[cartId] || DEMO_CARTS.default;
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

  const cart = getCart(cartId);
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
