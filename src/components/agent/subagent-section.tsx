"use client";

import { useState } from "react";
import { SubAgent } from "app-types/subagent";
import { ChatMention } from "app-types/chat";
import { BotIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { Button } from "ui/button";
import { Switch } from "ui/switch";
import { Label } from "ui/label";
import { SubAgentModal } from "./subagent-modal";
import { cn } from "lib/utils";

interface SubAgentSectionProps {
  agentId?: string;
  subAgents: SubAgent[];
  subAgentsEnabled: boolean;
  isLoadingTools?: boolean;
  hasEditAccess?: boolean;
  onChange: (subAgents: SubAgent[], subAgentsEnabled: boolean) => void;
}

export function SubAgentSection({
  agentId,
  subAgents,
  subAgentsEnabled,
  isLoadingTools = false,
  hasEditAccess = true,
  onChange,
}: SubAgentSectionProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editingSubAgent, setEditingSubAgent] = useState<SubAgent | undefined>(
    undefined,
  );

  const handleToggle = (enabled: boolean) => {
    onChange(subAgents, enabled);
  };

  const handleSave = (data: {
    name: string;
    description?: string;
    instructions?: string;
    tools: ChatMention[];
    enabled: boolean;
    sortOrder: number;
  }) => {
    if (editingSubAgent) {
      const updated = subAgents.map((sa) =>
        sa.id === editingSubAgent.id ? { ...sa, ...data } : sa,
      );
      onChange(updated, subAgentsEnabled);
    } else {
      const newSubAgent: SubAgent = {
        id: `temp_${Date.now()}`,
        agentId: agentId ?? "",
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      };
      onChange([...subAgents, newSubAgent], subAgentsEnabled);
    }
    setEditingSubAgent(undefined);
  };

  const handleDelete = (id: string) => {
    onChange(
      subAgents.filter((sa) => sa.id !== id),
      subAgentsEnabled,
    );
  };

  const openAdd = () => {
    setEditingSubAgent(undefined);
    setModalOpen(true);
  };

  const openEdit = (subAgent: SubAgent) => {
    setEditingSubAgent(subAgent);
    setModalOpen(true);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <Label className="text-base">Subagents</Label>
          <p className="text-xs text-muted-foreground">
            Delegate tasks to specialized sub-agents during chat
          </p>
        </div>
        <Switch
          checked={subAgentsEnabled}
          onCheckedChange={handleToggle}
          disabled={!hasEditAccess}
        />
      </div>

      {subAgentsEnabled && (
        <div className="flex flex-col gap-2">
          {subAgents.map((sa) => (
            <div
              key={sa.id}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-secondary/40 border border-transparent hover:border-input transition-colors"
            >
              <div className="flex items-center justify-center size-7 rounded-md bg-primary/10 text-primary shrink-0">
                <BotIcon className="size-3.5" />
              </div>
              <div className="flex flex-col flex-1 min-w-0">
                <span className="text-sm font-medium truncate">{sa.name}</span>
                {sa.description && (
                  <span className="text-xs text-muted-foreground truncate">
                    {sa.description}
                  </span>
                )}
              </div>
              <div
                className={cn(
                  "size-2 rounded-full shrink-0",
                  sa.enabled ? "bg-green-500" : "bg-muted-foreground",
                )}
              />
              {hasEditAccess && (
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={() => openEdit(sa)}
                  >
                    <PencilIcon className="size-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 hover:text-destructive"
                    onClick={() => handleDelete(sa.id)}
                  >
                    <Trash2Icon className="size-3" />
                  </Button>
                </div>
              )}
            </div>
          ))}

          {hasEditAccess && (
            <Button
              variant="outline"
              className="border-dashed gap-2 mt-1"
              onClick={openAdd}
            >
              <PlusIcon className="size-3.5" />
              Add Sub Agent
            </Button>
          )}
        </div>
      )}

      <SubAgentModal
        open={modalOpen}
        agentId={agentId ?? ""}
        initialSubAgent={editingSubAgent}
        isLoadingTools={isLoadingTools}
        onOpenChange={(open) => {
          setModalOpen(open);
          if (!open) setEditingSubAgent(undefined);
        }}
        onSave={handleSave}
      />
    </div>
  );
}
