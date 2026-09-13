import { useEffect, useRef, useState } from "react";
import { navigate } from "../router.js";
import { Footer, TopBar } from "../ui.jsx";

const GLYPH = { meta: "›", pass: "✓", flaky: "!", fail: "✗", summary: "›", queue: "…" };
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export default function ScanLive({ id }) {
  const [lines, setLines] = useState([]);
  const [queue, setQueue] = useState(null);
  const [progress, setProgress] = useState({ done: 0, total: 25 });
  const [state, setState] = useState("connecting"); // connecting, queued, running, done, failed
  const [error, setError] = useState("");
  const [spin, setSpin] = useState(0);
  const bodyRef = useRef(null);

  useEffect(() => {
    const source = new EventSource(`/api/scans/${id}/events`);
    source.onmessage = (msg) => {
      const ev = JSON.parse(msg.data);
      switch (ev.kind) {
        case "queue":
          setQueue(ev.text);
          setState((s) => (s === "running" ? s : "queued"));
          break;
        case "status":
          setQueue(null);
          setState("running");
          break;
        case "progress":
          setProgress({ done: ev.done, total: Math.max(ev.total, ev.done) });
          break;
        case "done":
          setState("done");
          source.close();
          setTimeout(() => navigate(`/r/${id}`), 1400);
          break;
        case "failed":
          setState("failed");
          setError(ev.text);
          source.close();
          break;
        default:
          setLines((l) => [...l, ev]);
      }
    };
    source.onerror = () => {
      // EventSource retries on its own; only give up if the server closed a finished stream.
      if (source.readyState === EventSource.CLOSED) setState((s) => (s === "done" || s === "failed" ? s : "failed"));
    };
    return () => source.close();
  }, [id]);

  useEffect(() => {
    if (state !== "running" && state !== "queued" && state !== "connecting") return;
    const t = setInterval(() => setSpin((s) => (s + 1) % SPINNER.length), 90);
    return () => clearInterval(t);
  }, [state]);

  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const pct = state === "done" ? 1 : progress.total ? Math.min(0.97, progress.done / progress.total) : 0;
  const host = lines.find((l) => l.kind === "meta")?.text.replace(/^resolving /, "");

  return (
    <>
      <TopBar />
      <main className="live wrap">
        <h1 className="display live-title">
          {state === "failed" ? "The scan stopped" : state === "done" ? "Scan complete" : state === "queued" ? "You're in the queue" : "Scanning"}
          {host && state !== "failed" && <span className="live-host">{host}</span>}
        </h1>
        <p className="lede live-lede">
          {state === "failed"
            ? error || "Something went wrong on our side."
            : state === "done"
              ? "Opening your report."
              : state === "queued"
                ? `${queue}. Keep this tab open, it starts on its own.`
                : "Leave this tab open. You'll land on the report as soon as the browser finishes."}
        </p>

        <figure className={`run live-run state-${state}`}>
          <div className="run-head">
            <span className="run-lights" aria-hidden="true"><i /><i /><i /></span>
            <span className="run-title">qacops scan {id.slice(0, 6)}</span>
            <span className={`run-status ${state === "done" ? "is-done" : state === "failed" ? "is-failed" : ""}`}>
              <span className="dot" aria-hidden="true" />
              {state === "done" ? "complete" : state === "failed" ? "stopped" : `${progress.done} of ${progress.total} pages`}
            </span>
            <span className="run-bar" style={{ transform: `scaleX(${pct})` }} aria-hidden="true" />
          </div>
          <div className="run-body" ref={bodyRef} aria-live="polite">
            {lines.map((line, i) => (
              <div key={i} className={`run-line k-${line.kind}`}>
                <span className="g">{GLYPH[line.kind] || "›"}</span>
                <span className="t">{line.text}</span>
                {line.time && <span className="ms">{line.time}</span>}
                {line.note && <span className="note">{line.note}</span>}
              </div>
            ))}
            {(state === "running" || state === "queued" || state === "connecting") && (
              <div className="run-line k-pending">
                <span className="g">{SPINNER[spin]}</span>
                <span className="t">{state === "queued" ? "waiting for a free browser" : "working"}</span>
              </div>
            )}
          </div>
        </figure>

        {state === "failed" && (
          <div className="live-actions">
            <button className="btn btn-amber" onClick={() => navigate("/")}>Try another address</button>
          </div>
        )}
      </main>
      <Footer />
    </>
  );
}
