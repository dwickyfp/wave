"use client";

import { TeamDetail, TeamMember, TeamResourceShare } from "app-types/team";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { fetcher } from "lib/utils";
import { Badge } from "ui/badge";
import { Button } from "ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "ui/card";
import { Input } from "ui/input";
import { Textarea } from "ui/textarea";
import { Users, ChevronsUpDown, Check } from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "ui/select";
import { cn } from "lib/utils";

interface TeamDetailPageProps {
  initialTeam: TeamDetail;
  currentUserId: string;
}

export function TeamDetailPage({
  initialTeam,
  currentUserId,
}: TeamDetailPageProps) {
  const router = useRouter();
  const { data: team = initialTeam, mutate } = useSWR<TeamDetail>(
    `/api/teams/${initialTeam.id}`,
    fetcher,
    { fallbackData: initialTeam },
  );

  const [selectedUser, setSelectedUser] = useState<{
    id: string;
    name: string;
    email: string;
  } | null>(null);
  const [userSearchOpen, setUserSearchOpen] = useState(false);
  const [memberRole, setMemberRole] = useState<"admin" | "member">("member");
  const [submittingMember, setSubmittingMember] = useState(false);
  const [savingTeam, setSavingTeam] = useState(false);
  const [name, setName] = useState(initialTeam.name);
  const [description, setDescription] = useState(initialTeam.description || "");

  const isOwner = team.role === "owner";
  const canManageMembers = team.role === "owner" || team.role === "admin";

  const { data: allUsers = [] } = useSWR<
    { id: string; name: string; email: string }[]
  >(canManageMembers ? "/api/users" : null, fetcher);

  const availableUsers = useMemo(
    () => allUsers.filter((u) => !team.members.some((m) => m.userId === u.id)),
    [allUsers, team.members],
  );

  const currentMember = useMemo(
    () => team.members.find((member) => member.userId === currentUserId),
    [team.members, currentUserId],
  );

  const addMember = async () => {
    if (!selectedUser) return;
    setSubmittingMember(true);
    try {
      const response = await fetch(`/api/teams/${team.id}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: selectedUser.email, role: memberRole }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Failed to add member");
      }

      setSelectedUser(null);
      setMemberRole("member");
      await mutate();
      toast.success("Member added");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to add member",
      );
    } finally {
      setSubmittingMember(false);
    }
  };

  const removeMember = async (member: TeamMember) => {
    try {
      const response = await fetch(
        `/api/teams/${team.id}/members/${member.userId}`,
        {
          method: "DELETE",
        },
      );
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Failed to remove member");
      }
      await mutate();
      toast.success("Member removed");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to remove member",
      );
    }
  };

  const changeRole = async (member: TeamMember, role: "admin" | "member") => {
    try {
      const response = await fetch(
        `/api/teams/${team.id}/members/${member.userId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role }),
        },
      );
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Failed to update role");
      }
      await mutate();
      toast.success("Role updated");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to update role",
      );
    }
  };

  const removeResourceShare = async (resource: TeamResourceShare) => {
    try {
      const response = await fetch(`/api/teams/${team.id}/resources`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resourceType: resource.resourceType,
          resourceId: resource.resourceId,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Failed to remove resource");
      }
      await mutate();
      toast.success("Resource removed from team");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to remove resource",
      );
    }
  };

  const saveTeam = async () => {
    setSavingTeam(true);
    try {
      const response = await fetch(`/api/teams/${team.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description: description || undefined,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Failed to update team");
      }
      await mutate();
      toast.success("Team updated");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to update team",
      );
    } finally {
      setSavingTeam(false);
    }
  };

  const deleteTeam = async () => {
    if (!window.confirm("Delete this team? This cannot be undone.")) {
      return;
    }

    try {
      const response = await fetch(`/api/teams/${team.id}`, {
        method: "DELETE",
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Failed to delete team");
      }

      toast.success("Team deleted");
      router.push("/teams");
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to delete team",
      );
    }
  };

  return (
    <div className="max-w-6xl mx-auto w-full p-6 md:p-8 space-y-6">
      <div className="flex items-center gap-2">
        <Users className="size-5 text-primary" />
        <h1 className="text-2xl font-semibold">{team.name}</h1>
        <Badge variant="outline" className="capitalize">
          {currentMember?.role || team.role}
        </Badge>
      </div>

      {isOwner ? (
        <Card>
          <CardHeader>
            <CardTitle>Team settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <Textarea
              rows={4}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
            <div className="flex justify-end">
              <div className="flex items-center gap-2">
                <Button variant="destructive" onClick={deleteTeam}>
                  Delete team
                </Button>
                <Button onClick={saveTeam} disabled={savingTeam}>
                  {savingTeam ? "Saving..." : "Save team"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle>Members</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {canManageMembers ? (
              <div className="grid gap-3 md:grid-cols-[1fr_140px_auto]">
                <Popover open={userSearchOpen} onOpenChange={setUserSearchOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={userSearchOpen}
                      className="justify-between font-normal"
                    >
                      {selectedUser ? selectedUser.name : "Select user..."}
                      <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[300px] p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Search by name..." />
                      <CommandList>
                        <CommandEmpty>No users found.</CommandEmpty>
                        <CommandGroup>
                          {availableUsers.map((user) => (
                            <CommandItem
                              key={user.id}
                              value={user.name}
                              onSelect={() => {
                                setSelectedUser(user);
                                setUserSearchOpen(false);
                              }}
                            >
                              <Check
                                className={cn(
                                  "mr-2 size-4",
                                  selectedUser?.id === user.id
                                    ? "opacity-100"
                                    : "opacity-0",
                                )}
                              />
                              <div className="min-w-0">
                                <p className="truncate">{user.name}</p>
                                <p className="text-xs text-muted-foreground truncate">
                                  {user.email}
                                </p>
                              </div>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                <Select
                  value={memberRole}
                  onValueChange={(value) =>
                    setMemberRole(value as "admin" | "member")
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="member">Member</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  onClick={addMember}
                  disabled={submittingMember || !selectedUser}
                >
                  {submittingMember ? "Adding..." : "Add user"}
                </Button>
              </div>
            ) : null}

            <div className="space-y-3">
              {team.members.map((member) => {
                const canRemove =
                  member.role !== "owner" &&
                  (team.role === "owner" ||
                    (team.role === "admin" && member.role === "member"));

                return (
                  <div
                    key={member.userId}
                    className="flex items-center justify-between gap-3 rounded-lg border p-3"
                  >
                    <div className="min-w-0">
                      <p className="font-medium truncate">{member.name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {member.email}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap justify-end">
                      <Badge variant="outline" className="capitalize">
                        {member.role}
                      </Badge>
                      {isOwner && member.role !== "owner" ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() =>
                            changeRole(
                              member,
                              member.role === "admin" ? "member" : "admin",
                            )
                          }
                        >
                          {member.role === "admin"
                            ? "Make member"
                            : "Make admin"}
                        </Button>
                      ) : null}
                      {canRemove ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => removeMember(member)}
                        >
                          Remove
                        </Button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Shared resources</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {team.resources.length ? (
              team.resources.map((resource) => (
                <div
                  key={resource.id}
                  className="flex items-center justify-between gap-3 rounded-lg border p-3"
                >
                  <div className="min-w-0">
                    <p className="font-medium truncate">
                      {resource.resourceName || resource.resourceId}
                    </p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                      <Badge variant="secondary" className="capitalize">
                        {resource.resourceType}
                      </Badge>
                      {resource.resourceVisibility ? (
                        <Badge variant="outline" className="capitalize">
                          {resource.resourceVisibility}
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                  {canManageMembers ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => removeResourceShare(resource)}
                    >
                      Remove
                    </Button>
                  ) : null}
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">
                No resources shared to this team yet.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
