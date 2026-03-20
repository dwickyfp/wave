"use client";

import { mutateSkillGroups } from "@/hooks/queries/use-skill-group";
import { useSkills } from "@/hooks/queries/use-skill";
import type {
  SkillGroup,
  SkillSummary,
  SkillVisibility,
} from "app-types/skill";
import { format } from "date-fns";
import { notify } from "lib/notify";
import {
  ArrowLeftIcon,
  FolderKanbanIcon,
  Loader2Icon,
  PlusIcon,
  SparklesIcon,
  Trash2Icon,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "ui/badge";
import { Button } from "ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "ui/card";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from "ui/command";
import { Input } from "ui/input";
import { Label } from "ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "ui/select";
import { Textarea } from "ui/textarea";
import { SkillCreateDialog } from "./skill-create-dialog";

interface SkillGroupDetailPageProps {
  group: SkillGroup;
  initialSkills: SkillSummary[];
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

export function SkillGroupDetailPage({
  group,
  initialSkills,
  userId,
}: SkillGroupDetailPageProps) {
  const router = useRouter();
  const isOwner = group.userId === userId;
  const [groupState, setGroupState] = useState(group);
  const [skills, setSkills] = useState(initialSkills);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [savingGroup, setSavingGroup] = useState(false);
  const [groupMutationLoading, setGroupMutationLoading] = useState(false);
  const [skillMutationId, setSkillMutationId] = useState<string | null>(null);
  const { data: availableSkills } = useSkills();

  const selectedIds = useMemo(
    () => new Set(skills.map((skill) => skill.id)),
    [skills],
  );
  const unselectedSkills = (availableSkills ?? []).filter(
    (skill) => !selectedIds.has(skill.id),
  );
  const hasGroupChanges =
    groupState.name !== group.name ||
    (groupState.description ?? "") !== (group.description ?? "") ||
    groupState.visibility !== group.visibility;

  const saveGroup = async () => {
    const name = groupState.name.trim();
    if (!name) {
      toast.error("Name is required");
      return;
    }

    setSavingGroup(true);
    try {
      const response = await fetch(`/api/skill-group/${group.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description: groupState.description?.trim() || undefined,
          visibility: groupState.visibility,
        }),
      });

      if (!response.ok) {
        const message = await readErrorMessage(
          response,
          "Failed to update skill group",
        );
        throw new Error(message);
      }

      const updatedGroup = (await response.json()) as SkillGroup;
      setGroupState((prev) => ({ ...prev, ...updatedGroup }));
      await mutateSkillGroups();
      toast.success("Skill group updated");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to update skill group",
      );
    } finally {
      setSavingGroup(false);
    }
  };

  const addSkill = async (skill: SkillSummary) => {
    setSkillMutationId(skill.id);
    try {
      const response = await fetch(`/api/skill-group/${group.id}/skill`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skillId: skill.id }),
      });

      if (!response.ok) {
        const message = await readErrorMessage(
          response,
          "Failed to add skill to group",
        );
        throw new Error(message);
      }

      setSkills((current) => [...current, skill]);
      setPickerOpen(false);
      await mutateSkillGroups();
      toast.success("Skill added to group");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to add skill to group",
      );
    } finally {
      setSkillMutationId(null);
    }
  };

  const removeSkill = async (skillId: string) => {
    setSkillMutationId(skillId);
    try {
      const response = await fetch(`/api/skill-group/${group.id}/skill`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skillId }),
      });

      if (!response.ok) {
        const message = await readErrorMessage(
          response,
          "Failed to remove skill from group",
        );
        throw new Error(message);
      }

      setSkills((current) => current.filter((skill) => skill.id !== skillId));
      await mutateSkillGroups();
      toast.success("Skill removed from group");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to remove skill from group",
      );
    } finally {
      setSkillMutationId(null);
    }
  };

  const deleteGroup = async () => {
    const ok = await notify.confirm({
      description:
        "Delete this skill group? Skills inside the group will remain available.",
    });
    if (!ok) return;

    setGroupMutationLoading(true);
    try {
      const response = await fetch(`/api/skill-group/${group.id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const message = await readErrorMessage(
          response,
          "Failed to delete skill group",
        );
        throw new Error(message);
      }

      await mutateSkillGroups();
      toast.success("Skill group deleted");
      router.push("/skills");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to delete skill group",
      );
    } finally {
      setGroupMutationLoading(false);
    }
  };

  const handleCreatedSkill = async (
    createdSkill: SkillSummary,
    options: { isEdit: boolean },
  ) => {
    if (options.isEdit) {
      setSkills((current) =>
        current.map((skill) =>
          skill.id === createdSkill.id ? createdSkill : skill,
        ),
      );
      return;
    }

    const response = await fetch(`/api/skill-group/${group.id}/skill`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skillId: createdSkill.id }),
    });

    if (!response.ok) {
      const message = await readErrorMessage(
        response,
        "Skill was created but could not be linked to the group",
      );
      throw new Error(message);
    }

    setSkills((current) => [...current, createdSkill]);
    await mutateSkillGroups();
  };

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6 max-w-5xl mx-auto w-full">
      <div className="sticky top-0 z-30 -mx-4 border-b bg-background/95 px-4 py-4 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:-mx-6 md:px-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex flex-col gap-2">
            <Link
              href="/skills"
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeftIcon className="size-4" />
              Back to Skills
            </Link>
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                <FolderKanbanIcon className="size-5" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold">{groupState.name}</h1>
                <p className="text-sm text-muted-foreground">
                  {skills.length} skills · Updated{" "}
                  {format(groupState.updatedAt || new Date(), "MMM d, yyyy")}
                </p>
              </div>
            </div>
          </div>

          {isOwner && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => setCreateOpen(true)}
                className="gap-2"
              >
                <PlusIcon className="size-4" />
                Create Skill
              </Button>
              <Button
                variant="destructive"
                onClick={deleteGroup}
                disabled={groupMutationLoading}
                className="gap-2"
              >
                {groupMutationLoading ? (
                  <Loader2Icon className="size-4 animate-spin" />
                ) : (
                  <Trash2Icon className="size-4" />
                )}
                Delete Group
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Group Details</CardTitle>
            <CardDescription>
              Manage this group and decide which skills are bundled together for
              a single case.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="skill-group-detail-name">
                  Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="skill-group-detail-name"
                  value={groupState.name}
                  onChange={(event) =>
                    setGroupState((prev) => ({
                      ...prev,
                      name: event.target.value,
                    }))
                  }
                  disabled={!isOwner}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label>Visibility</Label>
                <Select
                  value={groupState.visibility}
                  onValueChange={(value) =>
                    setGroupState((prev) => ({
                      ...prev,
                      visibility: value as SkillVisibility,
                    }))
                  }
                  disabled={!isOwner}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="private">Private</SelectItem>
                    <SelectItem value="readonly">Read-only</SelectItem>
                    <SelectItem value="public">Public</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="skill-group-detail-description">
                Description
              </Label>
              <Textarea
                id="skill-group-detail-description"
                value={groupState.description ?? ""}
                onChange={(event) =>
                  setGroupState((prev) => ({
                    ...prev,
                    description: event.target.value,
                  }))
                }
                rows={4}
                disabled={!isOwner}
              />
            </div>

            <div className="flex items-center justify-between gap-3 flex-wrap rounded-lg border bg-muted/20 p-3">
              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium">
                  Owner: {groupState.userName || (isOwner ? "You" : "Unknown")}
                </span>
                <span className="text-xs text-muted-foreground">
                  Shared visibility follows the same rules as standalone skills.
                </span>
              </div>
              {isOwner && (
                <Button
                  onClick={saveGroup}
                  disabled={!hasGroupChanges || savingGroup}
                >
                  {savingGroup ? "Saving..." : "Save Changes"}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="gap-4">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="flex flex-col gap-1">
                <CardTitle>Members</CardTitle>
                <CardDescription>
                  Add reusable skills to this group or create a new one directly
                  from here.
                </CardDescription>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="secondary">{skills.length} linked skills</Badge>
                <Badge variant="outline" className="capitalize">
                  {groupState.visibility}
                </Badge>
              </div>
            </div>

            {isOwner && (
              <div className="flex gap-2 flex-wrap">
                <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="gap-2">
                      <PlusIcon className="size-4" />
                      Add Existing Skill
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="p-0 w-80" align="start">
                    <Command>
                      <CommandInput placeholder="Search skills..." />
                      <CommandEmpty>No skills found</CommandEmpty>
                      <CommandGroup className="max-h-72 overflow-y-auto">
                        {unselectedSkills.map((skill) => (
                          <CommandItem
                            key={skill.id}
                            value={`${skill.title} ${skill.description ?? ""}`}
                            onSelect={() => addSkill(skill)}
                            disabled={skillMutationId === skill.id}
                          >
                            <div className="flex items-start gap-2 w-full">
                              <SparklesIcon className="size-3.5 mt-0.5 text-primary shrink-0" />
                              <div className="min-w-0 flex-1">
                                <p className="text-sm truncate">
                                  {skill.title}
                                </p>
                                <p className="text-xs text-muted-foreground truncate">
                                  {skill.description || "No description"}
                                </p>
                              </div>
                            </div>
                          </CommandItem>
                        ))}
                        {unselectedSkills.length === 0 && (
                          <div className="px-3 py-6 text-xs text-center text-muted-foreground">
                            All available skills are already linked
                          </div>
                        )}
                      </CommandGroup>
                    </Command>
                  </PopoverContent>
                </Popover>

                <Button onClick={() => setCreateOpen(true)} className="gap-2">
                  <SparklesIcon className="size-4" />
                  New Skill In Group
                </Button>
              </div>
            )}
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {skills.map((skill) => (
                <div
                  key={skill.id}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-secondary/40 border border-transparent hover:border-input transition-colors"
                >
                  <div className="flex items-center justify-center size-8 rounded-md bg-primary/10 text-primary shrink-0">
                    <SparklesIcon className="size-4" />
                  </div>
                  <div className="flex flex-col flex-1 min-w-0">
                    <span className="text-sm font-medium truncate">
                      {skill.title}
                    </span>
                    <span className="text-xs text-muted-foreground truncate">
                      {skill.description || "No description"}
                    </span>
                  </div>
                  <Badge variant="secondary" className="capitalize text-xs">
                    {skill.visibility}
                  </Badge>
                  {isOwner && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 hover:text-destructive"
                      onClick={() => removeSkill(skill.id)}
                      disabled={skillMutationId === skill.id}
                    >
                      {skillMutationId === skill.id ? (
                        <Loader2Icon className="size-4 animate-spin" />
                      ) : (
                        <Trash2Icon className="size-4" />
                      )}
                    </Button>
                  )}
                </div>
              ))}
            </div>

            {skills.length === 0 && (
              <div className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                No skills in this group yet.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <SkillCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSkillSaved={handleCreatedSkill}
      />
    </div>
  );
}
