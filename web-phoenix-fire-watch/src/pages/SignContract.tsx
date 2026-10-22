import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Download, Eraser, FileSignature, Loader2, PenLine, RefreshCw, Type } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";

import { PdfPages } from "@/components/fw/PdfPages";
import { Button } from "@/components/ui/button";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { sha256Hex, toBlocks } from "@/lib/crm/template";
import { callFunction, friendlyError } from "@/lib/supabase";

type ViewData = {
  status: "sent" | "signed";
  number: number;
  title: string;
  body: string;
  company: string;
  client: string;
  property: string;
  recipient_name: string | null;
  recipient_email: string | null;
  expires_at: string | null;
  signer_name: string | null;
  signed_at: string | null;
  doc_kind?: "text" | "pdf";
  pdf_base64?: string | null;
  initials_required?: boolean;
  asks_title?: boolean;
};

const suggestInitials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 4);

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const fmtWhen = (iso: string | null) => {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(iso));
};

/* ---------- drawn signature pad ---------- */
const SignaturePad = ({ onChange }: { onChange: (dataUrl: string | null) => void }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const strokes = useRef(0);

  const setup = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const rect = c.getBoundingClientRect();
    c.width = Math.round(rect.width * ratio);
    c.height = Math.round(rect.height * ratio);
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#0f1b33";
    strokes.current = 0;
    onChange(null);
  }, [onChange]);

  useEffect(() => {
    setup();
  }, [setup]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    last.current = point(e);
    const ctx = e.currentTarget.getContext("2d");
    if (ctx && last.current) {
      ctx.beginPath();
      ctx.arc(last.current.x, last.current.y, 1.1, 0, Math.PI * 2);
      ctx.fillStyle = "#0f1b33";
      ctx.fill();
    }
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || !last.current) return;
    const p = point(e);
    const ctx = e.currentTarget.getContext("2d");
    if (!ctx) return;
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    strokes.current += 1;
  };
  const up = () => {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    const c = canvasRef.current;
    if (c && strokes.current > 8) onChange(c.toDataURL("image/png"));
  };

  return (
    <div>
      <div className="relative rounded-xl border-2 border-dashed border-slate-300 bg-white">
        <canvas
          ref={canvasRef}
          className="block h-44 w-full touch-none cursor-crosshair rounded-xl"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onPointerLeave={up}
          aria-label="Signature drawing area"
        />
        <div className="pointer-events-none absolute inset-x-6 bottom-10 border-b border-slate-300" />
        <span className="pointer-events-none absolute bottom-3 left-6 text-xs text-slate-400">Sign above the line</span>
      </div>
      <button type="button" onClick={setup} className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900">
        <Eraser className="h-4 w-4" />
        Clear
      </button>
    </div>
  );
};

/* ---------- page ---------- */
const downloadSigned = async (token: string) => {
  const r = await callFunction<{ filename: string; pdf_base64: string }>("contract-sign", { action: "pdf", token });
  const bytes = Uint8Array.from(atob(r.pdf_base64), (ch) => ch.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = r.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
};

const Shell = ({ company, children }: { company?: string; children: React.ReactNode }) => (
  <div className="min-h-screen bg-[#eef1f6] text-slate-900">
    <header className="border-b border-slate-200 bg-[#0b1630]">
      <div className="mx-auto flex max-w-3xl items-center gap-3 px-5 py-4">
        <img src="/phoenix-logo.png" alt="" className="h-9 w-9 rounded-md object-contain" />
        <div className="min-w-0">
          <p className="truncate font-display text-base font-bold text-white">{company || "Service agreement"}</p>
          <p className="text-xs text-slate-300">Secure electronic signature</p>
        </div>
      </div>
    </header>
    <main className="mx-auto max-w-3xl px-4 py-8 sm:px-5">{children}</main>
  </div>
);

const Message = ({ icon, title, body, action }: { icon: React.ReactNode; title: string; body: string; action?: React.ReactNode }) => (
  <div className="rounded-2xl border border-slate-200 bg-white px-6 py-12 text-center shadow-sm">
    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">{icon}</div>
    <h1 className="mt-4 font-display text-2xl font-bold">{title}</h1>
    <p className="mx-auto mt-2 max-w-md text-slate-600">{body}</p>
    {action && <div className="mt-6 flex justify-center">{action}</div>}
  </div>
);

const SignContract = () => {
  const { token = "" } = useParams();
  useDocumentTitle("Sign agreement");
  const q = useQuery({
    queryKey: ["sign", token],
    queryFn: () => callFunction<ViewData>("contract-sign", { action: "view", token }),
    retry: false,
    refetchOnWindowFocus: false,
    gcTime: 0,
  });

  const [method, setMethod] = useState<"draw" | "type">("draw");
  const [image, setImage] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [signerTitle, setSignerTitle] = useState("");
  const [initials, setInitials] = useState("");
  const [initialsTouched, setInitialsTouched] = useState(false);
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [done, setDone] = useState<{ name: string; at: string } | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const onImage = useCallback((v: string | null) => setImage(v), []);
  const pdfBytes = useMemo(() => {
    const b64 = q.data?.doc_kind === "pdf" ? q.data.pdf_base64 : null;
    if (!b64) return null;
    try {
      return Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
    } catch {
      return null;
    }
  }, [q.data]);
  useEffect(() => {
    if (!initialsTouched) setInitials(suggestInitials(name));
  }, [name, initialsTouched]);

  useEffect(() => {
    if (q.data) {
      setName((p) => p || q.data.recipient_name || "");
      setEmail((p) => p || q.data.recipient_email || "");
    }
  }, [q.data]);

  const download = async () => {
    setDownloading(true);
    setDownloadError("");
    try {
      await downloadSigned(token);
    } catch (e) {
      setDownloadError(friendlyError(e));
    } finally {
      setDownloading(false);
    }
  };

  if (q.isLoading) {
    return (
      <Shell>
        <div className="flex flex-col items-center gap-3 py-24 text-slate-500">
          <Loader2 className="h-7 w-7 animate-spin" />
          Loading your agreement…
        </div>
      </Shell>
    );
  }

  if (q.error || !q.data) {
    const msg = friendlyError(q.error, "This signing link isn't valid.");
    const network = /network|connection/i.test(msg);
    return (
      <Shell>
        <Message
          icon={<AlertTriangle className="h-6 w-6 text-amber-600" />}
          title={network ? "Couldn't connect" : "This link can't be used"}
          body={msg}
          action={
            network ? (
              <Button variant="outline" onClick={() => void q.refetch()}>
                <RefreshCw />
                Try again
              </Button>
            ) : undefined
          }
        />
      </Shell>
    );
  }

  const d = q.data;
  const signedName = done?.name ?? d.signer_name;
  const signedAt = done?.at ?? d.signed_at;

  if (done || d.status === "signed") {
    return (
      <Shell company={d.company}>
        <Message
          icon={<CheckCircle2 className="h-6 w-6 text-emerald-600" />}
          title="Agreement signed"
          body={`${d.title} (C-${d.number}) was signed${signedName ? ` by ${signedName}` : ""}${signedAt ? ` on ${fmtWhen(signedAt)}` : ""}. ${d.company} has been notified. Keep a copy for your records.`}
          action={
            <div className="flex flex-col items-center gap-2">
              <Button onClick={() => void download()} disabled={downloading} className="bg-[#0b1630] text-white hover:bg-[#16264a]">
                {downloading ? <Loader2 className="animate-spin" /> : <Download />}
                Download signed copy
              </Button>
              {downloadError && <p className="text-sm text-red-700">{downloadError}</p>}
            </div>
          }
        />
      </Shell>
    );
  }

  const submit = async () => {
    const e: Record<string, string> = {};
    if (name.trim().replace(/\s+/g, " ").length < 2) e.name = "Enter your full legal name.";
    if (!EMAIL.test(email.trim())) e.email = "Enter a valid email address.";
    if (d.initials_required && !/^[A-Za-z.\-']{1,6}$/.test(initials.trim())) e.initials = "Enter your initials (letters only).";
    if (method === "draw" && !image) e.signature = "Draw your signature in the box.";
    if (!consent) e.consent = "Please agree to sign electronically.";
    setErrors(e);
    setSubmitError("");
    if (Object.keys(e).length) return;
    setSubmitting(true);
    try {
      const r = await callFunction<{ ok: true; signed_at: string; signer_name: string }>("contract-sign", {
        action: "sign",
        token,
        name: name.trim(),
        email: email.trim(),
        method,
        ...(d.asks_title ? { title: signerTitle.trim() } : {}),
        ...(d.initials_required ? { initials: initials.trim().toUpperCase() } : {}),
        signature_image: method === "draw" ? image : undefined,
        consent: true,
        body_sha256: await sha256Hex(d.body),
      });
      setDone({ name: r.signer_name, at: r.signed_at });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setSubmitError(friendlyError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls =
    "w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-[15px] text-slate-900 outline-none focus:border-[#2f5bd3] focus:ring-2 focus:ring-[#2f5bd3]/25";

  return (
    <Shell company={d.company}>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Agreement C-{d.number}</p>
          <p className="mt-1 text-slate-700">
            Prepared for <span className="font-semibold text-slate-900">{d.client}</span>
            {d.property && <> · {d.property}</>}
          </p>
        </div>
        {d.expires_at && <p className="text-xs text-slate-500">Link expires {fmtWhen(d.expires_at)}</p>}
      </div>

      {d.doc_kind === "pdf" ? (
        pdfBytes ? (
          <div className="rounded-2xl bg-slate-300/60 p-2 sm:p-4">
            <PdfPages data={pdfBytes} label={d.title} pageClassName="shadow-[0_6px_24px_rgba(15,27,51,0.18)]" />
          </div>
        ) : (
          <Message
            icon={<AlertTriangle className="h-6 w-6 text-amber-600" />}
            title="Couldn't show the agreement"
            body="The document didn't load. Reload the page to try again."
            action={
              <Button variant="outline" onClick={() => void q.refetch()}>
                <RefreshCw />
                Reload
              </Button>
            }
          />
        )
      ) : (
      <article className="rounded-2xl border border-slate-200 bg-white px-6 py-8 shadow-sm sm:px-10">
        <div className="space-y-4 text-[15px] leading-relaxed text-slate-700">
          {toBlocks(d.body).map((b, i) =>
            b.kind === "h1" ? (
              <h1 key={i} className="font-display text-2xl font-bold text-slate-900 sm:text-[28px]">{b.text}</h1>
            ) : b.kind === "h2" ? (
              <h2 key={i} className="pt-3 font-display text-lg font-bold text-slate-900">{b.text}</h2>
            ) : (
              <p key={i} className="whitespace-pre-line">{b.text}</p>
            ),
          )}
        </div>
      </article>
      )}

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white px-6 py-7 shadow-sm sm:px-10" aria-labelledby="sign-heading">
        <div className="flex items-center gap-2">
          <FileSignature className="h-5 w-5 text-[#2f5bd3]" />
          <h2 id="sign-heading" className="font-display text-xl font-bold">Sign this agreement</h2>
        </div>
        <p className="mt-1 text-sm text-slate-600">Signing on behalf of {d.client}.</p>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="sig-name" className="mb-1.5 block text-sm font-medium">Full legal name</label>
            <input id="sig-name" className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoComplete="name" />
            {errors.name && <p className="mt-1 text-sm text-red-700">{errors.name}</p>}
          </div>
          <div>
            <label htmlFor="sig-email" className="mb-1.5 block text-sm font-medium">Email</label>
            <input id="sig-email" type="email" className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} autoComplete="email" />
            {errors.email && <p className="mt-1 text-sm text-red-700">{errors.email}</p>}
          </div>
          {d.asks_title && (
            <div>
              <label htmlFor="sig-title" className="mb-1.5 block text-sm font-medium">
                Title <span className="font-normal text-slate-500">(optional)</span>
              </label>
              <input id="sig-title" className={inputCls} value={signerTitle} onChange={(e) => setSignerTitle(e.target.value)} maxLength={120} autoComplete="organization-title" placeholder="e.g. Property Manager" />
            </div>
          )}
          {d.initials_required && (
            <div>
              <label htmlFor="sig-initials" className="mb-1.5 block text-sm font-medium">Initials</label>
              <input
                id="sig-initials"
                className={`${inputCls} uppercase tracking-widest`}
                value={initials}
                onChange={(e) => {
                  setInitialsTouched(true);
                  setInitials(e.target.value.replace(/\s+/g, ""));
                }}
                maxLength={6}
                autoComplete="off"
              />
              {errors.initials ? (
                <p className="mt-1 text-sm text-red-700">{errors.initials}</p>
              ) : (
                <p className="mt-1 text-xs text-slate-500">Placed on every page where the agreement asks for initials.</p>
              )}
            </div>
          )}
        </div>

        <div className="mt-6">
          <div className="mb-3 inline-flex rounded-lg bg-slate-100 p-1" role="tablist" aria-label="Signature method">
            {(
              [
                ["draw", "Draw", PenLine],
                ["type", "Type", Type],
              ] as const
            ).map(([key, label, Icon]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={method === key}
                onClick={() => setMethod(key)}
                className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors ${
                  method === key ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>
          {method === "draw" ? (
            <SignaturePad onChange={onImage} />
          ) : (
            <div className="flex h-44 items-center rounded-xl border-2 border-dashed border-slate-300 bg-white px-6">
              <p className="w-full truncate border-b border-slate-300 pb-2 font-serif text-4xl italic text-[#0f1b33]">
                {name.trim() || <span className="text-slate-300">Your name</span>}
              </p>
            </div>
          )}
          {errors.signature && <p className="mt-1 text-sm text-red-700">{errors.signature}</p>}
        </div>

        <label className="mt-6 flex cursor-pointer items-start gap-3 rounded-lg bg-slate-50 p-4 text-sm text-slate-700">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#2f5bd3]" />
          <span>
            I have read this agreement and agree to sign it electronically. I understand my electronic signature is legally binding, the
            same as a handwritten signature, and that I'm authorized to sign for {d.client}.
          </span>
        </label>
        {errors.consent && <p className="mt-1 text-sm text-red-700">{errors.consent}</p>}

        {submitError && (
          <div className="mt-5 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {submitError}
              {/reload/i.test(submitError) && (
                <button type="button" className="ml-2 font-semibold underline" onClick={() => window.location.reload()}>
                  Reload
                </button>
              )}
            </span>
          </div>
        )}

        <Button
          onClick={() => void submit()}
          disabled={submitting}
          className="mt-6 h-12 w-full bg-[#0b1630] text-base text-white hover:bg-[#16264a] sm:w-auto sm:px-8"
        >
          {submitting ? <Loader2 className="animate-spin" /> : <FileSignature />}
          {submitting ? "Signing…" : "Sign agreement"}
        </Button>
        <p className="mt-3 text-xs text-slate-500">
          Your name, email, the time, your IP address and a fingerprint of this exact document are recorded with your signature.
        </p>
      </section>
    </Shell>
  );
};

export default SignContract;
