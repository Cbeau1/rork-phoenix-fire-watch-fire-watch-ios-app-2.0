/** Public business details used by the legal, support and SEO surfaces. */
export const LEGAL = {
  appName: "Phoenix Fire Watch",
  companyName: "Phoenix Fire Watch",
  supportEmail: "support@phoenixfirewatch.com",
  privacyEmail: "privacy@phoenixfirewatch.com",
  siteUrl: "https://oztxiyqp27gn6fu308my6-web-phoenix-fire-watch.rork.live",
  effectiveDate: "September 27, 2026",
  governingLaw: "the State of Florida, United States",
} as const;

/** Retention choices offered to organization admins (days; null = keep until deleted). */
export const RETENTION_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: "Keep until deleted" },
  { value: 180, label: "6 months" },
  { value: 365, label: "1 year" },
  { value: 730, label: "2 years" },
  { value: 1095, label: "3 years" },
  { value: 1825, label: "5 years" },
  { value: 2555, label: "7 years" },
];

export const retentionLabel = (days: number | null): string =>
  RETENTION_OPTIONS.find((o) => o.value === days)?.label ?? (days ? `${days} days` : "Keep until deleted");
