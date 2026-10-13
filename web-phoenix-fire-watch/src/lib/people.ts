import type { QueryClient } from "@tanstack/react-query";

/**
 * A person's name lives in Workforce, Team and Schedule; the database keeps all three in sync.
 * Call after adding or renaming someone anywhere so every page shows the new name right away.
 */
export function refreshPeople(qc: QueryClient): void {
  for (const key of [["staff"], ["members"], ["wf"], ["tc"], ["shifts"]]) {
    void qc.invalidateQueries({ queryKey: key });
  }
}
