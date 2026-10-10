import { Check, Monitor, Moon, Palette, Sun, type LucideIcon } from "lucide-react";

import type { ThemePreference } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { useTheme } from "@/state/ThemeProvider";

import { Card, CardHeader } from "./primitives";

const OPTIONS: { value: ThemePreference; label: string; hint: string; icon: LucideIcon }[] = [
  { value: "light", label: "Light", hint: "Bright, for daylight", icon: Sun },
  { value: "dark", label: "Dark", hint: "Navy, for night shifts", icon: Moon },
  { value: "system", label: "System", hint: "Match this device", icon: Monitor },
];

/** Mini app mock in fixed colors so each option previews its theme regardless of the active one. */
const Preview = ({ mode }: { mode: "light" | "dark" }) => {
  const c =
    mode === "dark"
      ? { canvas: "#0F172A", card: "#1E293B", line: "#334155", ink: "#F8FAFC", ink2: "#94A3B8" }
      : { canvas: "#F1F5F9", card: "#FFFFFF", line: "#E2E8F0", ink: "#0F172A", ink2: "#94A3B8" };
  return (
    <div className="flex h-full w-full gap-1.5 p-2" style={{ background: c.canvas }}>
      <div className="w-3 rounded-sm" style={{ background: c.card, boxShadow: `inset 0 0 0 1px ${c.line}` }} />
      <div className="flex flex-1 flex-col gap-1.5">
        <div className="h-1.5 w-1/2 rounded-full" style={{ background: c.ink }} />
        <div className="flex-1 rounded-sm p-1.5" style={{ background: c.card, boxShadow: `inset 0 0 0 1px ${c.line}` }}>
          <div className="h-1 w-3/4 rounded-full" style={{ background: c.ink2 }} />
          <div className="mt-1 h-1 w-1/2 rounded-full" style={{ background: c.ink2 }} />
          <div className="mt-1.5 h-2 w-8 rounded-sm" style={{ background: "#2563EB" }} />
        </div>
      </div>
    </div>
  );
};

/** Settings → Appearance: Light / Dark / System. Saved per browser and applied instantly. */
export const AppearanceCard = ({ className }: { className?: string }) => {
  const { preference, resolved, setPreference } = useTheme();

  return (
    <Card className={className}>
      <CardHeader
        icon={Palette}
        title="Appearance"
        subtitle={
          preference === "system"
            ? `Following your device — currently ${resolved === "dark" ? "Dark" : "Light"}`
            : "Choose how Phoenix Fire Watch looks on this device"
        }
      />
      <fieldset className="px-6 py-6 sm:px-7">
        <legend className="sr-only">Theme</legend>
        <div className="grid grid-cols-3 gap-3">
          {OPTIONS.map(({ value, label, hint, icon: Icon }) => {
            const selected = preference === value;
            return (
              <label key={value} className="group relative cursor-pointer">
                <input
                  type="radio"
                  name="appearance"
                  value={value}
                  checked={selected}
                  onChange={() => setPreference(value)}
                  className="peer sr-only"
                />
                <div
                  className={cn(
                    "overflow-hidden rounded-xl border-2 bg-surface transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-link peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-surface",
                    selected ? "border-primary" : "border-line group-hover:border-line-strong",
                  )}
                >
                  <div className="relative aspect-[16/10] border-b border-line">
                    {value === "system" ? (
                      <div className="flex h-full">
                        <div className="w-1/2 overflow-hidden">
                          <div className="h-full w-[200%]">
                            <Preview mode="light" />
                          </div>
                        </div>
                        <div className="relative w-1/2 overflow-hidden">
                          <div className="absolute inset-y-0 right-0 h-full w-[200%]">
                            <Preview mode="dark" />
                          </div>
                        </div>
                      </div>
                    ) : (
                      <Preview mode={value} />
                    )}
                    {selected && (
                      <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-white shadow-card">
                        <Check className="h-3 w-3" strokeWidth={3} />
                      </span>
                    )}
                  </div>
                  <div className="flex items-start gap-2 px-3 py-2.5">
                    <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", selected ? "text-link" : "text-ink-3")} />
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-ink">{label}</div>
                      <div className="hidden truncate text-xs text-ink-3 sm:block">{hint}</div>
                    </div>
                  </div>
                </div>
              </label>
            );
          })}
        </div>
      </fieldset>
    </Card>
  );
};
