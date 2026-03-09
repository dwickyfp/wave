import {
  convertToModelMessages,
  generateText,
  getToolName,
  isToolUIPart,
  smoothStream,
  stepCountIs,
  streamText,
  tool,
  type ToolUIPart,
  type UIMessage,
} from "ai";
import type { Agent } from "app-types/agent";
import type {
  ChatMention,
  ChatMetadata,
  ChatModel,
  ChatUsage,
} from "app-types/chat";
import type {
  PageSnapshot,
  PilotActionProposal,
  PilotActionResult,
  PilotChatContinueRequest,
  PilotChatRequest,
  PilotTaskState,
  PilotVisualContext,
} from "app-types/pilot";
import { z } from "zod";
import { convertToSavePart } from "@/app/api/chat/shared.chat";
import {
  buildWaveAgentSystemPrompt,
  createNoopDataStream,
  loadWaveAgentBoundTools,
} from "lib/ai/agent/runtime";
import { getLearnedPersonalizationPromptForUser } from "lib/self-learning/runtime";
import { AppDefaultToolkit } from "lib/ai/tools";
import { getDbModel } from "lib/ai/provider-factory";
import { buildUsageCostSnapshot } from "lib/ai/usage-cost";
import {
  applyChatAttachmentsToMessage,
  ensureUserChatThread,
} from "lib/chat/chat-session";
import {
  agentRepository,
  chatRepository,
  userRepository,
} from "lib/db/repository";
import { generateUUID, truncateString } from "lib/utils";
import {
  applyPilotUserApprovalGrant,
  createPilotActionProposal,
  findFieldByElementId,
  isSensitiveField,
  summarizeActionResults,
  validateProposalAgainstSnapshot,
} from "./browser-actions";
import {
  buildPilotBrokerPrompt,
  buildPilotContinueInstruction,
  buildPilotTaskState,
  buildRelevantFormContext,
  getLatestPilotSelections,
  getLatestPilotTaskState,
  getLatestUserText,
  mergePilotFillProposals,
  resolvePilotTaskMode,
  shouldRetryForPilotCoverage,
} from "./orchestrator";
import { resolveDefaultPilotChatModel } from "./server";
import { getPilotVisualMetadata, withPilotVisualContext } from "./visual-input";

function buildPilotProposalTools(snapshot?: PageSnapshot) {
  return {
    pilot_propose_highlight: tool({
      description:
        "Propose highlighting an element in the current page so the user can inspect it.",
      inputSchema: z.object({
        elementId: z.string(),
        explanation: z.string(),
      }),
      execute: async ({ elementId, explanation }) => {
        const field = findFieldByElementId(snapshot, elementId);
        const proposal = createPilotActionProposal({
          kind: "highlightElement",
          elementId,
          label: field?.label || field?.text || "Highlight element",
          explanation,
          isSensitive: isSensitiveField(field),
        });
        validateProposalAgainstSnapshot(proposal, snapshot);
        return proposal;
      },
    }),
    pilot_propose_set_input_value: tool({
      description:
        "Propose setting a single text-like input field on the current page.",
      inputSchema: z.object({
        elementId: z.string(),
        value: z.string(),
        explanation: z.string(),
      }),
      execute: async ({ elementId, value, explanation }) => {
        const field = findFieldByElementId(snapshot, elementId);
        const proposal = createPilotActionProposal({
          kind: "setInputValue",
          elementId,
          value,
          label: field?.label || "Set field value",
          explanation,
          isSensitive: isSensitiveField(field),
        });
        validateProposalAgainstSnapshot(proposal, snapshot);
        return proposal;
      },
    }),
    pilot_propose_fill_fields: tool({
      description:
        "Propose filling one or more fields on the current page. Use stable elementId values from the page snapshot.",
      inputSchema: z.object({
        explanation: z.string(),
        fields: z.array(
          z.object({
            elementId: z.string(),
            value: z.string(),
          }),
        ),
      }),
      execute: async ({ explanation, fields }) => {
        const proposal = createPilotActionProposal({
          kind: "fillFields",
          label: `Fill ${fields.length} field${fields.length === 1 ? "" : "s"}`,
          explanation,
          fields,
          isSensitive: fields.some((field) =>
            isSensitiveField(findFieldByElementId(snapshot, field.elementId)),
          ),
        });
        validateProposalAgainstSnapshot(proposal, snapshot);
        return proposal;
      },
    }),
    pilot_propose_select_option: tool({
      description:
        "Propose selecting an option in a select input or radio-like field.",
      inputSchema: z.object({
        elementId: z.string(),
        value: z.string(),
        explanation: z.string(),
      }),
      execute: async ({ elementId, value, explanation }) => {
        const field = findFieldByElementId(snapshot, elementId);
        const proposal = createPilotActionProposal({
          kind: "selectOption",
          elementId,
          value,
          label: field?.label || "Select option",
          explanation,
          isSensitive: isSensitiveField(field),
        });
        validateProposalAgainstSnapshot(proposal, snapshot);
        return proposal;
      },
    }),
    pilot_propose_toggle_checkbox: tool({
      description: "Propose toggling a checkbox or switch on the current page.",
      inputSchema: z.object({
        elementId: z.string(),
        checked: z.boolean(),
        explanation: z.string(),
      }),
      execute: async ({ elementId, checked, explanation }) => {
        const field = findFieldByElementId(snapshot, elementId);
        const proposal = createPilotActionProposal({
          kind: "toggleCheckbox",
          elementId,
          checked,
          label: field?.label || "Toggle checkbox",
          explanation,
          isSensitive: isSensitiveField(field),
        });
        validateProposalAgainstSnapshot(proposal, snapshot);
        return proposal;
      },
    }),
    pilot_propose_click: tool({
      description:
        "Propose clicking a button, link, or other actionable element on the current page.",
      inputSchema: z.object({
        elementId: z.string(),
        explanation: z.string(),
      }),
      execute: async ({ elementId, explanation }) => {
        const actionable = snapshot?.actionables.find(
          (item) => item.elementId === elementId,
        );
        const proposal = createPilotActionProposal({
          kind: "clickElement",
          elementId,
          label: actionable?.label || actionable?.text || "Click page element",
          explanation,
        });
        validateProposalAgainstSnapshot(proposal, snapshot);
        return proposal;
      },
    }),
    pilot_propose_scroll: tool({
      description:
        "Propose scrolling the page until an element is visible to the user.",
      inputSchema: z.object({
        elementId: z.string(),
        explanation: z.string(),
      }),
      execute: async ({ elementId, explanation }) => {
        const actionable = snapshot?.actionables.find(
          (item) => item.elementId === elementId,
        );
        const proposal = createPilotActionProposal({
          kind: "scrollToElement",
          elementId,
          label: actionable?.label || actionable?.text || "Scroll to element",
          explanation,
        });
        validateProposalAgainstSnapshot(proposal, snapshot);
        return proposal;
      },
    }),
    pilot_propose_navigate: tool({
      description: "Propose navigating the current tab to a different URL.",
      inputSchema: z.object({
        url: z.string().url(),
        explanation: z.string(),
      }),
      execute: async ({ url, explanation }) => {
        const proposal = createPilotActionProposal({
          kind: "navigate",
          url,
          label: "Navigate current tab",
          explanation,
        });
        validateProposalAgainstSnapshot(
          proposal,
          snapshot ?? {
            url,
            title: "",
            visibleText: "",
            forms: [],
            standaloneFields: [],
            actionables: [],
          },
        );
        return proposal;
      },
    }),
  };
}

function collectPilotProposals(steps: Array<{ toolResults?: any[] }>) {
  return steps.flatMap((step) =>
    (step.toolResults ?? [])
      .filter((result) => result.toolName?.startsWith("pilot_propose_"))
      .map((result) => result.output as PilotActionProposal),
  );
}

function normalizePilotProposals(input: {
  proposals: PilotActionProposal[];
  snapshot?: PageSnapshot;
  relevantForm?: ReturnType<typeof buildRelevantFormContext>;
  userText?: string;
}) {
  return mergePilotFillProposals({
    proposals: input.proposals,
    snapshot: input.snapshot,
    relevantForm: input.relevantForm,
  }).map((proposal) => applyPilotUserApprovalGrant(proposal, input.userText));
}

async function resolvePilotAgent(
  userId: string,
  mentions: ChatMention[],
  fallbackAgentId?: string | null,
) {
  const agentMention = mentions.find((mention) => mention.type === "agent") as
    | Extract<ChatMention, { type: "agent" }>
    | undefined;

  const agentId = agentMention?.agentId ?? fallbackAgentId;
  if (!agentId) return null;

  return await agentRepository.selectAgentById(agentId, userId);
}

function buildPilotAssistantText(input: {
  text?: string;
  proposals: PilotActionProposal[];
}) {
  return (
    input.text?.trim() ||
    (input.proposals.length
      ? `I prepared ${input.proposals.length} browser action proposal${
          input.proposals.length === 1 ? "" : "s"
        }.`
      : "I reviewed the page and I am ready for the next step.")
  );
}

function finalizePilotTaskState(input: {
  taskState: PilotTaskState;
  proposals: PilotActionProposal[];
  text: string;
}) {
  if (input.proposals.some((proposal) => proposal.requiresApproval)) {
    return {
      ...input.taskState,
      lastPhase: "awaiting_approval" as const,
    };
  }

  if (input.proposals.length) {
    return {
      ...input.taskState,
      lastPhase: "executing" as const,
    };
  }

  if (
    input.taskState.mode === "fill" &&
    (input.text.includes("?") || input.taskState.missingFieldIds.length)
  ) {
    return {
      ...input.taskState,
      lastPhase: "awaiting_user_input" as const,
    };
  }

  if (input.taskState.mode === "continue") {
    return {
      ...input.taskState,
      lastPhase: "completed" as const,
    };
  }

  return input.taskState;
}

function extractPilotProposalsFromMessage(
  message: UIMessage,
  snapshot?: PageSnapshot,
  relevantForm?: ReturnType<typeof buildRelevantFormContext>,
  userText?: string,
) {
  const proposals = message.parts
    .filter((part): part is ToolUIPart => isToolUIPart(part))
    .filter((part) => getToolName(part).startsWith("pilot_propose_"))
    .flatMap((part) => {
      if (part.state !== "output-available") {
        return [];
      }

      const output = part.output;
      if (!output || typeof output !== "object") {
        return [];
      }

      return [output as PilotActionProposal];
    });

  return normalizePilotProposals({
    proposals,
    snapshot,
    relevantForm,
    userText,
  });
}

function extractAssistantTextFromMessage(message: UIMessage) {
  return message.parts
    .filter(
      (
        part,
      ): part is Extract<
        UIMessage["parts"][number],
        { type: "text"; text: string }
      > => part.type === "text" && typeof part.text === "string",
    )
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function buildPilotResponseMetadata(input: {
  resolvedModel: ChatModel;
  selectedAgent: Agent | null;
  tabContext:
    | PilotChatRequest["tabContext"]
    | PilotChatContinueRequest["tabContext"];
  actionResults?: PilotActionResult[];
  proposals: PilotActionProposal[];
  taskState: PilotTaskState;
  toolCount: number;
  usage?: ChatUsage;
  pageVisualContext?: PilotVisualContext;
}) {
  return {
    source: "emma_pilot",
    chatModel: input.resolvedModel,
    toolChoice: "auto",
    toolCount: input.toolCount,
    agentId: input.selectedAgent?.id,
    usage: input.usage,
    tabUrl: input.tabContext.url,
    tabTitle: input.tabContext.title,
    lastApprovedActionSummary: summarizeActionResults(input.actionResults),
    pilotProposals: input.proposals,
    pilotTaskState: input.taskState,
    ...getPilotVisualMetadata(input.pageVisualContext),
  } satisfies ChatMetadata;
}

async function executePilotModelTurn(input: {
  userId: string;
  messages: UIMessage[];
  taskUserText: string;
  selectedAgent: Agent | null;
  mentions: ChatMention[];
  resolvedModel: ChatModel;
  user: NonNullable<Awaited<ReturnType<typeof userRepository.getUserById>>>;
  userPreferences: Awaited<ReturnType<typeof userRepository.getPreferences>>;
  pageSnapshot?: PageSnapshot;
  tabContext:
    | PilotChatRequest["tabContext"]
    | PilotChatContinueRequest["tabContext"];
  actionResults?: PilotActionResult[];
  previousTaskState?: PilotTaskState;
  abortSignal?: AbortSignal;
  modeOverride?: PilotTaskState["mode"];
  extraPrompt?: string;
  pageVisualContext?: PilotVisualContext;
}) {
  const mode =
    input.modeOverride ??
    resolvePilotTaskMode({
      userText: input.taskUserText,
      previousState: input.previousTaskState,
      actionResults: input.actionResults,
    });

  const relevantForm = buildRelevantFormContext({
    snapshot: input.pageSnapshot,
    userText: input.taskUserText,
    previousState: input.previousTaskState,
    mode,
  });

  const baseTaskState = buildPilotTaskState({
    mode,
    previousState: input.previousTaskState,
    relevantForm,
    selectedAgent: input.selectedAgent,
    snapshot: input.pageSnapshot,
    actionResults: input.actionResults,
  });

  const toolset = await loadWaveAgentBoundTools({
    agent: input.selectedAgent,
    userId: input.userId,
    mentions: input.mentions,
    allowedAppDefaultToolkit: [
      AppDefaultToolkit.Code,
      AppDefaultToolkit.Http,
      AppDefaultToolkit.WebSearch,
      AppDefaultToolkit.Visualization,
    ],
    dataStream: createNoopDataStream(),
    abortSignal: input.abortSignal ?? new AbortController().signal,
    chatModel: input.resolvedModel,
    source: "agent",
    isToolCallAllowed: true,
  });

  const uiMessages = await convertToModelMessages(input.messages);
  const learnedPersonalizationPrompt =
    await getLearnedPersonalizationPromptForUser(input.userId);
  const system = buildWaveAgentSystemPrompt({
    user: input.user ?? undefined,
    userPreferences: input.userPreferences ?? undefined,
    agent: null,
    subAgents: toolset.subAgents,
    attachedSkills: toolset.attachedSkills,
    extraPrompts: [
      learnedPersonalizationPrompt,
      buildPilotBrokerPrompt({
        tabUrl: input.tabContext.url,
        tabTitle: input.tabContext.title,
        snapshot: input.pageSnapshot,
        pageVisualContext: input.pageVisualContext,
        actionResults: input.actionResults,
        relevantForm,
        taskState: baseTaskState,
        mode,
        selectedAgent: input.selectedAgent,
      }),
      input.extraPrompt,
    ],
  });

  const dbModelResult = await getDbModel(input.resolvedModel);
  if (!dbModelResult) {
    throw new Error(
      `Model "${input.resolvedModel.model}" is not configured. Please set it up in Settings → AI Providers.`,
    );
  }

  const runTurn = async (extraPrompt?: string) => {
    const nextSystem =
      extraPrompt && extraPrompt.trim()
        ? `${system}\n\n${extraPrompt}`
        : system;

    return await generateText({
      model: dbModelResult.model,
      system: nextSystem,
      messages: uiMessages,
      tools: {
        ...toolset.mcpTools,
        ...toolset.workflowTools,
        ...toolset.subagentTools,
        ...toolset.knowledgeTools,
        ...toolset.skillTools,
        ...toolset.appDefaultTools,
        ...buildPilotProposalTools(input.pageSnapshot),
      },
      stopWhen: stepCountIs(12),
    });
  };

  let result = await runTurn();
  let proposals = normalizePilotProposals({
    proposals: collectPilotProposals(result.steps),
    snapshot: input.pageSnapshot,
    relevantForm,
    userText: input.taskUserText,
  });
  let text = buildPilotAssistantText({
    text: result.text,
    proposals,
  });

  if (
    shouldRetryForPilotCoverage({
      mode,
      text,
      proposals,
      relevantForm,
    })
  ) {
    result = await runTurn(
      [
        "Corrective broker reminder:",
        "This appears to be a multi-field form task.",
        "Re-check the whole relevant form before answering.",
        "Either ask one grouped checklist for all missing values or use one pilot_propose_fill_fields call for the related fields.",
        "Do not stop after proposing only one field unless the user explicitly asked for one field.",
      ].join("\n"),
    );

    proposals = normalizePilotProposals({
      proposals: collectPilotProposals(result.steps),
      snapshot: input.pageSnapshot,
      relevantForm,
      userText: input.taskUserText,
    });
    text = buildPilotAssistantText({
      text: result.text,
      proposals,
    });
  }

  const taskState = finalizePilotTaskState({
    taskState: baseTaskState,
    proposals,
    text,
  });

  const usage = result.totalUsage
    ? {
        ...result.totalUsage,
        ...buildUsageCostSnapshot(result.totalUsage, {
          inputTokenPricePer1MUsd: dbModelResult.inputTokenPricePer1MUsd,
          outputTokenPricePer1MUsd: dbModelResult.outputTokenPricePer1MUsd,
        }),
      }
    : undefined;

  const metadata: ChatMetadata = {
    source: "emma_pilot",
    chatModel: input.resolvedModel,
    toolChoice: "auto",
    toolCount: (result.toolCalls ?? []).length,
    agentId: input.selectedAgent?.id,
    usage,
    tabUrl: input.tabContext.url,
    tabTitle: input.tabContext.title,
    lastApprovedActionSummary: summarizeActionResults(input.actionResults),
    pilotProposals: proposals,
    pilotTaskState: taskState,
    ...getPilotVisualMetadata(input.pageVisualContext),
  };

  return {
    assistantMessage: {
      id: generateUUID(),
      role: "assistant" as const,
      parts: [{ type: "text" as const, text }],
      metadata,
    },
    proposals,
    metadata,
  };
}

async function streamPilotModelTurn(input: {
  threadId: string;
  originalMessages: UIMessage[];
  modelMessages: UIMessage[];
  taskUserText: string;
  selectedAgent: Agent | null;
  mentions: ChatMention[];
  resolvedModel: ChatModel;
  user: NonNullable<Awaited<ReturnType<typeof userRepository.getUserById>>>;
  userPreferences: Awaited<ReturnType<typeof userRepository.getPreferences>>;
  pageSnapshot?: PageSnapshot;
  tabContext:
    | PilotChatRequest["tabContext"]
    | PilotChatContinueRequest["tabContext"];
  actionResults?: PilotActionResult[];
  previousTaskState?: PilotTaskState;
  abortSignal?: AbortSignal;
  modeOverride?: PilotTaskState["mode"];
  extraPrompt?: string;
  pageVisualContext?: PilotVisualContext;
}) {
  const mode =
    input.modeOverride ??
    resolvePilotTaskMode({
      userText: input.taskUserText,
      previousState: input.previousTaskState,
      actionResults: input.actionResults,
    });

  const relevantForm = buildRelevantFormContext({
    snapshot: input.pageSnapshot,
    userText: input.taskUserText,
    previousState: input.previousTaskState,
    mode,
  });

  const baseTaskState = buildPilotTaskState({
    mode,
    previousState: input.previousTaskState,
    relevantForm,
    selectedAgent: input.selectedAgent,
    snapshot: input.pageSnapshot,
    actionResults: input.actionResults,
  });

  const toolset = await loadWaveAgentBoundTools({
    agent: input.selectedAgent,
    userId: input.user.id,
    mentions: input.mentions,
    allowedAppDefaultToolkit: [
      AppDefaultToolkit.Code,
      AppDefaultToolkit.Http,
      AppDefaultToolkit.WebSearch,
      AppDefaultToolkit.Visualization,
    ],
    dataStream: createNoopDataStream(),
    abortSignal: input.abortSignal ?? new AbortController().signal,
    chatModel: input.resolvedModel,
    source: "agent",
    isToolCallAllowed: true,
  });

  const uiMessages = await convertToModelMessages(input.modelMessages);
  const learnedPersonalizationPrompt =
    await getLearnedPersonalizationPromptForUser(input.user.id);
  const system = buildWaveAgentSystemPrompt({
    user: input.user ?? undefined,
    userPreferences: input.userPreferences ?? undefined,
    agent: null,
    subAgents: toolset.subAgents,
    attachedSkills: toolset.attachedSkills,
    extraPrompts: [
      learnedPersonalizationPrompt,
      buildPilotBrokerPrompt({
        tabUrl: input.tabContext.url,
        tabTitle: input.tabContext.title,
        snapshot: input.pageSnapshot,
        pageVisualContext: input.pageVisualContext,
        actionResults: input.actionResults,
        relevantForm,
        taskState: baseTaskState,
        mode,
        selectedAgent: input.selectedAgent,
      }),
      input.extraPrompt,
    ],
  });

  const dbModelResult = await getDbModel(input.resolvedModel);
  if (!dbModelResult) {
    throw new Error(
      `Model "${input.resolvedModel.model}" is not configured. Please set it up in Settings → AI Providers.`,
    );
  }

  let streamedText = "";
  const streamedToolNames = new Set<string>();
  let streamedProposals: PilotActionProposal[] = [];
  let streamedUsage: ChatUsage | undefined;

  const result = streamText({
    model: dbModelResult.model,
    system,
    messages: uiMessages,
    tools: {
      ...toolset.mcpTools,
      ...toolset.workflowTools,
      ...toolset.subagentTools,
      ...toolset.knowledgeTools,
      ...toolset.skillTools,
      ...toolset.appDefaultTools,
      ...buildPilotProposalTools(input.pageSnapshot),
    },
    experimental_transform: smoothStream({ chunking: "word" }),
    stopWhen: stepCountIs(12),
    abortSignal: input.abortSignal,
    onChunk: async ({ chunk }) => {
      if (chunk.type === "text-delta") {
        streamedText += chunk.text;
        return;
      }

      if (chunk.type === "tool-call") {
        streamedToolNames.add(chunk.toolName);
      }
    },
    onStepFinish: async (event) => {
      for (const toolCall of event.toolCalls ?? []) {
        streamedToolNames.add(toolCall.toolName);
      }

      streamedProposals = normalizePilotProposals({
        proposals: [
          ...streamedProposals,
          ...collectPilotProposals([event as { toolResults?: any[] }]),
        ],
        snapshot: input.pageSnapshot,
        relevantForm,
        userText: input.taskUserText,
      });
    },
  });

  return result.toUIMessageStreamResponse({
    originalMessages: input.originalMessages,
    generateMessageId: generateUUID,
    messageMetadata: ({ part }) => {
      if (part.type === "finish" && part.totalUsage) {
        streamedUsage = {
          ...part.totalUsage,
          ...buildUsageCostSnapshot(part.totalUsage, {
            inputTokenPricePer1MUsd: dbModelResult.inputTokenPricePer1MUsd,
            outputTokenPricePer1MUsd: dbModelResult.outputTokenPricePer1MUsd,
          }),
        };

        const finalText = buildPilotAssistantText({
          text: streamedText,
          proposals: streamedProposals,
        });
        const finalTaskState = finalizePilotTaskState({
          taskState: baseTaskState,
          proposals: streamedProposals,
          text: finalText,
        });

        return buildPilotResponseMetadata({
          resolvedModel: input.resolvedModel,
          selectedAgent: input.selectedAgent,
          tabContext: input.tabContext,
          actionResults: input.actionResults,
          proposals: streamedProposals,
          taskState: finalTaskState,
          toolCount: streamedToolNames.size,
          usage: streamedUsage,
          pageVisualContext: input.pageVisualContext,
        });
      }

      if (part.type === "start") {
        return buildPilotResponseMetadata({
          resolvedModel: input.resolvedModel,
          selectedAgent: input.selectedAgent,
          tabContext: input.tabContext,
          actionResults: input.actionResults,
          proposals: [],
          taskState: baseTaskState,
          toolCount: 0,
          pageVisualContext: input.pageVisualContext,
        });
      }

      return undefined;
    },
    onFinish: async ({ responseMessage }) => {
      const finalProposals = extractPilotProposalsFromMessage(
        responseMessage,
        input.pageSnapshot,
        relevantForm,
        input.taskUserText,
      );
      const finalText = buildPilotAssistantText({
        text: extractAssistantTextFromMessage(responseMessage) || streamedText,
        proposals: finalProposals,
      });
      const finalTaskState = finalizePilotTaskState({
        taskState: baseTaskState,
        proposals: finalProposals,
        text: finalText,
      });
      const finalMetadata = buildPilotResponseMetadata({
        resolvedModel: input.resolvedModel,
        selectedAgent: input.selectedAgent,
        tabContext: input.tabContext,
        actionResults: input.actionResults,
        proposals: finalProposals,
        taskState: finalTaskState,
        toolCount: streamedToolNames.size,
        usage: streamedUsage,
        pageVisualContext: input.pageVisualContext,
      });

      await chatRepository.upsertMessage({
        threadId: input.threadId,
        role: responseMessage.role,
        id: responseMessage.id,
        parts: responseMessage.parts.map(convertToSavePart),
        metadata: finalMetadata,
      });
    },
    onError: (error) => (error as Error).message || "Pilot stream failed.",
  });
}

export async function runPilotChat(input: {
  userId: string;
  request: PilotChatRequest;
  abortSignal?: AbortSignal;
}) {
  const threadId = input.request.threadId ?? generateUUID();
  const thread = await ensureUserChatThread({
    threadId,
    userId: input.userId,
  });

  const messages: UIMessage[] = [...(thread.messages ?? [])].map((message) => ({
    id: message.id,
    role: message.role,
    parts: message.parts,
    metadata: message.metadata,
  }));

  const currentMessage = input.request.message as UIMessage;
  if (messages.at(-1)?.id === currentMessage.id) {
    messages.pop();
  }

  await applyChatAttachmentsToMessage({
    message: currentMessage,
    attachments: input.request.attachments ?? [],
    userId: input.userId,
  });
  const modelCurrentMessage = withPilotVisualContext(
    currentMessage,
    input.request.pageVisualContext,
  );
  const messagesWithCurrent = [...messages, modelCurrentMessage];

  const currentMessageMetadata = currentMessage.metadata as
    | ChatMetadata
    | undefined;
  const latestSelections = getLatestPilotSelections(messagesWithCurrent);
  const mentions = [...(input.request.mentions ?? [])];
  const selectedAgent = await resolvePilotAgent(
    input.userId,
    mentions,
    currentMessageMetadata?.agentId ??
      latestSelections.agentId ??
      latestSelections.pilotTaskState?.selectedAgentId,
  );

  if (selectedAgent?.instructions?.mentions?.length) {
    mentions.push(...selectedAgent.instructions.mentions);
  }

  const resolvedModel =
    input.request.chatModel ??
    currentMessageMetadata?.chatModel ??
    latestSelections.chatModel ??
    (await resolveDefaultPilotChatModel());

  if (!resolvedModel) {
    throw new Error(
      "No tool-capable chat model is configured. Configure one in Settings > AI Providers.",
    );
  }

  const user = await userRepository.getUserById(input.userId);
  if (!user) {
    throw new Error("Emma Pilot user not found.");
  }
  const userPreferences = await userRepository.getPreferences(input.userId);

  const turnResult = await executePilotModelTurn({
    userId: input.userId,
    messages: messagesWithCurrent,
    taskUserText: getLatestUserText(messagesWithCurrent),
    selectedAgent,
    mentions,
    resolvedModel,
    user,
    userPreferences,
    pageSnapshot: input.request.pageSnapshot,
    pageVisualContext: input.request.pageVisualContext,
    tabContext: input.request.tabContext,
    actionResults: input.request.actionResults,
    previousTaskState: getLatestPilotTaskState(messages),
    abortSignal: input.abortSignal,
  });

  const userMetadata: ChatMetadata = {
    source: "emma_pilot",
    chatModel: resolvedModel,
    agentId: selectedAgent?.id,
    tabUrl: input.request.tabContext.url,
    tabTitle: input.request.tabContext.title,
    lastApprovedActionSummary: summarizeActionResults(
      input.request.actionResults,
    ),
    ...getPilotVisualMetadata(input.request.pageVisualContext),
  };

  await chatRepository.upsertMessage({
    threadId,
    role: currentMessage.role,
    id: currentMessage.id,
    parts: currentMessage.parts.map(convertToSavePart),
    metadata: userMetadata,
  });

  await chatRepository.upsertMessage({
    threadId,
    role: turnResult.assistantMessage.role,
    id: turnResult.assistantMessage.id,
    parts: turnResult.assistantMessage.parts.map(convertToSavePart),
    metadata: turnResult.metadata,
  });

  if (!thread.title.trim()) {
    const firstTextPart = currentMessage.parts.find(
      (part): part is Extract<UIMessage["parts"][number], { type: "text" }> =>
        part.type === "text" && "text" in part,
    );
    const firstUserText = firstTextPart?.text ?? "Emma Pilot";
    await chatRepository.updateThread(threadId, {
      title: truncateString(firstUserText, 80),
    });
  }

  return {
    threadId,
    assistantMessage: turnResult.assistantMessage,
    proposals: turnResult.proposals,
    chatModel: resolvedModel,
  };
}

export async function streamPilotChat(input: {
  userId: string;
  request: PilotChatRequest;
  abortSignal?: AbortSignal;
}) {
  const threadId = input.request.threadId ?? generateUUID();
  const thread = await ensureUserChatThread({
    threadId,
    userId: input.userId,
  });

  const messages: UIMessage[] = [...(thread.messages ?? [])].map((message) => ({
    id: message.id,
    role: message.role,
    parts: message.parts,
    metadata: message.metadata,
  }));

  const currentMessage = input.request.message as UIMessage;
  if (messages.at(-1)?.id === currentMessage.id) {
    messages.pop();
  }

  await applyChatAttachmentsToMessage({
    message: currentMessage,
    attachments: input.request.attachments ?? [],
    userId: input.userId,
  });
  const modelCurrentMessage = withPilotVisualContext(
    currentMessage,
    input.request.pageVisualContext,
  );

  const currentMessageMetadata = currentMessage.metadata as
    | ChatMetadata
    | undefined;
  const messagesWithCurrent = [...messages, modelCurrentMessage];
  const latestSelections = getLatestPilotSelections(messagesWithCurrent);
  const mentions = [...(input.request.mentions ?? [])];
  const selectedAgent = await resolvePilotAgent(
    input.userId,
    mentions,
    currentMessageMetadata?.agentId ??
      latestSelections.agentId ??
      latestSelections.pilotTaskState?.selectedAgentId,
  );

  if (selectedAgent?.instructions?.mentions?.length) {
    mentions.push(...selectedAgent.instructions.mentions);
  }

  const resolvedModel =
    input.request.chatModel ??
    currentMessageMetadata?.chatModel ??
    latestSelections.chatModel ??
    (await resolveDefaultPilotChatModel());

  if (!resolvedModel) {
    throw new Error(
      "No tool-capable chat model is configured. Configure one in Settings > AI Providers.",
    );
  }

  const user = await userRepository.getUserById(input.userId);
  if (!user) {
    throw new Error("Emma Pilot user not found.");
  }
  const userPreferences = await userRepository.getPreferences(input.userId);

  const userMetadata: ChatMetadata = {
    source: "emma_pilot",
    chatModel: resolvedModel,
    agentId: selectedAgent?.id,
    tabUrl: input.request.tabContext.url,
    tabTitle: input.request.tabContext.title,
    lastApprovedActionSummary: summarizeActionResults(
      input.request.actionResults,
    ),
    ...getPilotVisualMetadata(input.request.pageVisualContext),
  };

  await chatRepository.upsertMessage({
    threadId,
    role: currentMessage.role,
    id: currentMessage.id,
    parts: currentMessage.parts.map(convertToSavePart),
    metadata: userMetadata,
  });

  if (!thread.title.trim()) {
    const firstTextPart = currentMessage.parts.find(
      (part): part is Extract<UIMessage["parts"][number], { type: "text" }> =>
        part.type === "text" && "text" in part,
    );
    const firstUserText = firstTextPart?.text ?? "Emma Pilot";
    await chatRepository.updateThread(threadId, {
      title: truncateString(firstUserText, 80),
    });
  }

  return await streamPilotModelTurn({
    threadId,
    originalMessages: messagesWithCurrent,
    modelMessages: messagesWithCurrent,
    taskUserText: getLatestUserText(messagesWithCurrent),
    selectedAgent,
    mentions,
    resolvedModel,
    user,
    userPreferences,
    pageSnapshot: input.request.pageSnapshot,
    pageVisualContext: input.request.pageVisualContext,
    tabContext: input.request.tabContext,
    actionResults: input.request.actionResults,
    previousTaskState: getLatestPilotTaskState(messages),
    abortSignal: input.abortSignal,
  });
}

export async function continuePilotChat(input: {
  userId: string;
  request: PilotChatContinueRequest;
  abortSignal?: AbortSignal;
}) {
  const thread = await ensureUserChatThread({
    threadId: input.request.threadId,
    userId: input.userId,
  });

  const messages: UIMessage[] = [...(thread.messages ?? [])].map((message) => ({
    id: message.id,
    role: message.role,
    parts: message.parts,
    metadata: message.metadata,
  }));

  const latestSelections = getLatestPilotSelections(messages);
  const selectedAgent = await resolvePilotAgent(
    input.userId,
    [],
    latestSelections.agentId ??
      latestSelections.pilotTaskState?.selectedAgentId,
  );
  const resolvedModel =
    latestSelections.chatModel ?? (await resolveDefaultPilotChatModel());

  if (!resolvedModel) {
    throw new Error(
      "No tool-capable chat model is configured. Configure one in Settings > AI Providers.",
    );
  }

  const previousTaskState = getLatestPilotTaskState(messages);
  const taskUserText = getLatestUserText(messages);
  const syntheticMessage: UIMessage = {
    id: generateUUID(),
    role: "user",
    parts: [
      {
        type: "text",
        text: buildPilotContinueInstruction({
          taskState: previousTaskState,
          relevantForm: previousTaskState?.relevantForm,
          actionResults: input.request.actionResults,
        }),
      },
    ],
  };
  const modelSyntheticMessage = withPilotVisualContext(
    syntheticMessage,
    input.request.pageVisualContext,
  );

  const user = await userRepository.getUserById(input.userId);
  if (!user) {
    throw new Error("Emma Pilot user not found.");
  }
  const userPreferences = await userRepository.getPreferences(input.userId);

  const turnResult = await executePilotModelTurn({
    userId: input.userId,
    messages: [...messages, modelSyntheticMessage],
    taskUserText,
    selectedAgent,
    mentions: [],
    resolvedModel,
    user,
    userPreferences,
    pageSnapshot: input.request.pageSnapshot,
    pageVisualContext: input.request.pageVisualContext,
    tabContext: input.request.tabContext,
    actionResults: input.request.actionResults,
    previousTaskState,
    abortSignal: input.abortSignal,
    modeOverride: "continue",
    extraPrompt:
      "This is an automatic continuation turn after browser execution. Continue the task without waiting for a new user message unless you need clarification or approval.",
  });

  await chatRepository.upsertMessage({
    threadId: input.request.threadId,
    role: turnResult.assistantMessage.role,
    id: turnResult.assistantMessage.id,
    parts: turnResult.assistantMessage.parts.map(convertToSavePart),
    metadata: turnResult.metadata,
  });

  return {
    threadId: input.request.threadId,
    assistantMessage: turnResult.assistantMessage,
    proposals: turnResult.proposals,
    chatModel: resolvedModel,
  };
}

export async function streamPilotContinuationChat(input: {
  userId: string;
  request: PilotChatContinueRequest;
  abortSignal?: AbortSignal;
}) {
  const thread = await ensureUserChatThread({
    threadId: input.request.threadId,
    userId: input.userId,
  });

  const messages: UIMessage[] = [...(thread.messages ?? [])].map((message) => ({
    id: message.id,
    role: message.role,
    parts: message.parts,
    metadata: message.metadata,
  }));

  const latestSelections = getLatestPilotSelections(messages);
  const selectedAgent = await resolvePilotAgent(
    input.userId,
    [],
    latestSelections.agentId ??
      latestSelections.pilotTaskState?.selectedAgentId,
  );
  const resolvedModel =
    latestSelections.chatModel ?? (await resolveDefaultPilotChatModel());

  if (!resolvedModel) {
    throw new Error(
      "No tool-capable chat model is configured. Configure one in Settings > AI Providers.",
    );
  }

  const previousTaskState = getLatestPilotTaskState(messages);
  const taskUserText = getLatestUserText(messages);
  const syntheticMessage: UIMessage = {
    id: generateUUID(),
    role: "user",
    parts: [
      {
        type: "text",
        text: buildPilotContinueInstruction({
          taskState: previousTaskState,
          relevantForm: previousTaskState?.relevantForm,
          actionResults: input.request.actionResults,
        }),
      },
    ],
  };
  const modelSyntheticMessage = withPilotVisualContext(
    syntheticMessage,
    input.request.pageVisualContext,
  );

  const user = await userRepository.getUserById(input.userId);
  if (!user) {
    throw new Error("Emma Pilot user not found.");
  }
  const userPreferences = await userRepository.getPreferences(input.userId);

  return await streamPilotModelTurn({
    threadId: input.request.threadId,
    originalMessages: messages,
    modelMessages: [...messages, modelSyntheticMessage],
    taskUserText,
    selectedAgent,
    mentions: [],
    resolvedModel,
    user,
    userPreferences,
    pageSnapshot: input.request.pageSnapshot,
    pageVisualContext: input.request.pageVisualContext,
    tabContext: input.request.tabContext,
    actionResults: input.request.actionResults,
    previousTaskState,
    abortSignal: input.abortSignal,
    modeOverride: "continue",
    extraPrompt:
      "This is an automatic continuation turn after browser execution. Continue the task without waiting for a new user message unless you need clarification or approval.",
  });
}
