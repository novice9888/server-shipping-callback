const express = require('express');

const app = express();

app.use(express.json());

function buildShippingResponse(body, query) {
  const shippingAddressState = body?.shipping_address?.state;
  const purchaseUnit = body?.purchase_units?.[0] || {};
  const amount = purchaseUnit.amount || {};
  const breakdown = amount.breakdown || {};
  const baseAmount = breakdown.item_total?.value || amount.value || '0.00';
  const currencyCode = amount.currency_code || breakdown.item_total?.currency_code || 'GBP';
  const shippingAmount = shippingAddressState === 'CA' ? '0.00' : '15.00';

  return {
    id: body?.id,
    cart_id: query.cart_id,
    session_id: query.session_id,
    purchase_units: [
      {
        reference_id: purchaseUnit.reference_id || 'default',
        amount: {
          currency_code: currencyCode,
          value: (parseFloat(baseAmount) + parseFloat(shippingAmount)).toFixed(2),
          breakdown: {
            item_total: {
              currency_code: currencyCode,
              value: String(baseAmount)
            },
            shipping: {
              currency_code: currencyCode,
              value: shippingAmount
            }
          }
        }
      }
    ]
  };
}

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

app.get('/shipping-callback', (req, res) => {
  console.log('GET /shipping-callback received:', req.query);
  res.json({
    ok: true,
    message: 'Shipping callback host is reachable',
    query: req.query
  });
});

app.post('/shipping-callback', (req, res) => {
  console.log('POST /shipping-callback received:', JSON.stringify({ query: req.query, body: req.body }, null, 2));
  res.json(buildShippingResponse(req.body, req.query || {}));
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`Shipping callback host listening on port ${port}`);
});