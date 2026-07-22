# reqdump — Reddit /r/selfhosted Post Draft

## Title Option A (technical hook)
I built a webhook debugger in 500 lines of TypeScript — zero signup, self-host in 2 minutes

## Title Option B (problem-first)
reqdump: open-source HTTP request inspector that takes 2 minutes to self-host. No signup, no rate limits.

## Body

Hey /r/selfhosted!

I got tired of webhook.site rate-limiting me during development, and RequestBin shutting down — so I built my own: **reqdump**.

It's a dead-simple HTTP request inspector / webhook debugger in ~500 lines of TypeScript (single file, no build step).

**The gist:**
1. Click a button → get a unique URL
2. Send any HTTP request to it (GET, POST, PUT, PATCH, DELETE)
3. See method, path, headers, query params, body, timestamp — everything

**Why you might care:**

- **Zero signup, zero rate limits** — Just click and go
- **Self-host in 2 minutes**: `git clone && npm install && npm start`
- **Single file, 3 runtime deps** (hono, better-sqlite3, @hono/node-server) — ~500 lines total
- **MIT licensed** — Fork it, modify it, do whatever
- **Docker image available**: `ghcr.io/bakasa/reqdump`
- **One-click Railway deploy** if that's your thing
- **Dark radar-themed UI** because I couldn't resist

**Use cases:**
- Debugging Stripe/GitHub/Discord webhooks locally
- Testing what your API client is actually sending
- Mock endpoint for integration tests
- Share request details with teammates via permalink

**Tech stack:** Hono + better-sqlite3 + TypeScript, no build step, runs on `tsx` directly.

The whole app is one file — easy to read, easy to modify. That was the point: keep it simple enough that anyone can understand and extend it.

**Links:**
- Live demo: https://reqdump-production.up.railway.app
- GitHub: https://github.com/bakasa/reqdump
- Blog post about the tech stack: https://company-site-production-9f58.up.railway.app/blog/hono-sqlite-webhook-debugger

I'd love feedback — especially if you have ideas for features that would make this more useful for your self-hosted setup. Request replay? WebSocket support? Configurable TTL?

---

## Notes for poster

- Post to https://old.reddit.com/r/selfhosted/ — this subreddit is very active and friendly to self-hosted tools
- Best time to post: 9 AM - 12 PM US Eastern on a weekday
- Create a throwaway account if you don't want to use your main Reddit account
- If using r/selfhosted, make sure to engage with every comment — that drives the algorithm
- Consider cross-posting to r/webdev or r/opensource after 72 hours if this gains traction
