"use client";

import { experimental_useObject } from "@ai-sdk/react";
import { appStore } from "@/app/store";
import { SelectModel } from "@/components/select-model";
import { ChatModel } from "app-types/chat";
import { SkillGenerateSchema } from "app-types/skill";
import { CommandIcon, CornerRightUpIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "ui/dialog";
import { Textarea } from "ui/textarea";
import { handleErrorWithToast } from "ui/shared-toast";

interface SkillGenerateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSkillGenerated: (value: {
    title?: string;
    description?: string;
    instructions?: string;
  }) => void;
}

export function SkillGenerateDialog({
  open,
  onOpenChange,
  onSkillGenerated,
}: SkillGenerateDialogProps) {
  const [prompt, setPrompt] = useState("");
  const [generateModel, setGenerateModel] = useState<ChatModel | undefined>(
    appStore.getState().chatModel,
  );

  const { submit, isLoading } = experimental_useObject({
    api: "/api/skill/ai",
    schema: SkillGenerateSchema,
    onFinish(event) {
      if (event.error) {
        handleErrorWithToast(event.error);
        return;
      }
      if (event.object) {
        onSkillGenerated(event.object);
      }
      setPrompt("");
      setGenerateModel(appStore.getState().chatModel);
      onOpenChange(false);
    },
  });

  const submitPrompt = () => {
    submit({
      message: prompt,
      chatModel: generateModel,
    } as any);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Generate Skill</DialogTitle>
          <DialogDescription>
            Describe the skill you want. We will prefill the form for review.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <Textarea
            value={prompt}
            disabled={isLoading}
            placeholder="Create a skill for SEO content briefs with quality checks and output format."
            className="min-h-36 max-h-72 resize-none"
            data-testid="skill-generate-prompt-textarea"
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && event.metaKey && !isLoading) {
                event.preventDefault();
                submitPrompt();
              }
            }}
          />
          <div className="flex items-center justify-between">
            <SelectModel
              showProvider
              onSelect={(model) => setGenerateModel(model)}
            />
            <Button
              size="sm"
              disabled={!prompt.trim() || isLoading}
              onClick={submitPrompt}
              data-testid="skill-generate-submit-button"
            >
              {isLoading ? "Generating..." : "Generate"}
              {!isLoading && (
                <>
                  <CommandIcon className="size-3" />
                  <CornerRightUpIcon className="size-3" />
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
