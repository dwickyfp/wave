"use client";

import { KnowledgeSummary, KnowledgeVisibility } from "app-types/knowledge";
import { fetcher } from "lib/utils";
import { BrainIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { Button } from "ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "ui/card";
import { KnowledgeCard } from "./knowledge-card";
import { KnowledgeCreateDialog } from "./knowledge-create-dialog";

interface Props {
  initialMine: KnowledgeSummary[];
  initialShared: KnowledgeSummary[];
  userId: string;
}

export function KnowledgeList({ initialMine, initialShared, userId }: Props) {
  const [createOpen, setCreateOpen] = useState(false);
  const [editLoading, setEditLoading] = useState<string | null>(null);
  const [visibilityChangeLoading, setVisibilityChangeLoading] = useState<
    string | null
  >(null);

  const { data, mutate } = useSWR<KnowledgeSummary[]>(
    "/api/knowledge?filters=mine,shared",
    fetcher,
    {
      fallbackData: [...initialMine, ...initialShared],
    },
  );

  const updateVisibility = async (
    groupId: string,
    visibility: KnowledgeVisibility,
  ) => {
    setVisibilityChangeLoading(groupId);
    try {
      const response = await fetch(`/api/knowledge/${groupId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ visibility }),
      });

      if (!response.ok) throw new Error("Failed to update visibility");

      await mutate(
        (current) =>
          (current ?? []).map((group) =>
            group.id === groupId ? { ...group, visibility } : group,
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

  const updateGroupInfo = async (
    groupId: string,
    data: { name: string; description: string },
  ) => {
    setEditLoading(groupId);
    try {
      const response = await fetch(`/api/knowledge/${groupId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: data.name,
          description: data.description,
        }),
      });

      if (!response.ok) throw new Error("Failed to update group");

      const updated = (await response.json()) as KnowledgeSummary;
      await mutate(
        (current) =>
          (current ?? []).map((group) =>
            group.id === groupId ? { ...group, ...updated } : group,
          ),
        { revalidate: false },
      );
      toast.success("Knowledge group updated");
    } catch {
      toast.error("Failed to update group");
    } finally {
      setEditLoading(null);
    }
  };

  const mine = (data ?? []).filter((g) => g.userId === userId);
  const shared = (data ?? []).filter((g) => g.userId !== userId);

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6 max-w-7xl mx-auto w-full">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BrainIcon className="size-5 text-primary" />
          <h1 className="text-xl font-semibold">ContextX</h1>
          <span className="text-sm text-muted-foreground">
            Knowledge Management
          </span>
        </div>
        <Button
          onClick={() => setCreateOpen(true)}
          size="sm"
          className="gap-1.5"
        >
          <PlusIcon className="size-3.5" />
          New Group
        </Button>
      </div>

      {mine.length === 0 && shared.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center gap-4">
          <div className="p-4 rounded-full bg-primary/10">
            <BrainIcon className="size-8 text-primary" />
          </div>
          <div>
            <h2 className="font-semibold text-lg">No knowledge groups yet</h2>
            <p className="text-muted-foreground text-sm mt-1">
              Create a group to start building your private knowledge base
            </p>
          </div>
          <Button onClick={() => setCreateOpen(true)} className="gap-1.5">
            <PlusIcon className="size-4" />
            Create Knowledge Group
          </Button>
        </div>
      ) : (
        <>
          <section className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">My Knowledge Groups</h2>
              <div className="flex-1 h-px bg-border" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {mine.map((g) => (
                <KnowledgeCard
                  key={g.id}
                  group={g}
                  isOwner
                  onEditGroup={updateGroupInfo}
                  isEditLoading={editLoading === g.id}
                  onVisibilityChange={updateVisibility}
                  isVisibilityChangeLoading={visibilityChangeLoading === g.id}
                />
              ))}
              {mine.length === 0 && (
                <Card className="col-span-full bg-transparent border-none">
                  <CardHeader className="text-center py-12">
                    <CardTitle>No knowledge groups</CardTitle>
                    <CardDescription>
                      Create your first knowledge group to start building
                      context.
                    </CardDescription>
                  </CardHeader>
                </Card>
              )}
            </div>
          </section>

          <section className="flex flex-col gap-4 mt-8">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">Shared Knowledge Groups</h2>
              <div className="flex-1 h-px bg-border" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {shared.map((g) => (
                <KnowledgeCard key={g.id} group={g} isOwner={false} />
              ))}
              {shared.length === 0 && (
                <Card className="col-span-full bg-transparent border-none">
                  <CardHeader className="text-center py-12">
                    <CardTitle>No shared knowledge groups</CardTitle>
                    <CardDescription>
                      No public or read-only knowledge groups are currently
                      available.
                    </CardDescription>
                  </CardHeader>
                </Card>
              )}
            </div>
          </section>
        </>
      )}

      <KnowledgeCreateDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
