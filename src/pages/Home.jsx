import { useState } from "react";
import { navigate } from "../router.js";
import { Check, Footer, MAIN_SITE, TopBar } from "../ui.jsx";

const CHECKS = [
  { name: "Broken links", body: "Every link we find gets followed, so you see the 404s your visitors hit before we do." },
  { name: "JavaScript errors", body: "The errors that fire in the console while your pages load, including the ones that crash quietly." },
  { name: "Failed requests", body: "Images, scripts and API calls that come back broken or never come back at all." },
  { name: "Phone layout", body: "Pages loaded at phone size, with anything spilling off the screen outlined in red." },
  { name: "Accessibility", body: "The WCAG 2.1 AA rules a machine can check, grouped by how badly they block people." },
  { name: "Speed", body: "How long each page takes to finish loading and which files weigh it down." },
  { name: "Security headers", body: "The basic browser protections your server should be sending, and what each one stops." },
];

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
        <a className="toplink" href={MAIN_SITE}>Back to qacops.com</a>
      </TopBar>
      <main>
        <section className="home-hero">
          <div className="hero-glow" aria-hidden="true" />
          <div className="wrap home-grid">
            <div>
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
            </form>
          </div>
        </section>

        <section className="section">
          <div className="wrap checks-grid">
            <h2 className="h2">Seven checks, one report</h2>
            <dl className="check-list">
              {CHECKS.map((c) => (
                <div key={c.name}>
                  <dt>{c.name}</dt>
                  <dd>{c.body}</dd>
                </div>
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
              actually works. That's the part a person does, and it's what <a href={`${MAIN_SITE}/#services`}>we do for clients</a>.
            </p>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
