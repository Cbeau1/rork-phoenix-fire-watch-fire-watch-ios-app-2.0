/**
 * Decimal-safe money helpers. All arithmetic happens on integer cents; floats are only
 * used at the very edge (formatting for display). Amounts travel to the server as strings
 * like "12.34", which Postgres parses into numeric(14,2).
 */
export type Cents = number;

/** Totals keyed by ISO currency code, in cents. */
export type Totals = Record<string, Cents>;

/** Converts a DB numeric (JSON number with ≤2 decimals) to integer cents. */
export const toCents = (v: number | string | null | undefined): Cents => {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "string") return parseMoney(v) ?? 0;
  return Math.round(v * 100);
};

/** Parses user input ("1,234.5", "$20") into cents. Returns null when invalid or over 2 decimals. */
export const parseMoney = (input: string): Cents | null => {
  const t = input.trim().replace(/[$,\s]/g, "");
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(t)) return null;
  const [whole, frac = ""] = t.split(".");
  return Number(whole) * 100 + Number(`${frac}00`.slice(0, 2));
};

/** Cents → "1234.50" (server/input format, no grouping). */
export const centsToInput = (c: Cents): string => {
  const sign = c < 0 ? "-" : "";
  const a = Math.abs(Math.trunc(c));
  return `${sign}${Math.floor(a / 100)}.${String(a % 100).padStart(2, "0")}`;
};

export const fmtMoney = (c: Cents | null | undefined, currency = "USD"): string => {
  if (c === null || c === undefined) return "—";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 2 }).format(c / 100);
  } catch {
    return `${currency} ${centsToInput(c)}`;
  }
};

export const addTo = (t: Totals, currency: string, c: Cents): Totals => {
  t[currency] = (t[currency] ?? 0) + c;
  return t;
};

/** "$1,200.00" or "$1,200.00 + CA$40.00" when several currencies are involved. */
export const fmtTotals = (t: Totals, empty = "$0.00"): string => {
  const entries = Object.entries(t).filter(([, c]) => c !== 0);
  if (entries.length === 0) return empty;
  entries.sort(([a], [b]) => (a === "USD" ? -1 : b === "USD" ? 1 : a.localeCompare(b)));
  return entries.map(([cur, c]) => fmtMoney(c, cur)).join(" + ");
};

export const totalsSub = (a: Totals, b: Totals): Totals => {
  const out: Totals = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = (out[k] ?? 0) - v;
  return out;
};

/** Splits `total` across rows (oldest first) without exceeding any row's remaining balance. */
export const autoAllocate = (total: Cents, remaining: Cents[]): Cents[] => {
  let left = total;
  return remaining.map((r) => {
    const take = Math.max(0, Math.min(r, left));
    left -= take;
    return take;
  });
};
