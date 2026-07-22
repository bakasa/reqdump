# ReqDump

<p align="center">
  <img src="https://img.shields.io/github/stars/bakasa/reqdump?style=flat&color=%2300e5ff" alt="Stars"/>
  <img src="https://img.shields.io/github/license/bakasa/reqdump?style=flat&color=%2300e5ff" alt="License"/>
  <img src="https://img.shields.io/github/languages/top/bakasa/reqdump?style=flat&color=%2300e5ff" alt="TypeScript"/>
  <img src="https://img.shields.io/badge/Hono-4.x-%2300e5ff" alt="Hono"/>
  <a href="https://reqdump-production.up.railway.app"><img src="https://img.shields.io/badge/demo-live-%2300e5ff" alt="Demo"/></a>
</p>

Dead-simple HTTP request inspector / webhook debugger. No signup required.

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

- **Instant endpoints**: Click a button, get a URL. No account needed.
- **All methods**: Capture GET, POST, PUT, PATCH, DELETE requests
- **Full inspection**: View method, path, headers, query params, body, and timestamp
- **Clean dashboard**: Web UI to browse captured requests
- **JSON API**: Integrate with your tools via REST API
- **Auto-expiry**: Requests expire after 24 hours
- **Viral headers**: Every response includes `X-ReqDump` and `X-ReqDump-Link` for easy sharing

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
POST /api/bins          → Create a new dump endpoint
GET  /api/bins/:id      → List all captured requests (JSON)
GET  /bin/:id           → Dashboard HTML
GET  /bin/:id/req/:id   → Single request detail (HTML)
ANY  /:id/*             → Capture a request
GET  /health            → Health check
```

## Use Cases

- Debug Stripe / GitHub / Discord webhooks during development
- Inspect what API clients are actually sending
- Capture webhook payloads from third-party services
- Share request details with your team via permalink
- Integration testing — use reqdump as a mock endpoint

## Tech

- Node.js + Hono + better-sqlite3 + TypeScript
- Single file, no build step, no docker required
- ~500 lines of TypeScript
