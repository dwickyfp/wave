"use client";

import { useState, useEffect } from "react";
import { SubAgent, SubAgentCreateSchema } from "app-types/subagent";
import { ChatMention } from "app-types/chat";
import { WandSparklesIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "ui/dialog";
import { Button } from "ui/button";
import { Input } from "ui/input";
import { Label } from "ui/label";
import { Textarea } from "ui/textarea";
import { AgentToolSelector } from "./agent-tool-selector";
import { GenerateSubAgentDialog } from "./generate-subagent-dialog";

interface SubAgentModalProps {
  open: boolean;
  agentId: string;
  initialSubAgent?: SubAgent;
  isLoadingTools?: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (data: {
    name: string;
    description?: string;
    instructions?: string;
    tools: ChatMention[];
    enabled: boolean;
    sortOrder: number;
  }) => void;
}

export function SubAgentModal({
  open,
  agentId,
  initialSubAgent,
  isLoadingTools = false,
  onOpenChange,
  onSave,
}: SubAgentModalProps) {
  const [name, setName] = useState(initialSubAgent?.name ?? "");
  const [description, setDescription] = useState(
    initialSubAgent?.description ?? "",
  );
  const [instructions, setInstructions] = useState(
    initialSubAgent?.instructions ?? "",
  );
  const [tools, setTools] = useState<ChatMention[]>(
    initialSubAgent?.tools ?? [],
  );
  const [openGenerateDialog, setOpenGenerateDialog] = useState(false);

  useEffect(() => {
    if (open) {
      setName(initialSubAgent?.name ?? "");
      setDescription(initialSubAgent?.description ?? "");
      setInstructions(initialSubAgent?.instructions ?? "");
      setTools(initialSubAgent?.tools ?? []);
    }
  }, [open]);

  const handleSave = () => {
    const parsed = SubAgentCreateSchema.safeParse({
      name,
      description: description || undefined,
      instructions: instructions || undefined,
      tools,
      enabled: initialSubAgent?.enabled ?? true,
      sortOrder: initialSubAgent?.sortOrder ?? 0,
    });
    if (!parsed.success) return;
    onSave(parsed.data);
    onOpenChange(false);
  };

  const handleGenerated = (data: {
    name: string;
    description: string;
    instructions: string;
  }) => {
    if (data.name) setName(data.name);
    if (data.description) setDescription(data.description);
    if (data.instructions) setInstructions(data.instructions);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg w-full">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <DialogTitle>
                {initialSubAgent ? "Edit Sub Agent" : "Add Sub Agent"}
              </DialogTitle>
              {agentId && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs gap-1"
                  onClick={() => setOpenGenerateDialog(true)}
                >
                  <WandSparklesIcon className="size-3" />
                  Generate with AI
                </Button>
              )}
            </div>
            <DialogDescription className="sr-only">
              Configure a sub agent
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 mt-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="subagent-name">Name</Label>
              <Input
                id="subagent-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Research Assistant"
                className="hover:bg-input bg-secondary/40 transition-colors border-transparent border-none! focus-visible:bg-input! ring-0!"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="subagent-description">Description</Label>
              <Input
                id="subagent-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief description of this subagent's role"
                className="hover:bg-input bg-secondary/40 transition-colors border-transparent border-none! focus-visible:bg-input! ring-0!"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="subagent-instructions">Instructions</Label>
              <Textarea
                id="subagent-instructions"
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder="System instructions for this subagent..."
                className="hover:bg-input bg-secondary/40 min-h-32 max-h-48 overflow-y-auto resize-none transition-colors border-transparent border-none! focus-visible:bg-input! ring-0!"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label>Tools</Label>
              <AgentToolSelector
                mentions={tools}
                isLoading={isLoadingTools}
                onChange={setTools}
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={!name.trim()}>
                Save
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {agentId && (
        <GenerateSubAgentDialog
          open={openGenerateDialog}
          agentId={agentId}
          onOpenChange={setOpenGenerateDialog}
          onGenerated={handleGenerated}
        />
      )}
    </>
  );
}
