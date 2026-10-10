import * as React from "react";

import { cn } from "@/lib/utils";

const Input = ({ ref, className, type, ...props }: React.ComponentPropsWithRef<"input">) => {
  return (
    <input
      type={type}
      className={cn(
        "flex h-11 w-full rounded-lg border border-line-strong bg-field px-3.5 py-2 text-base text-ink transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-ink placeholder:text-ink-3 hover:border-line-hover focus-visible:border-link focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-link/30 disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-status-incident/70 md:text-sm",
        className,
      )}
      ref={ref}
      {...props}
    />
  );
};
Input.displayName = "Input";

export { Input };
