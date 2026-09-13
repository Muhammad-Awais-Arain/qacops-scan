import path from "node:path";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { config } from "./config.js";
import { loadRobots } from "./robots.js";
import { assertPublicHost, safeFetch, UnsafeTargetError } from "./safety.js";

const NOT_A_PAGE = /\.(pdf|jpe?g|png|gif|svg|webp|avif|ico|zip|gz|rar|mp4|webm|mov|mp3|wav|docx?|xlsx?|pptx?|dmg|exe|apk|ics|xml|json|txt|csv|rss)$/i;
const clip = (s, n = 240) => (s.length > n ? `${s.slice(0, n)}…` : s);
const pathOf = (u) => {
  const x = new URL(u);
  return x.pathname + x.search || "/";
};

function normalise(href, base) {
  try {
    const u = new URL(href, base);
    if (!["http:", "https:"].includes(u.protocol)) return null;
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

const bareHost = (h) => h.replace(/^www\./, "");

/**
 * Every browser request goes through Node so each redirect hop is re-checked
 * against private address ranges. The browser's own redirect handling would
 * otherwise skip the route handler after the first hop.
 */
async function guardContext(context, stats) {
  await context.route("**/*", async (route) => {
    const req = route.request();
    try {
      const u = new URL(req.url());
      if (!["http:", "https:"].includes(u.protocol)) return route.continue();
      if (req.resourceType() === "media") return route.abort("blockedbyclient");
      await assertPublicHost(u.hostname);
      const response = await route.fetch({ maxRedirects: 0, timeout: 20_000 });
      const body = await response.body().catch(() => Buffer.alloc(0));
      stats.requests += 1;
      stats.bytes += body.length;
      stats.resources.push({ url: req.url(), bytes: body.length, type: req.resourceType() });
      await route.fulfill({ response, body });
    } catch (err) {
      await route.abort(err instanceof UnsafeTargetError ? "blockedbyclient" : "failed").catch(() => {});
    }
  });
}

function describeElement() {
  // Runs in the page: returns outermost elements wider than the viewport.
  const vw = document.documentElement.clientWidth;
  const label = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += `#${el.id}`;
    const cls = [...el.classList].slice(0, 2);
    if (cls.length) s += `.${cls.join(".")}`;
    return s;
  };
  const out = [];
  for (const el of document.querySelectorAll("body *")) {
    const r = el.getBoundingClientRect();
    if (!r.width || r.right <= vw + 2) continue;
    const style = getComputedStyle(el);
    if (style.position === "fixed" || style.visibility === "hidden") continue;
    const parent = el.parentElement;
    if (parent && parent !== document.body && parent.getBoundingClientRect().right > vw + 2) continue;
    let clipped = false;
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const o = getComputedStyle(a).overflowX;
      if (o === "hidden" || o === "auto" || o === "scroll" || o === "clip") { clipped = true; break; }
    }
    if (clipped) continue;
    el.setAttribute("data-qacops-overflow", "");
    out.push({ element: label(el), overBy: Math.round(r.right - vw), text: (el.innerText || "").trim().slice(0, 60) });
    if (out.length >= 5) break;
  }
  return { viewport: vw, pageWidth: document.documentElement.scrollWidth, offenders: out };
}

export async function runScan({ target, emit, shotsDir }) {
  const started = Date.now();
  const deadline = started + config.maxScanMs;
  const timeLeft = () => deadline - Date.now();

  emit("meta", `resolving ${target.hostname}`);
  let landed;
  try {
    const { res, finalUrl } = await safeFetch(target, { timeoutMs: 15_000 });
    res.body?.cancel().catch(() => {});
    landed = new URL(finalUrl);
  } catch (err) {
    if (err instanceof UnsafeTargetError) throw err;
    throw new Error(`We couldn't reach ${target.hostname}. Check the site is online and try again.`);
  }
  if (landed.toString() !== target.toString()) emit("meta", `redirected to ${landed.toString()}`);

  const robots = await loadRobots(landed.origin);
  emit(
    "pass",
    robots.found ? `robots.txt read, ${robots.disallowCount} paths off limits` : "no robots.txt, scanning public pages only"
  );

  const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
  const stats = { requests: 0, bytes: 0, resources: [] };
  const pages = [];
  const linkRefs = new Map(); // url -> Set of pages it appears on
  const a11y = new Map();
  let robotsSkipped = 0;
  let firstHeaders = null;
  let hasViewportMeta = true;
  const screenshots = {};

  try {
    const desktop = await browser.newContext({
      userAgent: config.userAgent,
      viewport: { width: 1366, height: 850 },
      acceptDownloads: false,
      serviceWorkers: "block",
    });
    await guardContext(desktop, stats);
    const page = await desktop.newPage();

    const queue = [landed.toString()];
    const seen = new Set(queue);

    while (queue.length && pages.length < config.maxPages && timeLeft() > 25_000) {
      const url = queue.shift();
      if (!robots.isAllowed(url)) {
        robotsSkipped += 1;
        continue;
      }

      stats.requests = 0;
      stats.bytes = 0;
      stats.resources = [];
      const consoleErrors = new Set();
      const uncaught = new Set();
      const failedRequests = [];
      const badResponses = [];

      const onConsole = (m) => {
        if (m.type() === "error" && !/ERR_BLOCKED_BY_CLIENT|Failed to load resource/i.test(m.text())) consoleErrors.add(clip(m.text()));
      };
      const onPageError = (e) => uncaught.add(clip(e.message));
      const onFailed = (r) => {
        const err = r.failure()?.errorText || "";
        if (/ERR_ABORTED|BLOCKED_BY_CLIENT/i.test(err) || r.url() === url) return;
        failedRequests.push({ url: r.url(), type: r.resourceType(), error: err });
      };
      const onResponse = (r) => {
        if (r.status() >= 400 && r.url() !== url && r.request().resourceType() !== "document") {
          badResponses.push({ url: r.url(), type: r.request().resourceType(), status: r.status() });
        }
      };
      page.on("console", onConsole);
      page.on("pageerror", onPageError);
      page.on("requestfailed", onFailed);
      page.on("response", onResponse);

      const t0 = Date.now();
      let status = 0;
      let navError = null;
      let finalUrl = url;
      try {
        const resp = await page.goto(url, { waitUntil: "load", timeout: config.pageTimeoutMs });
        status = resp?.status() ?? 0;
        finalUrl = page.url();
        if (!firstHeaders && resp) firstHeaders = await resp.allHeaders();
        // Give late scripts a moment to throw, which is where most real console errors come from.
        await page.waitForTimeout(1200);
      } catch (err) {
        navError = /Timeout/i.test(err.message) ? "Page took too long to load" : clip(err.message.split("\n")[0], 120);
      }
      const wall = Date.now() - t0;

      let timing = null;
      if (!navError) {
        timing = await page
          .evaluate(() => {
            const n = performance.getEntriesByType("navigation")[0];
            return n ? { ttfb: Math.round(n.responseStart), dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd) } : null;
          })
          .catch(() => null);

        if (pages.length === 0) {
          hasViewportMeta = await page.$('meta[name="viewport"]').then(Boolean).catch(() => true);
          const file = "desktop-home.jpg";
          await page.screenshot({ path: path.join(shotsDir, file), type: "jpeg", quality: 62 }).catch(() => {});
          screenshots.desktop = file;
        }

        const hrefs = await page.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href"))).catch(() => []);
        for (const href of hrefs) {
          const abs = normalise(href, finalUrl);
          if (!abs) continue;
          if (!linkRefs.has(abs)) linkRefs.set(abs, new Set());
          linkRefs.get(abs).add(pathOf(finalUrl));
          const u = new URL(abs);
          if (bareHost(u.hostname) === bareHost(landed.hostname) && !NOT_A_PAGE.test(u.pathname) && !seen.has(abs)) {
            seen.add(abs);
            queue.push(abs);
          }
        }

        if (pages.length < config.a11yPages && status < 400) {
          try {
            const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
            for (const v of result.violations) {
              const entry = a11y.get(v.id) || { id: v.id, impact: v.impact, help: v.help, helpUrl: v.helpUrl, nodes: 0, pages: new Set(), samples: [] };
              entry.nodes += v.nodes.length;
              entry.pages.add(pathOf(finalUrl));
              for (const n of v.nodes) {
                if (entry.samples.length < 3) entry.samples.push({ target: String(n.target?.[0] ?? ""), html: clip(n.html, 160) });
              }
              a11y.set(v.id, entry);
            }
          } catch {
            // Some pages block injected scripts with a strict CSP; skip them quietly.
          }
        }
      }

      page.off("console", onConsole);
      page.off("pageerror", onPageError);
      page.off("requestfailed", onFailed);
      page.off("response", onResponse);

      const heaviest = [...stats.resources].sort((a, b) => b.bytes - a.bytes).slice(0, 5);
      const record = {
        url: finalUrl,
        path: pathOf(finalUrl),
        status,
        error: navError,
        loadMs: timing?.load || wall,
        ttfbMs: timing?.ttfb ?? null,
        requests: stats.requests,
        bytes: stats.bytes,
        heaviest,
        consoleErrors: [...consoleErrors],
        uncaught: [...uncaught],
        failedRequests: failedRequests.slice(0, 20),
        badResponses: badResponses.slice(0, 20),
        mixedContent: finalUrl.startsWith("https:") ? stats.resources.filter((r) => r.url.startsWith("http:")).length : 0,
      };
      pages.push(record);

      const secs = record.loadMs < 1000 ? `${record.loadMs}ms` : `${(record.loadMs / 1000).toFixed(1)}s`;
      const problems = record.consoleErrors.length + record.uncaught.length;
      if (navError || status >= 400) {
        emit("fail", `${record.path}`, { time: navError ? "" : String(status), note: navError || `returned ${status}` });
      } else if (problems || record.failedRequests.length || record.badResponses.length) {
        const bits = [];
        if (problems) bits.push(`${problems} console error${problems > 1 ? "s" : ""}`);
        const net = record.failedRequests.length + record.badResponses.length;
        if (net) bits.push(`${net} failed request${net > 1 ? "s" : ""}`);
        emit("flaky", record.path, { time: secs, note: bits.join(", ") });
      } else {
        emit("pass", record.path, { time: secs });
      }
      emit("progress", "", { done: pages.length, total: Math.min(config.maxPages, pages.length + queue.length) });
    }
    const hitPageCap = pages.length >= config.maxPages && queue.length > 0;
    const hitTimeCap = queue.length > 0 && !hitPageCap;
    await desktop.close();

    // Mobile layout
    const okPages = pages.filter((p) => !p.error && p.status < 400);
    const mobileResults = [];
    if (timeLeft() > 20_000 && okPages.length) {
      emit("meta", `checking layout at phone size on ${Math.min(okPages.length, config.mobilePages)} pages`);
      const mobile = await browser.newContext({
        userAgent: config.userAgent,
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
        acceptDownloads: false,
        serviceWorkers: "block",
      });
      await guardContext(mobile, { requests: 0, bytes: 0, resources: [] });
      const mpage = await mobile.newPage();
      let shots = 0;
      for (const p of okPages.slice(0, config.mobilePages)) {
        if (timeLeft() < 12_000) break;
        try {
          await mpage.goto(p.url, { waitUntil: "load", timeout: config.pageTimeoutMs });
          await mpage.waitForTimeout(600); // let web fonts and late layout settle before measuring widths
          const result = await mpage.evaluate(describeElement);
          const entry = { path: p.path, ...result };
          const isHome = mobileResults.length === 0;
          if (result.offenders.length && shots < 3) {
            await mpage.addStyleTag({ content: "[data-qacops-overflow]{outline:3px solid #ff5b4f!important;outline-offset:-3px}" });
            entry.screenshot = `mobile-overflow-${shots + 1}.jpg`;
            await mpage.screenshot({ path: path.join(shotsDir, entry.screenshot), type: "jpeg", quality: 60 });
            shots += 1;
          }
          if (isHome) {
            screenshots.mobile = "mobile-home.jpg";
            await mpage.screenshot({ path: path.join(shotsDir, screenshots.mobile), type: "jpeg", quality: 60 });
          }
          mobileResults.push(entry);
        } catch {
          // A page that fails on mobile was already reported by the desktop pass.
        }
      }
      await mobile.close();
      const overflowing = mobileResults.filter((m) => m.offenders.length).length;
      emit(overflowing ? "flaky" : "pass", overflowing ? `${overflowing} pages wider than a phone screen` : "every page fits a phone screen");
    }

    // Links
    const crawled = new Set(pages.map((p) => p.url));
    const candidates = [...linkRefs.keys()].filter((u) => !crawled.has(u));
    const internal = candidates.filter((u) => bareHost(new URL(u).hostname) === bareHost(landed.hostname));
    const external = candidates.filter((u) => bareHost(new URL(u).hostname) !== bareHost(landed.hostname));
    const toCheck = [...internal, ...external].slice(0, config.maxLinkChecks);
    const brokenLinks = [];
    let unverified = 0;
    for (const p of pages) {
      if (p.status >= 400) brokenLinks.push({ url: p.url, status: p.status, internal: true, foundOn: [...(linkRefs.get(p.url) || [])].slice(0, 3) });
    }
    if (toCheck.length && timeLeft() > 10_000) {
      emit("meta", `checking ${toCheck.length} more links`);
      let i = 0;
      const worker = async () => {
        while (i < toCheck.length && timeLeft() > 6000) {
          const url = toCheck[i++];
          const result = await checkLink(url);
          if (result.broken) {
            brokenLinks.push({
              url,
              status: result.status,
              reason: result.reason,
              internal: internal.includes(url),
              foundOn: [...linkRefs.get(url)].slice(0, 3),
            });
          } else if (result.unverified) unverified += 1;
        }
      };
      await Promise.all(Array.from({ length: 6 }, worker));
      emit(brokenLinks.length ? "fail" : "pass", brokenLinks.length ? `${brokenLinks.length} broken links` : "no broken links found");
    }

    const report = buildReport({
      target, landed, started, pages, a11y, mobileResults, hasViewportMeta, firstHeaders,
      brokenLinks, unverified, linksChecked: toCheck.length + pages.length,
      robots, robotsSkipped, hitPageCap, hitTimeCap, screenshots,
    });
    emit("summary", `${pages.length} pages, ${report.totals.fail} failing checks, ${report.totals.warn} warnings in ${Math.round(report.durationMs / 1000)}s`);
    return report;
  } finally {
    await browser.close().catch(() => {});
  }
}

async function checkLink(url) {
  const attempt = async (method) => {
    const { res } = await safeFetch(url, { method, timeoutMs: 8000 });
    res.body?.cancel().catch(() => {});
    return res.status;
  };
  try {
    let status = await attempt("HEAD");
    if ([400, 403, 405, 501].includes(status)) status = await attempt("GET");
    if (status === 404 || status === 410) return { broken: true, status, reason: "Page not found" };
    if (status >= 500) return { broken: true, status, reason: "Server error" };
    if ([401, 403, 429, 999].includes(status)) return { unverified: true };
    return { ok: true, status };
  } catch (err) {
    if (err instanceof UnsafeTargetError) {
      if (/couldn't find/.test(err.message)) return { broken: true, status: 0, reason: "Domain doesn't exist" };
      return { unverified: true };
    }
    if (err?.cause?.code === "ENOTFOUND") return { broken: true, status: 0, reason: "Domain doesn't exist" };
    return { unverified: true };
  }
}

const SECURITY_HEADERS = [
  { key: "strict-transport-security", name: "Strict Transport Security", why: "Forces browsers to always use HTTPS, so visitors can't be downgraded to an insecure connection." },
  { key: "content-security-policy", name: "Content Security Policy", why: "Limits where scripts can load from. It's the main defence against injected scripts." },
  { key: "x-content-type-options", name: "X Content Type Options", why: "Stops browsers guessing file types, which closes a class of script injection." },
  { key: "x-frame-options", name: "Clickjacking protection", why: "Stops other sites embedding yours in a hidden frame to trick clicks.", alt: (h) => /frame-ancestors/i.test(h["content-security-policy"] || "") },
  { key: "referrer-policy", name: "Referrer Policy", why: "Controls how much of your URLs leak to other sites when visitors click away." },
  { key: "permissions-policy", name: "Permissions Policy", why: "Switches off browser features you don't use, like camera or location." },
];

function median(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function buildReport(d) {
  const { pages } = d;
  const okPages = pages.filter((p) => !p.error && p.status < 400);

  // Links
  const internalBroken = d.brokenLinks.filter((l) => l.internal);
  const links = {
    status: internalBroken.length ? "fail" : d.brokenLinks.length ? "warn" : "pass",
    headline: d.brokenLinks.length ? `${d.brokenLinks.length} broken link${d.brokenLinks.length > 1 ? "s" : ""}` : "No broken links",
    checked: d.linksChecked,
    unverified: d.unverified,
    items: d.brokenLinks.slice(0, 40),
  };

  // Console
  const consolePages = pages.filter((p) => p.consoleErrors.length || p.uncaught.length);
  const uncaughtCount = pages.reduce((n, p) => n + p.uncaught.length, 0);
  const consoleCheck = {
    status: uncaughtCount || consolePages.length >= 3 ? "fail" : consolePages.length ? "warn" : "pass",
    headline: consolePages.length ? `Errors on ${consolePages.length} page${consolePages.length > 1 ? "s" : ""}` : "No JavaScript errors",
    items: consolePages.map((p) => ({ path: p.path, uncaught: p.uncaught, errors: p.consoleErrors.slice(0, 6) })),
  };

  // Network
  const netItems = pages
    .filter((p) => p.failedRequests.length || p.badResponses.length)
    .map((p) => ({ path: p.path, requests: [...p.badResponses, ...p.failedRequests.map((f) => ({ ...f, status: 0 }))].slice(0, 10) }));
  const netTotal = netItems.reduce((n, p) => n + p.requests.length, 0);
  const anyServerError = netItems.some((p) => p.requests.some((r) => r.status >= 500));
  const network = {
    status: anyServerError || netTotal >= 5 ? "fail" : netTotal ? "warn" : "pass",
    headline: netTotal ? `${netTotal} failed request${netTotal > 1 ? "s" : ""}` : "Every request succeeded",
    items: netItems,
  };

  // Mobile
  const overflow = d.mobileResults.filter((m) => m.offenders.length);
  const mobile = {
    status: overflow.length || !d.hasViewportMeta ? "fail" : d.mobileResults.length ? "pass" : "warn",
    headline: !d.hasViewportMeta
      ? "No mobile viewport set"
      : overflow.length
        ? `${overflow.length} page${overflow.length > 1 ? "s break" : " breaks"} on phones`
        : d.mobileResults.length ? "Fits phone screens" : "Not checked",
    hasViewportMeta: d.hasViewportMeta,
    checked: d.mobileResults.length,
    items: overflow,
  };

  // Accessibility
  const rules = [...d.a11y.values()]
    .map((r) => ({ ...r, pages: [...r.pages] }))
    .sort((a, b) => impactRank(b.impact) - impactRank(a.impact) || b.nodes - a.nodes);
  const severe = rules.filter((r) => r.impact === "critical" || r.impact === "serious");
  const accessibility = {
    status: severe.length ? "fail" : rules.length ? "warn" : "pass",
    headline: rules.length ? `${rules.reduce((n, r) => n + r.nodes, 0)} issues across ${rules.length} rules` : "No automated issues found",
    pagesChecked: Math.min(okPages.length, config.a11yPages),
    items: rules.slice(0, 20),
  };

  // Performance
  const loads = okPages.map((p) => p.loadMs);
  const slow = okPages.filter((p) => p.loadMs > 3000).sort((a, b) => b.loadMs - a.loadMs);
  const heavy = okPages.filter((p) => p.bytes > 3 * 1024 * 1024);
  const med = median(loads);
  const biggest = okPages
    .flatMap((p) => p.heaviest)
    .filter((r, i, arr) => r.bytes > 250 * 1024 && arr.findIndex((x) => x.url === r.url) === i)
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 8);
  const performance = {
    status: med > 4000 || slow.some((p) => p.loadMs > 6000) ? "fail" : slow.length || heavy.length ? "warn" : "pass",
    headline: `Median load ${med < 1000 ? `${med} ms` : `${(med / 1000).toFixed(1)}s`}`,
    medianMs: med,
    medianBytes: median(okPages.map((p) => p.bytes)),
    slowPages: slow.slice(0, 10).map((p) => ({ path: p.path, loadMs: p.loadMs, bytes: p.bytes, requests: p.requests })),
    biggest,
  };

  // Security
  const h = d.firstHeaders || {};
  const headerChecks = SECURITY_HEADERS.map((s) => ({
    name: s.name,
    present: Boolean(h[s.key]) || Boolean(s.alt?.(h)),
    value: h[s.key] ? clip(h[s.key], 120) : null,
    why: s.why,
  }));
  const https = d.landed.protocol === "https:";
  const mixed = pages.reduce((n, p) => n + p.mixedContent, 0);
  const missing = headerChecks.filter((c) => !c.present).length;
  const security = {
    status: !https || mixed || (!headerChecks[0].present && !headerChecks[1].present) ? "fail" : missing ? "warn" : "pass",
    headline: !https ? "Site isn't served over HTTPS" : missing ? `${missing} of ${headerChecks.length} protections missing` : "All basic protections set",
    https,
    mixedContent: mixed,
    headers: headerChecks,
  };

  const checks = { links, console: consoleCheck, network, mobile, accessibility, performance, security };
  const totals = Object.values(checks).reduce(
    (t, c) => ({ ...t, [c.status]: t[c.status] + 1 }),
    { pass: 0, warn: 0, fail: 0 }
  );

  return {
    version: 1,
    url: d.target.toString(),
    landedUrl: d.landed.toString(),
    host: d.landed.hostname,
    scannedAt: new Date(d.started).toISOString(),
    durationMs: Date.now() - d.started,
    auditUrl: config.auditUrl,
    retentionDays: config.reportTtlDays,
    limits: { maxPages: config.maxPages, hitPageCap: d.hitPageCap, hitTimeCap: d.hitTimeCap },
    robots: { found: d.robots.found, skipped: d.robotsSkipped },
    screenshots: d.screenshots,
    totals,
    checks,
    pages: pages.map(({ heaviest, ...p }) => p),
  };
}

function impactRank(i) {
  return { critical: 4, serious: 3, moderate: 2, minor: 1 }[i] || 0;
}
