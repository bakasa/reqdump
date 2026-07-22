# ReqDump

<p align="center">
  <img src="https://img.shields.io/github/stars/bakasa/reqdump?style=flat&color=%2300e5ff" alt="Stars"/>
  <img src="https://img.shields.io/github/license/bakasa/reqdump?style=flat&color=%2300e5ff" alt="License"/>
  <img src="https://img.shields.io/github/languages/top/bakasa/reqdump?style=flat&color=%2300e5ff" alt="TypeScript"/>
  <img src="https://img.shields.io/badge/Hono-4.x-%2300e5ff" alt="Hono"/>
  <a href="https://reqdump-production.up.railway.app"><img src="https://img.shields.io/badge/demo-live-%2300e5ff" alt="Demo"/></a>
</p>

Dead-simple HTTP request inspector & Stripe webhook debugger. No signup required.

[**Live instance**](https://reqdump-production.up.railway.app) &middot; [Deploy on Railway](https://railway.app/template/reqdump)

```
# Create a dump endpoint
curl -X POST https://reqdump-production.up.railway.app/api/bins

# Send requests to it
curl -X POST https://reqdump-production.up.railway.app/<your-bin-id>/path -d "hello world"

# Open the dashboard to inspect
open https://reqdump-production.up.railway.app/bin/<your-bin-id>
```

## Features

- **Stripe signature verification**: Paste any Stripe webhook payload and verify its signature instantly — no SDK needed
- **Stripe webhook debugger**: Dedicated tool at `/stripe` for verifying signatures and debugging Stripe events
- **Instant endpoints**: Click a button, get a URL. No account needed.
- **All methods**: Capture GET, POST, PUT, PATCH, DELETE requests
- **Full inspection**: View method, path, headers, query params, body, and timestamp
- **Request replay**: Replay captured requests against any target URL — perfect for testing webhooks against your local dev server
- **Clean dashboard**: Web UI to browse captured requests
- **JSON API**: Integrate with your tools via REST API
- **Auto-expiry**: Requests expire after 24 hours
- **CORS enabled**: API endpoints support cross-origin requests from browser-based tools
- **Viral headers**: Every response includes `X-ReqDump` and `X-ReqDump-Link` for easy sharing
- **Embeddable badge**: Show your live request count in any README — `![reqdump](https://reqdump-production.up.railway.app/api/badge/YOUR_BIN_ID)`

## Deploy

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/reqdump)

### Self-host

```bash
git clone https://github.com/bakasa/reqdump
cd reqdump
npm install
npm start
```

Set `PORT` and `BASE_URL` environment variables as needed.

### Docker

```bash
docker run -p 3000:3000 -e BASE_URL=http://localhost:3000 ghcr.io/bakasa/reqdump
```

## API

```
POST /api/bins              → Create a new dump endpoint
GET  /api/bins/:id          → List all captured requests (JSON)
POST /api/replay/:binId/:id → Replay a captured request against a target URL
GET  /api/badge/:id         → Embeddable request count badge (SVG)
POST /api/stripe/verify     → Verify a Stripe webhook signature
GET  /stripe                → Stripe webhook debugger tool (HTML)
GET  /bin/:id               → Dashboard HTML
GET  /bin/:id/req/:id       → Single request detail (HTML)
ANY  /:id/*                 → Capture a request
GET  /health                → Health check
```

### GitHub Action

Test webhooks in your CI pipeline with the [reqdump GitHub Action](https://github.com/bakasa/reqdump-action):

```yaml
steps:
  - uses: bakasa/reqdump-action@v1
    id: webhook
  - run: |
      curl -X POST ${{ steps.webhook.outputs.endpoint }}/test \
        -H 'Content-Type: application/json' \
        -d '{"event":"payment.succeeded"}'
  - run: |
      curl ${{ steps.webhook.outputs.url }}/api/summary
```

No external service, no accounts — runs entirely on the GitHub Actions runner. Captures and asserts on webhook payloads during integration tests.

[![GitHub Marketplace](https://img.shields.io/badge/Marketplace-reqdump--action-%2300e5ff)](https://github.com/marketplace/actions/reqdump-action)

## Badge API

Embed a live request count badge in your project's README or docs page:

```
GET /api/badge/:binId
```

```markdown
[![reqdump](https://reqdump-production.up.railway.app/api/badge/abc123)](https://reqdump-production.up.railway.app/bin/abc123)
```

Example badge:  
![reqdump requests](https://reqdump-production.up.railway.app/api/badge/abc123)

### Replay API

Replay a captured request against any target URL — ideal for testing webhooks against your local dev server.

```
POST /api/replay/:binId/:reqId
Content-Type: application/json

{
  "target_url": "http://localhost:8080/webhook",
  "method": "POST",              // optional, defaults to original
  "headers": "{...}",            // optional JSON string, defaults to original
  "body": "{\\"hello\\":\\"world\\"}"  // optional, defaults to original
}
```

Returns the response status, headers, body, and elapsed time.

## Use Cases

- **Debug Stripe webhooks**: Capture Stripe events, verify signatures, and replay against your dev server — the complete Stripe webhook debugging workflow
- Debug GitHub / Discord webhooks during development
- Inspect what API clients are actually sending
- Capture webhook payloads from third-party services
- Share request details with your team via permalink
- Integration testing — use reqdump as a mock endpoint

## Tech

- Node.js + Hono + better-sqlite3 + TypeScript
- Single file, no build step, no docker required
- ~500 lines of TypeScript
