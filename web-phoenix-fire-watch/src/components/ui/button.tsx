import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium ring-offset-canvas transition-all duration-150 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember/70 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-ember text-white hover:bg-ember-hover",
        destructive: "bg-status-incident text-white hover:bg-status-incident/90",
        "destructive-outline":
          "border border-status-incident/60 bg-transparent text-status-incident hover:bg-status-incident/10",
        outline: "border border-[#6E7686] bg-transparent text-ink hover:bg-raised hover:border-[#7D8595]",
        secondary: "bg-raised text-ink hover:bg-[#575E6C]",
        ghost: "text-ink-2 hover:bg-raised hover:text-ink",
        link: "text-ember underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 px-3",
        lg: "h-12 px-6 text-[15px]",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps extends React.ComponentPropsWithRef<"button">, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = ({ ref, className, variant, size, asChild = false, ...props }: ButtonProps) => {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
};
Button.displayName = "Button";

export { Button, buttonVariants };
