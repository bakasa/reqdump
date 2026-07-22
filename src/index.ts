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

let totalCaptured = 0;
const getTotalCaptured = db.prepare('SELECT COUNT(*) as count FROM requests');

function html(content: string, title = 'ReqDump — Open-Source HTTP Request Inspector & Webhook Debugger'): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<meta name="description" content="Debug webhooks and inspect HTTP requests instantly. Free, open-source request inspector with zero signup. Self-host or use the live instance.">
<meta property="og:title" content="reqdump — Open-Source HTTP Request Inspector">
<meta property="og:description" content="Debug webhooks instantly. Zero signup. One click. Open source.">
<meta property="og:type" content="website">
<meta property="og:url" content="${BASE_URL}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="reqdump — HTTP Request Inspector">
<meta name="twitter:description" content="Debug webhooks instantly. Zero signup. One click.">
<link rel="canonical" href="${BASE_URL}">
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
@keyframes pulse { 0%, 100% { opacity: .4; } 50% { opacity: .8; } }
@keyframes scan { 0% { transform: translateY(-100%); } 100% { transform: translateY(100vh); } }
@keyframes fadeIn { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
:root {
  --bg: #08080c; --surface: #111118; --border: #1e1e2e;
  --text: #e8e8ee; --text-muted: #6b6b80; --text-dim: #48485a;
  --cyan: #00e5ff; --cyan-dim: rgba(0,229,255,.08);
  --amber: #ffab00; --magenta: #d500f9;
  --font: 'SF Mono','Fira Code','Cascadia Code','JetBrains Mono',monospace;
  --body: -apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;
}
body { font-family: var(--body); background: var(--bg); color: var(--text); line-height: 1.6; min-height: 100vh; overflow-x: hidden; }
body::before { content: ''; position: fixed; inset: 0; background: repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,229,255,.008) 2px, rgba(0,229,255,.008) 4px); pointer-events: none; z-index: 999; }
.container { max-width: 960px; margin: 0 auto; padding: 2rem 1.5rem; position: relative; }
header { padding: 1.5rem 0 0; }
.logo { font-family: var(--font); font-size: 1.25rem; font-weight: 700; letter-spacing: -.03em; text-decoration: none; color: var(--text); display: flex; align-items: center; gap: .5rem; }
.logo span { color: var(--cyan); }
.logo .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--cyan); box-shadow: 0 0 8px var(--cyan); animation: pulse 2s ease-in-out infinite; }
h1 { font-size: clamp(2rem, 5vw, 3.2rem); font-weight: 800; letter-spacing: -.03em; line-height: 1.1; }
h1 span { color: var(--cyan); }
.subtitle { color: var(--text-muted); font-size: 1.1rem; margin-top: .75rem; max-width: 520px; }
.btn { display: inline-flex; align-items: center; gap: .5rem; padding: .8rem 1.75rem; border-radius: .4rem; font-size: 1rem; font-weight: 600; cursor: pointer; border: none; text-decoration: none; transition: all .15s; font-family: var(--body); }
.btn-primary { background: var(--cyan); color: #000; }
.btn-primary:hover { background: #66f0ff; transform: translateY(-2px); box-shadow: 0 8px 32px rgba(0,229,255,.2); }
.btn-outline { background: transparent; border: 1px solid var(--border); color: var(--text); }
.btn-outline:hover { border-color: var(--cyan); color: var(--cyan); }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: .75rem; padding: 1.5rem; margin: 1rem 0; }
.code { font-family: var(--font); font-size: .875rem; }
.request-item { padding: 1rem 1.25rem; border-bottom: 1px solid var(--border); cursor: pointer; transition: background .1s; display: flex; align-items: center; gap: 1rem; }
.request-item:hover { background: var(--cyan-dim); }
.request-item:last-child { border-bottom: none; }
.badge { display: inline-flex; align-items: center; padding: .15rem .55rem; border-radius: .2rem; font-size: .7rem; font-weight: 700; font-family: var(--font); letter-spacing: .02em; min-width: 4rem; justify-content: center; }
.badge-get { background: rgba(0,229,255,.12); color: var(--cyan); }
.badge-post { background: rgba(255,171,0,.12); color: var(--amber); }
.badge-put { background: rgba(213,0,249,.12); color: var(--magenta); }
.badge-delete { background: rgba(255,55,55,.12); color: #ff3737; }
.badge-patch { background: rgba(0,229,255,.12); color: var(--cyan); }
.meta { display: flex; gap: 1rem; align-items: center; flex-wrap: wrap; }
.meta time { color: var(--text-dim); font-size: .8rem; font-family: var(--font); }
.path-text { font-family: var(--font); color: var(--text-muted); font-size: .8rem; word-break: break-all; }
.endpoint-url { display: flex; align-items: center; gap: .5rem; background: var(--bg); padding: .75rem 1rem; border-radius: .4rem; border: 1px solid var(--border); margin: 1rem 0; }
.endpoint-url code { flex: 1; font-family: var(--font); font-size: .85rem; color: var(--cyan); }
.copy-btn { background: none; border: 1px solid var(--border); color: var(--text-dim); padding: .3rem .75rem; border-radius: .25rem; cursor: pointer; font-size: .75rem; font-family: var(--body); transition: all .1s; }
.copy-btn:hover { border-color: var(--cyan); color: var(--cyan); }
.empty-state { text-align: center; padding: 3rem 1rem; color: var(--text-muted); }
.empty-state p { font-size: 1.1rem; margin-bottom: .5rem; }
.section-header { display: flex; justify-content: space-between; align-items: center; margin: 1.5rem 0 1rem; }
.section-header h2 { font-size: 1.25rem; }
.hero { padding: 5rem 0 3rem; position: relative; }
.hero::before { content: ''; position: absolute; top: -50%; left: -20%; width: 140%; height: 200%; background: radial-gradient(ellipse at 50% 0%, var(--cyan-dim) 0%, transparent 60%); pointer-events: none; }
.hero > * { position: relative; }
.hero-tag { display: inline-flex; align-items: center; gap: .4rem; background: var(--cyan-dim); border: 1px solid rgba(0,229,255,.15); padding: .35rem .8rem; border-radius: 2rem; font-size: .75rem; color: var(--cyan); font-family: var(--font); margin-bottom: 1.5rem; letter-spacing: .03em; }
.hero h1 { margin-bottom: 1rem; }
.hero p { font-size: 1.1rem; color: var(--text-muted); max-width: 540px; margin: 0 auto 2rem; }
.hero-actions { display: flex; gap: .75rem; align-items: center; justify-content: center; flex-wrap: wrap; }
.hero-actions .hint { font-size: .8rem; color: var(--text-dim); }
.stats-bar { display: flex; justify-content: center; gap: 2rem; margin-top: 2.5rem; flex-wrap: wrap; }
.stat { text-align: center; }
.stat-num { font-family: var(--font); font-size: 1.4rem; font-weight: 700; color: var(--cyan); }
.stat-label { font-size: .75rem; color: var(--text-dim); text-transform: uppercase; letter-spacing: .06em; margin-top: .15rem; }
.steps { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; margin: 3rem 0; }
.step { background: var(--surface); border: 1px solid var(--border); border-radius: .75rem; padding: 1.5rem; text-align: center; position: relative; overflow: hidden; }
.step::after { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2px; background: linear-gradient(90deg, transparent, var(--cyan), transparent); opacity: .3; }
.step .num { display: inline-flex; align-items: center; justify-content: center; width: 2rem; height: 2rem; border-radius: 50%; background: rgba(0,229,255,.1); color: var(--cyan); font-weight: 700; font-size: .85rem; font-family: var(--font); margin-bottom: .75rem; border: 1px solid rgba(0,229,255,.15); }
.step h3 { font-size: 1rem; margin-bottom: .5rem; }
.step p { font-size: .85rem; color: var(--text-muted); }
footer { text-align: center; padding: 3rem 2rem; color: var(--text-dim); font-size: .8rem; border-top: 1px solid var(--border); margin-top: 2rem; }
footer a { color: var(--text-muted); text-decoration: none; }
footer a:hover { color: var(--cyan); }
pre { background: var(--bg); padding: 1.25rem; border-radius: .5rem; overflow-x: auto; font-family: var(--font); font-size: .8rem; line-height: 1.6; margin: .75rem 0; border: 1px solid var(--border); }
pre .cmt { color: var(--text-dim); }
pre .cmd { color: var(--cyan); }
.header-row { display: flex; gap: .5rem; flex-wrap: wrap; margin: .25rem 0; }
.header-key { color: var(--cyan); font-family: var(--font); font-size: .8rem; }
.header-val { color: var(--text-muted); font-family: var(--font); font-size: .8rem; word-break: break-all; }
.back-link { display: inline-flex; align-items: center; gap: .3rem; color: var(--text-dim); text-decoration: none; font-size: .85rem; margin-bottom: 1rem; }
.back-link:hover { color: var(--cyan); }
.features { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 1rem; margin: 2rem 0; }
.feature { background: var(--surface); border: 1px solid var(--border); border-radius: .75rem; padding: 1.5rem; }
.feature h3 { font-size: .95rem; margin-bottom: .5rem; }
.feature p { font-size: .85rem; color: var(--text-muted); }
.feature-icon { font-family: var(--font); font-size: 1.5rem; margin-bottom: .5rem; color: var(--cyan); }
.gh-link { display: inline-flex; align-items: center; gap: .4rem; color: var(--text-muted); text-decoration: none; font-size: .85rem; }
.gh-link:hover { color: var(--cyan); }
.replay-section { margin-top: 1.5rem; border-top: 1px solid var(--border); padding-top: 1.5rem; }
.replay-toggle { width: 100%; padding: .75rem 1rem; background: var(--surface); border: 1px dashed var(--border); border-radius: .5rem; color: var(--cyan); font-family: var(--font); font-size: .85rem; cursor: pointer; transition: all .15s; display: flex; align-items: center; gap: .5rem; justify-content: center; }
.replay-toggle:hover { border-color: var(--cyan); background: var(--cyan-dim); }
.replay-form { margin-top: 1rem; display: none; }
.replay-form.open { display: block; animation: fadeIn .2s ease-out; }
.replay-form label { display: block; font-size: .8rem; color: var(--text-dim); text-transform: uppercase; letter-spacing: .05em; margin-bottom: .35rem; margin-top: 1rem; }
.replay-form label:first-child { margin-top: 0; }
.replay-form input, .replay-form select, .replay-form textarea { width: 100%; padding: .65rem .85rem; background: var(--bg); border: 1px solid var(--border); border-radius: .4rem; color: var(--text); font-family: var(--font); font-size: .85rem; outline: none; transition: border .15s; }
.replay-form input:focus, .replay-form select:focus, .replay-form textarea:focus { border-color: var(--cyan); }
.replay-form textarea { min-height: 80px; resize: vertical; font-size: .8rem; line-height: 1.5; }
.replay-form .form-row { display: flex; gap: .75rem; align-items: end; }
.replay-form .form-row > * { flex: 1; }
.replay-btn { padding: .65rem 1.5rem; background: var(--cyan); color: #000; border: none; border-radius: .4rem; font-weight: 600; font-size: .85rem; cursor: pointer; transition: all .15s; font-family: var(--body); white-space: nowrap; }
.replay-btn:hover { background: #66f0ff; transform: translateY(-1px); }
.replay-btn:disabled { opacity: .5; cursor: not-allowed; transform: none; }
.replay-response { margin-top: 1rem; background: var(--surface); border: 1px solid var(--border); border-radius: .5rem; overflow: hidden; display: none; }
.replay-response.open { display: block; animation: fadeIn .2s ease-out; }
.replay-response .resp-header { display: flex; align-items: center; gap: .75rem; padding: .75rem 1rem; border-bottom: 1px solid var(--border); }
.replay-response .resp-status { font-family: var(--font); font-size: .85rem; font-weight: 700; padding: .15rem .5rem; border-radius: .2rem; }
.replay-response .resp-status-2xx { background: rgba(0,200,83,.12); color: #00c853; }
.replay-response .resp-status-3xx { background: rgba(255,171,0,.12); color: var(--amber); }
.replay-response .resp-status-4xx { background: rgba(255,55,55,.12); color: #ff3737; }
.replay-response .resp-status-5xx { background: rgba(255,55,55,.12); color: #ff3737; }
.replay-response .resp-elapsed { font-family: var(--font); font-size: .75rem; color: var(--text-dim); margin-left: auto; }
.replay-response .resp-body { padding: 0; }
.replay-response .resp-body pre { margin: 0; border: none; border-radius: 0; max-height: 400px; }
.replay-response .resp-tabs { display: flex; border-bottom: 1px solid var(--border); }
.replay-response .resp-tab { padding: .5rem 1rem; font-size: .8rem; color: var(--text-dim); cursor: pointer; border-bottom: 2px solid transparent; font-family: var(--body); background: none; }
.replay-response .resp-tab.active { color: var(--cyan); border-bottom-color: var(--cyan); }
.replay-response .resp-tab-content { display: none; }
.replay-response .resp-tab-content.active { display: block; }
.replay-error { margin-top: .5rem; padding: .75rem 1rem; background: rgba(255,55,55,.08); border: 1px solid rgba(255,55,55,.2); border-radius: .4rem; color: #ff5555; font-family: var(--font); font-size: .85rem; display: none; }
.replay-error.show { display: block; }
@media (max-width: 640px) { .hero { padding: 3rem 0 2rem; } .hero-actions { flex-direction: column; } .replay-form .form-row { flex-direction: column; } }
</style>
</head>
<body>
${content}
<footer><div class="container"><span style="color:var(--text-dim)"><span style="color:var(--cyan)">reqdump</span> — open-source HTTP request inspector &middot; <a href="https://github.com/bakasa/reqdump" target="_blank">GitHub</a></span></div></footer>
</body>
</html>`;
}

function landingPage(): string {
  const total = (getTotalCaptured.get() as { count: number }).count;
  return html(`
<header><div class="container">
  <a href="/" class="logo"><span class="dot"></span> req<span>dump</span></a>
</div></header>
<div class="container">
  <div class="hero">
    <div class="hero-tag"><span style="color:var(--cyan)">&#9679;</span> OPEN SOURCE &middot; ZERO SIGNUP</div>
    <h1>Inspect HTTP requests.<br>No signup. <span>Free.</span></h1>
    <p>Create a unique endpoint URL in one click and see every HTTP request sent to it — headers, body, query params, the works. The fastest way to debug webhooks and test API clients.</p>
    <div class="hero-actions">
      <form action="/api/bins" method="POST" style="display:inline">
        <button class="btn btn-primary">Create your endpoint &rarr;</button>
      </form>
      <a href="https://github.com/bakasa/reqdump" target="_blank" class="btn btn-outline">GitHub</a>
    </div>
    <div class="stats-bar">
      <div class="stat"><div class="stat-num">${total.toLocaleString()}</div><div class="stat-label">Requests captured</div></div>
      <div class="stat"><div class="stat-num">0s</div><div class="stat-label">Signup time</div></div>
      <div class="stat"><div class="stat-num">100%</div><div class="stat-label">Open source</div></div>
    </div>
  </div>

  <div class="steps">
    <div class="step">
      <div class="num">1</div>
      <h3>Create an endpoint</h3>
      <p>Click the button above and get a unique URL instantly. No email, no password, no nonsense.</p>
    </div>
    <div class="step">
      <div class="num">2</div>
      <h3>Send requests</h3>
      <p>Any HTTP method &mdash; GET, POST, PUT, PATCH, DELETE &mdash; with any headers, body, or query params.</p>
    </div>
    <div class="step">
      <div class="num">3</div>
      <h3>Inspect everything</h3>
      <p>See method, path, headers, query string, and body. Share the permalink to debug with your team.</p>
    </div>
  </div>

  <div class="features">
    <div class="feature">
      <div class="feature-icon">&#x25C8;</div>
      <h3>Zero friction</h3>
      <p>No signup, no rate limits, no "upgrade to pro." Click one button and you're already debugging.</p>
    </div>
    <div class="feature">
      <div class="feature-icon">&#x2699;</div>
      <h3>Self-hostable</h3>
      <p>Open source under MIT. Deploy your own instance on Railway in under 2 minutes. Full data control.</p>
    </div>
    <div class="feature">
      <div class="feature-icon">&#x2194;</div>
      <h3>Any method, any format</h3>
      <p>GET, POST, PUT, PATCH, DELETE — JSON, form data, text, binary. Whatever you throw at it.</p>
    </div>
  </div>

  <div class="card">
    <h3 style="margin-bottom:.75rem">Quick start</h3>
    <pre><span class="cmt"># Create a dump endpoint</span>
<span class="cmd">curl -X POST ${BASE_URL}/api/bins</span>

<span class="cmt"># Send a test request</span>
<span class="cmd">curl -X POST ${BASE_URL}/&lt;your-bin-id&gt;/test \</span>
  -H "Content-Type: application/json" \
  -d '{"hello":"world"}'

<span class="cmt"># Open the dashboard</span>
<span class="cmd">open ${BASE_URL}/bin/&lt;your-bin-id&gt;</span></pre>
  </div>

  <div class="card" style="text-align:center;border-style:dashed;border-color:var(--border);background:transparent">
    <p style="color:var(--text-muted);font-size:.9rem">Built with <a href="https://hono.dev" style="color:var(--cyan);text-decoration:none">Hono</a> + better-sqlite3 &middot; <a href="https://github.com/bakasa/reqdump" style="color:var(--cyan);text-decoration:none">contribute on GitHub</a></p>
  </div>

  <div style="text-align:center;padding:2rem 0 3rem">
    <div style="display:inline-flex;gap:.75rem;flex-wrap:wrap;justify-content:center">
      <a href="https://twitter.com/intent/tweet?text=reqdump%20%E2%80%94%20Open-source%20HTTP%20request%20inspector.%20Zero%20signup.%20One%20click.&url=https://reqdump-production.up.railway.app" target="_blank" rel="noopener" class="btn btn-outline" style="font-size:.8rem;padding:.4rem .85rem">&#120143; Share on X</a>
      <a href="https://news.ycombinator.com/submitlink?u=https://reqdump-production.up.railway.app&t=reqdump%20%E2%80%94%20open-source%20webhook%20inspector%2C%20no%20signup%20required" target="_blank" rel="noopener" class="btn btn-outline" style="font-size:.8rem;padding:.4rem .85rem">Y Share on HN</a>
      <a href="https://company-site-production-9f58.up.railway.app/blog/hono-sqlite-webhook-debugger" style="color:var(--text-dim);font-size:.8rem;text-decoration:none;display:inline-flex;align-items:center;gap:.3rem">Read the tech stack &rarr;</a>
    </div>
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
        <span class="badge ${methodClass}">${r.method}</span>
        <div style="flex:1;min-width:0">
          <div style="display:flex;gap:.75rem;align-items:center;flex-wrap:wrap">
            <time>${r.timestamp}</time>
            <span class="path-text">${r.path}</span>
          </div>
          ${bodyPreview ? `<div class="code" style="margin-top:.35rem;color:var(--text-dim);font-size:.75rem">${escapeHtml(bodyPreview)}</div>` : ''}
        </div>
    </div>`;
  }).join('');

  const endpointUrl = `${BASE_URL}/${binId}`;

  return html(`
<header><div class="container">
  <a href="/" class="logo"><span class="dot"></span> req<span>dump</span></a>
</div></header>
<div class="container">
  <div class="section-header">
    <h2>Bin <span style="color:var(--cyan)">${binId}</span></h2>
    <form action="/api/bins" method="POST" style="display:inline">
      <button class="btn btn-outline" style="font-size:.8rem;padding:.4rem .85rem">New bin</button>
    </form>
  </div>

  <div class="endpoint-url">
    <span style="font-size:.75rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:.05em">Endpoint</span>
    <code>${endpointUrl}</code>
    <button class="copy-btn" onclick="navigator.clipboard.writeText('${endpointUrl}')">Copy</button>
  </div>

  <p style="font-size:.8rem;color:var(--text-dim);margin-bottom:1rem">
    Send any HTTP request to <strong style="color:var(--text)">${endpointUrl}/your-path</strong> to capture it. Requests expire after 24 hours.
  </p>

  <div style="display:flex;gap:.5rem;margin-bottom:1rem;flex-wrap:wrap">
    <a href="https://twitter.com/intent/tweet?text=${encodeURIComponent('Debugging webhooks with reqdump — open source HTTP request inspector, no signup')}&url=${encodeURIComponent(BASE_URL + '/bin/' + binId)}" target="_blank" class="btn btn-outline" style="font-size:.8rem;padding:.35rem .85rem;text-decoration:none;display:inline-flex;align-items:center;gap:.35rem">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 4s-.7 2.1-2 3.4c1.6 10-9.4 17.3-18 11.6 2.2.1 4.4-.6 6-2C3 15.5.5 9.6 3 5c2.2 2.6 5.6 4.1 9 4-.9-4.2 4-6.6 7-3.8 1.1 0 3-1.2 3-1.2z"/></svg>
      Share on X
    </a>
    <a href="https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(BASE_URL + '/bin/' + binId)}" target="_blank" class="btn btn-outline" style="font-size:.8rem;padding:.35rem .85rem;text-decoration:none;display:inline-flex;align-items:center;gap:.35rem">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"/><rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/></svg>
      Share on LinkedIn
    </a>
  </div>

  ${requests.length === 0 ? `
  <div class="empty-state">
    <p>No requests yet</p>
    <p style="font-size:.9rem;margin-top:.5rem">Send a request to your endpoint and it will appear here.</p>
    <pre style="margin-top:1rem;display:inline-block;text-align:left">curl -X POST ${endpointUrl}/test -d "hello world"</pre>
  </div>
  ` : `
  <div class="card" style="padding:0;overflow:hidden">
    ${rows}
  </div>
  <p style="font-size:.8rem;color:var(--text-dim);margin-top:.75rem">${requests.length} request${requests.length > 1 ? 's' : ''} captured &middot; <a href="/bin/${binId}" style="color:var(--cyan);text-decoration:none">refresh</a></p>
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
  const shareText = encodeURIComponent(`Inspected a ${req.method} request on @reqdump — open source webhook debugger, no signup needed`);
  const shareUrl = encodeURIComponent(`${BASE_URL}/bin/${binId}/req/${req.id}`);
  const escapedBody = escapeHtml(bodyContent);
  const headersJson = escapeHtml(JSON.stringify(headers, null, 2));
  const method = req.method as string;

  return html(`
<header><div class="container">
  <a href="/" class="logo"><span class="dot"></span> req<span>dump</span></a>
</div></header>
<div class="container">
  <a href="/bin/${binId}" class="back-link">&larr; Back to bin</a>

  <div class="card">
    <div class="meta" style="margin-bottom:1rem">
      <span class="badge ${methodClass}">${method}</span>
      <span class="path-text">${req.path}</span>
      <time>${req.timestamp}</time>
    </div>

    <h3 style="font-size:.9rem;margin-bottom:.5rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:.06em">Headers</h3>
    <div style="background:var(--bg);padding:1rem;border-radius:.4rem;border:1px solid var(--border);margin-bottom:1rem">
      ${headerRows}
    </div>

    ${req.query ? `<h3 style="font-size:.9rem;margin-bottom:.5rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:.06em">Query Parameters</h3><pre>${escapeHtml(req.query as string)}</pre>` : ''}

    ${bodyContent ? `<h3 style="font-size:.9rem;margin-bottom:.5rem;margin-top:1rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:.06em">Body</h3><pre>${escapedBody}</pre>` : ''}
  </div>
  <div style="display:flex;gap:.5rem;margin-top:.75rem;flex-wrap:wrap">
    <button class="copy-btn" onclick="navigator.clipboard.writeText(window.location.href)">Copy link to this request</button>
    <a href="https://twitter.com/intent/tweet?text=${shareText}&url=${shareUrl}" target="_blank" class="btn btn-outline" style="font-size:.8rem;padding:.35rem .85rem;text-decoration:none;display:inline-flex;align-items:center;gap:.35rem">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 4s-.7 2.1-2 3.4c1.6 10-9.4 17.3-18 11.6 2.2.1 4.4-.6 6-2C3 15.5.5 9.6 3 5c2.2 2.6 5.6 4.1 9 4-.9-4.2 4-6.6 7-3.8 1.1 0 3-1.2 3-1.2z"/></svg>
      Share
    </a>
  </div>

  <div class="replay-section">
    <button class="replay-toggle" onclick="toggleReplay()">&#x25B6; Replay this request</button>
    <div class="replay-form" id="replayForm">
      <div class="form-row">
        <div>
          <label>Target URL</label>
          <input type="url" id="replayUrl" placeholder="http://localhost:8080/webhook" value="">
        </div>
        <div style="flex:0 0 auto">
          <label>Method</label>
          <select id="replayMethod">
            <option value="GET" ${method === 'GET' ? 'selected' : ''}>GET</option>
            <option value="POST" ${method === 'POST' ? 'selected' : ''}>POST</option>
            <option value="PUT" ${method === 'PUT' ? 'selected' : ''}>PUT</option>
            <option value="PATCH" ${method === 'PATCH' ? 'selected' : ''}>PATCH</option>
            <option value="DELETE" ${method === 'DELETE' ? 'selected' : ''}>DELETE</option>
          </select>
        </div>
      </div>
      <label>Headers (JSON)</label>
      <textarea id="replayHeaders" rows="4">${headersJson}</textarea>
      ${bodyContent ? `<label>Body</label><textarea id="replayBody" rows="5">${escapedBody}</textarea>` : '<input type="hidden" id="replayBody" value="">'}
      <div style="display:flex;gap:.5rem;margin-top:1rem">
        <button class="replay-btn" id="replaySendBtn" onclick="sendReplay()">Send</button>
        <span id="replaySpinner" style="display:none;color:var(--text-dim);font-size:.85rem;align-self:center">Sending...</span>
      </div>
      <div class="replay-error" id="replayError"></div>
      <div class="replay-response" id="replayResponse">
        <div class="resp-header">
          <span class="resp-status" id="respStatusBadge"></span>
          <span id="respStatusText" style="font-size:.85rem;color:var(--text-muted)"></span>
          <span class="resp-elapsed" id="respElapsed"></span>
        </div>
        <div class="resp-tabs">
          <button class="resp-tab active" data-tab="body" onclick="switchRespTab(this, 'body')">Body</button>
          <button class="resp-tab" data-tab="headers" onclick="switchRespTab(this, 'headers')">Headers</button>
        </div>
        <div class="resp-tab-content active" id="respBodyContent"><pre></pre></div>
        <div class="resp-tab-content" id="respHeadersContent"><pre></pre></div>
      </div>
    </div>
  </div>
</div>

<script>
function toggleReplay() {
  const form = document.getElementById('replayForm');
  form.classList.toggle('open');
}

async function sendReplay() {
  const btn = document.getElementById('replaySendBtn');
  const spinner = document.getElementById('replaySpinner');
  const error = document.getElementById('replayError');
  const resp = document.getElementById('replayResponse');
  const url = document.getElementById('replayUrl').value.trim();

  if (!url) {
    error.textContent = 'Target URL is required';
    error.classList.add('show');
    return;
  }
  error.classList.remove('show');
  error.textContent = '';

  btn.disabled = true;
  spinner.style.display = 'inline-block';
  resp.classList.remove('open');

  try {
    const r = await fetch('/api/replay/${binId}/${req.id}', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target_url: url,
        method: document.getElementById('replayMethod').value,
        headers: document.getElementById('replayHeaders').value,
        body: document.getElementById('replayBody')?.value || undefined
      })
    });
    const data = await r.json();
    if (data.error) { throw new Error(data.error); }

    document.getElementById('respStatusBadge').textContent = data.status;
    const statusClass = data.status < 300 ? 'resp-status-2xx' : data.status < 400 ? 'resp-status-3xx' : data.status < 500 ? 'resp-status-4xx' : 'resp-status-5xx';
    document.getElementById('respStatusBadge').className = 'resp-status ' + statusClass;
    document.getElementById('respStatusText').textContent = data.status_text;
    document.getElementById('respElapsed').textContent = data.elapsed_ms + 'ms';

    const body = typeof data.body === 'string' ? data.body : JSON.stringify(data.body, null, 2);
    const formattedBody = data.headers && data.headers['content-type'] && data.headers['content-type'].includes('json')
      ? (() => { try { return JSON.stringify(JSON.parse(body), null, 2); } catch(e) { return body; } })()
      : body;

    document.querySelector('#respBodyContent pre').textContent = formattedBody;
    const hJson = JSON.stringify(data.headers, null, 2);
    document.querySelector('#respHeadersContent pre').textContent = hJson;

    resp.classList.add('open');
  } catch (e) {
    error.textContent = e.message;
    error.classList.add('show');
  } finally {
    btn.disabled = false;
    spinner.style.display = 'none';
  }
}

function switchRespTab(tab, name) {
  document.querySelectorAll('.resp-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.resp-tab-content').forEach(t => t.classList.remove('active'));
  tab.classList.add('active');
  document.getElementById('resp' + name.charAt(0).toUpperCase() + name.slice(1) + 'Content').classList.add('active');
}
</script>
`);
}

function errorPage(msg: string): string {
  return html(`<div class="container" style="text-align:center;padding:4rem 0"><h2>${escapeHtml(msg)}</h2><p style="color:var(--text-muted);margin-top:0.5rem"><a href="/" style="color:var(--accent)">Go home</a></p></div>`);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const app = new Hono();

app.use('/api/*', async (c, next) => {
  await next();
  c.res.headers.set('Access-Control-Allow-Origin', '*');
  c.res.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  c.res.headers.set('Access-Control-Allow-Headers', '*');
});

app.options('/api/*', c => new Response(null, {
  headers: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': '*',
  }
}));

app.get('/robots.txt', c => new Response('User-agent: *\nAllow: /\n', {
  headers: { 'Content-Type': 'text/plain' }
}));

app.get('/sitemap.xml', c => new Response(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${BASE_URL}/</loc><priority>1.0</priority></url>
</urlset>`, {
  headers: { 'Content-Type': 'application/xml' }
}));

app.get('/health', c => c.json({ ok: true, ts: new Date().toISOString() }));

app.get('/', c => htmlResponse(landingPage()));

app.post('/api/bins', c => {
  const id = genId();
  insertBin.run(id);
  const endpoint = `${BASE_URL}/${id}`;
  const dashboard = `${BASE_URL}/bin/${id}`;
  const accept = c.req.header('Accept') || '';
  if (accept.includes('application/json')) {
    return new Response(JSON.stringify({ bin_id: id, endpoint, dashboard }), {
      headers: {
        'Content-Type': 'application/json',
        'X-ReqDump': 'true',
        'X-ReqDump-Link': dashboard
      }
    });
  }
  if (accept.includes('text/html')) {
    return new Response(null, {
      status: 302,
      headers: { Location: dashboard, 'X-ReqDump': 'true', 'X-ReqDump-Link': dashboard }
    });
  }
  return new Response(`Endpoint: ${endpoint}\nDashboard: ${dashboard}\n`, {
    headers: {
      'Content-Type': 'text/plain',
      'X-ReqDump': 'true',
      'X-ReqDump-Link': dashboard
    }
  });
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

app.post('/api/replay/:binId/:reqId', async c => {
  const { binId, reqId } = c.req.param();
  const bin = getBin.get(binId);
  if (!bin) return c.json({ error: 'bin not found' }, 404);

  const request = getRequest.get(parseInt(reqId, 10), binId) as Record<string, unknown> | undefined;
  if (!request) return c.json({ error: 'request not found' }, 404);

  let body: Record<string, unknown>;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid JSON body' }, 400); }

  const targetUrl = (body.target_url as string || '').trim();
  if (!targetUrl) return c.json({ error: 'target_url is required' }, 400);

  const replayMethod = (body.method as string) || (request.method as string);
  let replayHeaders: Record<string, string>;
  try {
    replayHeaders = typeof body.headers === 'string' ? JSON.parse(body.headers) : (body.headers as Record<string, string> || JSON.parse(request.headers as string));
  } catch { return c.json({ error: 'invalid headers JSON' }, 400); }

  delete replayHeaders['host'];
  delete replayHeaders['Host'];
  delete replayHeaders['content-length'];
  delete replayHeaders['Content-Length'];
  delete replayHeaders['content-encoding'];
  delete replayHeaders['Content-Encoding'];

  const replayBody = body.body !== undefined ? (typeof body.body === 'string' ? body.body : String(body.body)) : (request.body as string || undefined);

  try {
    const startTime = Date.now();
    const response = await fetch(targetUrl, {
      method: replayMethod,
      headers: replayHeaders,
      body: ['GET', 'HEAD'].includes(replayMethod.toUpperCase()) ? undefined : (replayBody || undefined),
    });
    const elapsed = Date.now() - startTime;

    const respHeaders: Record<string, string> = {};
    response.headers.forEach((v, k) => { respHeaders[k] = v; });

    const respBody = await response.text();

    return c.json({
      status: response.status,
      status_text: response.statusText,
      headers: respHeaders,
      body: respBody,
      elapsed_ms: elapsed,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 502);
  }
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
  totalCaptured = (getTotalCaptured.get() as { count: number }).count;

  const accept = c.req.header('Accept') || '';
  const dashboardUrl = `${BASE_URL}/bin/${binId}`;
  if (accept.includes('application/json')) {
    return new Response(JSON.stringify({
      ok: true,
      bin_id: binId,
      method,
      path,
      headers: JSON.parse(headers),
      query,
      body: body?.toString('utf-8') || null,
      body_type: bodyType,
      dashboard: dashboardUrl
    }), {
      headers: {
        'Content-Type': 'application/json',
        'X-ReqDump': 'true',
        'X-ReqDump-Link': dashboardUrl
      }
    });
  }

  return new Response(`Request captured.\nDashboard: ${dashboardUrl}\n`, {
    headers: {
      'X-ReqDump': 'true',
      'X-ReqDump-Link': dashboardUrl
    }
  });
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
