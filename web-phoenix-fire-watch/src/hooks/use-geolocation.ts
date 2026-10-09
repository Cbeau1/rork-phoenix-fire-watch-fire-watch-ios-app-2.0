import { useCallback, useEffect, useState } from "react";

import type { PatrolLocation } from "@/lib/types";

export type GeoState =
  | { status: "idle" }
  | { status: "locating" }
  | { status: "ready"; location: PatrolLocation; at: number }
  | { status: "denied" }
  | { status: "unavailable"; message: string };

/**
 * Live device position while `enabled`. Uses high accuracy GPS and keeps the latest fix.
 * `retry` restarts the watch (e.g. after the user re-enables location access).
 */
export function useGeolocation(enabled: boolean): { state: GeoState; retry: () => void } {
  const [state, setState] = useState<GeoState>({ status: "idle" });
  const [attempt, setAttempt] = useState<number>(0);

  useEffect(() => {
    if (!enabled) {
      setState({ status: "idle" });
      return;
    }
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setState({ status: "unavailable", message: "This browser can't share your location." });
      return;
    }
    setState((s) => (s.status === "ready" ? s : { status: "locating" }));
    const id = navigator.geolocation.watchPosition(
      (pos) =>
        setState({
          status: "ready",
          location: { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracyM: pos.coords.accuracy },
          at: pos.timestamp,
        }),
      (err) => {
        if (err.code === err.PERMISSION_DENIED) setState({ status: "denied" });
        else
          setState((s) =>
            s.status === "ready"
              ? s
              : {
                  status: "unavailable",
                  message:
                    err.code === err.TIMEOUT
                      ? "Getting a GPS fix is taking too long. Move near a window or outside and retry."
                      : "Your location isn't available right now.",
                },
          );
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [enabled, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, retry };
}

/** One-shot position for "use my location" buttons. */
export const currentPosition = (): Promise<PatrolLocation> =>
  new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("This browser can't share your location."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: p.coords.accuracy }),
      (e) =>
        reject(
          new Error(
            e.code === e.PERMISSION_DENIED
              ? "Location access is blocked. Allow it in your browser settings."
              : "Couldn't get your location.",
          ),
        ),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 },
    );
  });
