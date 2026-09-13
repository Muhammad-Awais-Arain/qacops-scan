# QACops Scan

A free website QA scanner for `scan.qacops.com`. A visitor enters their site; a real Chromium browser (Playwright) walks up to 25 public pages and produces a shareable report:

- Broken links (internal and external)
- JavaScript console errors and uncaught exceptions
- Failed network requests (4xx, 5xx, network errors)
- Phone layout (pages wider than a 390px screen, outlined in screenshots)
- Accessibility (axe-core, WCAG 2.1 AA)
- Speed (load time, page weight, heaviest files)
- Security headers, HTTPS and mixed content

## Run locally

```bash
npm install
npm run browsers          # downloads Chromium for Playwright
npm run build             # builds the frontend into dist/
node server/index.js      # serves the app and API on http://127.0.0.1:3001
```

For frontend work with hot reload, run `npm run dev:api` and `npm run dev:web` in two terminals, then open http://localhost:5180.

To scan a site running on your own machine, start the server with `ALLOW_PRIVATE_TARGETS=1`. **Never set that in production.**

## How it's built

| Path | What it does |
|---|---|
| `server/index.js` | Express API, rate limiting, lead capture, serves `dist/` |
| `server/jobs.js` | In-memory queue, live event stream per scan, writes reports to `data/reports/<id>/` |
| `server/scanner.js` | The Playwright crawl and every check |
| `server/safety.js` | Blocks private and internal addresses, re-checks every redirect hop |
| `server/robots.js` | Honours robots.txt |
| `src/pages/` | Home form, live scan terminal, report page |

Leads (email, URL, scan id) are appended to `data/leads.jsonl`.

## Safety

- Every browser request goes through Node first, and every redirect hop is checked, so a public URL can't bounce the scanner into `localhost`, `10.x`, `169.254.169.254` and similar.
- Read only: no form submits, no logins, downloads and media blocked, service workers blocked.
- Limits: 3 scans per IP per hour, 25 pages, 3 minutes, queue of 20, one browser at a time.
- Visitors must tick a consent box and give an email.

## Settings (environment variables)

| Variable | Default |
|---|---|
| `PORT` | `3001` |
| `DATA_DIR` | `./data` |
| `MAX_PAGES` | `25` |
| `MAX_SCAN_MS` | `180000` |
| `SCAN_CONCURRENCY` | `1` (about 1 GB RAM per browser) |
| `SCANS_PER_HOUR` | `3` |
| `MAX_QUEUE` | `20` |
| `AUDIT_URL` | `https://qacops.com/#audit` |

## Deploying (outline)

1. DNS: `A` record `scan` pointing at the server.
2. On the server: `npm ci && npx playwright install --with-deps chromium && npm run build`.
3. Keep it running with pm2 or systemd: `node server/index.js` (it listens on 127.0.0.1 only).
4. Caddy: `scan.qacops.com { reverse_proxy 127.0.0.1:3001 }`.
