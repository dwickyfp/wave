"use client";

import {
  SkillGroupSummary,
  SkillSummary,
  SkillVisibility,
} from "app-types/skill";
import { fetcher } from "lib/utils";
import { FolderKanbanIcon, PlusIcon, SparklesIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { Button } from "ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "ui/card";
import { notify } from "lib/notify";
import { SkillCard } from "./skill-card";
import { SkillCreateDialog } from "./skill-create-dialog";
import { SkillGroupCard } from "./skill-group-card";
import { SkillGroupCreateDialog } from "./skill-group-create-dialog";

interface SkillListProps {
  initialMine: SkillSummary[];
  initialShared: SkillSummary[];
  initialMineGroups: SkillGroupSummary[];
  initialSharedGroups: SkillGroupSummary[];
  userId: string;
}

async function readErrorMessage(response: Response, fallback: string) {
  try {
    const payload = await response.json();
    if (typeof payload?.error === "string" && payload.error) {
      return payload.error;
    }
  } catch {}

  return fallback;
}

export function SkillList({
  initialMine,
  initialShared,
  initialMineGroups,
  initialSharedGroups,
  userId,
}: SkillListProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [editingSkill, setEditingSkill] = useState<SkillSummary | null>(null);
  const [visibilityChangeLoading, setVisibilityChangeLoading] = useState<
    string | null
  >(null);
  const [groupVisibilityChangeLoading, setGroupVisibilityChangeLoading] =
    useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState<string | null>(null);
  const [deleteGroupLoading, setDeleteGroupLoading] = useState<string | null>(
    null,
  );

  const { data: skills, mutate: mutateSkills } = useSWR<SkillSummary[]>(
    "/api/skill?filters=mine,shared",
    fetcher,
    {
      fallbackData: [...initialMine, ...initialShared],
    },
  );
  const { data: groups, mutate: mutateGroups } = useSWR<SkillGroupSummary[]>(
    "/api/skill-group?filters=mine,shared",
    fetcher,
    {
      fallbackData: [...initialMineGroups, ...initialSharedGroups],
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
      if (!response.ok) {
        const message = await readErrorMessage(
          response,
          "Failed to update visibility",
        );
        throw new Error(message);
      }

      await mutateSkills(
        (current) =>
          (current ?? []).map((skill) =>
            skill.id === skillId ? { ...skill, visibility } : skill,
          ),
        { revalidate: false },
      );
      toast.success("Visibility updated");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to update visibility",
      );
    } finally {
      setVisibilityChangeLoading(null);
    }
  };

  const updateGroupVisibility = async (
    groupId: string,
    visibility: SkillVisibility,
  ) => {
    setGroupVisibilityChangeLoading(groupId);
    try {
      const response = await fetch(`/api/skill-group/${groupId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visibility }),
      });
      if (!response.ok) {
        const message = await readErrorMessage(
          response,
          "Failed to update visibility",
        );
        throw new Error(message);
      }

      await mutateGroups(
        (current) =>
          (current ?? []).map((group) =>
            group.id === groupId ? { ...group, visibility } : group,
          ),
        { revalidate: false },
      );
      toast.success("Visibility updated");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to update visibility",
      );
    } finally {
      setGroupVisibilityChangeLoading(null);
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

      await mutateSkills(
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

  const deleteGroup = async (groupId: string) => {
    const ok = await notify.confirm({
      description:
        "Delete this skill group? Skills inside the group will remain available.",
    });
    if (!ok) return;

    setDeleteGroupLoading(groupId);
    try {
      const response = await fetch(`/api/skill-group/${groupId}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Failed to delete skill group");

      await mutateGroups(
        (current) => (current ?? []).filter((group) => group.id !== groupId),
        { revalidate: false },
      );
      toast.success("Skill group deleted");
    } catch {
      toast.error("Failed to delete skill group");
    } finally {
      setDeleteGroupLoading(null);
    }
  };

  const mineSkills = (skills ?? []).filter((skill) => skill.userId === userId);
  const sharedSkills = (skills ?? []).filter(
    (skill) => skill.userId !== userId,
  );
  const mineGroups = (groups ?? []).filter((group) => group.userId === userId);
  const sharedGroups = (groups ?? []).filter(
    (group) => group.userId !== userId,
  );
  const hasAnyItems =
    mineSkills.length > 0 ||
    sharedSkills.length > 0 ||
    mineGroups.length > 0 ||
    sharedGroups.length > 0;

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6 max-w-7xl mx-auto w-full">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <SparklesIcon className="size-5 text-primary" />
          <h1 className="text-xl font-semibold">Skills</h1>
          <span className="text-sm text-muted-foreground">
            Skills and Groups
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => setCreateGroupOpen(true)}
            size="sm"
            variant="outline"
            className="gap-1.5"
            data-testid="skill-groups-new-button"
          >
            <FolderKanbanIcon className="size-3.5" />
            New Group
          </Button>
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
      </div>

      {!hasAnyItems ? (
        <div className="flex flex-col items-center justify-center py-24 text-center gap-4">
          <div className="p-4 rounded-full bg-primary/10">
            <FolderKanbanIcon className="size-8 text-primary" />
          </div>
          <div>
            <h2 className="font-semibold text-lg">No skills or groups yet</h2>
            <p className="text-muted-foreground text-sm mt-1">
              Create reusable skills or organize them into groups for a single
              case.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={() => setCreateGroupOpen(true)}
              variant="outline"
              className="gap-1.5"
            >
              <FolderKanbanIcon className="size-4" />
              Create Group
            </Button>
            <Button
              onClick={() => setCreateOpen(true)}
              className="gap-1.5"
              data-testid="skills-create-empty-button"
            >
              <PlusIcon className="size-4" />
              Create Skill
            </Button>
          </div>
        </div>
      ) : (
        <>
          <section className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">My Skill Groups</h2>
              <div className="flex-1 h-px bg-border" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {mineGroups.map((group) => (
                <SkillGroupCard
                  key={group.id}
                  group={group}
                  isOwner
                  onDelete={deleteGroup}
                  onVisibilityChange={updateGroupVisibility}
                  isVisibilityChangeLoading={
                    groupVisibilityChangeLoading === group.id
                  }
                  isDeleteLoading={deleteGroupLoading === group.id}
                />
              ))}
              {mineGroups.length === 0 && (
                <Card className="col-span-full bg-transparent border-none">
                  <CardHeader className="text-center py-12">
                    <CardTitle>No skill groups</CardTitle>
                    <CardDescription>
                      Create your first skill group.
                    </CardDescription>
                  </CardHeader>
                </Card>
              )}
            </div>
          </section>

          <section className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">My Skills</h2>
              <div className="flex-1 h-px bg-border" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {mineSkills.map((skill) => (
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
              {mineSkills.length === 0 && (
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
              <h2 className="text-lg font-semibold">Shared Skill Groups</h2>
              <div className="flex-1 h-px bg-border" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {sharedGroups.map((group) => (
                <SkillGroupCard key={group.id} group={group} isOwner={false} />
              ))}
              {sharedGroups.length === 0 && (
                <Card className="col-span-full bg-transparent border-none">
                  <CardHeader className="text-center py-12">
                    <CardTitle>No shared skill groups</CardTitle>
                    <CardDescription>
                      No public or read-only skill groups are currently
                      available.
                    </CardDescription>
                  </CardHeader>
                </Card>
              )}
            </div>
          </section>

          <section className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">Shared Skills</h2>
              <div className="flex-1 h-px bg-border" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {sharedSkills.map((skill) => (
                <SkillCard key={skill.id} skill={skill} isOwner={false} />
              ))}
              {sharedSkills.length === 0 && (
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
      <SkillGroupCreateDialog
        open={createGroupOpen}
        onOpenChange={setCreateGroupOpen}
      />
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
