import {
  ArrowRight,
  Building2,
  CheckCircle2,
  ChevronDown,
  Download,
  Eye,
  FilePenLine,
  FileSignature,
  FileText,
  History,
  Mail,
  MoreHorizontal,
  Pencil,
  Phone,
  Plus,
  Send,
  Trash2,
  UserRound,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";

import { PageHeader } from "@/components/fw/primitives";
import { AreaField, ConfirmDialog, DataTile, Empty, ErrorBlock, FormDialog, Loading, MetaPill, Pill, SectionCard, SelectField, TextField, fmtDate, isDate, toNum } from "@/components/workforce/kit";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { crm, type DealDetail as DealData, useCrmSettings, useDeal, useInvalidateCrm, useOrg, useOrgTimezone } from "@/lib/crm/api";
import { blobToBase64, buildQuotePdf, quoteFileName } from "@/lib/crm/quotePdf";
import { DEFAULT_CONTRACT_TEMPLATE, mergeValues, renderTemplate, toBlocks } from "@/lib/crm/template";
import {
  CONTRACT_META,
  COVERAGE_LABEL,
  COVERAGE_OPTIONS,
  type Coverage,
  type CrmContract,
  type CrmQuote,
  fmtTime,
  fmtZoned,
  LEAD_SOURCES,
  money,
  NEXT_ACTION,
  pricingQuote,
  QUOTE_META,
  ROLE_LABEL,
  STAGE_META,
  STAGES,
  type Stage,
  weeklyHours,
} from "@/lib/crm/types";
import { downloadBlob } from "@/lib/workforce/exports";
import { callFunction, friendlyError } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { useFireWatch } from "@/state/FireWatchProvider";

import { AgreementPdfEditor, PdfPreviewDialog } from "./AgreementPdfEditor";
import { parseAgreement, prefillAgreement, serializeAgreement, withEstimates } from "@/lib/crm/agreementFields";
import { isAgreementLayout } from "@/lib/crm/agreementLayout";
import { AcceptDialog, ContractEditor, LinkResultDialog, QuoteDialog, type QuoteDraft, ReasonDialog, SendDialog, newQuoteDraft, quoteDraftFrom } from "./DealDialogs";
import { LostDialog, useStageMove } from "./Pipeline";

const Stepper = ({ stage }: { stage: Stage }) => {
  const idx = STAGES.indexOf(stage);
  return (
    <ol className="mb-6 flex overflow-x-auto rounded-xl border border-line bg-surface p-1.5" aria-label="Pipeline progress">
      {STAGES.map((s, i) => {
        const done = stage !== "lost" && i < idx;
        const current = s === stage;
        return (
          <li key={s} className="flex min-w-[112px] flex-1 items-center" aria-current={current ? "step" : undefined}>
            <div
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm",
                current ? "bg-primary text-white" : done ? "text-ink" : "text-ink-3",
              )}
            >
              {done ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-status-clear" />
              ) : (
                <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full border font-mono text-[11px]", current ? "border-white/70" : "border-line-strong")}>{i + 1}</span>
              )}
              <span className="whitespace-nowrap font-medium">{STAGE_META[s].label}</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
};

const EMPTY_VALUES: Record<string, string> = {};

/** "Fire_Watch_Proposal-Agreement.pdf" → "Fire Watch Proposal Agreement" */
const agreementTitle = (fileName: string) => {
  const t = fileName.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return t.length >= 4 ? t.slice(0, 120) : "Fire Watch Service Agreement";
};

const Agreement = ({ body, className }: { body: string; className?: string }) => (
  <div className={cn("space-y-3 text-sm leading-relaxed text-ink-2", className)}>
    {toBlocks(body).map((b, i) =>
      b.kind === "h1" ? (
        <h3 key={i} className="font-display text-lg font-bold text-ink">{b.text}</h3>
      ) : b.kind === "h2" ? (
        <h4 key={i} className="pt-1 font-display text-[15px] font-bold text-ink">{b.text}</h4>
      ) : (
        <p key={i} className="whitespace-pre-line">{b.text}</p>
      ),
    )}
  </div>
);

/* ------------------------- Edit request (intake) ------------------------- */

const EditRequestDialog = ({ open, onOpenChange, data }: { open: boolean; onOpenChange: (v: boolean) => void; data: DealData }) => {
  const invalidate = useInvalidateCrm();
  const { reload } = useFireWatch();
  const d = data.deal;
  const p = data.property;
  const initial = useMemo(
    () => ({
      reason: d.reason,
      coverage: d.coverage,
      hours: d.hours_per_week != null ? String(d.hours_per_week) : "",
      interval: d.patrol_interval_minutes != null ? String(d.patrol_interval_minutes) : "60",
      start: d.requested_start_date ?? "",
      time: d.requested_start_time?.slice(0, 5) ?? "",
      end: d.end_date ?? "",
      rate: d.est_rate != null ? String(d.est_rate) : "",
      source: d.source,
      notes: d.notes,
      access: p?.access_instructions ?? "",
      marshal: p?.fire_marshal_name ?? "",
      marshalPhone: p?.fire_marshal_phone ?? "",
      marshalEmail: p?.fire_marshal_email ?? "",
    }),
    [d, p],
  );
  const [f, setF] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof typeof initial>(k: K, v: (typeof initial)[K]) => setF((x) => ({ ...x, [k]: v }));
  const change = (v: boolean) => {
    if (v) {
      setF(initial);
      setErrors({});
    }
    onOpenChange(v);
  };
  const submit = async () => {
    const e: Record<string, string> = {};
    const h = toNum(f.hours);
    if (f.coverage === "custom" && (h == null || h <= 0 || h > 168)) e.hours = "Between 1 and 168.";
    const iv = toNum(f.interval);
    if (iv == null || iv < 10 || iv > 720) e.interval = "Between 10 and 720 minutes.";
    if (f.start && !isDate(f.start)) e.start = "Use a valid date.";
    if (f.end && !isDate(f.end)) e.end = "Use a valid date.";
    if (f.start && f.end && f.end < f.start) e.end = "End is before start.";
    if (f.rate && (toNum(f.rate) == null || (toNum(f.rate) ?? 0) < 0)) e.rate = "Enter a dollar amount.";
    setErrors(e);
    if (Object.keys(e).length) return;
    setSaving(true);
    try {
      await crm.updateDeal(d.id, {
        reason: f.reason.trim(),
        coverage: f.coverage,
        hours_per_week: f.coverage === "custom" ? h : null,
        patrol_interval_minutes: iv,
        requested_start_date: f.start || null,
        requested_start_time: f.time || null,
        end_date: f.end || null,
        est_rate: f.rate ? toNum(f.rate) : null,
        source: f.source,
        notes: f.notes.trim(),
      });
      if (p) {
        await crm.updateProperty(p.id, {
          access_instructions: f.access.trim(),
          fire_marshal_name: f.marshal.trim(),
          fire_marshal_phone: f.marshalPhone.trim(),
          fire_marshal_email: f.marshalEmail.trim().toLowerCase(),
        });
        reload();
      }
      await invalidate();
      toast.success("Request updated");
      onOpenChange(false);
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setSaving(false);
    }
  };
  return (
    <FormDialog open={open} onOpenChange={change} title="Edit request" dirty={JSON.stringify(f) !== JSON.stringify(initial)} saving={saving} onSubmit={() => void submit()} wide>
      <TextField label="Reason for fire watch" value={f.reason} onChange={(v) => set("reason", v)} />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label="Coverage" value={f.coverage} onChange={(v) => set("coverage", v as Coverage)} options={COVERAGE_OPTIONS} />
        {f.coverage === "custom" && <TextField label="Hours per week" value={f.hours} onChange={(v) => set("hours", v)} inputMode="decimal" error={errors.hours} />}
        <TextField label="Patrol every (minutes)" value={f.interval} onChange={(v) => set("interval", v)} inputMode="numeric" error={errors.interval} />
        <TextField label="Start date" type="date" value={f.start} onChange={(v) => set("start", v)} error={errors.start} />
        <TextField label="Start time" type="time" value={f.time} onChange={(v) => set("time", v)} />
        <TextField label="Expected end date" type="date" value={f.end} onChange={(v) => set("end", v)} error={errors.end} />
        <TextField label="Estimated rate ($/hr)" value={f.rate} onChange={(v) => set("rate", v)} inputMode="decimal" error={errors.rate} />
        <SelectField label="How they found us" value={f.source} onChange={(v) => set("source", v)} allowNone noneLabel="Not recorded" options={LEAD_SOURCES.map((s) => ({ value: s, label: s }))} />
      </div>
      <AreaField label="Notes" value={f.notes} onChange={(v) => set("notes", v)} rows={2} />
      {p && (
        <>
          <AreaField label={`Access instructions — ${p.name}`} value={f.access} onChange={(v) => set("access", v)} rows={2} />
          <div className="grid gap-4 sm:grid-cols-3">
            <TextField label="Fire marshal" value={f.marshal} onChange={(v) => set("marshal", v)} />
            <TextField label="Marshal phone" value={f.marshalPhone} onChange={(v) => set("marshalPhone", v)} type="tel" />
            <TextField label="Marshal email" value={f.marshalEmail} onChange={(v) => set("marshalEmail", v)} type="email" />
          </div>
        </>
      )}
    </FormDialog>
  );
};

/* -------------------------------- Page --------------------------------- */

type SendResult = { link: string; emailed: boolean; email_error: string | null; expires_at: string; to: string };

const DealDetail = () => {
  const { id = "" } = useParams();
  const q = useDeal(id);
  const settingsQ = useCrmSettings();
  const tz = useOrgTimezone();
  const { orgId, orgName, userName } = useOrg();
  const invalidate = useInvalidateCrm();
  const { move, busy: moving } = useStageMove();

  const [editRequest, setEditRequest] = useState(false);
  const [lostOpen, setLostOpen] = useState(false);
  const [quoteDraft, setQuoteDraft] = useState<QuoteDraft | null>(null);
  const [sendQuote, setSendQuote] = useState<CrmQuote | null>(null);
  const [acceptQuote, setAcceptQuote] = useState<CrmQuote | null>(null);
  const [declineQuote, setDeclineQuote] = useState<CrmQuote | null>(null);
  const [deleteQuote, setDeleteQuote] = useState<CrmQuote | null>(null);
  const [editContract, setEditContract] = useState<CrmContract | null>(null);
  const [sendContract, setSendContract] = useState<CrmContract | null>(null);
  const [voidContract, setVoidContract] = useState<CrmContract | null>(null);
  const [sendResult, setSendResult] = useState<SendResult | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [showBody, setShowBody] = useState(false);
  const [previewContract, setPreviewContract] = useState<CrmContract | null>(null);

  if (q.isLoading || settingsQ.isLoading) return <Loading label="Loading…" />;
  if (q.error) return <ErrorBlock message={friendlyError(q.error)} onRetry={() => void q.refetch()} />;
  if (settingsQ.error) return <ErrorBlock message={friendlyError(settingsQ.error)} onRetry={() => void settingsQ.refetch()} />;
  if (!q.data || !settingsQ.data) {
    return <Empty title="Not found" description="This record may have been removed." action={<Button asChild variant="outline"><Link to="/clients">Back to pipeline</Link></Button>} />;
  }
  const data = q.data;
  const settings = settingsQ.data;
  const { deal, client, contacts, property, quotes, contracts, activity } = data;
  const primaryContact = contacts.find((c) => c.role !== "billing" && c.email) ?? contacts.find((c) => c.email) ?? contacts[0] ?? null;
  const priced = pricingQuote(quotes);
  const liveContract = contracts.find((c) => c.status !== "void") ?? null;
  const pastContracts = contracts.filter((c) => c.status === "void");
  const next = NEXT_ACTION[deal.stage];

  const mergeCtx = (quote: CrmQuote | null) =>
    mergeValues({
      clientName: client.name,
      propertyName: property?.name ?? "",
      propertyAddress: property?.address ?? "",
      coverage: quote?.coverage ?? deal.coverage,
      hoursPerWeek: quote ? Number(quote.hours_per_week) : deal.hours_per_week,
      rate: quote ? Number(quote.hourly_rate) : deal.est_rate,
      minimumHours: quote?.minimum_hours ?? null,
      startDate: quote?.start_date ?? deal.requested_start_date,
      startTime: deal.requested_start_time,
      endDate: quote?.end_date ?? deal.end_date,
      patrolMinutes: deal.patrol_interval_minutes ?? property?.patrol_interval_minutes ?? 60,
      paymentTerms: quote?.payment_terms || settings.payment_terms,
      reason: deal.reason,
      fireMarshal: [property?.fire_marshal_name, property?.fire_marshal_phone].filter(Boolean).join(", "),
      companyName: orgName,
    });
  const renderBody = (quote: CrmQuote | null) => renderTemplate(settings.contract_template.trim() || DEFAULT_CONTRACT_TEMPLATE, mergeCtx(quote));
  const pdfTemplate =
    settings.agreement_pdf_path && isAgreementLayout(settings.agreement_layout)
      ? { path: settings.agreement_pdf_path, layout: settings.agreement_layout, title: agreementTitle(settings.agreement_pdf_name) }
      : null;
  const prefillFor = (layout: NonNullable<typeof pdfTemplate>["layout"], quote: CrmQuote | null, contractNumber: number | null) =>
    withEstimates(layout, prefillAgreement(layout, { client, contacts, property, deal, quote, settings, tz, contractNumber }));

  const run = async (key: string, fn: () => Promise<void>, ok?: string) => {
    setWorking(key);
    try {
      await fn();
      await invalidate();
      if (ok) toast.success(ok);
    } catch (err) {
      toast.error(friendlyError(err));
      throw err;
    } finally {
      setWorking(null);
    }
  };

  const quotePdf = (quote: CrmQuote) =>
    buildQuotePdf({ quote, deal, client, contact: primaryContact, property, settings, orgName, preparedBy: userName || "Admin" });

  const downloadQuote = (quote: CrmQuote) =>
    run(`pdf-${quote.id}`, async () => downloadBlob(await quotePdf(quote), quoteFileName(quote, client.name))).catch(() => undefined);

  const saveQuote = async (d: QuoteDraft) => {
    await run(
      "quote",
      async () => {
        await crm.saveQuote(orgId, deal.id, {
          id: d.id,
          coverage: d.coverage,
          hours_per_week: toNum(d.hours) ?? 0,
          hourly_rate: toNum(d.rate) ?? 0,
          minimum_hours: d.minimum ? toNum(d.minimum) : null,
          start_date: d.start || null,
          end_date: d.end || null,
          schedule: d.schedule.trim(),
          payment_terms: d.terms.trim(),
          notes: d.notes.trim(),
          valid_until: d.validUntil || null,
        });
      },
      d.id ? "Quote saved" : "Quote created",
    );
  };

  const createContract = () =>
    run(
      "contract-new",
      async () => {
        const qt = priced && priced.status !== "declined" ? priced : null;
        const tpl = pdfTemplate;
        const created = await crm.createContract(orgId, deal.id, {
          quote_id: qt?.id ?? null,
          title: tpl ? tpl.title : "Fire Watch Service Agreement",
          body: tpl ? serializeAgreement(prefillFor(tpl.layout, qt, null)) : renderBody(qt),
          ...(tpl ? { doc_kind: "pdf" as const, template_path: tpl.path, template_layout: tpl.layout } : {}),
          coverage: qt?.coverage ?? deal.coverage,
          hours_per_week: qt ? Number(qt.hours_per_week) : weeklyHours(deal.coverage, deal.hours_per_week) || null,
          hourly_rate: qt ? Number(qt.hourly_rate) : deal.est_rate,
          start_date: qt?.start_date ?? deal.requested_start_date,
          end_date: qt?.end_date ?? deal.end_date,
          payment_terms: qt?.payment_terms || settings.payment_terms,
        });
        // Without a quote, the proposal number is the agreement's own number, known only after insert.
        if (tpl && !qt) await crm.updateContract(created.id, { body: serializeAgreement(prefillFor(tpl.layout, null, created.number)) });
      },
      "Agreement drafted — review it, then send for signature",
    ).catch(() => undefined);

  const downloadSigned = (c: CrmContract) =>
    run(`signed-${c.id}`, async () => {
      if (!c.signed_pdf_path) throw new Error("The signed copy is still being prepared. Try again in a moment.");
      const url = await crm.signedPdfUrl(c.signed_pdf_path);
      const a = document.createElement("a");
      a.href = url;
      a.rel = "noopener";
      a.click();
    }).catch(() => undefined);

  const stageMeta = STAGE_META[deal.stage];

  return (
    <div>
      <PageHeader
        backTo="/clients"
        backLabel="Pipeline"
        title={client.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Pill tone={stageMeta.tone}>{stageMeta.label}</Pill>
            <span>{property ? `${property.name}${property.address ? ` · ${property.address}` : ""}` : "No property linked"}</span>
          </span>
        }
        actions={
          <>
            {next && (
              <Button onClick={() => void move(deal, next.to)} disabled={moving === deal.id}>
                <ArrowRight />
                {next.label}
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" aria-label="More actions">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="border-line bg-surface text-ink">
                <DropdownMenuItem onSelect={() => setEditRequest(true)}>
                  <Pencil className="mr-2 h-4 w-4" /> Edit request
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to={`/clients/c/${client.id}`}>
                    <UserRound className="mr-2 h-4 w-4" /> Client & contacts
                  </Link>
                </DropdownMenuItem>
                {property && (
                  <DropdownMenuItem asChild>
                    <Link to={`/properties/${property.id}`}>
                      <Building2 className="mr-2 h-4 w-4" /> Open property
                    </Link>
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs text-ink-3">Move to</DropdownMenuLabel>
                {STAGES.filter((s) => s !== deal.stage).map((s) => (
                  <DropdownMenuItem key={s} onSelect={() => void move(deal, s)}>
                    <span className={cn("mr-2 h-2 w-2 rounded-full", STAGE_META[s].dot)} />
                    {STAGE_META[s].label}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                {deal.stage === "lost" ? (
                  <DropdownMenuItem onSelect={() => void move(deal, "lead")}>Reopen as lead</DropdownMenuItem>
                ) : (
                  <DropdownMenuItem className="text-status-incident-ink focus:text-status-incident-ink" onSelect={() => setLostOpen(true)}>
                    Mark lost…
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      {deal.stage === "lost" ? (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-status-incident/40 bg-status-incident/10 px-4 py-3 text-sm text-ink">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-status-incident-ink" />
          <span>
            Closed as lost {fmtZoned(deal.stage_changed_at, tz, false)}
            {deal.lost_reason ? ` — ${deal.lost_reason}` : ""}.
          </span>
        </div>
      ) : (
        <Stepper stage={deal.stage} />
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="grid min-w-0 gap-6">
          {/* Quotes */}
          <SectionCard
            title="Quotes"
            subtitle="Price the job, email the PDF, and record the client's answer."
            action={
              <Button
                size="sm"
                onClick={() =>
                  setQuoteDraft(
                    newQuoteDraft({
                      coverage: deal.coverage,
                      hoursPerWeek: deal.hours_per_week,
                      rate: priced ? Number(priced.hourly_rate) : deal.est_rate,
                      start: deal.requested_start_date,
                      end: deal.end_date,
                      settings,
                    }),
                  )
                }
              >
                <Plus />
                New quote
              </Button>
            }
          >
            {quotes.length === 0 ? (
              <p className="px-2 py-6 text-center text-sm text-ink-3">No quotes yet. Create one to send the client a branded PDF.</p>
            ) : (
              <ul className="grid gap-2.5">
                {quotes.map((qt) => {
                  const hrs = weeklyHours(qt.coverage, qt.hours_per_week);
                  return (
                    <li key={qt.id} className="rounded-xl border border-line bg-raised/50 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-sm font-semibold text-ink">Q-{qt.number}</span>
                            <MetaPill meta={QUOTE_META} value={qt.status} />
                            <span className="text-xs text-ink-3">{COVERAGE_LABEL[qt.coverage]}</span>
                          </div>
                          <p className="mt-2 font-mono text-xl font-semibold tabular-nums text-ink">
                            {money(Number(qt.hourly_rate) * hrs)}
                            <span className="ml-1 text-sm font-normal text-ink-3">/wk · {money(qt.hourly_rate)}/hr × {hrs} h</span>
                          </p>
                          <p className="mt-1 text-xs text-ink-3">
                            {qt.status === "sent" && qt.sent_at && `Sent to ${qt.sent_to || "client"} · ${fmtZoned(qt.sent_at, tz)}`}
                            {qt.status === "accepted" && qt.accepted_at && `Accepted${qt.accepted_by ? ` by ${qt.accepted_by}` : ""} · ${fmtZoned(qt.accepted_at, tz)}${qt.accept_note ? ` — ${qt.accept_note}` : ""}`}
                            {qt.status === "draft" && `Created ${fmtZoned(qt.created_at, tz)}${qt.valid_until ? ` · valid until ${fmtDate(qt.valid_until)}` : ""}`}
                            {qt.status === "declined" && "Declined by the client"}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {(qt.status === "draft" || qt.status === "sent") && (
                            <Button size="sm" variant={qt.status === "draft" ? "default" : "outline"} onClick={() => setSendQuote(qt)}>
                              <Send />
                              {qt.status === "draft" ? "Email quote" : "Resend"}
                            </Button>
                          )}
                          <Button size="sm" variant="outline" onClick={() => void downloadQuote(qt)} disabled={working === `pdf-${qt.id}`}>
                            <Download />
                            PDF
                          </Button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button size="sm" variant="ghost" aria-label={`More for Q-${qt.number}`}>
                                <MoreHorizontal />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="border-line bg-surface text-ink">
                              {qt.status !== "accepted" && (
                                <DropdownMenuItem onSelect={() => setAcceptQuote(qt)}>
                                  <CheckCircle2 className="mr-2 h-4 w-4 text-status-clear" /> Mark accepted…
                                </DropdownMenuItem>
                              )}
                              {qt.status === "draft" && (
                                <DropdownMenuItem
                                  onSelect={() =>
                                    void run("q-sent", () => crm.setQuoteStatus(qt.id, "sent", { sent_at: new Date().toISOString(), sent_to: "manually" }), `Q-${qt.number} marked sent`).catch(() => undefined)
                                  }
                                >
                                  <Mail className="mr-2 h-4 w-4" /> Mark sent (sent it myself)
                                </DropdownMenuItem>
                              )}
                              {qt.status === "sent" && (
                                <DropdownMenuItem onSelect={() => setDeclineQuote(qt)}>
                                  <XCircle className="mr-2 h-4 w-4" /> Mark declined
                                </DropdownMenuItem>
                              )}
                              {qt.status === "draft" && (
                                <>
                                  <DropdownMenuItem onSelect={() => setQuoteDraft(quoteDraftFrom(qt))}>
                                    <Pencil className="mr-2 h-4 w-4" /> Edit
                                  </DropdownMenuItem>
                                  <DropdownMenuItem className="text-status-incident-ink focus:text-status-incident-ink" onSelect={() => setDeleteQuote(qt)}>
                                    <Trash2 className="mr-2 h-4 w-4" /> Delete draft
                                  </DropdownMenuItem>
                                </>
                              )}
                              {qt.status !== "draft" && (
                                <DropdownMenuItem onSelect={() => setQuoteDraft({ ...quoteDraftFrom(qt), id: undefined })}>
                                  <Plus className="mr-2 h-4 w-4" /> Copy to new quote
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </SectionCard>

          {/* Contract */}
          <SectionCard
            title="Service agreement"
            subtitle="Drafted from your template, signed online by the client, then locked."
            action={
              !liveContract && (
                <Button size="sm" onClick={() => void createContract()} disabled={working === "contract-new"}>
                  <FilePenLine />
                  Draft agreement
                </Button>
              )
            }
          >
            {!liveContract ? (
              <p className="px-2 py-6 text-center text-sm text-ink-3">
                {priced?.status === "accepted"
                  ? `Q-${priced.number} was accepted — draft the agreement to send for e-signature.`
                  : "Draft the agreement once the client is ready. It fills in the rate, coverage and dates from the latest quote."}
              </p>
            ) : (
              <div className="grid gap-4 px-1 pb-1">
                <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-line bg-raised/50 p-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <FileSignature className="h-4 w-4 text-link" />
                      <span className="font-mono text-sm font-semibold text-ink">C-{liveContract.number}</span>
                      <MetaPill meta={CONTRACT_META} value={liveContract.status} />
                    </div>
                    <p className="mt-1.5 font-display text-base font-bold text-ink">{liveContract.title}</p>
                    <p className="mt-1 text-xs text-ink-3">
                      {liveContract.hourly_rate != null && `${money(liveContract.hourly_rate)}/hr · `}
                      {COVERAGE_LABEL[liveContract.coverage as Coverage] ?? liveContract.coverage}
                      {liveContract.start_date && ` · starts ${fmtDate(liveContract.start_date)}`}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {liveContract.status === "draft" && (
                      <>
                        <Button size="sm" onClick={() => setSendContract(liveContract)}>
                          <Send />
                          Send for signature
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setEditContract(liveContract)}>
                          <Pencil />
                          Edit
                        </Button>
                      </>
                    )}
                    {liveContract.status === "sent" && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => setSendContract(liveContract)}>
                          <Send />
                          Resend new link
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditContract(liveContract)}>
                          <Pencil />
                          Edit
                        </Button>
                      </>
                    )}
                    {liveContract.status === "signed" && (
                      <Button size="sm" onClick={() => void downloadSigned(liveContract)} disabled={working === `signed-${liveContract.id}`}>
                        <Download />
                        Signed PDF
                      </Button>
                    )}
                    {liveContract.status !== "signed" && (
                      <Button size="sm" variant="ghost" className="text-status-incident-ink" onClick={() => setVoidContract(liveContract)}>
                        Void
                      </Button>
                    )}
                  </div>
                </div>

                {liveContract.status === "sent" && (
                  <div className="grid gap-3 sm:grid-cols-3">
                    <DataTile label="Sent to">{liveContract.sent_to_name ? `${liveContract.sent_to_name} · ` : ""}{liveContract.sent_to || "—"}</DataTile>
                    <DataTile label="Opened">
                      {liveContract.viewed_at ? (
                        <span className="inline-flex items-center gap-1.5"><Eye className="h-3.5 w-3.5 text-status-clear" />{fmtZoned(liveContract.viewed_at, tz)}</span>
                      ) : (
                        "Not yet"
                      )}
                    </DataTile>
                    <DataTile label="Link expires">{fmtZoned(liveContract.sign_expires_at, tz)}</DataTile>
                  </div>
                )}
                {liveContract.status === "signed" && (
                  <div className="rounded-xl border border-status-clear/40 bg-status-clear/10 p-4">
                    <p className="flex items-center gap-2 text-sm font-semibold text-ink">
                      <CheckCircle2 className="h-4 w-4 text-status-clear" />
                      Signed by {liveContract.signer_name} {liveContract.signer_email ? `(${liveContract.signer_email})` : ""}
                    </p>
                    <p className="mt-1 text-xs text-ink-2">
                      {fmtZoned(liveContract.signed_at, tz)} · {liveContract.signature_method === "draw" ? "Drawn signature" : "Typed signature"}
                      {liveContract.signer_ip ? ` · IP ${liveContract.signer_ip}` : ""}
                    </p>
                    {liveContract.body_sha256 && <p className="mt-1 break-all font-mono text-[11px] text-ink-3">SHA-256 {liveContract.body_sha256}</p>}
                    <p className="mt-2 text-xs text-ink-3">Signed agreements are locked and can't be edited or deleted.</p>
                  </div>
                )}

                {liveContract.doc_kind === "pdf" ? (
                  <button
                    type="button"
                    onClick={() => setPreviewContract(liveContract)}
                    className="focus-ring flex w-full items-center justify-between rounded-xl border border-line px-4 py-3 text-sm font-medium text-ink transition-colors hover:border-primary"
                  >
                    <span className="inline-flex items-center gap-2"><FileText className="h-4 w-4 text-ink-3" /> {liveContract.status === "signed" ? "View agreement as filled in" : "Preview agreement PDF"}</span>
                    <Eye className="h-4 w-4 text-ink-3" />
                  </button>
                ) : (
                <div className="rounded-xl border border-line">
                  <button
                    type="button"
                    onClick={() => setShowBody((v) => !v)}
                    className="focus-ring flex w-full items-center justify-between rounded-xl px-4 py-3 text-sm font-medium text-ink"
                    aria-expanded={showBody}
                  >
                    <span className="inline-flex items-center gap-2"><FileText className="h-4 w-4 text-ink-3" /> Read agreement</span>
                    <ChevronDown className={cn("h-4 w-4 text-ink-3 transition-transform", showBody && "rotate-180")} />
                  </button>
                  {showBody && <Agreement body={liveContract.body} className="max-h-[60vh] overflow-y-auto border-t border-line px-5 py-4" />}
                </div>
                )}
              </div>
            )}
            {pastContracts.length > 0 && (
              <div className="mt-2 border-t border-line px-2 pt-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-ink-3">Voided</p>
                <ul className="grid gap-1.5">
                  {pastContracts.map((c) => (
                    <li key={c.id} className="text-sm text-ink-2">
                      <span className="font-mono">C-{c.number}</span> · voided{c.void_reason ? ` — ${c.void_reason}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </SectionCard>

          {/* Activity */}
          <SectionCard title={<span className="inline-flex items-center gap-2"><History className="h-5 w-5 text-ink-3" />Activity</span>}>
            {activity.length === 0 ? (
              <p className="px-2 py-4 text-sm text-ink-3">No activity yet.</p>
            ) : (
              <ol className="relative ml-2 border-l border-line pl-5">
                {activity.map((a) => (
                  <li key={a.id} className="relative pb-4 last:pb-1">
                    <span className={cn("absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-surface", a.kind === "contract" ? "bg-status-follow" : a.kind === "quote" ? "bg-primary" : a.kind === "stage" ? "bg-status-clear" : "bg-ink-3")} />
                    <p className="text-sm text-ink">{a.summary}</p>
                    <p className="text-xs text-ink-3">{a.actor_name} · {fmtZoned(a.created_at, tz)}</p>
                  </li>
                ))}
              </ol>
            )}
          </SectionCard>
        </div>

        {/* Sidebar */}
        <div className="grid content-start gap-6">
          <SectionCard title="Request" action={<Button size="sm" variant="ghost" onClick={() => setEditRequest(true)}><Pencil />Edit</Button>}>
            <dl className="grid gap-3 px-2 pb-1 text-sm">
              {[
                ["Reason", deal.reason || "—"],
                ["Coverage", deal.coverage === "custom" ? `${deal.hours_per_week ?? "?"} h/week` : COVERAGE_LABEL[deal.coverage]],
                ["Patrols", `Every ${deal.patrol_interval_minutes ?? property?.patrol_interval_minutes ?? 60} min`],
                ["Start", deal.requested_start_date ? `${fmtDate(deal.requested_start_date)}${deal.requested_start_time ? ` · ${fmtTime(deal.requested_start_time)}` : ""}` : "—"],
                ["End", deal.end_date ? fmtDate(deal.end_date) : "Until restored"],
                ["Est. rate", deal.est_rate != null ? `${money(deal.est_rate)}/hr` : "—"],
                ["Source", deal.source || "—"],
                ["Received", fmtZoned(deal.created_at, tz)],
              ].map(([k, v]) => (
                <div key={k} className="grid grid-cols-[92px_1fr] gap-3">
                  <dt className="text-ink-3">{k}</dt>
                  <dd className="text-ink">{v}</dd>
                </div>
              ))}
              {deal.notes && <p className="whitespace-pre-line rounded-lg bg-raised px-3 py-2 text-ink-2">{deal.notes}</p>}
            </dl>
          </SectionCard>

          <SectionCard title="Contacts" action={<Button asChild size="sm" variant="ghost"><Link to={`/clients/c/${client.id}`}>Manage</Link></Button>}>
            {contacts.length === 0 ? (
              <p className="px-2 pb-2 text-sm text-ink-3">No contacts yet.</p>
            ) : (
              <ul className="grid gap-2 px-1 pb-1">
                {contacts.map((c) => (
                  <li key={c.id} className="rounded-lg bg-raised/60 px-3 py-2.5">
                    <p className="flex items-center gap-2 text-sm font-medium text-ink">
                      {c.name}
                      <span className="text-[11px] font-normal text-ink-3">{ROLE_LABEL[c.role]}</span>
                    </p>
                    <div className="mt-1 flex flex-col gap-0.5 text-xs">
                      {c.phone && <a href={`tel:${c.phone}`} className="inline-flex items-center gap-1.5 font-mono text-link hover:underline"><Phone className="h-3 w-3" />{c.phone}</a>}
                      {c.email && <a href={`mailto:${c.email}`} className="inline-flex items-center gap-1.5 text-link hover:underline"><Mail className="h-3 w-3" />{c.email}</a>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          {property && (
            <SectionCard title="Site" action={<Button asChild size="sm" variant="ghost"><Link to={`/properties/${property.id}`}>Open</Link></Button>}>
              <div className="grid gap-3 px-2 pb-1 text-sm">
                <p className="text-ink">{property.name}<span className="block text-ink-2">{property.address || "No address"}</span></p>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-3">Access</p>
                  <p className="mt-0.5 whitespace-pre-line text-ink-2">{property.access_instructions || "Not recorded"}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-3">Fire marshal</p>
                  <p className="mt-0.5 text-ink-2">
                    {[property.fire_marshal_name, property.fire_marshal_phone, property.fire_marshal_email].filter(Boolean).join(" · ") || "Not recorded"}
                  </p>
                </div>
              </div>
            </SectionCard>
          )}
        </div>
      </div>

      {/* Dialogs */}
      <EditRequestDialog open={editRequest} onOpenChange={setEditRequest} data={data} />
      <LostDialog
        open={lostOpen}
        onOpenChange={setLostOpen}
        busy={moving === deal.id}
        onConfirm={(reason) => void move(deal, "lost", reason).then(() => setLostOpen(false))}
      />
      <QuoteDialog open={!!quoteDraft} onOpenChange={(v) => !v && setQuoteDraft(null)} initial={quoteDraft} onSave={saveQuote} />
      <SendDialog
        open={!!sendQuote}
        onOpenChange={(v) => !v && setSendQuote(null)}
        title={sendQuote ? `Email quote Q-${sendQuote.number}` : "Email quote"}
        description="The branded PDF is attached. Replies go to your company email from Templates & settings."
        contacts={contacts}
        defaultTo={primaryContact?.email ?? ""}
        defaultName={primaryContact?.name ?? ""}
        submitLabel="Send quote"
        messagePlaceholder="Thanks for calling — here's our quote for fire watch coverage. Reply to accept and we'll send the agreement."
        onSend={async ({ to, name, message }) => {
          const qt = sendQuote;
          if (!qt) return;
          await run(
            "send-quote",
            async () => {
              const pdf = await blobToBase64(await quotePdf(qt));
              await callFunction("crm-send", { action: "quote", quote_id: qt.id, pdf_base64: pdf, to, to_name: name, message });
            },
            `Quote Q-${qt.number} emailed to ${to}`,
          );
        }}
      />
      <AcceptDialog
        open={!!acceptQuote}
        onOpenChange={(v) => !v && setAcceptQuote(null)}
        quoteNumber={acceptQuote?.number ?? 0}
        defaultBy={primaryContact?.name ?? ""}
        onAccept={async (by, note) => {
          const qt = acceptQuote;
          if (!qt) return;
          await run("accept", () => crm.acceptQuote(qt.id, by, note), `Q-${qt.number} accepted`);
        }}
      />
      <ConfirmDialog
        open={!!declineQuote}
        onOpenChange={(v) => !v && setDeclineQuote(null)}
        title={`Mark Q-${declineQuote?.number ?? ""} declined?`}
        description="The quote stays on file. You can copy it into a new quote with different pricing."
        confirmLabel="Mark declined"
        destructive
        busy={working === "decline"}
        onConfirm={() => {
          const qt = declineQuote;
          if (!qt) return;
          void run("decline", () => crm.setQuoteStatus(qt.id, "declined"), "Quote marked declined").then(() => setDeclineQuote(null), () => undefined);
        }}
      />
      <ConfirmDialog
        open={!!deleteQuote}
        onOpenChange={(v) => !v && setDeleteQuote(null)}
        title={`Delete draft Q-${deleteQuote?.number ?? ""}?`}
        description="Only drafts that were never sent can be deleted."
        confirmLabel="Delete"
        destructive
        busy={working === "delete-quote"}
        onConfirm={() => {
          const qt = deleteQuote;
          if (!qt) return;
          void run("delete-quote", () => crm.deleteQuote(qt.id), "Draft deleted").then(() => setDeleteQuote(null), () => undefined);
        }}
      />
      <AgreementPdfEditor
        open={editContract?.doc_kind === "pdf"}
        onOpenChange={(v) => !v && setEditContract(null)}
        layout={editContract && isAgreementLayout(editContract.template_layout) ? editContract.template_layout : null}
        templatePath={editContract?.template_path ?? null}
        initialValues={editContract ? parseAgreement(editContract.body) : EMPTY_VALUES}
        warnSent={editContract?.status === "sent"}
        fileName={editContract ? `C-${editContract.number} preview.pdf` : "preview.pdf"}
        refill={() => {
          const c = editContract;
          if (!c || !isAgreementLayout(c.template_layout)) return {};
          return prefillFor(c.template_layout, priced && priced.status !== "declined" ? priced : null, c.number);
        }}
        onSave={async (body) => {
          const c = editContract;
          if (!c) return;
          const qt = priced && priced.status !== "declined" ? priced : null;
          await run(
            "edit-contract",
            () =>
              crm.updateContract(c.id, {
                body,
                ...(qt
                  ? {
                      quote_id: qt.id,
                      coverage: qt.coverage,
                      hours_per_week: Number(qt.hours_per_week),
                      hourly_rate: Number(qt.hourly_rate),
                      start_date: qt.start_date,
                      end_date: qt.end_date,
                      payment_terms: qt.payment_terms,
                    }
                  : {}),
              }),
            c.status === "sent" ? "Agreement updated — the old link no longer works. Send it again." : "Agreement saved",
          );
        }}
      />
      <PdfPreviewDialog
        open={!!previewContract}
        onOpenChange={(v) => !v && setPreviewContract(null)}
        title={previewContract ? `C-${previewContract.number} · ${previewContract.title}` : "Agreement"}
        description={previewContract?.status === "signed" ? "Filled-in terms. Download the signed PDF for the signed copy." : "Exactly what the client reads before signing."}
        fileName={previewContract ? `C-${previewContract.number}.pdf` : "agreement.pdf"}
        load={() =>
          previewContract?.template_path
            ? crm.previewAgreement(previewContract.template_path, previewContract.body)
            : Promise.reject(new Error("This agreement's PDF is missing."))
        }
      />
      <ContractEditor
        open={!!editContract && editContract.doc_kind !== "pdf"}
        onOpenChange={(v) => !v && setEditContract(null)}
        initialTitle={editContract?.title ?? ""}
        initialBody={editContract?.body ?? ""}
        warnSent={editContract?.status === "sent"}
        regenerate={() => renderBody(priced && priced.status !== "declined" ? priced : null)}
        onSave={async (title, body) => {
          const c = editContract;
          if (!c) return;
          const qt = priced && priced.status !== "declined" ? priced : null;
          await run(
            "edit-contract",
            () =>
              crm.updateContract(c.id, {
                title,
                body,
                ...(qt
                  ? {
                      quote_id: qt.id,
                      coverage: qt.coverage,
                      hours_per_week: Number(qt.hours_per_week),
                      hourly_rate: Number(qt.hourly_rate),
                      start_date: qt.start_date,
                      end_date: qt.end_date,
                      payment_terms: qt.payment_terms,
                    }
                  : {}),
              }),
            c.status === "sent" ? "Agreement updated — the old link no longer works. Send it again." : "Agreement saved",
          );
        }}
      />
      <SendDialog
        open={!!sendContract}
        onOpenChange={(v) => !v && setSendContract(null)}
        title={sendContract?.status === "sent" ? "Send a new signing link" : "Send for e-signature"}
        description={
          sendContract?.status === "sent"
            ? "A fresh secure link is emailed and the previous one stops working."
            : `The client gets a secure link to read and sign online. It expires in ${settings.sign_link_days} days.`
        }
        contacts={contacts}
        defaultTo={sendContract?.sent_to || primaryContact?.email || ""}
        defaultName={sendContract?.sent_to_name || primaryContact?.name || ""}
        submitLabel="Send agreement"
        messagePlaceholder="Please review and sign the attached fire watch service agreement so we can confirm your coverage."
        onSend={async ({ to, name, message }) => {
          const c = sendContract;
          if (!c) return;
          await run("send-contract", async () => {
            const res = await callFunction<{ link: string; emailed: boolean; email_error: string | null; expires_at: string }>("crm-send", {
              action: "contract",
              contract_id: c.id,
              origin: window.location.origin,
              to,
              to_name: name,
              message,
            });
            setSendResult({ ...res, to });
          });
        }}
      />
      <ReasonDialog
        open={!!voidContract}
        onOpenChange={(v) => !v && setVoidContract(null)}
        title={`Void C-${voidContract?.number ?? ""}?`}
        description="The signing link stops working immediately. The voided agreement stays on file, and you can draft a new one."
        confirmLabel="Void agreement"
        label="Reason (optional)"
        onConfirm={async (reason) => {
          const c = voidContract;
          if (!c) return;
          await run("void", () => crm.updateContract(c.id, { status: "void", void_reason: reason }), "Agreement voided");
        }}
      />
      <LinkResultDialog result={sendResult} onClose={() => setSendResult(null)} tz={tz} />
    </div>
  );
};

export default DealDetail;
