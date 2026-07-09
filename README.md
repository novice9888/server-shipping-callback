# Shipping Callback Host

This folder is a standalone Express app for hosting the PayPal server-side shipping callback outside localhost.

## Run locally

1. `cd shipping-callback-host`
2. `npm install`
3. `npm start`

The callback endpoint is:

`POST /shipping-callback`

Example public callback URL:

`https://your-host.example/shipping-callback?cart_id=abc123&session_id=sess456`

## Notes

- PayPal server-side shipping callbacks need a publicly reachable HTTPS URL.
- `localhost` will not work unless you expose it through a tunnel such as ngrok or Cloudflare Tunnel.
- The endpoint returns the updated purchase unit amount and echoes back `cart_id` and `session_id` for correlation.

## Health check

`GET /health`