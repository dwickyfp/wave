import {
  convertToModelMessages,
  generateText,
  stepCountIs,
  tool,
  type UIMessage,
} from "ai";
import type { Agent } from "app-types/agent";
import type { ChatMention, ChatMetadata, ChatModel } from "app-types/chat";
import type {
  PageSnapshot,
  PilotActionProposal,
  PilotActionResult,
  PilotChatRequest,
} from "app-types/pilot";
import { z } from "zod";
import { convertToSavePart } from "@/app/api/chat/shared.chat";
import {
  buildWaveAgentSystemPrompt,
  createNoopDataStream,
  loadWaveAgentBoundTools,
} from "lib/ai/agent/runtime";
import { AppDefaultToolkit } from "lib/ai/tools";
import { getDbModel } from "lib/ai/provider-factory";
import { buildUsageCostSnapshot } from "lib/ai/usage-cost";
import {
  ensureUserChatThread,
  applyChatAttachmentsToMessage,
} from "lib/chat/chat-session";
import {
  agentRepository,
  chatRepository,
  userRepository,
} from "lib/db/repository";
import { generateUUID, truncateString } from "lib/utils";
import {
  createPilotActionProposal,
  findFieldByElementId,
  isSensitiveField,
  summarizeActionResults,
  validateProposalAgainstSnapshot,
} from "./browser-actions";
import { resolveDefaultPilotChatModel } from "./server";

function summarizePageSnapshot(snapshot?: PageSnapshot) {
  if (!snapshot) return "No page snapshot available.";

  const focused = snapshot.focusedElement
    ? `Focused element: ${JSON.stringify(snapshot.focusedElement)}`
    : "Focused element: none";

  const forms = snapshot.forms.slice(0, 6).map((form) => ({
    formId: form.formId,
    label: form.label,
    action: form.action,
    fields: form.fields.slice(0, 12),
  }));

  const actionables = snapshot.actionables.slice(0, 20);

  return JSON.stringify(
    {
      url: snapshot.url,
      title: snapshot.title,
      selectedText: snapshot.selectedText,
      visibleText: truncateString(snapshot.visibleText || "", 5000),
      forms,
      actionables,
      focused,
    },
    null,
    2,
  );
}

function buildPilotExtraPrompt(input: {
  tabUrl: string;
  tabTitle?: string;
  snapshot?: PageSnapshot;
  actionResults?: PilotActionResult[];
}) {
  return [
    "You are Emma Pilot, a supervised browser copilot inside a Chrome or Microsoft Edge side panel.",
    "Answer the user directly when the page can be explained without changing it.",
    "If the user wants a browser interaction, call one of the pilot_propose_* tools instead of pretending the action already happened.",
    "Every browser action requires explicit approval before execution.",
    "Never fill passwords, payment data, or other sensitive fields without explicit confirmation.",
    `Active tab URL: ${input.tabUrl}`,
    `Active tab title: ${input.tabTitle || ""}`,
    input.actionResults?.length
      ? `Recently executed browser actions: ${JSON.stringify(input.actionResults)}`
      : "",
    `Current page snapshot:\n${summarizePageSnapshot(input.snapshot)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function resolvePilotAgent(userId: string, mentions: ChatMention[]) {
  const agentMention = mentions.find((mention) => mention.type === "agent") as
    | Extract<ChatMention, { type: "agent" }>
    | undefined;

  if (!agentMention) return null;
  return await agentRepository.selectAgentById(agentMention.agentId, userId);
}

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

  const currentMessage = input.request.message;
  if (messages.at(-1)?.id === currentMessage.id) {
    messages.pop();
  }

  await applyChatAttachmentsToMessage({
    message: currentMessage,
    attachments: input.request.attachments ?? [],
    userId: input.userId,
  });
  messages.push(currentMessage as UIMessage);

  const mentions = [...(input.request.mentions ?? [])];
  const agent = await resolvePilotAgent(input.userId, mentions);

  if (agent?.instructions?.mentions?.length) {
    mentions.push(...agent.instructions.mentions);
  }

  const resolvedModel =
    input.request.chatModel ?? (await resolveDefaultPilotChatModel());
  if (!resolvedModel) {
    throw new Error(
      "No tool-capable chat model is configured. Configure one in Settings > AI Providers.",
    );
  }

  const dbModelResult = await getDbModel(resolvedModel);
  if (!dbModelResult) {
    throw new Error(
      `Model "${resolvedModel.model}" is not configured. Please set it up in Settings → AI Providers.`,
    );
  }

  const user = await userRepository.getUserById(input.userId);
  if (!user) {
    throw new Error("Emma Pilot user not found.");
  }
  const userPreferences = await userRepository.getPreferences(input.userId);

  const toolset = await loadWaveAgentBoundTools({
    agent: agent as Agent | null,
    userId: input.userId,
    mentions,
    allowedAppDefaultToolkit: [
      AppDefaultToolkit.Code,
      AppDefaultToolkit.Http,
      AppDefaultToolkit.WebSearch,
      AppDefaultToolkit.Visualization,
    ],
    dataStream: createNoopDataStream(),
    abortSignal: input.abortSignal ?? new AbortController().signal,
    chatModel: resolvedModel as ChatModel,
    source: "agent",
    isToolCallAllowed: true,
  });

  const uiMessages = await convertToModelMessages(messages);
  const system = buildWaveAgentSystemPrompt({
    user,
    userPreferences: userPreferences ?? undefined,
    agent,
    subAgents: toolset.subAgents,
    attachedSkills: toolset.attachedSkills,
    extraPrompts: [
      buildPilotExtraPrompt({
        tabUrl: input.request.tabContext.url,
        tabTitle: input.request.tabContext.title,
        snapshot: input.request.pageSnapshot,
        actionResults: input.request.actionResults,
      }),
    ],
  });

  const result = await generateText({
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
      ...buildPilotProposalTools(input.request.pageSnapshot),
    },
    stopWhen: stepCountIs(8),
  });

  const proposals = collectPilotProposals(result.steps);
  const text =
    result.text?.trim() ||
    (proposals.length
      ? `I prepared ${proposals.length} browser action proposal${
          proposals.length === 1 ? "" : "s"
        }. Review them before execution.`
      : "I reviewed the page and I'm ready for the next step.");

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
    chatModel: resolvedModel,
    toolChoice: "auto",
    toolCount: (result.toolCalls ?? []).length,
    agentId: agent?.id,
    usage,
    tabUrl: input.request.tabContext.url,
    tabTitle: input.request.tabContext.title,
    lastApprovedActionSummary: summarizeActionResults(
      input.request.actionResults,
    ),
    pilotProposals: proposals,
  };

  const userMetadata: ChatMetadata = {
    source: "emma_pilot",
    chatModel: resolvedModel,
    agentId: agent?.id,
    tabUrl: input.request.tabContext.url,
    tabTitle: input.request.tabContext.title,
    lastApprovedActionSummary: summarizeActionResults(
      input.request.actionResults,
    ),
  };

  await chatRepository.upsertMessage({
    threadId,
    role: currentMessage.role,
    id: currentMessage.id,
    parts: currentMessage.parts.map(convertToSavePart),
    metadata: userMetadata,
  });

  const assistantMessage = {
    id: generateUUID(),
    role: "assistant" as const,
    parts: [{ type: "text" as const, text }],
    metadata,
  };

  await chatRepository.upsertMessage({
    threadId,
    role: assistantMessage.role,
    id: assistantMessage.id,
    parts: assistantMessage.parts.map(convertToSavePart),
    metadata,
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
    assistantMessage,
    proposals,
    chatModel: resolvedModel,
  };
}
