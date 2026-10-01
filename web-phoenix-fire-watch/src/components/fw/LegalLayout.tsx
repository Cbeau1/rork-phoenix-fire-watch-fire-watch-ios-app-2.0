import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";

import { useDocumentTitle } from "@/hooks/use-document-title";
import { LEGAL } from "@/lib/legal";
import { cn } from "@/lib/utils";

import { Crest } from "./Crest";

const LINKS = [
  { to: "/privacy", label: "Privacy" },
  { to: "/terms", label: "Terms" },
  { to: "/support", label: "Support" },
];

/** Public, readable document layout for legal and support pages (no sign-in required). */
export const LegalLayout = ({
  title,
  description,
  updated = true,
  children,
}: {
  title: string;
  description: string;
  updated?: boolean;
  children: ReactNode;
}) => {
  useDocumentTitle(title, description);
  return (
    <div className="canvas-glow min-h-screen">
      <header className="sticky top-0 z-20 border-b border-line bg-rail/90 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-5">
          <Link to="/" className="focus-ring rounded" aria-label={`${LEGAL.appName} home`}>
            <Crest size="sm" />
          </Link>
          <nav aria-label="Legal" className="flex items-center gap-1">
            {LINKS.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                className={({ isActive }) =>
                  cn(
                    "focus-ring rounded-md px-3 py-2 text-sm transition-colors",
                    isActive ? "text-ember" : "text-ink-2 hover:text-ink",
                  )
                }
              >
                {l.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-5 py-10 sm:py-14">
        <Link to="/" className="focus-ring mb-6 inline-flex items-center gap-2 rounded text-sm text-ink-2 hover:text-ink">
          <ArrowLeft className="h-4 w-4" />
          Back to app
        </Link>
        <h1 className="font-display text-4xl font-extrabold tracking-[-0.01em] text-ink sm:text-5xl">{title}</h1>
        <p className="mt-3 max-w-2xl text-base text-ink-2">{description}</p>
        {updated && <p className="mt-2 text-sm text-ink-3">Effective {LEGAL.effectiveDate}</p>}
        <article className="legal-prose mt-10 rounded-xl border border-line bg-surface px-6 py-8 sm:px-10 sm:py-10">
          {children}
        </article>
        <footer className="mt-10 flex flex-wrap items-center justify-between gap-3 text-xs text-ink-3">
          <span>
            © {new Date().getFullYear()} {LEGAL.companyName}. All rights reserved.
          </span>
          <a href={`mailto:${LEGAL.supportEmail}`} className="hover:text-ember">
            {LEGAL.supportEmail}
          </a>
        </footer>
      </main>
    </div>
  );
};
