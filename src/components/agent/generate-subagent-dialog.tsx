"use client";

import { useState } from "react";
import { experimental_useObject } from "@ai-sdk/react";
import { SubAgentGenerateSchema } from "app-types/subagent";
import { handleErrorWithToast } from "ui/shared-toast";
import { CommandIcon, CornerRightUpIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "ui/dialog";
import { Button } from "ui/button";
import { Textarea } from "ui/textarea";
import { MessageLoading } from "ui/message-loading";
import { SelectModel } from "@/components/select-model";
import { appStore } from "@/app/store";
import { ChatModel } from "app-types/chat";

interface GenerateSubAgentDialogProps {
  open: boolean;
  agentId: string;
  onOpenChange: (open: boolean) => void;
  onGenerated: (data: {
    name: string;
    description: string;
    instructions: string;
  }) => void;
}

export function GenerateSubAgentDialog({
  open,
  agentId,
  onOpenChange,
  onGenerated,
}: GenerateSubAgentDialogProps) {
  const [generateModel, setGenerateModel] = useState<ChatModel | undefined>(
    appStore.getState().chatModel,
  );
  const [prompt, setPrompt] = useState("");
  const [submittedPrompt, setSubmittedPrompt] = useState("");

  const { submit, isLoading } = experimental_useObject({
    api: `/api/agent/${agentId}/subagent/ai`,
    schema: SubAgentGenerateSchema,
    onFinish(event) {
      if (event.error) {
        handleErrorWithToast(event.error);
        return;
      }
      if (event.object) {
        onGenerated({
          name: event.object.name,
          description: event.object.description,
          instructions: event.object.instructions,
        });
      }
      onOpenChange(false);
      setPrompt("");
      setSubmittedPrompt("");
      setGenerateModel(appStore.getState().chatModel);
    },
  });

  const handleSubmit = () => {
    setSubmittedPrompt(prompt);
    submit({ message: prompt, chatModel: generateModel });
    setPrompt("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="xl:max-w-[40vw] w-full max-w-full">
        <DialogHeader>
          <DialogTitle>Generate Sub Agent</DialogTitle>
          <DialogDescription className="sr-only">
            Generate Sub Agent with AI
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-6 w-full">
          <div className="px-4">
            <p className="bg-secondary rounded-lg max-w-2/3 p-4">
              Describe the subagent you want to create. What should it
              specialize in? What tasks should it handle?
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

          <div className="relative flex flex-col border rounded-lg p-4">
            <Textarea
              value={prompt}
              autoFocus
              placeholder="e.g. A research assistant that searches the web and summarizes findings..."
              disabled={isLoading}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && e.metaKey && !isLoading) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              className="w-full break-all pb-6 border-none! ring-0! resize-none min-h-24 max-h-48 overflow-y-auto placeholder:text-xs transition-colors"
            />
            <div className="flex justify-end items-center gap-2">
              <SelectModel
                showProvider
                requiredCapability="supportsGeneration"
                emptyMessage="No generate-capable models configured in Settings → AI Providers."
                onSelect={(model) => setGenerateModel(model)}
              />
              <Button
                disabled={!prompt.trim() || isLoading}
                size="sm"
                onClick={handleSubmit}
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
