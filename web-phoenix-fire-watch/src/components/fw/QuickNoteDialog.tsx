import { Loader2, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { friendlyError } from "@/lib/supabase";
import { useFireWatch } from "@/state/FireWatchProvider";

export const QuickNoteDialog = ({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) => {
  const { addNote } = useFireWatch();
  const [content, setContent] = useState<string>("");
  const [saving, setSaving] = useState<boolean>(false);

  const save = async () => {
    if (!content.trim() || saving) return;
    setSaving(true);
    try {
      const saved = await addNote(content);
      setContent("");
      onOpenChange(false);
      toast.success(saved.syncState === "pending" ? "Note saved offline — will sync when you reconnect" : "Watch note added");
    } catch (err) {
      toast.error(friendlyError(err, "Couldn't save the note"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-line bg-surface text-ink sm:rounded-xl">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">New Watch Note</DialogTitle>
          <DialogDescription className="text-ink-2">Record important observations or reminders</DialogDescription>
        </DialogHeader>
        <Textarea
          autoFocus
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void save();
          }}
          placeholder="Enter note content..."
          className="min-h-[140px]"
        />
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={!content.trim() || saving}>
            {saving ? <Loader2 className="animate-spin" /> : <Plus />}
            Add Note
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
