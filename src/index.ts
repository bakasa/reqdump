import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || join(__dirname, '..', 'data');
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(join(DATA_DIR, 'reqdump.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS bins (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_request_at TEXT
  );

  CREATE TABLE IF NOT EXISTS requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bin_id TEXT NOT NULL REFERENCES bins(id),
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    headers TEXT NOT NULL,
    query TEXT,
    body BLOB,
    body_type TEXT,
    remote_addr TEXT,
    timestamp TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_requests_bin_id ON requests(bin_id);
  CREATE INDEX IF NOT EXISTS idx_requests_timestamp ON requests(timestamp);
`);

const PORT = parseInt(process.env.PORT || '3000', 10);
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

const insertBin = db.prepare('INSERT INTO bins (id) VALUES (?)');
const getBin = db.prepare('SELECT * FROM bins WHERE id = ?');
const insertRequest = db.prepare(
  'INSERT INTO requests (bin_id, method, path, headers, query, body, body_type, remote_addr) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
);
const getRequests = db.prepare('SELECT * FROM requests WHERE bin_id = ? ORDER BY timestamp DESC');
const getRequest = db.prepare('SELECT * FROM requests WHERE id = ? AND bin_id = ?');
const updateBinTime = db.prepare('UPDATE bins SET last_request_at = datetime(\'now\') WHERE id = ?');
const deleteOldBins = db.prepare("DELETE FROM bins WHERE created_at < datetime('now', '-7 days') AND id NOT IN (SELECT DISTINCT bin_id FROM requests WHERE timestamp > datetime('now', '-1 day'))");

function genId(): string {
  return randomBytes(6).toString('base64url');
}

function formatRow(row: Record<string, unknown>): Record<string, unknown> {
  const r = { ...row };
  if (r.body instanceof Buffer) r.body = r.body.toString('utf-8');
  return r;
}

function html(content: string, title = 'ReqDump'): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<meta name="description" content="Dead-simple HTTP request inspector. Create an endpoint, send requests, inspect them.">
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root { --bg: #0f0f13; --surface: #1a1a24; --border: #2a2a3a; --text: #e4e4ec; --text-muted: #8888a0; --accent: #6366f1; --accent-hover: #818cf8; --success: #22c55e; --warn: #f59e0b; --font: 'SF Mono','Fira Code','Cascadia Code',monospace; }
body { font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif; background: var(--bg); color: var(--text); line-height: 1.6; min-height: 100vh; }
.container { max-width: 960px; margin: 0 auto; padding: 2rem 1.5rem; }
header { padding: 2rem 0 0; }
h1 { font-size: 2rem; font-weight: 700; letter-spacing: -0.02em; }
h1 span { color: var(--accent); }
.subtitle { color: var(--text-muted); font-size: 1.05rem; margin-top: 0.5rem; }
.btn { display: inline-flex; align-items: center; gap: 0.5rem; padding: 0.75rem 1.5rem; border-radius: 0.5rem; font-size: 1rem; font-weight: 600; cursor: pointer; border: none; text-decoration: none; transition: all 0.15s; }
.btn-primary { background: var(--accent); color: #fff; }
.btn-primary:hover { background: var(--accent-hover); transform: translateY(-1px); }
.btn-outline { background: transparent; border: 1px solid var(--border); color: var(--text); }
.btn-outline:hover { border-color: var(--accent); color: var(--accent); }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 0.75rem; padding: 1.5rem; margin: 1rem 0; }
.code { font-family: var(--font); font-size: 0.875rem; }
.request-item { padding: 1rem; border-bottom: 1px solid var(--border); cursor: pointer; transition: background 0.1s; }
.request-item:hover { background: rgba(99,102,241,0.05); }
.request-item:last-child { border-bottom: none; }
.badge { display: inline-block; padding: 0.15rem 0.5rem; border-radius: 0.25rem; font-size: 0.75rem; font-weight: 600; font-family: var(--font); }
.badge-get { background: rgba(34,197,94,0.15); color: var(--success); }
.badge-post { background: rgba(99,102,241,0.15); color: var(--accent); }
.badge-put { background: rgba(245,158,11,0.15); color: var(--warn); }
.badge-delete { background: rgba(239,68,68,0.15); color: #ef4444; }
.badge-patch { background: rgba(168,85,247,0.15); color: #a855f7; }
.meta { display: flex; gap: 1rem; align-items: center; flex-wrap: wrap; }
.meta time { color: var(--text-muted); font-size: 0.85rem; }
.path-text { font-family: var(--font); color: var(--text-muted); font-size: 0.85rem; word-break: break-all; }
.endpoint-url { display: flex; align-items: center; gap: 0.5rem; background: var(--bg); padding: 0.75rem 1rem; border-radius: 0.5rem; border: 1px solid var(--border); margin: 1rem 0; }
.endpoint-url code { flex: 1; font-family: var(--font); font-size: 0.9rem; color: var(--accent); }
.copy-btn { background: none; border: 1px solid var(--border); color: var(--text-muted); padding: 0.3rem 0.75rem; border-radius: 0.3rem; cursor: pointer; font-size: 0.8rem; }
.copy-btn:hover { border-color: var(--accent); color: var(--accent); }
.empty-state { text-align: center; padding: 3rem 1rem; color: var(--text-muted); }
.empty-state p { font-size: 1.1rem; margin-bottom: 0.5rem; }
.section-header { display: flex; justify-content: space-between; align-items: center; margin: 1.5rem 0 1rem; }
.section-header h2 { font-size: 1.25rem; }
.hero { text-align: center; padding: 4rem 0 3rem; }
.hero h1 { font-size: 2.5rem; }
.hero p { font-size: 1.1rem; color: var(--text-muted); max-width: 560px; margin: 1rem auto 2rem; }
.steps { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 1rem; margin: 2rem 0; }
.step { background: var(--surface); border: 1px solid var(--border); border-radius: 0.75rem; padding: 1.5rem; text-align: center; }
.step .num { display: inline-flex; align-items: center; justify-content: center; width: 2rem; height: 2rem; border-radius: 50%; background: var(--accent); color: #fff; font-weight: 700; font-size: 0.9rem; margin-bottom: 0.75rem; }
.step h3 { font-size: 1rem; margin-bottom: 0.5rem; }
.step p { font-size: 0.9rem; color: var(--text-muted); }
footer { text-align: center; padding: 2rem; color: var(--text-muted); font-size: 0.85rem; }
footer a { color: var(--accent); text-decoration: none; }
pre { background: var(--bg); padding: 1rem; border-radius: 0.5rem; overflow-x: auto; font-family: var(--font); font-size: 0.8rem; line-height: 1.5; margin: 0.5rem 0; }
.header-row { display: flex; gap: 0.5rem; flex-wrap: wrap; margin: 0.25rem 0; }
.header-key { color: var(--accent); font-family: var(--font); font-size: 0.8rem; }
.header-val { color: var(--text-muted); font-family: var(--font); font-size: 0.8rem; word-break: break-all; }
.back-link { display: inline-flex; align-items: center; gap: 0.3rem; color: var(--text-muted); text-decoration: none; font-size: 0.9rem; margin-bottom: 1rem; }
.back-link:hover { color: var(--accent); }
.tab { color: var(--text-muted); font-size: 0.85rem; }
</style>
</head>
<body>
${content}
<footer><div class="container"><a href="/">ReqDump</a> &mdash; dead-simple HTTP request inspector</div></footer>
</body>
</html>`;
}

function landingPage(): string {
  return html(`
<header><div class="container">
  <a href="/" style="text-decoration:none;color:var(--text)"><h1>req<span>dump</span></h1></a>
</div></header>
<div class="container">
  <div class="hero">
    <h1>Inspect HTTP requests.<br>No signup. <span style="color:var(--accent)">Free.</span></h1>
    <p>Create a unique endpoint URL, send requests to it, and inspect them in real-time. Perfect for debugging webhooks, testing API clients, and understanding what your HTTP calls actually send.</p>
    <form action="/api/bins" method="POST" style="display:inline">
      <button class="btn btn-primary">Create your endpoint &rarr;</button>
    </form>
    <p style="margin-top:1rem;font-size:0.85rem;color:var(--text-muted)">No account needed &middot; Requests expire in 24h</p>
  </div>

  <div class="steps">
    <div class="step">
      <div class="num">1</div>
      <h3>Create an endpoint</h3>
      <p>Click the button above and get a unique URL instantly.</p>
    </div>
    <div class="step">
      <div class="num">2</div>
      <h3>Send requests</h3>
      <p>Any HTTP method &mdash; GET, POST, PUT, PATCH, DELETE &mdash; with any headers or body.</p>
    </div>
    <div class="step">
      <div class="num">3</div>
      <h3>Inspect &amp; debug</h3>
      <p>See full request details: method, path, headers, query params, and body.</p>
    </div>
  </div>

  <div class="card">
    <h3 style="margin-bottom:0.75rem">Quick start</h3>
    <pre># Create a dump endpoint
curl -X POST ${BASE_URL}/api/bins

# Send a test request
curl -X POST ${BASE_URL}/&lt;your-bin-id&gt;/test \\
  -H "Content-Type: application/json" \\
  -d '{"hello":"world"}'

# Open the dashboard in your browser
open ${BASE_URL}/bin/&lt;your-bin-id&gt;</pre>
  </div>
</div>
`);
}

function binPage(binId: string, requests: Array<Record<string, unknown>>): string {
  const rows = requests.map(r => {
    const methodClass = `badge-${(r.method as string).toLowerCase()}`;
    const bodyPreview = r.body
      ? (r.body_type === 'application/json'
        ? JSON.stringify(JSON.parse(r.body as string), null, 2).slice(0, 200)
        : (r.body as string).slice(0, 200))
      : '';
    return `<div class="request-item" onclick="window.location='/bin/${binId}/req/${r.id}'">
      <div class="meta">
        <span class="badge ${methodClass}">${r.method}</span>
        <time>${r.timestamp}</time>
        <span class="path-text">${r.path}</span>
      </div>
      ${bodyPreview ? `<div class="code" style="margin-top:0.5rem;color:var(--text-muted);font-size:0.8rem">${escapeHtml(bodyPreview)}</div>` : ''}
    </div>`;
  }).join('');

  const endpointUrl = `${BASE_URL}/${binId}`;

  return html(`
<header><div class="container">
  <a href="/" style="text-decoration:none;color:var(--text)"><h1>req<span>dump</span></h1></a>
</div></header>
<div class="container">
  <div class="section-header">
    <h2>Bin <span style="color:var(--accent)">${binId}</span></h2>
    <form action="/api/bins" method="POST" style="display:inline">
      <button class="btn btn-outline" style="font-size:0.85rem;padding:0.5rem 1rem">New bin</button>
    </form>
  </div>

  <div class="endpoint-url">
    <span style="font-size:0.85rem;color:var(--text-muted)">Endpoint:</span>
    <code>${endpointUrl}</code>
    <button class="copy-btn" onclick="navigator.clipboard.writeText('${endpointUrl}')">Copy</button>
  </div>

  <p style="font-size:0.85rem;color:var(--text-muted);margin-bottom:1rem">
    Send any HTTP request to <strong>${endpointUrl}/your-path</strong> to capture it. Requests expire after 24 hours.
  </p>

  ${requests.length === 0 ? `
  <div class="empty-state">
    <p>No requests yet</p>
    <p style="font-size:0.9rem;margin-top:0.5rem">Send a request to your endpoint and it will appear here.</p>
    <pre style="margin-top:1rem;display:inline-block;text-align:left">curl -X POST ${endpointUrl}/test -d "hello world"</pre>
  </div>
  ` : `
  <div class="card" style="padding:0;overflow:hidden">
    ${rows}
  </div>
  <p style="font-size:0.85rem;color:var(--text-muted);margin-top:0.75rem">${requests.length} request${requests.length > 1 ? 's' : ''} captured</p>
  `}
</div>
`);
}

function requestDetailPage(binId: string, req: Record<string, unknown>): string {
  const headers: Record<string, string> = JSON.parse(req.headers as string);
  const headerRows = Object.entries(headers).map(([k, v]) =>
    `<div class="header-row"><span class="header-key">${escapeHtml(k)}:</span><span class="header-val">${escapeHtml(v)}</span></div>`
  ).join('');

  let bodyContent = '';
  if (req.body) {
    const raw = req.body as string;
    const type = req.body_type as string;
    if (type === 'application/json') {
      try { bodyContent = JSON.stringify(JSON.parse(raw), null, 2); } catch { bodyContent = raw; }
    } else {
      bodyContent = raw;
    }
  }

  const methodClass = `badge-${(req.method as string).toLowerCase()}`;

  return html(`
<header><div class="container">
  <a href="/" style="text-decoration:none;color:var(--text)"><h1>req<span>dump</span></h1></a>
</div></header>
<div class="container">
  <a href="/bin/${binId}" class="back-link">&larr; Back to bin</a>

  <div class="card">
    <div class="meta" style="margin-bottom:1rem">
      <span class="badge ${methodClass}">${req.method}</span>
      <span class="path-text">${req.path}</span>
      <time>${req.timestamp}</time>
    </div>

    <h3 style="font-size:1rem;margin-bottom:0.5rem">Headers</h3>
    <div style="background:var(--bg);padding:1rem;border-radius:0.5rem;border:1px solid var(--border);margin-bottom:1rem">
      ${headerRows}
    </div>

    ${req.query ? `<h3 style="font-size:1rem;margin-bottom:0.5rem">Query Parameters</h3><pre>${escapeHtml(req.query as string)}</pre>` : ''}

    ${bodyContent ? `<h3 style="font-size:1rem;margin-bottom:0.5rem;margin-top:1rem">Body</h3><pre>${escapeHtml(bodyContent)}</pre>` : ''}
  </div>
</div>
`);
}

function errorPage(msg: string): string {
  return html(`<div class="container" style="text-align:center;padding:4rem 0"><h2>${escapeHtml(msg)}</h2><p style="color:var(--text-muted);margin-top:0.5rem"><a href="/" style="color:var(--accent)">Go home</a></p></div>`);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const app = new Hono();

app.get('/health', c => c.json({ ok: true, ts: new Date().toISOString() }));

app.get('/', c => htmlResponse(landingPage()));

app.post('/api/bins', c => {
  const id = genId();
  insertBin.run(id);
  const url = `${BASE_URL}/bin/${id}`;
  if (c.req.header('Accept')?.includes('application/json')) {
    return c.json({ bin_id: id, endpoint: `${BASE_URL}/${id}`, dashboard: url });
  }
  return c.redirect(url, 302);
});

app.get('/api/bins/:id', c => {
  const bin = getBin.get(c.req.param('id')) as Record<string, unknown> | undefined;
  if (!bin) return c.json({ error: 'bin not found' }, 404);
  const requests = (getRequests.all(bin.id) as Array<Record<string, unknown>>).map(formatRow);
  return c.json({ bin_id: bin.id, request_count: requests.length, requests });
});

app.get('/bin/:id', c => {
  const bin = getBin.get(c.req.param('id')) as Record<string, unknown> | undefined;
  if (!bin) return htmlResponse(errorPage('Bin not found'), 404);
  const requests = (getRequests.all(bin.id) as Array<Record<string, unknown>>).map(formatRow);
  return htmlResponse(binPage(bin.id as string, requests));
});

app.get('/bin/:id/req/:reqId', c => {
  const { id, reqId } = c.req.param();
  const bin = getBin.get(id) as Record<string, unknown> | undefined;
  if (!bin) return htmlResponse(errorPage('Bin not found'), 404);
  const req = getRequest.get(parseInt(reqId, 10), id) as Record<string, unknown> | undefined;
  if (!req) return htmlResponse(errorPage('Request not found'), 404);
  return htmlResponse(requestDetailPage(id, formatRow(req)));
});

app.all('/:id/*', async c => {
  const binId = c.req.param('id');
  const bin = getBin.get(binId) as Record<string, unknown> | undefined;
  if (!bin) {
    const id = c.req.param('id');
    if (id === 'api' || id === 'bin' || id === 'health') return c.notFound();
    const newBin = genId();
    insertBin.run(newBin);
    return htmlResponse(errorPage('No such bin. Created a new one: <a href="/bin/' + newBin + '" style="color:var(--accent)">' + newBin + '</a>'));
  }

  const method = c.req.method;
  const path = c.req.path;
  const headers = JSON.stringify(Object.fromEntries(c.req.raw.headers.entries()));
  const url = new URL(c.req.url);
  const query = url.search.slice(1) || null;
  const remoteAddr = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || null;

  let body: Buffer | null = null;
  let bodyType: string | null = null;
  try {
    const raw = await c.req.raw.clone().arrayBuffer();
    if (raw.byteLength > 0 && raw.byteLength < 1_000_000) {
      body = Buffer.from(raw);
      bodyType = c.req.header('content-type') || null;
    }
  } catch { }

  insertRequest.run(binId, method, path, headers, query, body, bodyType, remoteAddr);
  updateBinTime.run(binId);

  const accept = c.req.header('Accept') || '';
  if (accept.includes('application/json')) {
    return c.json({
      ok: true,
      bin_id: binId,
      method,
      path,
      headers: JSON.parse(headers),
      query,
      body: body?.toString('utf-8') || null,
      body_type: bodyType,
      dashboard: `${BASE_URL}/bin/${binId}`
    });
  }

  return c.text(`Request captured.\nDashboard: ${BASE_URL}/bin/${binId}\n`);
});

app.notFound(c => htmlResponse(errorPage('Not found'), 404));

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

// Cleanup old bins every hour
setInterval(() => {
  try { deleteOldBins.run(); } catch { }
}, 60 * 60 * 1000);

serve({ fetch: app.fetch, port: PORT });
console.log(`ReqDump running on port ${PORT}`);
