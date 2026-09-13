import dns from "node:dns/promises";
import net from "node:net";
import { config } from "./config.js";

export class UnsafeTargetError extends Error {}

function ipv4ToInt(ip) {
  return ip.split(".").reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
}

const V4_BLOCKS = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
].map(([base, bits]) => [ipv4ToInt(base), bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0]);

export function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const n = ipv4ToInt(ip);
    return V4_BLOCKS.some(([base, mask]) => ((n & mask) >>> 0) === base);
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === "::" || v === "::1") return true;
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    if (/^f[cd]/.test(v)) return true; // unique local
    if (/^fe[89ab]/.test(v)) return true; // link local
    if (/^ff/.test(v)) return true; // multicast
    if (v.startsWith("2001:db8")) return true; // documentation
    return false;
  }
  return true;
}

const hostCache = new Map();

/** Throws unless every address the hostname resolves to is public. */
export async function assertPublicHost(hostname) {
  if (config.allowPrivate) return;
  const host = hostname.replace(/^\[|\]$/g, "");
  const cached = hostCache.get(host);
  if (cached && cached.expires > Date.now()) {
    if (!cached.ok) throw new UnsafeTargetError(`${host} points to a private network address`);
    return;
  }
  let ok = true;
  if (net.isIP(host)) {
    ok = !isPrivateIp(host);
  } else {
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
      ok = false;
    } else {
      let addrs;
      try {
        addrs = await dns.lookup(host, { all: true, verbatim: true });
      } catch {
        throw new UnsafeTargetError(`We couldn't find ${host}. Check the address and try again.`);
      }
      ok = addrs.length > 0 && addrs.every((a) => !isPrivateIp(a.address));
    }
  }
  hostCache.set(host, { ok, expires: Date.now() + 60_000 });
  if (hostCache.size > 5000) hostCache.clear();
  if (!ok) throw new UnsafeTargetError(`${host} points to a private network address`);
}

/** Validates a URL a visitor typed. Returns the normalised URL. */
export async function validateTarget(raw) {
  let input = String(raw || "").trim();
  if (!input) throw new UnsafeTargetError("Enter the address of the site you want scanned.");
  if (!/^https?:\/\//i.test(input)) input = `https://${input}`;
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new UnsafeTargetError("That doesn't look like a website address.");
  }
  if (!["http:", "https:"].includes(url.protocol)) throw new UnsafeTargetError("Only http and https sites can be scanned.");
  if (url.username || url.password) throw new UnsafeTargetError("Remove the username and password from the address.");
  if (url.port && !["80", "443"].includes(url.port) && !config.allowPrivate) {
    throw new UnsafeTargetError("Only sites on the standard web ports can be scanned.");
  }
  if (!url.hostname.includes(".") && !config.allowPrivate) throw new UnsafeTargetError("That doesn't look like a public website address.");
  await assertPublicHost(url.hostname);
  url.hash = "";
  return url;
}

/**
 * fetch() that validates every redirect hop, so a public URL can't bounce the
 * scanner into a private address.
 */
export async function safeFetch(rawUrl, { method = "GET", timeoutMs = 8000, maxRedirects = 4 } = {}) {
  let url = new URL(rawUrl);
  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (!["http:", "https:"].includes(url.protocol)) throw new UnsafeTargetError("Unsupported protocol");
    await assertPublicHost(url.hostname);
    const res = await fetch(url, {
      method,
      redirect: "manual",
      headers: { "user-agent": config.userAgent, accept: "text/html,*/*;q=0.8" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      res.body?.cancel().catch(() => {});
      url = new URL(res.headers.get("location"), url);
      continue;
    }
    return { res, finalUrl: url.toString() };
  }
  throw new Error("Too many redirects");
}
