import { fileURLToPath } from "node:url";

const num = (name, fallback) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

export const config = {
  port: num("PORT", 3001),
  dataDir: process.env.DATA_DIR || fileURLToPath(new URL("../data", import.meta.url)),
  distDir: fileURLToPath(new URL("../dist", import.meta.url)),

  // Scan budget
  maxPages: num("MAX_PAGES", 25),
  maxScanMs: num("MAX_SCAN_MS", 3 * 60 * 1000),
  pageTimeoutMs: num("PAGE_TIMEOUT_MS", 25_000),
  a11yPages: num("A11Y_PAGES", 8),
  mobilePages: num("MOBILE_PAGES", 6),
  maxLinkChecks: num("MAX_LINK_CHECKS", 80),

  // Capacity and abuse limits
  concurrency: num("SCAN_CONCURRENCY", 1),
  maxQueue: num("MAX_QUEUE", 20),
  scansPerHourPerIp: num("SCANS_PER_HOUR", 3),

  // Only for local development: lets you scan localhost. Never set this in production.
  allowPrivate: process.env.ALLOW_PRIVATE_TARGETS === "1",

  userAgent: "Mozilla/5.0 (compatible; QACopsScan/1.0; +https://qacops.com/scan)",
  auditUrl: process.env.AUDIT_URL || "https://qacops.com/#audit",
};
