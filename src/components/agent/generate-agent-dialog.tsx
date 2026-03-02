"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { experimental_useObject } from "@ai-sdk/react";
import { ChatModel } from "app-types/chat";
import { AgentGenerateSchema } from "app-types/agent";
import { handleErrorWithToast } from "ui/shared-toast";
import { CommandIcon, CornerRightUpIcon, NetworkIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "ui/dialog";
import { Button } from "ui/button";
import { Textarea } from "ui/textarea";
import { Switch } from "ui/switch";
import { Label } from "ui/label";
import { MessageLoading } from "ui/message-loading";
import { SelectModel } from "@/components/select-model";
import { appStore } from "@/app/store";

interface GenerateAgentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAgentChange: (data: any) => void;
  onToolsGenerated?: (tools: string[]) => void;
}

export function GenerateAgentDialog({
  open,
  onOpenChange,
  onAgentChange,
  onToolsGenerated,
}: GenerateAgentDialogProps) {
  const t = useTranslations();
  const [generateModel, setGenerateModel] = useState<ChatModel | undefined>(
    appStore.getState().chatModel,
  );
  const [generateAgentPrompt, setGenerateAgentPrompt] = useState("");
  const [submittedPrompt, setSubmittedPrompt] = useState("");
  const [enableSubAgents, setEnableSubAgents] = useState(false);

  const { submit, isLoading, object } = experimental_useObject({
    api: "/api/agent/ai",
    schema: AgentGenerateSchema,
    onFinish(event) {
      if (event.error) {
        handleErrorWithToast(event.error);
      }
      if (event.object) {
        onAgentChange(event.object);
        if (event.object.tools && onToolsGenerated) {
          onToolsGenerated(event.object.tools as string[]);
        }
      }
      // Close dialog after generation completes
      onOpenChange(false);
      setGenerateAgentPrompt("");
      setSubmittedPrompt("");
      // Reset to current global default model
      setGenerateModel(appStore.getState().chatModel);
    },
  });

  const submitGenerateAgent = () => {
    setSubmittedPrompt(generateAgentPrompt);
    submit({
      message: generateAgentPrompt,
      chatModel: generateModel,
      enableSubAgents,
    } as any);
    setGenerateAgentPrompt(""); // Clear textarea immediately after submit
    // Don't close dialog immediately - will close in onFinish
  };

  useEffect(() => {
    if (object && isLoading) {
      onAgentChange(object);
    }
  }, [object, isLoading, onAgentChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="xl:max-w-[40vw] w-full max-w-full">
        <DialogHeader>
          <DialogTitle>Generate Agent</DialogTitle>
          <DialogDescription className="sr-only">
            Generate Agent
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-6 w-full">
          <div className="px-4">
            <p className="bg-secondary rounded-lg max-w-2/3 p-4">
              {t("Agent.generateAgentDetailedGreeting")}
            </p>
          </div>

          <div className="flex justify-end px-4">
            <p className="text-sm bg-primary text-primary-foreground py-4 px-6 rounded-lg">
              {isLoading && submittedPrompt ? (
                submittedPrompt
              ) : (
                <MessageLoading className="size-4" />
              )}
            </p>
          </div>

          {/* Enable SubAgents toggle */}
          <div className="flex items-start gap-3 px-4 py-3 rounded-lg border bg-secondary/30">
            <NetworkIcon className="size-4 mt-0.5 shrink-0 text-muted-foreground" />
            <div className="flex flex-col gap-1 flex-1 min-w-0">
              <Label
                htmlFor="enable-subagents-switch"
                className="text-sm font-medium cursor-pointer"
              >
                Enable SubAgents
              </Label>
              <p className="text-xs text-muted-foreground leading-relaxed">
                AI will design an orchestrator agent with specialized subagents
                that work as a team. Each subagent gets its own instructions and
                tools, and the main agent will know when to delegate to each
                one.
              </p>
            </div>
            <Switch
              id="enable-subagents-switch"
              checked={enableSubAgents}
              disabled={isLoading}
              onCheckedChange={setEnableSubAgents}
            />
          </div>

          <div className="relative flex flex-col border rounded-lg p-4">
            <Textarea
              value={generateAgentPrompt}
              autoFocus
              placeholder="input prompt here..."
              disabled={isLoading}
              onChange={(e) => setGenerateAgentPrompt(e.target.value)}
              data-testid="agent-generate-agent-prompt-textarea"
              onKeyDown={(e) => {
                if (e.key === "Enter" && e.metaKey && !isLoading) {
                  e.preventDefault();
                  submitGenerateAgent();
                }
              }}
              className="w-full break-all pb-6 border-none! ring-0! resize-none min-h-24 max-h-48 overflow-y-auto placeholder:text-xs transition-colors"
            />
            <div className="flex justify-end items-center gap-2">
              <SelectModel
                showProvider
                onSelect={(model) => setGenerateModel(model)}
              />
              <Button
                disabled={!generateAgentPrompt.trim() || isLoading}
                size="sm"
                data-testid="agent-generate-agent-prompt-submit-button"
                onClick={submitGenerateAgent}
                className="text-xs"
              >
                <span className="mr-1">
                  {isLoading ? "Generating..." : "Send"}
                </span>
                {isLoading ? (
                  <div className="size-3 border border-current border-t-transparent rounded-full animate-spin" />
                ) : (
                  <>
                    <CommandIcon className="size-3" />
                    <CornerRightUpIcon className="size-3" />
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
