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
  if (scan) return <ScanLive id={scan[1]} />;
  if (report) return <Report id={report[1]} />;
  return <Home />;
}
