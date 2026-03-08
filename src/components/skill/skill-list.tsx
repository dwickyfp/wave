"use client";

import { SkillSummary, SkillVisibility } from "app-types/skill";
import { fetcher } from "lib/utils";
import { SparklesIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { Button } from "ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "ui/card";
import { notify } from "lib/notify";
import { SkillCard } from "./skill-card";
import { SkillCreateDialog } from "./skill-create-dialog";

interface SkillListProps {
  initialMine: SkillSummary[];
  initialShared: SkillSummary[];
  userId: string;
}

export function SkillList({
  initialMine,
  initialShared,
  userId,
}: SkillListProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [editingSkill, setEditingSkill] = useState<SkillSummary | null>(null);
  const [visibilityChangeLoading, setVisibilityChangeLoading] = useState<
    string | null
  >(null);
  const [deleteLoading, setDeleteLoading] = useState<string | null>(null);

  const { data, mutate } = useSWR<SkillSummary[]>(
    "/api/skill?filters=mine,shared",
    fetcher,
    {
      fallbackData: [...initialMine, ...initialShared],
    },
  );

  const updateVisibility = async (
    skillId: string,
    visibility: SkillVisibility,
  ) => {
    setVisibilityChangeLoading(skillId);
    try {
      const response = await fetch(`/api/skill/${skillId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visibility }),
      });
      if (!response.ok) throw new Error("Failed to update visibility");

      await mutate(
        (current) =>
          (current ?? []).map((skill) =>
            skill.id === skillId ? { ...skill, visibility } : skill,
          ),
        { revalidate: false },
      );
      toast.success("Visibility updated");
    } catch {
      toast.error("Failed to update visibility");
    } finally {
      setVisibilityChangeLoading(null);
    }
  };

  const deleteSkill = async (skillId: string) => {
    const ok = await notify.confirm({
      description: "Delete this skill? This action cannot be undone.",
    });
    if (!ok) return;

    setDeleteLoading(skillId);
    try {
      const response = await fetch(`/api/skill/${skillId}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Failed to delete skill");

      await mutate(
        (current) => (current ?? []).filter((skill) => skill.id !== skillId),
        { revalidate: false },
      );
      toast.success("Skill deleted");
    } catch {
      toast.error("Failed to delete skill");
    } finally {
      setDeleteLoading(null);
    }
  };

  const mine = (data ?? []).filter((skill) => skill.userId === userId);
  const shared = (data ?? []).filter((skill) => skill.userId !== userId);

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6 max-w-7xl mx-auto w-full">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <SparklesIcon className="size-5 text-primary" />
          <h1 className="text-xl font-semibold">Skills</h1>
          <span className="text-sm text-muted-foreground">Agent Skills</span>
        </div>
        <Button
          onClick={() => setCreateOpen(true)}
          size="sm"
          className="gap-1.5"
          data-testid="skills-new-button"
        >
          <PlusIcon className="size-3.5" />
          New Skill
        </Button>
      </div>

      {mine.length === 0 && shared.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center gap-4">
          <div className="p-4 rounded-full bg-primary/10">
            <SparklesIcon className="size-8 text-primary" />
          </div>
          <div>
            <h2 className="font-semibold text-lg">No skills yet</h2>
            <p className="text-muted-foreground text-sm mt-1">
              Create your first skill and attach it to agents.
            </p>
          </div>
          <Button
            onClick={() => setCreateOpen(true)}
            className="gap-1.5"
            data-testid="skills-create-empty-button"
          >
            <PlusIcon className="size-4" />
            Create Skill
          </Button>
        </div>
      ) : (
        <>
          <section className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">My Skills</h2>
              <div className="flex-1 h-px bg-border" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {mine.map((skill) => (
                <SkillCard
                  key={skill.id}
                  skill={skill}
                  isOwner
                  onEdit={setEditingSkill}
                  onDelete={deleteSkill}
                  onVisibilityChange={updateVisibility}
                  isVisibilityChangeLoading={
                    visibilityChangeLoading === skill.id
                  }
                  isDeleteLoading={deleteLoading === skill.id}
                />
              ))}
              {mine.length === 0 && (
                <Card className="col-span-full bg-transparent border-none">
                  <CardHeader className="text-center py-12">
                    <CardTitle>No skills</CardTitle>
                    <CardDescription>Create your first skill.</CardDescription>
                  </CardHeader>
                </Card>
              )}
            </div>
          </section>

          <section className="flex flex-col gap-4 mt-8">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">Shared Skills</h2>
              <div className="flex-1 h-px bg-border" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {shared.map((skill) => (
                <SkillCard key={skill.id} skill={skill} isOwner={false} />
              ))}
              {shared.length === 0 && (
                <Card className="col-span-full bg-transparent border-none">
                  <CardHeader className="text-center py-12">
                    <CardTitle>No shared skills</CardTitle>
                    <CardDescription>
                      No public or read-only skills are currently available.
                    </CardDescription>
                  </CardHeader>
                </Card>
              )}
            </div>
          </section>
        </>
      )}

      <SkillCreateDialog open={createOpen} onOpenChange={setCreateOpen} />
      <SkillCreateDialog
        open={Boolean(editingSkill)}
        onOpenChange={(open) => {
          if (!open) setEditingSkill(null);
        }}
        initialSkill={editingSkill}
      />
    </div>
  );
}
