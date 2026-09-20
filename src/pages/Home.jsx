import { useEffect, useState } from "react";
import { navigate } from "../router.js";
import { Check, Footer, MAIN_SITE, Reveal, TopBar } from "../ui.jsx";

const CHECKS = [
  { name: "Broken links", body: "Every link we find gets followed, so you see the 404s your visitors hit before we do." },
  { name: "JavaScript errors", body: "The errors that fire in the console while your pages load, including the ones that crash quietly." },
  { name: "Failed requests", body: "Images, scripts and API calls that come back broken or never come back at all." },
  { name: "Phone layout", body: "Pages loaded at phone size, with anything spilling off the screen outlined in red." },
  { name: "Accessibility", body: "The WCAG 2.1 AA rules a machine can check, grouped by how badly they block people." },
  { name: "Speed", body: "How long each page takes to finish loading and which files weigh it down." },
  { name: "Security headers", body: "The basic browser protections your server should be sending, and what each one stops." },
];

// The demo panel in the hero: a scan of a fictional site, played on a loop.
const DEMO = [
  { text: "opening chromium, one page at a time", kind: "meta" },
  { text: "/ home", kind: "ok", note: "1.4s, 12 links" },
  { text: "/pricing", kind: "ok", note: "0.9s" },
  { text: "/blog/how-we-ship", kind: "warn", note: "content wider than a phone screen" },
  { text: "/careers", kind: "bad", note: "404 linked from the footer" },
  { text: "accessibility pass on 8 pages", kind: "meta" },
  { text: "4 serious issues, 2 of them keyboard traps", kind: "bad" },
  { text: "report ready, link sent", kind: "done" },
];

const MARK = { meta: "›", ok: "✓", warn: "!", bad: "✗", done: "★" };

function DemoPanel() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return setStep(DEMO.length);
    const id = setInterval(() => setStep((s) => (s >= DEMO.length ? 0 : s + 1)), 900);
    return () => clearInterval(id);
  }, []);

  return (
    <figure className="demo" aria-hidden="true">
      <div className="demo-head">
        <span className="demo-lights"><i /><i /><i /></span>
        <span className="mono">scanning example.com</span>
        <span className={`demo-state ${step >= DEMO.length ? "done" : ""}`}>{step >= DEMO.length ? "complete" : "working"}</span>
      </div>
      <div className="demo-body">
        {DEMO.slice(0, step).map((line, i) => (
          <div className={`demo-line k-${line.kind}`} key={`${step}-${i}`}>
            <span className="g">{MARK[line.kind]}</span>
            <span className="t">{line.text}</span>
            {line.note && <span className="n">{line.note}</span>}
          </div>
        ))}
      </div>
    </figure>
  );
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/scans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, email, consent }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "The scan couldn't start. Try again in a moment.");
      navigate(`/scan/${data.id}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <>
      <TopBar>
        <a className="toplink" href={`${MAIN_SITE}/blog/`}>Writing</a>
        <a className="toplink" href={MAIN_SITE}>Back to qacops.com</a>
      </TopBar>
      <main>
        <section className="home-hero">
          <div className="aurora" aria-hidden="true" />
          <div className="grid-bg" aria-hidden="true" />
          <div className="wrap home-grid">
            <div>
              <p className="kicker">Free, no signup</p>
              <h1 className="display">See what's breaking on your site</h1>
              <p className="lede">
                Paste your address. A real browser walks up to 25 of your public pages and hands you the same kind of
                report our clients get every release. It takes about three minutes.
              </p>
              <ul className="assurances">
                <li><Check />Free, no card, no call</li>
                <li><Check />Report link you can share with your team</li>
                <li><Check />Reads public pages only</li>
              </ul>
              <DemoPanel />
            </div>

            <form className="scan-form" onSubmit={submit} noValidate>
              <label className="field">
                <span>Website address</span>
                <input
                  className="url-input"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="yourproduct.com"
                  inputMode="url"
                  autoComplete="url"
                  spellCheck="false"
                  required
                />
              </label>
              <label className="field">
                <span>Work email</span>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" autoComplete="email" required />
                <small>We'll send you the report link. No newsletter.</small>
              </label>
              <label className="consent">
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                <span>This is my site, or I have permission to test it.</span>
              </label>
              {error && <p className="form-error" role="alert">{error}</p>}
              <button className="btn btn-amber btn-block" disabled={busy}>
                {busy ? "Starting your scan…" : "Scan my site"}
              </button>
              <p className="form-foot">Runs one page at a time, follows your robots.txt, and identifies itself as QACopsScan in your logs.</p>
            </form>
          </div>
        </section>

        <section className="section">
          <div className="wrap checks-grid">
            <h2 className="h2">Seven checks, one report</h2>
            <dl className="check-list">
              {CHECKS.map((c, i) => (
                <Reveal key={c.name} delay={i}>
                  <dt>{c.name}</dt>
                  <dd>{c.body}</dd>
                </Reveal>
              ))}
            </dl>
          </div>
        </section>

        <section className="section polite">
          <div className="wrap polite-inner">
            <h2 className="h2">It behaves like a careful visitor</h2>
            <p>
              The scanner only opens pages anyone could open. It never fills in forms, never logs in, follows your
              robots.txt, and loads one page at a time so your servers barely notice. It identifies itself as
              QACopsScan in your logs.
            </p>
            <p>
              What it can't do is click through your checkout, test your API under load, or tell you whether a feature
              actually works. That's the part a person does, and it's what <a href={`${MAIN_SITE}/services/`}>we do for clients</a>.
            </p>
          </div>
        </section>

        <section className="section">
          <Reveal className="wrap handoff">
            <div>
              <h2 className="h2">A scan finds symptoms. We fix causes.</h2>
              <p>
                This tool runs once, on public pages, with no login. A QACops engagement is the opposite: suites in your
                repository, running on every pull request, with a person reading every failure and signing off each
                release.
              </p>
              <div className="handoff-actions">
                <a className="btn btn-amber" href={`${MAIN_SITE}/#audit`}>Get a free QA audit</a>
                <a className="btn btn-ghost" href={`${MAIN_SITE}/blog/`}>Read how we think</a>
              </div>
            </div>
            <ul className="handoff-list">
              <li><Check />Playwright and Cypress suites built on your critical flows</li>
              <li><Check />Every failure reproduced, filed with video and a trace</li>
              <li><Check />A written go or no go before each release</li>
            </ul>
          </Reveal>
        </section>
      </main>
      <Footer />
    </>
  );
}
