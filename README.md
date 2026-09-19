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

Leads (email, URL, scan id) are appended to `data/leads.jsonl`. Audit requests from the qacops.com form are appended to `data/contacts.jsonl`, so nothing is lost even if an email fails.

## Email

The server sends four emails through any SMTP provider (see `.env.example`):

| When | To | What |
|---|---|---|
| A scan finishes | Visitor | Verdict and report link |
| A scan finishes | `OWNER_EMAIL` | Who scanned what, with reply to set to the visitor |
| Audit form sent on qacops.com | `OWNER_EMAIL` | The request, with reply to set to the visitor |
| Audit form sent on qacops.com | Visitor | Confirmation that a person will reply |

Without `SMTP_HOST`, emails are printed to the console, which is handy for local work.

## Report cleanup

Reports and screenshots older than `REPORT_TTL_DAYS` (30) are deleted on startup and every 6 hours. The report page and the email both tell visitors when their link stops working.

## Audit form endpoint

`POST /api/contact` takes `{ name, company, email, link, pain }` from the qacops.com audit form. Only origins listed in `CONTACT_ORIGINS` get CORS access, there's a hidden honeypot field, and it's limited to 5 requests per IP per hour.

## Safety

- Every browser request goes through Node first, and every redirect hop is checked, so a public URL can't bounce the scanner into `localhost`, `10.x`, `169.254.169.254` and similar.
- Read only: no form submits, no logins, downloads and media blocked, service workers blocked.
- Limits: 3 scans per IP per hour, 25 pages, 3 minutes, queue of 20, one browser at a time.
- Visitors must tick a consent box and give an email.

## Settings (environment variables)

| Variable | Default |
|---|---|
| `PORT` | `3001` |
| `HOST` | `127.0.0.1` (Docker sets `0.0.0.0`) |
| `DATA_DIR` | `./data` |
| `MAX_PAGES` | `25` |
| `MAX_SCAN_MS` | `180000` |
| `SCAN_CONCURRENCY` | `1` (about 1 GB RAM per browser) |
| `SCANS_PER_HOUR` | `3` |
| `MAX_QUEUE` | `20` |
| `AUDIT_URL` | `https://qacops.com/#audit` |
| `REPORT_TTL_DAYS` | `30` |
| `PUBLIC_URL` | `http://127.0.0.1:3001` (set to `https://scan.qacops.com` in production) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | empty (emails printed to console) |
| `MAIL_FROM` | `QACops <scan@qacops.com>` |
| `OWNER_EMAIL` | `contact@qacops.com` |
| `CONTACT_ORIGINS` | `https://qacops.com,https://www.qacops.com` |

## Deploying with Docker

The image is built on Microsoft's Playwright image, so Chromium and its Linux libraries are already inside. Nothing needs installing on the host but Docker.

```bash
cp .env.example .env     # set PUBLIC_URL, OWNER_EMAIL, SMTP_* and CONTACT_ORIGINS
docker compose up -d --build
```

The container listens on `0.0.0.0:3001` inside and is published on host port **4005**. Reports and leads live in `./data`, mounted as a volume, so a rebuild never loses them.

Then point `scan.qacops.com` at `127.0.0.1:4005` in whatever fronts the other sites (Caddy, nginx or a Cloudflare Tunnel).

Useful commands:

```bash
docker compose logs -f          # includes [mail preview] lines while SMTP is unset
docker compose up -d --build    # redeploy after a git pull
docker compose down             # stop
```

## Deploying without Docker

1. DNS: `A` record `scan` pointing at the server.
2. On the server: `npm ci && npx playwright install --with-deps chromium && npm run build`.
3. Keep it running with pm2 or systemd: `node --env-file=.env server/index.js` (it listens on 127.0.0.1 unless `HOST` says otherwise).
4. Caddy: `scan.qacops.com { reverse_proxy 127.0.0.1:3001 }`.
