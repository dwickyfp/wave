"use client";

import { mutateSkillGroups } from "@/hooks/queries/use-skill-group";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { SkillGroupSummary } from "app-types/skill";
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

interface SkillGroupCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialGroup?: SkillGroupSummary | null;
}

export function SkillGroupCreateDialog({
  open,
  onOpenChange,
  initialGroup,
}: SkillGroupCreateDialogProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    name: "",
    description: "",
  });

  const isEdit = useMemo(() => Boolean(initialGroup?.id), [initialGroup?.id]);

  useEffect(() => {
    if (!open) return;

    setForm({
      name: initialGroup?.name ?? "",
      description: initialGroup?.description ?? "",
    });
  }, [initialGroup, open]);

  const handleSubmit = async () => {
    const name = form.name.trim();
    if (!name) {
      toast.error("Name is required");
      return;
    }

    setLoading(true);
    try {
      const endpoint = isEdit
        ? `/api/skill-group/${initialGroup!.id}`
        : "/api/skill-group";
      const method = isEdit ? "PUT" : "POST";
      const response = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description: form.description.trim() || undefined,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to save skill group");
      }

      const group = (await response.json()) as SkillGroupSummary;
      await mutateSkillGroups();
      toast.success(isEdit ? "Skill group updated" : "Skill group created");
      onOpenChange(false);

      if (!isEdit) {
        router.push(`/skills/groups/${group.id}`);
      }
    } catch {
      toast.error(
        isEdit
          ? "Failed to update skill group"
          : "Failed to create skill group",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Edit Skill Group" : "New Skill Group"}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update this skill group."
              : "Create a group to organize related skills for a single use case."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="skill-group-name">
              Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="skill-group-name"
              value={form.name}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, name: event.target.value }))
              }
              placeholder="e.g. Sales Demo Follow-up"
              data-testid="skill-group-name-input"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="skill-group-description">Description</Label>
            <Textarea
              id="skill-group-description"
              value={form.description}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  description: event.target.value,
                }))
              }
              placeholder="Describe the case this group covers."
              rows={4}
              data-testid="skill-group-description-input"
            />
          </div>
        </div>

        <DialogFooter>
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
              isEdit ? "skill-group-update-button" : "skill-group-create-button"
            }
          >
            {loading ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
