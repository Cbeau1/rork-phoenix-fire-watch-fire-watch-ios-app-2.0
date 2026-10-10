import { cn } from "@/lib/utils";

interface CrestProps {
  size?: "sm" | "md" | "lg";
  className?: string;
  /** Show only the emblem (used by the compact tablet rail). */
  markOnly?: boolean;
}

/** Phoenix emblem + "PHOENIX / FIRE WATCH" wordmark. */
export const Crest = ({ size = "md", className, markOnly = false }: CrestProps) => {
  const img = size === "lg" ? "h-24 w-24" : size === "md" ? "h-16 w-16" : "h-9 w-9";
  const word = size === "lg" ? "text-3xl" : size === "md" ? "text-[26px]" : "text-base";
  const sub = size === "lg" ? "text-xs" : size === "md" ? "text-[11px]" : "text-[9px]";
  const stacked = size !== "sm";

  return (
    <div className={cn("flex items-center", stacked ? "flex-col gap-3 text-center" : "gap-2.5", className)}>
      <img
        src="/icon.png"
        alt=""
        className={cn(img, "shrink-0 rounded-full object-cover drop-shadow-[0_0_18px_rgba(220,38,38,0.25)]")}
      />
      <div className={cn("leading-none", !stacked && "text-left", markOnly && "sr-only")}>
        <div className={cn("font-crest tracking-[0.08em] text-silver", word)}>PHOENIX</div>
        <div className={cn("mt-1.5 font-medium uppercase tracking-[0.34em] text-link", sub)}>Fire Watch</div>
      </div>
    </div>
  );
};
