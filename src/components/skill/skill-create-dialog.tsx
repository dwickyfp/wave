"use client";

import { mutateSkills } from "@/hooks/queries/use-skill";
import { SkillSummary } from "app-types/skill";
import { WandSparklesIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "ui/dialog";
import { Input } from "ui/input";
import { Label } from "ui/label";
import { Textarea } from "ui/textarea";
import { SkillGenerateDialog } from "./skill-generate-dialog";

interface SkillCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialSkill?: SkillSummary | null;
}

export function SkillCreateDialog({
  open,
  onOpenChange,
  initialSkill,
}: SkillCreateDialogProps) {
  const [loading, setLoading] = useState(false);
  const [openGenerate, setOpenGenerate] = useState(false);
  const [form, setForm] = useState({
    title: "",
    description: "",
    instructions: "",
  });

  const isEdit = useMemo(() => Boolean(initialSkill?.id), [initialSkill?.id]);

  useEffect(() => {
    if (!open) return;
    setForm({
      title: initialSkill?.title ?? "",
      description: initialSkill?.description ?? "",
      instructions: initialSkill?.instructions ?? "",
    });
  }, [open, initialSkill]);

  const handleSubmit = async () => {
    const title = form.title.trim();
    const instructions = form.instructions.trim();

    if (!title) {
      toast.error("Title is required");
      return;
    }

    if (!instructions) {
      toast.error("Instructions are required");
      return;
    }

    setLoading(true);
    try {
      const endpoint = isEdit ? `/api/skill/${initialSkill!.id}` : "/api/skill";
      const method = isEdit ? "PUT" : "POST";

      const res = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description: form.description.trim() || undefined,
          instructions,
        }),
      });

      if (!res.ok) {
        throw new Error(`Failed to ${isEdit ? "update" : "create"} skill`);
      }

      await mutateSkills();
      toast.success(isEdit ? "Skill updated" : "Skill created");
      onOpenChange(false);
    } catch {
      toast.error(isEdit ? "Failed to update skill" : "Failed to create skill");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>{isEdit ? "Edit Skill" : "New Skill"}</DialogTitle>
            <DialogDescription>
              {isEdit
                ? "Update this skill definition."
                : "Create a reusable skill with title and instructions."}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 min-h-0 overflow-hidden flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">
                Review AI output before saving.
              </div>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => setOpenGenerate(true)}
                disabled={loading}
              >
                <WandSparklesIcon className="size-3.5" />
                Generate With AI
              </Button>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="skill-title">
                Title <span className="text-destructive">*</span>
              </Label>
              <Input
                id="skill-title"
                value={form.title}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, title: event.target.value }))
                }
                placeholder="e.g. Technical RFC Writer"
                data-testid="skill-title-input"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="skill-description">Description</Label>
              <Input
                id="skill-description"
                value={form.description}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    description: event.target.value,
                  }))
                }
                placeholder="Short summary of this skill."
                data-testid="skill-description-input"
              />
            </div>

            <div className="flex flex-col gap-1.5 min-h-0 flex-1">
              <Label htmlFor="skill-instructions">
                Instructions <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="skill-instructions"
                value={form.instructions}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    instructions: event.target.value,
                  }))
                }
                placeholder="Write SKILL.md-style markdown instructions."
                className="min-h-64 h-full max-h-none resize-none overflow-y-auto"
                data-testid="skill-instructions-textarea"
              />
            </div>
          </div>

          <DialogFooter className="pt-3 border-t">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={loading}
              data-testid={
                isEdit ? "skill-update-button" : "skill-create-button"
              }
            >
              {loading ? (isEdit ? "Saving..." : "Creating...") : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SkillGenerateDialog
        open={openGenerate}
        onOpenChange={setOpenGenerate}
        onSkillGenerated={(value) =>
          setForm((prev) => ({
            ...prev,
            title: value.title ?? prev.title,
            description: value.description ?? prev.description,
            instructions: value.instructions ?? prev.instructions,
          }))
        }
      />
    </>
  );
}
