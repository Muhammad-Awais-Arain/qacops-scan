import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";

const DAY = 24 * 60 * 60 * 1000;

/**
 * Deletes reports older than REPORT_TTL_DAYS, and any folder a crashed scan
 * left behind without a report.json after a day.
 */
export async function removeExpiredReports(activeIds = new Set()) {
  const root = path.join(config.dataDir, "reports");
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return 0;
  }
  const now = Date.now();
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isDirectory() || activeIds.has(entry.name)) continue;
    const dir = path.join(root, entry.name);
    try {
      const stat = await fs.stat(path.join(dir, "report.json")).catch(() => null);
      const age = now - (stat ?? (await fs.stat(dir))).mtimeMs;
      const limit = stat ? config.reportTtlDays * DAY : DAY;
      if (age > limit) {
        await fs.rm(dir, { recursive: true, force: true });
        removed += 1;
      }
    } catch (err) {
      console.error(`[cleanup] could not check ${entry.name}:`, err.message);
    }
  }
  return removed;
}

export function scheduleCleanup(getActiveIds) {
  const run = () =>
    removeExpiredReports(getActiveIds())
      .then((n) => n && console.log(`[cleanup] removed ${n} expired report${n > 1 ? "s" : ""}`))
      .catch((err) => console.error("[cleanup]", err));
  run();
  setInterval(run, 6 * 60 * 60 * 1000).unref();
}
