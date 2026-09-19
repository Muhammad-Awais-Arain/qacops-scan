import { useEffect, useState } from "react";
import Home from "./pages/Home.jsx";
import ScanLive from "./pages/ScanLive.jsx";
import Report from "./pages/Report.jsx";

function useLocationPath() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  return path;
}

export default function App() {
  const path = useLocationPath();
  const scan = path.match(/^\/scan\/([A-Za-z0-9_-]{16})$/);
  const report = path.match(/^\/r\/([A-Za-z0-9_-]{16})$/);

  // An address that matches nothing shows the home page, and the address bar is
  // corrected to "/" so a mistyped link doesn't linger as a dead URL.
  useEffect(() => {
    if (!scan && !report && path !== "/") window.history.replaceState({}, "", "/");
  }, [path, scan, report]);

  // Report and live-scan pages carry someone else's site data: keep them out of search results.
  useEffect(() => {
    const tag = document.querySelector('meta[name="robots"]') || document.head.appendChild(Object.assign(document.createElement("meta"), { name: "robots" }));
    tag.content = scan || report ? "noindex, nofollow" : "index, follow, max-image-preview:large";
  }, [scan, report]);

  if (scan) return <ScanLive id={scan[1]} />;
  if (report) return <Report id={report[1]} />;
  return <Home />;
}
