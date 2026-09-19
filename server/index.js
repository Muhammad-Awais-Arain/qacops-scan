import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import express from "express";
import { scheduleCleanup } from "./cleanup.js";
import { config } from "./config.js";
import { activeJobIds, createJob, getJob, ID_PATTERN, queueLength, reportDir } from "./jobs.js";
import { mailStatus, sendContact } from "./mailer.js";
import { UnsafeTargetError, validateTarget } from "./safety.js";

const app = express();
app.disable("x-powered-by");
// Caddy or nginx on the same machine sets X-Forwarded-For.
app.set("trust proxy", "loopback");
app.use(express.json({ limit: "10kb" }));

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function makeLimiter(perHour) {
  const hits = new Map();
  setInterval(() => hits.clear(), 6 * 60 * 60 * 1000).unref();
  return (ip) => {
    const hourAgo = Date.now() - 60 * 60 * 1000;
    const recent = (hits.get(ip) || []).filter((t) => t > hourAgo);
    if (recent.length >= perHour) return true;
    recent.push(Date.now());
    hits.set(ip, recent);
    return false;
  };
}
const rateLimited = makeLimiter(config.scansPerHourPerIp);
const contactLimited = makeLimiter(config.contactsPerHourPerIp);

// The audit form on qacops.com posts here, so it needs CORS for that origin only.
app.use("/api/contact", (req, res, next) => {
  const origin = req.get("origin");
  if (origin && config.contactOrigins.includes(origin)) {
    res.set({ "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "Content-Type", Vary: "Origin" });
  }
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

app.post("/api/contact", async (req, res) => {
  const { name, company, email, link, pain, website } = req.body || {};
  // `website` is a hidden field real visitors never fill in; bots usually do.
  if (website) return res.status(200).json({ ok: true });
  const clean = (v, max) => String(v ?? "").trim().slice(0, max);
  const form = { name: clean(name, 80), company: clean(company, 80), email: clean(email, 120), link: clean(link, 300), pain: clean(pain, 3000) };
  if (!form.name || !form.company) return res.status(400).json({ error: "Add your name and company so we know who we're talking to." });
  if (!EMAIL.test(form.email)) return res.status(400).json({ error: "Add a work email so we can reply." });
  if (contactLimited(req.ip)) return res.status(429).json({ error: `Too many requests from this network. Email us directly at ${config.ownerEmail}.` });

  await fsp.mkdir(config.dataDir, { recursive: true });
  await fsp.appendFile(path.join(config.dataDir, "contacts.jsonl"), JSON.stringify({ at: new Date().toISOString(), ip: req.ip, ...form }) + "\n");
  const delivered = await sendContact(form);
  // The request is saved either way, so the visitor still gets a success message.
  if (!delivered) console.error("[contact] saved to contacts.jsonl but the email to the owner failed");
  res.json({ ok: true });
});

app.post("/api/scans", async (req, res) => {
  const { url, email, consent } = req.body || {};
  if (!EMAIL.test(String(email || ""))) return res.status(400).json({ error: "Enter a work email so we can send you the report link." });
  if (consent !== true) return res.status(400).json({ error: "Confirm you're allowed to scan this site." });
  if (queueLength() >= config.maxQueue) return res.status(503).json({ error: "The scanner is busy right now. Try again in a few minutes." });

  let target;
  try {
    target = await validateTarget(url);
  } catch (err) {
    const message = err instanceof UnsafeTargetError ? err.message : "That address can't be scanned.";
    return res.status(400).json({ error: message });
  }
  if (rateLimited(req.ip)) {
    return res.status(429).json({ error: `You've run ${config.scansPerHourPerIp} scans in the last hour. Try again later, or ask us for a full audit.` });
  }

  const job = createJob(target, { email: String(email).trim() });
  await fsp.mkdir(config.dataDir, { recursive: true });
  await fsp.appendFile(
    path.join(config.dataDir, "leads.jsonl"),
    JSON.stringify({ at: new Date().toISOString(), email: String(email).trim(), url: target.toString(), scanId: job.id, ip: req.ip }) + "\n"
  );
  res.status(202).json({ id: job.id });
});

app.get("/api/scans/:id/events", (req, res) => {
  const { id } = req.params;
  if (!ID_PATTERN.test(id)) return res.status(404).end();
  const job = getJob(id);
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  res.flushHeaders();
  const send = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);

  if (!job) {
    const exists = fs.existsSync(path.join(reportDir(id), "report.json"));
    send(exists ? { kind: "done", id } : { kind: "failed", text: "We couldn't find that scan. It may have expired." });
    return res.end();
  }
  job.events.forEach(send);
  if (job.status === "done" || job.status === "failed") return res.end();

  const listener = (event) => {
    send(event);
    if (event.kind === "done" || event.kind === "failed") res.end();
  };
  job.listeners.add(listener);
  const ping = setInterval(() => res.write(": ping\n\n"), 20_000);
  req.on("close", () => {
    clearInterval(ping);
    job.listeners.delete(listener);
  });
});

app.get("/api/reports/:id", async (req, res) => {
  const { id } = req.params;
  if (!ID_PATTERN.test(id)) return res.status(404).json({ error: "Report not found" });
  try {
    const raw = await fsp.readFile(path.join(reportDir(id), "report.json"), "utf8");
    res.type("json").send(raw);
  } catch {
    res.status(404).json({ error: "Report not found" });
  }
});

app.get("/api/reports/:id/shots/:name", (req, res) => {
  const { id, name } = req.params;
  if (!ID_PATTERN.test(id) || !/^[a-z0-9-]+\.jpg$/.test(name)) return res.status(404).end();
  res.sendFile(path.join(reportDir(id), name), { maxAge: "7d" }, (err) => err && res.status(404).end());
});

// Search engines: the home page is fair game, scan and report pages are not
// (they hold other people's site data), so say so in the header as well as in
// the page itself, which is what crawlers that don't run JavaScript will see.
app.use(["/r", "/scan"], (_req, res, next) => {
  res.set("X-Robots-Tag", "noindex, nofollow");
  next();
});

app.get("/robots.txt", (_req, res) => {
  res.type("text/plain").send(`User-agent: *
Allow: /$
Disallow: /r/
Disallow: /scan/
Disallow: /api/

Sitemap: ${config.publicUrl}/sitemap.xml
`);
});

app.get("/sitemap.xml", (_req, res) => {
  res.type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${config.publicUrl}/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>
</urlset>
`);
});

app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));

if (fs.existsSync(config.distDir)) {
  app.use(express.static(config.distDir, { maxAge: "1h", index: false }));
  // A real page, or a send back to the home page. Nothing lands on a dead URL.
  app.get("*", (req, res) => {
    if (/^\/(scan|r)\/[A-Za-z0-9_-]{16}$/.test(req.path)) {
      return res.sendFile(path.join(config.distDir, "index.html"));
    }
    if (req.path === "/") return res.sendFile(path.join(config.distDir, "index.html"));
    // A missing build asset stays a 404: redirecting those would hide a broken deploy.
    if (req.path.startsWith("/assets/")) return res.status(404).type("text/plain").send("Not found");
    res.redirect(302, "/");
  });
}

app.listen(config.port, config.host, () => {
  console.log(`QACops Scan listening on http://${config.host}:${config.port}`);
  console.log(`Email: ${mailStatus()}`);
  console.log(`Reports are kept for ${config.reportTtlDays} days`);
  scheduleCleanup(activeJobIds);
  if (config.allowPrivate) console.warn("ALLOW_PRIVATE_TARGETS is on. Never run this way in production.");
});
