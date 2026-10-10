import { Check, FileText, Loader2, Plus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Card, CardHeader, EmptyState, PageHeader } from "@/components/fw/primitives";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { fullDateTime, initials, timeAgo } from "@/lib/format";
import { friendlyError } from "@/lib/supabase";
import { useFireWatch } from "@/state/FireWatchProvider";

const WatchNotes = () => {
  useDocumentTitle("Watch Notes");
  const { notes, addNote, resolveNote, restoreNote } = useFireWatch();
  const [content, setContent] = useState<string>("");
  const [saving, setSaving] = useState<boolean>(false);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!content.trim() || saving) return;
    setSaving(true);
    try {
      const saved = await addNote(content);
      setContent("");
      toast.success(saved.syncState === "pending" ? "Note saved offline — will sync when you reconnect" : "Watch note added");
    } catch (err) {
      toast.error(friendlyError(err, "Couldn't save the note"));
    } finally {
      setSaving(false);
    }
  };

  const resolve = (id: string) => {
    const note = notes.find((n) => n.id === id);
    resolveNote(id)
      .then(() => {
        if (note) {
          toast("Note resolved", {
            action: {
              label: "Undo",
              onClick: () => {
                restoreNote(note).catch((err: unknown) => toast.error(friendlyError(err)));
              },
            },
          });
        }
      })
      .catch((err: unknown) => toast.error(friendlyError(err, "Couldn't resolve the note")));
  };

  return (
    <>
      <PageHeader title="Watch Notes" subtitle="Active shift notes and important reminders" />

      <Card>
        <CardHeader icon={FileText} title="New Watch Note" subtitle="Record important observations or reminders" />
        <form onSubmit={(e) => void submit(e)} className="px-6 pb-6 pt-6 sm:px-7">
          <label htmlFor="note" className="sr-only">
            Note content
          </label>
          <Textarea
            id="note"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
            }}
            placeholder="Enter note content..."
            className="min-h-[150px] resize-y"
          />
          <div className="mt-4 flex items-center justify-between gap-3">
            <span className="hidden text-xs text-ink-3 sm:block">Press ⌘/Ctrl + Enter to add</span>
            <Button type="submit" size="lg" disabled={!content.trim() || saving} className="ml-auto">
              {saving ? <Loader2 className="animate-spin" /> : <Plus />}
              Add Note
            </Button>
          </div>
        </form>
      </Card>

      <Card className="mt-5">
        <CardHeader
          title="Active Notes"
          subtitle={`${notes.length} open ${notes.length === 1 ? "note" : "notes"} · shared with your whole team`}
        />
        {notes.length === 0 ? (
          <EmptyState title="No watch notes yet" description="Create your first note to track important information" />
        ) : (
          <ul className="mt-5 divide-y divide-line border-t border-line">
            {notes.map((n) => (
              <li key={n.id} className="group flex animate-fade-up gap-4 px-6 py-5 sm:px-7">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-raised text-xs font-semibold text-silver ring-1 ring-line">
                  {initials(n.author)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-sm font-medium text-ink">{n.author}</span>
                    <time dateTime={n.createdAt} title={fullDateTime(n.createdAt)} className="text-xs text-ink-3">
                      {timeAgo(n.createdAt)}
                    </time>
                    {n.syncState && (
                      <span className={n.syncState === "failed" ? "text-xs text-status-incident-ink" : "text-xs text-link"}>
                        {n.syncState === "failed" ? "· Not uploaded" : "· Waiting to upload"}
                      </span>
                    )}
                  </div>
                  <p className="mt-2 whitespace-pre-wrap rounded-lg border border-line bg-raised px-4 py-3 text-[15px] leading-relaxed text-ink">{n.content}</p>
                </div>
                <button
                  type="button"
                  onClick={() => resolve(n.id)}
                  aria-label="Mark note resolved"
                  title="Mark resolved"
                  className="focus-ring flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ink-3 transition-colors hover:bg-status-clear/10 hover:text-status-clear"
                >
                  <Check className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
};

export default WatchNotes;
