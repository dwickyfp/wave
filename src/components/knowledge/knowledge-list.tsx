"use client";

import { KnowledgeSummary, KnowledgeVisibility } from "app-types/knowledge";
import { fetcher } from "lib/utils";
import { BrainIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { Button } from "ui/button";
import { KnowledgeCard } from "./knowledge-card";
import { KnowledgeCreateDialog } from "./knowledge-create-dialog";

interface Props {
  initialMine: KnowledgeSummary[];
  initialShared: KnowledgeSummary[];
  userId: string;
}

export function KnowledgeList({ initialMine, initialShared, userId }: Props) {
  const [createOpen, setCreateOpen] = useState(false);
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
          {mine.length > 0 && (
            <section>
              <h2 className="text-sm font-medium text-muted-foreground mb-3">
                My Knowledge Groups
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {mine.map((g) => (
                  <KnowledgeCard
                    key={g.id}
                    group={g}
                    isOwner
                    onVisibilityChange={updateVisibility}
                    isVisibilityChangeLoading={visibilityChangeLoading === g.id}
                  />
                ))}
              </div>
            </section>
          )}

          {shared.length > 0 && (
            <section>
              <h2 className="text-sm font-medium text-muted-foreground mb-3">
                Shared with me
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {shared.map((g) => (
                  <KnowledgeCard key={g.id} group={g} isOwner={false} />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      <KnowledgeCreateDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
