import { createRoot } from "react-dom/client";

import App from "./App.tsx";
import "./index.css";

/** Phone-sized page shown full-screen or inside a device-frame preview: reserve room for the status bar and camera. */
const markFramedViewport = (): void => {
  let embedded = false;
  try {
    embedded = window.self !== window.top;
  } catch {
    embedded = true;
  }
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const phoneSized = window.innerWidth < 1024 && window.innerHeight > window.innerWidth;
  document.documentElement.classList.toggle("fw-framed", (embedded || standalone) && phoneSized);
};
markFramedViewport();
window.addEventListener("resize", markFramedViewport);

createRoot(document.getElementById("root")!).render(<App />);

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err: unknown) => {
      console.warn("[Offline] service worker registration failed", err);
    });
  });
}
