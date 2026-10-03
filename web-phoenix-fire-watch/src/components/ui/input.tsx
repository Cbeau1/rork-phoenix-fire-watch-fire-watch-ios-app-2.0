import * as React from "react";

import { cn } from "@/lib/utils";

const Input = ({ ref, className, type, ...props }: React.ComponentPropsWithRef<"input">) => {
  return (
    <input
      type={type}
      className={cn(
        "flex h-11 w-full rounded-lg border border-line bg-raised px-3.5 py-2 text-base text-ink transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-ink placeholder:text-ink-3 hover:border-[#6B7382] focus-visible:border-ember/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember/25 disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-status-incident/70 md:text-sm",
        className,
      )}
      ref={ref}
      {...props}
    />
  );
};
Input.displayName = "Input";

export { Input };
