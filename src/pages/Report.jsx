import { useEffect, useState } from "react";
import { Check, Footer, STATUS_LABEL, TopBar, formatBytes, formatMs } from "../ui.jsx";

const CHECK_META = [
  ["links", "Broken links", "Links on your pages that lead nowhere."],
  ["console", "JavaScript errors", "Errors your pages throw while loading. Each one is a feature that may not be working."],
  ["network", "Failed requests", "Files and API calls your pages asked for that came back broken."],
  ["mobile", "Phone layout", "Pages loaded 390 pixels wide, the size of a common phone."],
  ["accessibility", "Accessibility", "Automated WCAG 2.1 AA checks. A machine catches some problems; a person has to find the rest."],
  ["performance", "Speed", "Time until each page finished loading from our server, and the heaviest files."],
  ["security", "Security headers", "Browser protections sent with your homepage."],
];

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

const shortUrl = (u) => {
  try {
    const x = new URL(u);
    return `${x.hostname}${x.pathname === "/" ? "" : x.pathname}${x.search}`;
  } catch {
    return u;
  }
};

function StatusPill({ status }) {
  return <span className={`pill pill-${status}`}>{STATUS_LABEL[status]}</span>;
}

function Section({ id, title, intro, check, children }) {
  return (
    <section className={`r-section s-${check.status}`} id={id}>
      <header className="r-section-head">
        <div>
          <h2>{title}</h2>
          <p>{intro}</p>
        </div>
        <div className="r-section-verdict">
          <StatusPill status={check.status} />
          <strong>{check.headline}</strong>
        </div>
      </header>
      <div className="r-section-body">{children}</div>
    </section>
  );
}

function Clean({ children }) {
  return (
    <p className="clean">
      <Check size={18} />
      {children}
    </p>
  );
}

export default function Report({ id }) {
  const [report, setReport] = useState(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [showPages, setShowPages] = useState(false);

  useEffect(() => {
    fetch(`/api/reports/${id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("We couldn't find this report. The link may be wrong or the report has expired."))))
      .then((data) => {
        setReport(data);
        document.title = `QA report for ${data.host} | QACops Scan`;
      })
      .catch((e) => setError(e.message));
  }, [id]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy this link", window.location.href);
    }
  };

  if (error) {
    return (
      <>
        <TopBar />
        <main className="wrap live">
          <h1 className="display live-title">Report not found</h1>
          <p className="lede">{error}</p>
          <a className="btn btn-amber" href="/">Scan a site</a>
        </main>
      </>
    );
  }

  if (!report) {
    return (
      <>
        <TopBar />
        <main className="wrap live"><p className="lede loading">Loading the report…</p></main>
      </>
    );
  }

  const { checks, totals } = report;
  const shot = (name) => `/api/reports/${id}/shots/${name}`;
  const date = new Date(report.scannedAt).toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" });
  const verdict =
    totals.fail === 0 && totals.warn === 0
      ? "Clean run. Nothing an automated pass can find is wrong."
      : totals.fail === 0
        ? `Nothing failing, but ${totals.warn} ${totals.warn > 1 ? "areas need" : "area needs"} a look.`
        : `${totals.fail} of 7 checks failing${totals.warn ? ` and ${totals.warn} more worth a look` : ""}.`;

  return (
    <>
      <TopBar>
        <button className="btn btn-ghost btn-sm no-print" onClick={copyLink}>{copied ? "Link copied" : "Copy link"}</button>
        <button className="btn btn-ghost btn-sm no-print" onClick={() => window.print()}>Save as PDF</button>
      </TopBar>

      <main className="report">
        <section className="r-hero">
          <div className="wrap">
            <p className="r-for">QA report for</p>
            <h1 className="display r-host">{report.host}</h1>
            <p className="r-meta">
              Scanned {date}. {plural(report.pages.length, "page")} in {Math.round(report.durationMs / 1000)} seconds.
              {report.limits.hitPageCap && ` Stopped at the ${report.limits.maxPages} page limit.`}
              {report.limits.hitTimeCap && " Stopped at the time limit."}
              {report.robots.skipped > 0 && ` ${report.robots.skipped} pages skipped because robots.txt asked.`}
            </p>
            <p className="r-verdict">{verdict}</p>

            <div className="tiles">
              {CHECK_META.map(([key, name]) => (
                <a key={key} href={`#${key}`} className={`tile t-${checks[key].status}`}>
                  <span className="tile-name">{name}</span>
                  <strong>{checks[key].headline}</strong>
                  <StatusPill status={checks[key].status} />
                </a>
              ))}
            </div>
          </div>
        </section>

        {(report.screenshots.desktop || report.screenshots.mobile) && (
          <section className="wrap shots">
            {report.screenshots.desktop && (
              <figure className="shot shot-desktop">
                <div className="frame-bar"><i /><i /><i /><span>{shortUrl(report.landedUrl)}</span></div>
                <img src={shot(report.screenshots.desktop)} alt={`Your homepage at desktop size`} loading="lazy" />
                <figcaption>Desktop, 1366 pixels wide</figcaption>
              </figure>
            )}
            {report.screenshots.mobile && (
              <figure className="shot shot-mobile">
                <div className="phone"><img src={shot(report.screenshots.mobile)} alt="Your homepage at phone size" loading="lazy" /></div>
                <figcaption>Phone, 390 pixels wide</figcaption>
              </figure>
            )}
          </section>
        )}

        <div className="wrap r-sections">
          <Section id="links" title="Broken links" intro={CHECK_META[0][2]} check={checks.links}>
            {checks.links.items.length ? (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Link</th><th>Result</th><th>Found on</th></tr></thead>
                  <tbody>
                    {checks.links.items.map((l) => (
                      <tr key={l.url}>
                        <td className="url">{shortUrl(l.url)}{!l.internal && <span className="tag">external</span>}</td>
                        <td>{l.status ? `${l.status} ${l.reason || ""}` : l.reason}</td>
                        <td className="url">{l.foundOn.join(", ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Clean>Checked {plural(checks.links.checked, "link")}. Every one we could reach worked.</Clean>
            )}
            {checks.links.unverified > 0 && (
              <p className="footnote">{checks.links.unverified} links refused automated visitors, so we couldn't confirm them either way.</p>
            )}
          </Section>

          <Section id="console" title="JavaScript errors" intro={CHECK_META[1][2]} check={checks.console}>
            {checks.console.items.length ? (
              checks.console.items.map((p) => (
                <div className="issue" key={p.path}>
                  <h3 className="mono">{p.path}</h3>
                  <ul className="log">
                    {p.uncaught.map((e, i) => <li key={`u${i}`} className="log-fail"><b>Uncaught</b> {e}</li>)}
                    {p.errors.map((e, i) => <li key={`e${i}`}>{e}</li>)}
                  </ul>
                </div>
              ))
            ) : (
              <Clean>No console errors on {report.pages.length > 1 ? `any of the ${report.pages.length} pages` : "the page we scanned"}.</Clean>
            )}
          </Section>

          <Section id="network" title="Failed requests" intro={CHECK_META[2][2]} check={checks.network}>
            {checks.network.items.length ? (
              checks.network.items.map((p) => (
                <div className="issue" key={p.path}>
                  <h3 className="mono">{p.path}</h3>
                  <ul className="log">
                    {p.requests.map((r, i) => (
                      <li key={i} className={r.status >= 500 ? "log-fail" : ""}>
                        <b>{r.status || r.error}</b> <span className="dim">{r.type}</span> {shortUrl(r.url)}
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            ) : (
              <Clean>Every image, script, font and API call loaded.</Clean>
            )}
          </Section>

          <Section id="mobile" title="Phone layout" intro={CHECK_META[3][2]} check={checks.mobile}>
            {!checks.mobile.hasViewportMeta && (
              <p className="callout">Your homepage has no viewport meta tag, so phones render it as a shrunken desktop page.</p>
            )}
            {checks.mobile.items.length ? (
              <div className="mobile-issues">
                {checks.mobile.items.map((m) => (
                  <div className="mobile-issue" key={m.path}>
                    {m.screenshot && <div className="phone phone-sm"><img src={shot(m.screenshot)} alt={`${m.path} at phone size, overflowing parts outlined`} loading="lazy" /></div>}
                    <div>
                      <h3 className="mono">{m.path}</h3>
                      <p>The page is {m.pageWidth} pixels wide on a {m.viewport} pixel screen, so visitors scroll sideways.</p>
                      <ul className="log">
                        {m.offenders.map((o, i) => (
                          <li key={i}><b>{o.element}</b> sticks out {o.overBy}px{o.text && <span className="dim"> “{o.text}”</span>}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              checks.mobile.hasViewportMeta && <Clean>{checks.mobile.checked > 1 ? `All ${checks.mobile.checked} pages we loaded fit` : "The page we loaded fits"} inside a phone screen.</Clean>
            )}
          </Section>

          <Section id="accessibility" title="Accessibility" intro={CHECK_META[4][2]} check={checks.accessibility}>
            {checks.accessibility.items.length ? (
              <div className="a11y">
                {checks.accessibility.items.map((r) => (
                  <details key={r.id} className="a11y-rule">
                    <summary>
                      <span className={`impact i-${r.impact}`}>{r.impact}</span>
                      <span className="a11y-help">{r.help}</span>
                      <span className="a11y-count">{r.nodes} on {r.pages.length} page{r.pages.length > 1 ? "s" : ""}</span>
                    </summary>
                    <div className="a11y-body">
                      <p>Pages: <span className="mono">{r.pages.join(", ")}</span></p>
                      <ul className="log">
                        {r.samples.map((s, i) => <li key={i}><b>{s.target}</b> <span className="dim">{s.html}</span></li>)}
                      </ul>
                      <a href={r.helpUrl} target="_blank" rel="noreferrer" className="link">How to fix this</a>
                    </div>
                  </details>
                ))}
              </div>
            ) : (
              <Clean>No automated issues on {plural(checks.accessibility.pagesChecked, "page")} checked.</Clean>
            )}
          </Section>

          <Section id="performance" title="Speed" intro={CHECK_META[5][2]} check={checks.performance}>
            <div className="stats">
              <div><strong>{formatMs(checks.performance.medianMs)}</strong><span>median load time</span></div>
              <div><strong>{formatBytes(checks.performance.medianBytes)}</strong><span>median page weight</span></div>
              <div><strong>{checks.performance.slowPages.length}</strong><span>pages over 3 seconds</span></div>
            </div>
            {checks.performance.slowPages.length > 0 && (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Slowest pages</th><th>Load</th><th>Weight</th><th>Requests</th></tr></thead>
                  <tbody>
                    {checks.performance.slowPages.map((p) => (
                      <tr key={p.path}><td className="url">{p.path}</td><td>{formatMs(p.loadMs)}</td><td>{formatBytes(p.bytes)}</td><td>{p.requests}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {checks.performance.biggest.length > 0 && (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Heaviest files</th><th>Type</th><th>Size</th></tr></thead>
                  <tbody>
                    {checks.performance.biggest.map((r) => (
                      <tr key={r.url}><td className="url">{shortUrl(r.url)}</td><td>{r.type}</td><td>{formatBytes(r.bytes)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <Section id="security" title="Security headers" intro={CHECK_META[6][2]} check={checks.security}>
            {!checks.security.https && <p className="callout">Your site loads over plain HTTP. Anything visitors type can be read on the way.</p>}
            {checks.security.mixedContent > 0 && (
              <p className="callout">{checks.security.mixedContent} files load over plain HTTP on secure pages. Browsers block or warn about these.</p>
            )}
            <ul className="headers">
              {checks.security.headers.map((h) => (
                <li key={h.name} className={h.present ? "ok" : "missing"}>
                  <span className="h-mark" aria-hidden="true">{h.present ? "✓" : "✗"}</span>
                  <div>
                    <strong>{h.name}</strong> <span className="dim">{h.present ? "set" : "missing"}</span>
                    <p>{h.why}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Section>

          <section className="r-section pages-list">
            <button className="pages-toggle" aria-expanded={showPages} onClick={() => setShowPages((s) => !s)}>
              <span>Every page we scanned</span>
              <span className="dim">{report.pages.length} pages</span>
            </button>
            {showPages && (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Page</th><th>Status</th><th>Load</th><th>Weight</th><th>Errors</th></tr></thead>
                  <tbody>
                    {report.pages.map((p) => (
                      <tr key={p.url}>
                        <td className="url">{p.path}</td>
                        <td>{p.error || p.status}</td>
                        <td>{p.error ? "" : formatMs(p.loadMs)}</td>
                        <td>{p.error ? "" : formatBytes(p.bytes)}</td>
                        <td>{p.consoleErrors.length + p.uncaught.length}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <section className="wrap r-cta">
          <div>
            <h2>This was one run, on one day, on public pages.</h2>
            <p>
              Your checkout, your dashboard behind login and next Tuesday's release weren't in it. QACops runs this and
              far more on every release, inside your repo and your CI, with a person reading every failure.
            </p>
          </div>
          <div className="r-cta-actions">
            <a className="btn btn-night" href={report.auditUrl}>Get the full free audit</a>
            <a className="r-cta-alt" href="/">Scan another site</a>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
