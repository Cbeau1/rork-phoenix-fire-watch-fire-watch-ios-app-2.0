import * as React from "react";

import { cn } from "@/lib/utils";

export type TextareaProps = React.ComponentPropsWithRef<"textarea">;

const Textarea = ({ ref, className, ...props }: TextareaProps) => {
  return (
    <textarea
      className={cn(
        "flex min-h-[110px] w-full rounded-lg border border-line-strong bg-field px-3.5 py-3 text-sm leading-relaxed text-ink transition-colors placeholder:text-ink-3 hover:border-line-hover focus-visible:border-link focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-link/30 disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-status-incident/70",
        className,
      )}
      ref={ref}
      {...props}
    />
  );
};
Textarea.displayName = "Textarea";

export { Textarea };
