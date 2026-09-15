// PayPal server-side shipping callback listener — Netlify Function
//
// Handles the SHIPPING_ADDRESS / SHIPPING_OPTIONS callbacks described here:
// https://developer.paypal.com/docs/checkout/standard/customize/shipping-module/
//
// This is wired up by setting, on your Create Order request:
//   payment_source.paypal.experience_context.order_update_callback_config = {
//     callback_events: ["SHIPPING_ADDRESS", "SHIPPING_OPTIONS"],
//     callback_url: "https://<your-site>.netlify.app/.netlify/functions/paypal-shipping-callback?cart_id=..."
//   }
//
// PayPal calls this URL synchronously while the buyer is on the review page:
//   - once with just shipping_address, when the page first loads or the buyer changes address
//   - again with shipping_address + shipping_option, when the buyer picks/changes a shipping method
// Your response has to come back fast (this blocks the buyer's UI) and must contain
// the updated shipping_options + amount breakdown, or a 422 decline.

// ---------------------------------------------------------------------------
// 1. Cart lookup — REPLACE THIS with your real order/cart storage.
//
// The callback only tells you the PayPal order id, the (redacted) shipping
// address, and the purchase_units' reference_id + last-known amount — it does
// NOT include your line items. You need to look those up yourself, typically
// keyed off:
//   - a `cart_id` / `session_id` you embedded as a query string on callback_url
//     when you created the order (recommended by PayPal's docs), or
//   - the order `id` itself, if you stored a mapping when you called Create Order.
// ---------------------------------------------------------------------------
const DEMO_CARTS = {
  // cart_id -> { itemTotal, taxRate }
  default: { itemTotal: 100.0, taxRate: 0.0825 },
};

function getCart(cartId) {
  return DEMO_CARTS[cartId] || DEMO_CARTS.default;
}

// ---------------------------------------------------------------------------
// 2. Shipping rules — REPLACE with your real rate logic (flat rate, carrier
// API call, distance/weight based, etc). Keyed off the buyer's address.
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

// ---------------------------------------------------------------------------
// 3. Response builder — assembles the purchase_units patch PayPal expects,
// with a self-consistent amount breakdown (item_total + tax_total + shipping
// must sum to the purchase unit total; the selected option's amount must
// equal purchase_units[].amount.breakdown.shipping.value).
// ---------------------------------------------------------------------------
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

function declineResponse(issue) {
  return {
    statusCode: 422,
    body: JSON.stringify({
      name: "UNPROCESSABLE_ENTITY",
      details: [{ issue }],
    }),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const cartId = (event.queryStringParameters || {}).cart_id || "default";

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (err) {
    console.error("Invalid JSON body:", err.message);
    return { statusCode: 400, body: "Bad request" };
  }

  const { id: orderId, shipping_address: address, shipping_option: chosenOption, purchase_units } = payload;
  const referenceId = purchase_units?.[0]?.reference_id;

  console.log("Shipping callback received", {
    orderId,
    cartId,
    address,
    chosenOptionId: chosenOption?.id,
  });

  if (!address) {
    console.warn("Callback missing shipping_address");
    return { statusCode: 400, body: "Missing shipping_address" };
  }

  // --- Validate the address ---------------------------------------------
  if (!SUPPORTED_COUNTRIES.has(address.country_code)) {
    console.log(`Declining: unsupported country ${address.country_code}`);
    return declineResponse("COUNTRY_ERROR");
  }

  const options = getShippingOptions(address);
  if (options.length === 0) {
    return declineResponse("ADDRESS_ERROR");
  }

  // If the buyer picked a shipping option that no longer exists for this
  // address (e.g. they changed address after selecting), decline it.
  if (chosenOption && !options.some((o) => o.id === chosenOption.id)) {
    console.log(`Declining: shipping option ${chosenOption.id} unavailable for this address`);
    return declineResponse("METHOD_UNAVAILABLE");
  }

  const cart = getCart(cartId);
  const responseBody = buildSuccessResponse({
    orderId,
    referenceId,
    cart,
    options,
    selectedOptionId: chosenOption?.id,
  });

  console.log("Responding with updated shipping options + amount", responseBody.purchase_units[0].amount);

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(responseBody),
  };
};
