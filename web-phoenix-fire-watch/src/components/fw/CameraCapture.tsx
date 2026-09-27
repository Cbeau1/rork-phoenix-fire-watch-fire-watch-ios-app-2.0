import { format } from "date-fns";
import { Aperture, CameraOff, Loader2, RefreshCw, SwitchCamera, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type CameraState = "starting" | "live" | "denied" | "unavailable" | "error";

interface CameraCaptureProps {
  open: boolean;
  onClose: () => void;
  /** Receives a compressed, time-stamped JPEG data URL. */
  onCapture: (dataUrl: string) => void;
  remaining: number;
  stampLines: string[];
}

const MAX_SIDE = 1280;

/** Burns a date/time + context stamp into the bottom of the frame so photos prove when they were taken. */
const drawStamp = (ctx: CanvasRenderingContext2D, w: number, h: number, lines: string[]) => {
  const size = Math.max(14, Math.round(w / 48));
  const pad = Math.round(size * 0.8);
  const lineH = Math.round(size * 1.35);
  const text = [format(new Date(), "MMM d, yyyy · h:mm:ss a"), ...lines.filter(Boolean)];
  const boxH = pad * 2 + lineH * text.length - (lineH - size);
  const grad = ctx.createLinearGradient(0, h - boxH - pad * 2, 0, h);
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(1, "rgba(0,0,0,0.72)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, h - boxH - pad * 2, w, boxH + pad * 2);
  ctx.fillStyle = "#DC2626";
  ctx.fillRect(pad, h - boxH, Math.max(3, Math.round(size / 5)), boxH - pad);
  ctx.textBaseline = "top";
  text.forEach((t, i) => {
    ctx.font = `${i === 0 ? "700" : "500"} ${i === 0 ? size : Math.round(size * 0.85)}px "IBM Plex Sans", Helvetica, Arial, sans-serif`;
    ctx.fillStyle = i === 0 ? "#FFFFFF" : "rgba(255,255,255,0.82)";
    ctx.fillText(t, pad * 2, h - boxH + i * lineH, w - pad * 3);
  });
};

/** Full-screen live camera. Photos can only come from the camera feed — never from the library. */
export const CameraCapture = ({ open, onClose, onCapture, remaining, stampLines }: CameraCaptureProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [state, setState] = useState<CameraState>("starting");
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [canSwitch, setCanSwitch] = useState<boolean>(false);
  const [flash, setFlash] = useState<boolean>(false);
  const [lastShot, setLastShot] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<number>(0);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    if (!open) {
      stop();
      return;
    }
    let cancelled = false;
    setState("starting");
    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setState("unavailable");
        return;
      }
      try {
        stop();
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => undefined);
        }
        const devices = await navigator.mediaDevices.enumerateDevices().catch(() => [] as MediaDeviceInfo[]);
        setCanSwitch(devices.filter((d) => d.kind === "videoinput").length > 1);
        setState("live");
      } catch (err) {
        if (cancelled) return;
        const name = err instanceof DOMException ? err.name : "";
        console.warn("[Camera] start failed", name);
        if (name === "NotAllowedError" || name === "SecurityError") setState("denied");
        else if (name === "NotFoundError" || name === "OverconstrainedError") setState("unavailable");
        else setState("error");
      }
    };
    void start();
    return () => {
      cancelled = true;
    };
  }, [open, facing, attempt, stop]);

  useEffect(() => stop, [stop]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const capture = () => {
    const video = videoRef.current;
    if (!video || state !== "live" || remaining <= 0 || !video.videoWidth) return;
    const scale = Math.min(1, MAX_SIDE / Math.max(video.videoWidth, video.videoHeight));
    const w = Math.round(video.videoWidth * scale);
    const h = Math.round(video.videoHeight * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (facing === "user") {
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, w, h);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawStamp(ctx, w, h, stampLines);
    const data = canvas.toDataURL("image/jpeg", 0.74);
    navigator.vibrate?.(30);
    setFlash(true);
    setTimeout(() => setFlash(false), 180);
    setLastShot(data);
    onCapture(data);
    if (remaining - 1 <= 0) setTimeout(onClose, 450);
  };

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[60] flex h-[100dvh] flex-col bg-black" role="dialog" aria-modal="true" aria-label="Camera">
      <div className="relative flex-1 overflow-hidden">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className={cn("h-full w-full object-contain", facing === "user" && "-scale-x-100", state !== "live" && "opacity-0")}
        />
        <div className={cn("pointer-events-none absolute inset-0 bg-white transition-opacity duration-150", flash ? "opacity-80" : "opacity-0")} />

        <div className="absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent px-4 pb-10 pt-[max(1rem,env(safe-area-inset-top))]">
          <span className="inline-flex items-center gap-2 rounded-full bg-black/50 px-3 py-1.5 text-xs font-medium text-white ring-1 ring-white/15">
            <span className={cn("h-2 w-2 rounded-full", state === "live" ? "animate-ember-pulse bg-status-incident" : "bg-ink-3")} />
            {state === "live" ? "LIVE · photos are time-stamped" : "Camera"}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close camera"
            className="focus-ring flex h-11 w-11 items-center justify-center rounded-full bg-black/50 text-white ring-1 ring-white/15 hover:bg-black/70"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {state !== "live" && (
          <div className="absolute inset-0 flex items-center justify-center p-8 text-center">
            {state === "starting" ? (
              <Loader2 className="h-8 w-8 animate-spin text-ember" />
            ) : (
              <div className="max-w-sm">
                <CameraOff className="mx-auto h-10 w-10 text-ink-2" strokeWidth={1.6} />
                <h2 className="mt-4 font-display text-xl font-bold text-white">
                  {state === "denied" ? "Camera access is blocked" : state === "unavailable" ? "No camera found" : "Camera couldn't start"}
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-ink-2">
                  {state === "denied"
                    ? "Allow camera access for this site in your browser or device settings, then try again. Patrol photos must be taken live."
                    : state === "unavailable"
                      ? "Patrol photos must be taken live with a camera. Use a phone or tablet with a camera to attach photos."
                      : "Another app may be using the camera. Close it and try again."}
                </p>
                <Button className="mt-6" variant="outline" onClick={() => setAttempt((a) => a + 1)}>
                  <RefreshCw />
                  Try again
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-6 bg-black px-8 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-5">
        <div className="h-14 w-14 overflow-hidden rounded-lg ring-1 ring-white/20">
          {lastShot && <img src={lastShot} alt="Last photo taken" className="h-full w-full animate-fade-up object-cover" />}
        </div>
        <button
          type="button"
          onClick={capture}
          disabled={state !== "live" || remaining <= 0}
          aria-label="Take photo"
          className="focus-ring group flex h-[76px] w-[76px] items-center justify-center rounded-full border-4 border-white/90 transition-transform active:scale-90 disabled:opacity-40"
        >
          <span className="flex h-[58px] w-[58px] items-center justify-center rounded-full bg-ember transition-colors group-hover:bg-ember-hover">
            <Aperture className="h-6 w-6 text-white" />
          </span>
        </button>
        <div className="flex w-14 flex-col items-center gap-1">
          {canSwitch ? (
            <button
              type="button"
              onClick={() => setFacing((f) => (f === "environment" ? "user" : "environment"))}
              aria-label="Switch camera"
              className="focus-ring flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
            >
              <SwitchCamera className="h-5 w-5" />
            </button>
          ) : null}
          <span className="font-mono text-[11px] text-ink-2">{remaining} left</span>
        </div>
      </div>
    </div>,
    document.body,
  );
};
