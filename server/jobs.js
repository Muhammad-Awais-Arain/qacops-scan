import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { runScan } from "./scanner.js";

const jobs = new Map();
const waiting = [];
let running = 0;

export const ID_PATTERN = /^[A-Za-z0-9_-]{16}$/;
export const reportDir = (id) => path.join(config.dataDir, "reports", id);

export function queueLength() {
  return waiting.length;
}

export function getJob(id) {
  return jobs.get(id);
}

export function createJob(target) {
  const id = crypto.randomBytes(12).toString("base64url");
  const job = {
    id,
    target,
    status: "queued",
    events: [],
    listeners: new Set(),
    error: null,
  };
  job.emit = (kind, text, extra = {}) => {
    const event = { kind, text, ...extra, at: Date.now() };
    job.events.push(event);
    if (job.events.length > 400) job.events.splice(1, job.events.length - 400);
    for (const fn of job.listeners) fn(event);
  };
  jobs.set(id, job);
  waiting.push(job);
  announcePositions();
  pump();
  return job;
}

function announcePositions() {
  waiting.forEach((job, i) => {
    job.emit("queue", i === 0 ? "you're next in line" : `${i} scan${i > 1 ? "s" : ""} ahead of you`, { position: i });
  });
}

function pump() {
  while (running < config.concurrency && waiting.length) {
    const job = waiting.shift();
    running += 1;
    announcePositions();
    run(job).finally(() => {
      running -= 1;
      // Keep finished jobs around briefly so late subscribers can replay the log.
      setTimeout(() => jobs.delete(job.id), 10 * 60 * 1000).unref();
      pump();
    });
  }
}

async function run(job) {
  job.status = "running";
  job.emit("status", "running");
  const dir = reportDir(job.id);
  await fs.mkdir(dir, { recursive: true });
  try {
    const report = await runScan({ target: job.target, emit: job.emit, shotsDir: dir });
    report.id = job.id;
    await fs.writeFile(path.join(dir, "report.json"), JSON.stringify(report));
    job.status = "done";
    job.emit("done", "complete", { id: job.id });
  } catch (err) {
    console.error(`[scan ${job.id}]`, err);
    job.status = "failed";
    job.error = err.message || "The scan stopped unexpectedly.";
    job.emit("failed", job.error);
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
