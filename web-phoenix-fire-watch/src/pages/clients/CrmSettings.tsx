import { Eye, FileText, RotateCcw, Save, Upload } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/fw/primitives";
import { ErrorBlock, Loading, SectionCard, TextField, toNum, useUnloadGuard } from "@/components/workforce/kit";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { detectAgreementLayout, isAgreementLayout, type PdfDocLike } from "@/lib/crm/agreementLayout";
import { loadPdfJs } from "@/lib/pdfjs";
import { PdfPreviewDialog } from "./AgreementPdfEditor";
import { crm, useCrmSettings, useInvalidateCrm, useOrg } from "@/lib/crm/api";
import { DEFAULT_CONTRACT_TEMPLATE, MERGE_FIELDS, mergeValues, renderTemplate, toBlocks } from "@/lib/crm/template";
import type { CrmSettings as Settings } from "@/lib/crm/types";
import { friendlyError } from "@/lib/supabase";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Form = {
  company_phone: string;
  company_email: string;
  company_address: string;
  default_rate: string;
  payment_terms: string;
  quote_valid_days: string;
  sign_link_days: string;
  quote_notes: string;
  contract_template: string;
  countersign_name: string;
};

const toForm = (s: Settings): Form => ({
  company_phone: s.company_phone,
  company_email: s.company_email,
  company_address: s.company_address,
  default_rate: s.default_rate != null ? String(s.default_rate) : "",
  payment_terms: s.payment_terms,
  quote_valid_days: String(s.quote_valid_days),
  sign_link_days: String(s.sign_link_days),
  quote_notes: s.quote_notes,
  contract_template: s.contract_template.trim() ? s.contract_template : DEFAULT_CONTRACT_TEMPLATE,
  countersign_name: s.countersign_name ?? "",
});

const Inner = ({ settings }: { settings: Settings }) => {
  const { orgId, orgName } = useOrg();
  const invalidate = useInvalidateCrm();
  const initial = useMemo(() => toForm(settings), [settings]);
  const [f, setF] = useState<Form>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(false);
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);
  useUnloadGuard(dirty);
  const set = (k: keyof Form, v: string) => setF((p) => ({ ...p, [k]: v }));

  const insertField = (key: string) => {
    const el = document.getElementById("contract-template") as HTMLTextAreaElement | null;
    const token = `{{${key}}}`;
    if (!el) return set("contract_template", f.contract_template + token);
    const start = el.selectionStart ?? f.contract_template.length;
    const end = el.selectionEnd ?? start;
    const next = f.contract_template.slice(0, start) + token + f.contract_template.slice(end);
    set("contract_template", next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const save = async () => {
    const e: Record<string, string> = {};
    if (f.company_email && !EMAIL.test(f.company_email.trim())) e.company_email = "Enter a valid email.";
    const rate = f.default_rate ? toNum(f.default_rate) : null;
    if (f.default_rate && (rate == null || rate < 0)) e.default_rate = "Enter a dollar amount.";
    const qd = toNum(f.quote_valid_days);
    if (qd == null || qd < 1 || qd > 120 || !Number.isInteger(qd)) e.quote_valid_days = "1 to 120 days.";
    const sd = toNum(f.sign_link_days);
    if (sd == null || sd < 1 || sd > 60 || !Number.isInteger(sd)) e.sign_link_days = "1 to 60 days.";
    if (!f.contract_template.trim()) e.contract_template = "The template can't be empty.";
    setErrors(e);
    if (Object.keys(e).length) return;
    setSaving(true);
    try {
      await crm.saveSettings({
        ...settings,
        org_id: orgId,
        company_phone: f.company_phone.trim(),
        company_email: f.company_email.trim(),
        company_address: f.company_address.trim(),
        default_rate: rate,
        payment_terms: f.payment_terms.trim() || "Net 15",
        quote_valid_days: qd ?? 14,
        sign_link_days: sd ?? 14,
        quote_notes: f.quote_notes.trim(),
        contract_template: f.contract_template === DEFAULT_CONTRACT_TEMPLATE ? "" : f.contract_template,
        countersign_name: f.countersign_name.trim(),
      });
      await invalidate();
      toast.success("Settings saved");
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setSaving(false);
    }
  };

  const sample = renderTemplate(
    f.contract_template,
    mergeValues({
      clientName: "Harbor Point Apartments LLC",
      propertyName: "Harbor Point Tower B",
      propertyAddress: "1200 Bayshore Blvd, Tampa, FL",
      coverage: "24_7",
      hoursPerWeek: null,
      rate: toNum(f.default_rate) ?? 42,
      minimumHours: 4,
      startDate: new Date().toISOString().slice(0, 10),
      endDate: null,
      patrolMinutes: 60,
      paymentTerms: f.payment_terms,
      reason: "Sprinkler system impaired during repairs",
      fireMarshal: "Fire Marshal's office",
      companyName: orgName,
    }),
  );

  return (
    <div>
      <PageHeader
        title="Templates & settings"
        subtitle="Defaults for quotes, the agreement your clients sign, and the details printed on both."
        actions={
          <Button onClick={() => void save()} disabled={saving || !dirty}>
            <Save />
            {saving ? "Saving…" : "Save changes"}
          </Button>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
        <div className="grid content-start gap-6">
          <SectionCard title="Company details" subtitle="Printed on quotes. Client replies go to this email.">
            <div className="grid gap-4 px-2 pb-2">
              <TextField label="Company email" value={f.company_email} onChange={(v) => set("company_email", v)} type="email" error={errors.company_email} hint="Used as the reply-to on quote and agreement emails." />
              <TextField label="Company phone" value={f.company_phone} onChange={(v) => set("company_phone", v)} type="tel" />
              <TextField label="Company address" value={f.company_address} onChange={(v) => set("company_address", v)} />
              <TextField
                label="Company signer (optional)"
                value={f.countersign_name}
                onChange={(v) => set("countersign_name", v)}
                maxLength={120}
                placeholder="e.g. Corey Smith, Owner"
                hint="If filled, this name is signed for the company on your agreement PDF when the client signs. Leave blank to sign the company side yourself."
              />
            </div>
          </SectionCard>
          <SectionCard title="Quote defaults">
            <div className="grid gap-4 px-2 pb-2">
              <TextField label="Default hourly rate ($)" value={f.default_rate} onChange={(v) => set("default_rate", v)} inputMode="decimal" error={errors.default_rate} />
              <TextField label="Payment terms" value={f.payment_terms} onChange={(v) => set("payment_terms", v)} placeholder="Net 15" />
              <div className="grid grid-cols-2 gap-4">
                <TextField label="Quotes valid (days)" value={f.quote_valid_days} onChange={(v) => set("quote_valid_days", v)} inputMode="numeric" error={errors.quote_valid_days} />
                <TextField label="Signing link (days)" value={f.sign_link_days} onChange={(v) => set("sign_link_days", v)} inputMode="numeric" error={errors.sign_link_days} />
              </div>
              <div>
                <label htmlFor="quote-notes" className="mb-1.5 block text-sm font-medium text-ink">Standard quote notes</label>
                <textarea
                  id="quote-notes"
                  value={f.quote_notes}
                  onChange={(e) => set("quote_notes", e.target.value)}
                  rows={4}
                  maxLength={4000}
                  placeholder="e.g. All officers are licensed, insured and trained in fire watch procedures."
                  className="focus-ring w-full rounded-lg border border-line-strong bg-field px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-3"
                />
              </div>
            </div>
          </SectionCard>
        </div>

        <div className="grid content-start gap-6">
        <AgreementDocumentCard settings={settings} />
        <SectionCard
          title={settings.agreement_pdf_path ? "Backup text agreement" : "Service agreement template"}
          subtitle={
            settings.agreement_pdf_path
              ? "Only used if you remove your agreement PDF. Agreements already written in text keep using it."
              : "Each new agreement is filled in from this template, then you can edit it before sending."
          }
          action={
            <>
              <Button size="sm" variant="outline" onClick={() => setPreview(true)}>
                <Eye />
                Preview
              </Button>
              <Button size="sm" variant="ghost" onClick={() => set("contract_template", DEFAULT_CONTRACT_TEMPLATE)} disabled={f.contract_template === DEFAULT_CONTRACT_TEMPLATE}>
                <RotateCcw />
                Reset to standard
              </Button>
            </>
          }
        >
          <div className="grid gap-3 px-2 pb-2">
            <div>
              <p className="mb-2 text-xs text-ink-3">Tap to insert a field at the cursor:</p>
              <div className="flex flex-wrap gap-1.5">
                {MERGE_FIELDS.map((m) => (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => insertField(m.key)}
                    className="focus-ring rounded-full border border-line bg-raised px-2.5 py-1 text-xs text-ink-2 transition-colors hover:border-primary hover:text-ink"
                    title={`{{${m.key}}}`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
            <textarea
              id="contract-template"
              value={f.contract_template}
              onChange={(e) => set("contract_template", e.target.value)}
              maxLength={60000}
              aria-label="Agreement template"
              className="focus-ring min-h-[60vh] w-full rounded-lg border border-line-strong bg-field px-3.5 py-3 font-mono text-[13px] leading-relaxed text-ink"
            />
            {errors.contract_template && <p className="text-sm text-status-incident-ink">{errors.contract_template}</p>}
            <p className="text-xs text-ink-3">Blank lines separate paragraphs. Start a line with # for the title or ## for a section heading.</p>
          </div>
        </SectionCard>
        </div>
      </div>

      <Dialog open={preview} onOpenChange={setPreview}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto border-line bg-white text-slate-900 sm:max-w-2xl sm:rounded-xl">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-500">Sample — how the client will read it</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-[15px] leading-relaxed text-slate-700">
            {toBlocks(sample).map((b, i) =>
              b.kind === "h1" ? (
                <h3 key={i} className="font-display text-2xl font-bold text-slate-900">{b.text}</h3>
              ) : b.kind === "h2" ? (
                <h4 key={i} className="pt-2 font-display text-base font-bold text-slate-900">{b.text}</h4>
              ) : (
                <p key={i} className="whitespace-pre-line">{b.text}</p>
              ),
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

const MAX_PDF_BYTES = 10 * 1024 * 1024;

const describeLayout = (layout: unknown) => {
  if (!isAgreementLayout(layout)) return null;
  const fill = layout.fields.filter((x) => !x.readOnly).length;
  const initialPages = new Set(layout.initials.map((s) => s.page)).size;
  return [
    `${layout.pages} page${layout.pages === 1 ? "" : "s"}`,
    `${fill} fill-in field${fill === 1 ? "" : "s"}`,
    initialPages ? `initials on ${initialPages} page${initialPages === 1 ? "" : "s"}` : "no initial lines",
    layout.clientSig ? "client signature line found" : "signature goes on the last page",
  ];
};

const AgreementDocumentCard = ({ settings }: { settings: Settings }) => {
  const { orgId, orgName } = useOrg();
  const invalidate = useInvalidateCrm();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"" | "upload" | "remove">("");
  const [error, setError] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [preview, setPreview] = useState(false);
  const path = settings.agreement_pdf_path;
  const summary = describeLayout(settings.agreement_layout);

  const onFile = async (file: File) => {
    setError("");
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) return setError("Choose a PDF file.");
    if (file.size > MAX_PDF_BYTES) return setError("That PDF is over 10 MB. Export a smaller copy and try again.");
    setBusy("upload");
    try {
      const pdfjs = await loadPdfJs();
      let layout;
      try {
        const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
        try {
          layout = await detectAgreementLayout(doc as unknown as PdfDocLike);
        } finally {
          void doc.loadingTask.destroy();
        }
      } catch {
        throw new Error("This PDF couldn't be read. If it's password-protected, save an unlocked copy and try again.");
      }
      if (!layout.fields.some((x) => !x.readOnly)) {
        throw new Error("This PDF has no fill-in fields. Save it as a fillable PDF form (with text fields) and upload it again.");
      }
      await crm.uploadAgreement(orgId, file, layout);
      await invalidate();
      toast.success("Agreement PDF uploaded", { description: "New agreements will use it. Agreements already created stay as they are." });
    } catch (err) {
      setError(err instanceof Error && err.message.startsWith("This PDF") ? err.message : friendlyError(err, "Couldn't upload the PDF."));
    } finally {
      setBusy("");
      if (input.current) input.current.value = "";
    }
  };

  const remove = async () => {
    setBusy("remove");
    try {
      await crm.clearAgreement(orgId);
      await invalidate();
      toast.success("Switched back to the text agreement");
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setBusy("");
      setConfirmRemove(false);
    }
  };

  const uploaded = settings.agreement_uploaded_at
    ? new Date(settings.agreement_uploaded_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    : "";

  return (
    <SectionCard
      title="Agreement document"
      subtitle="Upload your own fillable PDF agreement. Each new agreement fills in its blanks, and the client initials and signs it online."
    >
      <div className="grid gap-3 px-2 pb-2">
        <input
          ref={input}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          aria-label="Agreement PDF file"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onFile(file);
          }}
        />
        {path ? (
          <div className="grid gap-3 rounded-lg border border-line bg-raised px-4 py-3">
            <div className="flex items-start gap-3">
            <FileText className="mt-0.5 h-8 w-8 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-ink">{settings.agreement_pdf_name || "Agreement.pdf"}</p>
              <p className="text-xs text-ink-3">
                {uploaded && `Uploaded ${uploaded}`}
                {summary && ` · ${summary.join(" · ")}`}
              </p>
            </div>
            </div>
            <div className="flex flex-wrap gap-2 pl-11">
              <Button size="sm" variant="outline" onClick={() => setPreview(true)}>
                <Eye />
                Preview
              </Button>
              <Button size="sm" variant="outline" onClick={() => input.current?.click()} disabled={!!busy}>
                <Upload />
                {busy === "upload" ? "Uploading…" : "Replace"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(true)} disabled={!!busy}>
                Remove
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={!!busy}
            className="focus-ring flex flex-col items-center gap-2 rounded-lg border border-dashed border-line-strong bg-raised/50 px-4 py-8 text-center transition-colors hover:border-primary disabled:opacity-60"
          >
            <Upload className="h-6 w-6 text-primary" />
            <span className="text-sm font-semibold text-ink">{busy === "upload" ? "Reading and uploading…" : "Upload agreement PDF"}</span>
            <span className="max-w-sm text-xs text-ink-3">
              A fillable PDF form. Until you upload one, agreements use the text template below.
            </span>
          </button>
        )}
        {error && <p className="text-sm text-status-incident-ink">{error}</p>}
      </div>

      <PdfPreviewDialog
        open={preview}
        onOpenChange={setPreview}
        title={settings.agreement_pdf_name || "Agreement"}
        description={`Blank copy for ${orgName}. Each agreement fills these in from the client and quote.`}
        fileName={settings.agreement_pdf_name || "agreement.pdf"}
        load={() => (path ? crm.previewAgreement(path, JSON.stringify({ v: 1, fields: {} })) : Promise.reject(new Error("No PDF uploaded.")))}
      />
      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent className="border-line bg-surface text-ink">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove agreement PDF?</AlertDialogTitle>
            <AlertDialogDescription className="text-ink-2">
              New agreements will use the text template instead. Agreements already created or signed from this PDF keep it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void remove();
              }}
              disabled={busy === "remove"}
            >
              {busy === "remove" ? "Removing…" : "Remove PDF"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SectionCard>
  );
};

const CrmSettings = () => {
  const q = useCrmSettings();
  if (q.isLoading) return <Loading label="Loading settings…" />;
  if (q.error || !q.data) return <ErrorBlock message={friendlyError(q.error)} onRetry={() => void q.refetch()} />;
  return <Inner key={q.dataUpdatedAt} settings={q.data} />;
};

export default CrmSettings;
