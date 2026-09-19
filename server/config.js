import { fileURLToPath } from "node:url";

const num = (name, fallback) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

export const config = {
  port: num("PORT", 3001),
  // Inside Docker this must be 0.0.0.0 so the published port can reach it.
  host: process.env.HOST || "127.0.0.1",
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

  // Reports and their screenshots are deleted after this many days.
  reportTtlDays: num("REPORT_TTL_DAYS", 30),

  // Public address of this app, used to build report links in emails.
  publicUrl: (process.env.PUBLIC_URL || "http://127.0.0.1:3001").replace(/\/$/, ""),

  // Email. Any SMTP provider works (Brevo, Resend, Gmail app password, ...).
  // Without SMTP_HOST, emails are printed to the console instead of sent.
  smtp: {
    host: process.env.SMTP_HOST || "",
    port: num("SMTP_PORT", 587),
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
  },
  mailFrom: process.env.MAIL_FROM || "QACops <scan@qacops.com>",
  ownerEmail: process.env.OWNER_EMAIL || "contact@qacops.com",

  // Sites allowed to post the audit request form to /api/contact.
  contactOrigins: (process.env.CONTACT_ORIGINS || "https://qacops.com,https://www.qacops.com")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  contactsPerHourPerIp: num("CONTACTS_PER_HOUR", 5),
};
