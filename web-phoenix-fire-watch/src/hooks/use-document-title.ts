import { useEffect } from "react";

import { LEGAL } from "@/lib/legal";

/** Sets the browser tab / search result title for the current screen. */
export const useDocumentTitle = (title?: string, description?: string) => {
  useEffect(() => {
    document.title = title ? `${title} · ${LEGAL.appName}` : `${LEGAL.appName} — Fire Watch Patrol Logs & Signed Shift Reports`;
    if (description) {
      document.querySelector('meta[name="description"]')?.setAttribute("content", description);
    }
  }, [title, description]);
};
