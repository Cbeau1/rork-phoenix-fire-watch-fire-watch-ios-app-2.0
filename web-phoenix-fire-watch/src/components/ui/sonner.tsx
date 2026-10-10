import { Toaster as Sonner, toast } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="dark"
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-surface group-[.toaster]:text-ink group-[.toaster]:border-line group-[.toaster]:shadow-pop group-[.toaster]:rounded-xl",
          description: "group-[.toast]:text-ink-2",
          success: "group-[.toaster]:border-status-clear/40 [&_[data-icon]]:text-status-clear",
          error: "group-[.toaster]:border-status-incident/50 [&_[data-icon]]:text-status-incident-ink",
          warning: "group-[.toaster]:border-status-follow/45 [&_[data-icon]]:text-status-follow",
          info: "group-[.toaster]:border-link/40 [&_[data-icon]]:text-link",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-white",
          cancelButton: "group-[.toast]:bg-raised group-[.toast]:text-ink-2",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
