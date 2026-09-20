import { useEffect, useRef, useState } from "react";

export const MAIN_SITE = "https://qacops.com";

export function Badge({ size = 26 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path d="M16 2 4 6.5v8.2C4 22 9.2 27.8 16 30c6.8-2.2 12-8 12-15.3V6.5z" fill="var(--amber)" />
      <path d="m10.5 16 3.8 3.8 7.2-7.6" fill="none" stroke="var(--night)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Check({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <path d="m3.5 8.2 3 3 6-6.4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function TopBar({ children }) {
  return (
    <header className="topbar">
      <div className="wrap topbar-inner">
        <a href="/" className="brand" aria-label="QACops Scan home">
          <Badge />
          <span>QACops <em>Scan</em></span>
        </a>
        <div className="topbar-actions">{children}</div>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="footer">
      <div className="wrap footer-inner">
        <span>QACops Scan is a free tool from <a href={MAIN_SITE}>QACops</a>, the QA crew for teams shipping faster than they can test.</span>
        <a href="mailto:contact@qacops.com">contact@qacops.com</a>
      </div>
    </footer>
  );
}

export const STATUS_LABEL = { pass: "Passing", warn: "Needs a look", fail: "Failing" };

export const formatBytes = (b) => {
  if (!b) return "0 KB";
  if (b < 1024 * 1024) return `${Math.max(1, Math.round(b / 1024))} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
};

export const formatMs = (ms) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)}s`);

/* ---------- Motion helpers ---------- */

export function useInView(threshold = 0.18) {
  const ref = useRef(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || inView) return;
    const io = new IntersectionObserver(
      ([e]) => e.isIntersecting && (setInView(true), io.disconnect()),
      { threshold }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold, inView]);
  return [ref, inView];
}

/** Adds the `in` class the first time it scrolls into view. */
export function Reveal({ children, className = "", as: Tag = "div", delay = 0, ...rest }) {
  const [ref, inView] = useInView();
  return (
    <Tag ref={ref} className={`reveal ${inView ? "in" : ""} ${className}`.trim()} style={{ "--i": delay }} {...rest}>
      {children}
    </Tag>
  );
}
