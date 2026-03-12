"use client";

import { experimental_useObject } from "@ai-sdk/react";
import { WandSparklesIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { appStore } from "@/app/store";
import { SelectModel } from "@/components/select-model";
import { AgentInstructionEnhanceResponseSchema } from "app-types/agent";
import { ChatModel } from "app-types/chat";
import { cn } from "lib/utils";
import { Button } from "ui/button";
import { Label } from "ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "ui/popover";
import { handleErrorWithToast } from "ui/shared-toast";
import { Textarea } from "ui/textarea";

function defaultModel() {
  return appStore.getState().chatModel;
}

export function AgentInstructionEnhancePopover({
  currentInstructions,
  agentContext,
  disabled,
  iconOnly = false,
  className,
  onGenerated,
}: {
  currentInstructions: string;
  agentContext?: {
    name?: string;
    description?: string;
    role?: string;
  };
  disabled?: boolean;
  iconOnly?: boolean;
  className?: string;
  onGenerated: (instructions: string) => void;
}) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState<ChatModel | undefined>(defaultModel());

  const resetState = () => {
    setPrompt("");
    setModel(defaultModel());
  };

  const { submit, isLoading } = experimental_useObject({
    api: "/api/agent/instructions/ai",
    schema: AgentInstructionEnhanceResponseSchema,
    onFinish(event) {
      if (event.error) {
        handleErrorWithToast(event.error);
        return;
      }

      if (event.object?.instructions) {
        onGenerated(event.object.instructions);
        setOpen(false);
        resetState();
      }
    },
  });

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && !isLoading) {
      resetState();
    }
    setOpen(nextOpen);
  };

  const handleGenerate = () => {
    submit({
      changePrompt: prompt,
      currentInstructions,
      chatModel: model,
      agentContext,
    } as any);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size={iconOnly ? "icon" : "sm"}
          variant={iconOnly ? "ghost" : "secondary"}
          aria-label={t("Agent.instructionsAiTrigger")}
          title={t("Agent.instructionsAiTrigger")}
          disabled={disabled || isLoading}
          data-testid="agent-instruction-enhance-button"
          className={cn(iconOnly && "size-8 shrink-0", className)}
        >
          <WandSparklesIcon className="size-3.5" />
          {iconOnly ? (
            <span className="sr-only">{t("Agent.instructionsAiTrigger")}</span>
          ) : (
            t("Agent.instructionsAiTrigger")
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[420px] max-w-[calc(100vw-2rem)] space-y-4"
        data-testid="agent-instruction-enhance-popover"
      >
        <div className="space-y-1">
          <p className="text-sm font-medium">
            {t("Agent.instructionsAiPopoverTitle")}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("Agent.instructionsAiPopoverDescription")}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="agent-instruction-enhance-prompt" className="text-xs">
            {t("Agent.instructionsAiPromptLabel")}
          </Label>
          <Textarea
            id="agent-instruction-enhance-prompt"
            value={prompt}
            disabled={isLoading}
            placeholder={t("Agent.instructionsAiPromptPlaceholder")}
            onChange={(event) => setPrompt(event.target.value)}
            data-testid="agent-instruction-enhance-prompt-textarea"
            className="min-h-28 resize-none bg-background"
          />
        </div>

        <div className="flex items-center justify-between gap-3">
          <SelectModel
            currentModel={model}
            showProvider
            requiredCapability="supportsGeneration"
            emptyMessage={t("Agent.instructionsAiNoModels")}
            onSelect={(nextModel) => setModel(nextModel)}
          />

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={isLoading}
              onClick={() => handleOpenChange(false)}
              data-testid="agent-instruction-enhance-cancel-button"
            >
              {t("Common.cancel")}
            </Button>
            <Button
              type="button"
              disabled={!prompt.trim() || isLoading}
              onClick={handleGenerate}
              data-testid="agent-instruction-enhance-generate-button"
            >
              {isLoading
                ? t("Agent.instructionsAiGenerating")
                : t("Common.generate")}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
