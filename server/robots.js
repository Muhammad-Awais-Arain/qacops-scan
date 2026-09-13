import { safeFetch } from "./safety.js";

/** Minimal robots.txt reader: honours the `*` and `QACopsScan` groups, longest match wins. */
export async function loadRobots(origin) {
  const rules = { allow: [], disallow: [], found: false };
  try {
    const { res } = await safeFetch(new URL("/robots.txt", origin), { timeoutMs: 6000 });
    if (!res.ok) return makeChecker(rules);
    const text = (await res.text()).slice(0, 200_000);
    rules.found = true;
    let applies = false;
    let lastWasAgent = false;
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.replace(/#.*$/, "").trim();
      if (!line) continue;
      const idx = line.indexOf(":");
      if (idx === -1) continue;
      const key = line.slice(0, idx).trim().toLowerCase();
      const value = line.slice(idx + 1).trim();
      if (key === "user-agent") {
        const ua = value.toLowerCase();
        const match = ua === "*" || ua.includes("qacopsscan");
        applies = lastWasAgent ? applies || match : match;
        lastWasAgent = true;
        continue;
      }
      lastWasAgent = false;
      if (!applies || !value) continue;
      if (key === "disallow") rules.disallow.push(value);
      if (key === "allow") rules.allow.push(value);
    }
  } catch {
    // No robots.txt reachable: treat everything as allowed.
  }
  return makeChecker(rules);
}

function toRegex(pattern) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped.endsWith("\\$") ? escaped.slice(0, -2) + "$" : escaped}`);
}

function makeChecker(rules) {
  const allow = rules.allow.map((p) => [p.length, toRegex(p)]);
  const disallow = rules.disallow.map((p) => [p.length, toRegex(p)]);
  return {
    found: rules.found,
    disallowCount: rules.disallow.length,
    isAllowed(url) {
      const u = new URL(url);
      const path = u.pathname + u.search;
      const best = (list) => list.reduce((m, [len, re]) => (re.test(path) && len > m ? len : m), -1);
      return best(allow) >= best(disallow);
    },
  };
}
