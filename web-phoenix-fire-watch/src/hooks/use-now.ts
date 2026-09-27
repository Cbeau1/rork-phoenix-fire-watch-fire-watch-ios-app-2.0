import { useEffect, useState } from "react";

/** Current timestamp that re-renders the caller every `intervalMs` while enabled. */
export const useNow = (intervalMs = 1000, enabled = true): number => {
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    if (!enabled) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs, enabled]);

  return now;
};
