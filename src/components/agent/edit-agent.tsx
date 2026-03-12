"use client";

import { KnowledgeAgentSection } from "@/components/knowledge/knowledge-agent-section";
import { ShareableActions, Visibility } from "@/components/shareable-actions";
import { SkillAgentSection } from "@/components/skill/skill-agent-section";
import { useMutateAgents } from "@/hooks/queries/use-agents";
import { useBookmark } from "@/hooks/queries/use-bookmark";
import { useChatModels } from "@/hooks/queries/use-chat-models";
import { useMcpList } from "@/hooks/queries/use-mcp-list";
import { useWorkflowToolList } from "@/hooks/queries/use-workflow-tool-list";
import { useObjectState } from "@/hooks/use-object-state";
import { Agent, AgentCreateSchema, AgentUpdateSchema } from "app-types/agent";
import { ChatMention, ChatModel } from "app-types/chat";
import type { KnowledgeSummary } from "app-types/knowledge";
import { MCPServerInfo } from "app-types/mcp";
import type { SkillGroupSummary, SkillSummary } from "app-types/skill";
import { SubAgent } from "app-types/subagent";
import { WorkflowSummary } from "app-types/workflow";
import {
  buildContinueAgentSystemMessage,
  buildContinuePlanSystemMessage,
} from "lib/ai/agent/continue-prompts";
import {
  RandomDataGeneratorExample,
  WeatherExample,
} from "lib/ai/agent/example";
import {
  getExternalAgentAutocompleteOpenAiModelId,
  getExternalAgentOpenAiModelId,
} from "lib/ai/agent/external-agent-model-id";
import { DefaultToolName } from "lib/ai/tools";
import { BACKGROUND_COLORS } from "lib/const";
import { notify } from "lib/notify";
import { cn, fetcher, objectFlow } from "lib/utils";
import {
  ChevronDownIcon,
  CopyIcon,
  KeyIcon,
  Loader,
  RefreshCwIcon,
  SaveIcon,
  ServerIcon,
  ShieldAlertIcon,
  Trash2Icon,
  WandSparklesIcon,
  WaypointsIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { safe } from "ts-safe";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "ui/accordion";
import { Button } from "ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "ui/dropdown-menu";
import { Input } from "ui/input";
import { Label } from "ui/label";
import { ScrollArea } from "ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "ui/select";
import { handleErrorWithToast } from "ui/shared-toast";
import { Skeleton } from "ui/skeleton";
import { Switch } from "ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "ui/tabs";
import { TextShimmer } from "ui/text-shimmer";
import { Textarea } from "ui/textarea";
import { A2APublishPanel } from "./a2a-publish-panel";
import { AgentDashboardTab } from "./agent-dashboard-tab";
import { AgentIconPicker } from "./agent-icon-picker";
import { AgentInstructionDiffPreview } from "./agent-instruction-diff-preview";
import { AgentInstructionEnhancePopover } from "./agent-instruction-enhance-popover";
import { AgentToolSelector } from "./agent-tool-selector";
import { GenerateAgentDialog } from "./generate-agent-dialog";
import { SubAgentSection } from "./subagent-section";

const defaultConfig = (): PartialBy<
  Omit<Agent, "createdAt" | "updatedAt" | "userId">,
  "id"
> => {
  return {
    name: "",
    description: "",
    chatPersonalizationEnabled: true,
    icon: {
      type: "emoji",
      value:
        "https://cdn.jsdelivr.net/npm/emoji-datasource-apple/img/apple/64/1f916.png",
      style: {
        backgroundColor: BACKGROUND_COLORS[0],
      },
    },
    instructions: {
      role: "",
      systemPrompt: "",
      mentions: [],
    },
    visibility: "private",
  };
};

const MCP_MODEL_AUTO_VALUE = "__mcp_model_auto__";
const MCP_AUTOCOMPLETE_MODEL_NONE_VALUE = "__mcp_autocomplete_model_none__";
const MCP_PRESENTATION_COMPATIBILITY = "compatibility";
const MCP_PRESENTATION_COPILOT_NATIVE = "copilot_native";

type AgentMcpPresentationMode =
  | typeof MCP_PRESENTATION_COMPATIBILITY
  | typeof MCP_PRESENTATION_COPILOT_NATIVE;

function makeMcpModelValue(model: ChatModel) {
  return `${model.provider}::${model.model}`;
}

function parseMcpModelValue(value: string): ChatModel | null {
  if (!value || value === MCP_MODEL_AUTO_VALUE) return null;
  const separatorIndex = value.indexOf("::");
  if (separatorIndex < 0) return null;

  const provider = value.slice(0, separatorIndex);
  const model = value.slice(separatorIndex + 2);

  if (!provider || !model) return null;
  return { provider, model };
}

function yamlScalar(value: string) {
  return JSON.stringify(value);
}

interface EditAgentProps {
  initialAgent?: Agent;
  userId: string;
  isOwner?: boolean;
  hasEditAccess?: boolean;
  isBookmarked?: boolean;
}

export default function EditAgent({
  initialAgent,
  userId,
  isOwner = true,
  hasEditAccess = true,
}: EditAgentProps) {
  const t = useTranslations();
  const mutateAgents = useMutateAgents();
  const router = useRouter();

  const [openGenerateAgentDialog, setOpenGenerateAgentDialog] = useState(false);
  const [instructionReview, setInstructionReview] = useState<{
    before: string;
    after: string;
  } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isVisibilityChangeLoading, setIsVisibilityChangeLoading] =
    useState(false);

  const [subAgents, setSubAgents] = useState<SubAgent[]>(
    initialAgent?.subAgents ?? [],
  );
  const [subAgentsEnabled, setSubAgentsEnabled] = useState<boolean>(
    initialAgent?.subAgentsEnabled ?? false,
  );
  const [knowledgeGroups, setKnowledgeGroups] = useState<KnowledgeSummary[]>(
    (initialAgent as any)?.knowledgeGroups ?? [],
  );
  const [knowledgeEnabled, setKnowledgeEnabled] = useState<boolean>(
    ((initialAgent as any)?.knowledgeGroups ?? []).length > 0,
  );
  const [skills, setSkills] = useState<SkillSummary[]>(
    (initialAgent as any)?.skills ?? [],
  );
  const [skillGroups, setSkillGroups] = useState<SkillGroupSummary[]>(
    (initialAgent as any)?.skillGroups ?? [],
  );
  const [skillsEnabled, setSkillsEnabled] = useState<boolean>(
    ((initialAgent as any)?.skills ?? []).length > 0 ||
      ((initialAgent as any)?.skillGroups ?? []).length > 0,
  );
  const [agentMcpEnabled, setAgentMcpEnabled] = useState(
    initialAgent?.mcpEnabled ?? false,
  );
  const [agentChatPersonalizationEnabled, setAgentChatPersonalizationEnabled] =
    useState(initialAgent?.chatPersonalizationEnabled ?? true);
  const [agentMcpApiKey, setAgentMcpApiKey] = useState<string | null>(null);
  const [agentMcpKeyPreview, setAgentMcpKeyPreview] = useState(
    initialAgent?.mcpApiKeyPreview ?? initialAgent?.a2aApiKeyPreview ?? null,
  );
  const [isAgentMcpGeneratingKey, setIsAgentMcpGeneratingKey] = useState(false);
  const [isAgentMcpRevokingKey, setIsAgentMcpRevokingKey] = useState(false);
  const [isAgentMcpToggling, setIsAgentMcpToggling] = useState(false);
  const [isAgentMcpUpdatingModel, setIsAgentMcpUpdatingModel] = useState(false);
  const [
    isAgentContinueUpdatingCodingMode,
    setIsAgentContinueUpdatingCodingMode,
  ] = useState(false);
  const [
    isAgentContinueUpdatingAutocompleteModel,
    setIsAgentContinueUpdatingAutocompleteModel,
  ] = useState(false);
  const [
    isAgentChatPersonalizationUpdating,
    setIsAgentChatPersonalizationUpdating,
  ] = useState(false);
  const [
    isAgentMcpUpdatingPresentationMode,
    setIsAgentMcpUpdatingPresentationMode,
  ] = useState(false);
  const [agentMcpModel, setAgentMcpModel] = useState<ChatModel | null>(
    initialAgent?.mcpModelProvider && initialAgent?.mcpModelName
      ? {
          provider: initialAgent.mcpModelProvider,
          model: initialAgent.mcpModelName,
        }
      : null,
  );
  const [agentContinueCodingMode, setAgentContinueCodingMode] = useState(
    initialAgent?.mcpCodingMode ?? false,
  );
  const [agentAutocompleteModel, setAgentAutocompleteModel] =
    useState<ChatModel | null>(
      initialAgent?.mcpAutocompleteModelProvider &&
        initialAgent?.mcpAutocompleteModelName
        ? {
            provider: initialAgent.mcpAutocompleteModelProvider,
            model: initialAgent.mcpAutocompleteModelName,
          }
        : null,
    );
  const [agentMcpPresentationMode, setAgentMcpPresentationMode] =
    useState<AgentMcpPresentationMode>(
      initialAgent?.mcpPresentationMode === MCP_PRESENTATION_COPILOT_NATIVE
        ? MCP_PRESENTATION_COPILOT_NATIVE
        : MCP_PRESENTATION_COMPATIBILITY,
    );
  const [activeTab, setActiveTab] = useState("details");
  const [browserOrigin, setBrowserOrigin] = useState("");

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isInstructionReviewActive = instructionReview !== null;

  // Initialize agent state with initial data or defaults
  const [agent, setAgent] = useObjectState(initialAgent || defaultConfig());

  const { toggleBookmark, isLoading: isBookmarkToggleLoadingFn } = useBookmark({
    itemType: "agent",
  });
  const isBookmarkToggleLoading = useMemo(
    () =>
      (initialAgent?.id && isBookmarkToggleLoadingFn(initialAgent?.id)) ||
      false,
    [initialAgent?.id, isBookmarkToggleLoadingFn],
  );
  const agentMcpLocalStorageKey = useMemo(
    () =>
      initialAgent?.id ? `emma:agent-mcp-api-key:${initialAgent.id}` : null,
    [initialAgent?.id],
  );
  const showAgentAccessTab =
    !initialAgent || initialAgent.agentType !== "snowflake_cortex";
  const showDashboardTab = showAgentAccessTab && isOwner;
  const agentMcpPath = initialAgent?.id
    ? `/api/mcp/agent/${initialAgent.id}`
    : "";
  const agentMcpUrl = browserOrigin
    ? `${browserOrigin}${agentMcpPath}`
    : agentMcpPath;
  const agentContinueApiBasePath = initialAgent?.id
    ? `/api/agent/${initialAgent.id}/openai/v1`
    : "";
  const agentContinueApiBase = browserOrigin
    ? `${browserOrigin}${agentContinueApiBasePath}`
    : agentContinueApiBasePath;
  const agentContinueModelId = useMemo(
    () => getExternalAgentOpenAiModelId(agent.name || initialAgent?.name),
    [agent.name, initialAgent?.name],
  );
  const agentContinueAutocompleteModelId = useMemo(
    () =>
      getExternalAgentAutocompleteOpenAiModelId(
        agent.name || initialAgent?.name,
      ),
    [agent.name, initialAgent?.name],
  );

  const { data: mcpList, isLoading: isMcpLoading } = useMcpList();
  const { data: workflowToolList, isLoading: isWorkflowLoading } =
    useWorkflowToolList();
  const { data: chatModelProviders, isLoading: isChatModelsLoading } =
    useChatModels();

  const mcpModelProviders = useMemo(
    () =>
      (chatModelProviders ?? [])
        .map((provider) => ({
          provider: provider.provider,
          models: provider.models.filter((item) => !item.isToolCallUnsupported),
        }))
        .filter((provider) => provider.models.length > 0),
    [chatModelProviders],
  );
  const autocompleteModelProviders = useMemo(
    () =>
      (chatModelProviders ?? [])
        .map((provider) => ({
          provider: provider.provider,
          models: provider.models,
        }))
        .filter((provider) => provider.models.length > 0),
    [chatModelProviders],
  );
  const isAgentMcpModelAvailable = useMemo(() => {
    if (!agentMcpModel) return true;

    return mcpModelProviders.some((provider) => {
      if (provider.provider !== agentMcpModel.provider) return false;
      return provider.models.some(
        (model) => model.name === agentMcpModel.model,
      );
    });
  }, [agentMcpModel, mcpModelProviders]);
  const agentMcpModelValue = useMemo(() => {
    if (!agentMcpModel || !isAgentMcpModelAvailable) {
      return MCP_MODEL_AUTO_VALUE;
    }

    return makeMcpModelValue(agentMcpModel);
  }, [agentMcpModel, isAgentMcpModelAvailable]);
  const isAgentAutocompleteModelAvailable = useMemo(() => {
    if (!agentAutocompleteModel) return true;

    return autocompleteModelProviders.some((provider) => {
      if (provider.provider !== agentAutocompleteModel.provider) return false;
      return provider.models.some(
        (model) => model.name === agentAutocompleteModel.model,
      );
    });
  }, [agentAutocompleteModel, autocompleteModelProviders]);
  const agentAutocompleteModelValue = useMemo(() => {
    if (!agentAutocompleteModel || !isAgentAutocompleteModelAvailable) {
      return MCP_AUTOCOMPLETE_MODEL_NONE_VALUE;
    }

    return makeMcpModelValue(agentAutocompleteModel);
  }, [agentAutocompleteModel, isAgentAutocompleteModelAvailable]);

  const assignToolsByNames = useCallback(
    (toolNames: string[]) => {
      const allMentions: ChatMention[] = [];

      objectFlow(DefaultToolName).forEach((toolName) => {
        if (toolNames.includes(toolName)) {
          allMentions.push({
            type: "defaultTool",
            name: toolName,
            label: toolName,
          });
        }
      });

      (mcpList as (MCPServerInfo & { id: string })[])?.forEach((mcp) => {
        mcp.toolInfo.forEach((tool) => {
          if (toolNames.includes(tool.name)) {
            allMentions.push({
              type: "mcpTool",
              serverName: mcp.name,
              name: tool.name,
              serverId: mcp.id,
            });
          }
        });
      });

      (workflowToolList as WorkflowSummary[])?.forEach((workflow) => {
        if (toolNames.includes(workflow.name)) {
          allMentions.push({
            type: "workflow",
            name: workflow.name,
            workflowId: workflow.id,
          });
        }
      });

      if (allMentions.length > 0) {
        setAgent((prev) => ({
          instructions: {
            ...prev.instructions,
            mentions: allMentions,
          },
        }));
      }
    },
    [mcpList, workflowToolList, setAgent],
  );

  // Returns ChatMention[] for a list of raw tool name strings.
  // Used when applying AI-generated subagents whose tools are plain strings.
  const resolveMentionsFromNames = useCallback(
    (toolNames: string[]): ChatMention[] => {
      const mentions: ChatMention[] = [];

      objectFlow(DefaultToolName).forEach((toolName) => {
        if (toolNames.includes(toolName)) {
          mentions.push({
            type: "defaultTool",
            name: toolName,
            label: toolName,
          });
        }
      });

      (mcpList as (MCPServerInfo & { id: string })[])?.forEach((mcp) => {
        mcp.toolInfo.forEach((tool) => {
          if (toolNames.includes(tool.name)) {
            mentions.push({
              type: "mcpTool",
              serverName: mcp.name,
              name: tool.name,
              serverId: mcp.id,
            });
          }
        });
      });

      (workflowToolList as WorkflowSummary[])?.forEach((workflow) => {
        if (toolNames.includes(workflow.name)) {
          mentions.push({
            type: "workflow",
            name: workflow.name,
            workflowId: workflow.id,
          });
        }
      });

      return mentions;
    },
    [mcpList, workflowToolList],
  );

  const syncKnowledgeGroups = useCallback(
    async (agentId: string) => {
      const current = (initialAgent as any)?.knowledgeGroups ?? [];
      const currentIds = new Set(current.map((g: any) => g.id));
      const newIds = new Set(knowledgeGroups.map((g) => g.id));

      const toAdd = knowledgeGroups.filter((g) => !currentIds.has(g.id));
      const toRemove = current.filter((g: any) => !newIds.has(g.id));

      await Promise.all([
        ...toAdd.map((g) =>
          fetch(`/api/agent/${agentId}/knowledge`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ groupId: g.id }),
          }),
        ),
        ...toRemove.map((g: any) =>
          fetch(`/api/agent/${agentId}/knowledge`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ groupId: g.id }),
          }),
        ),
      ]);
    },
    [knowledgeGroups, initialAgent],
  );

  const syncSkills = useCallback(
    async (agentId: string) => {
      const current = (initialAgent as any)?.skills ?? [];
      const targetSkills = skillsEnabled ? skills : [];
      const currentIds = new Set(current.map((skill: any) => skill.id));
      const newIds = new Set(targetSkills.map((skill) => skill.id));

      const toAdd = targetSkills.filter((skill) => !currentIds.has(skill.id));
      const toRemove = current.filter((skill: any) => !newIds.has(skill.id));

      await Promise.all([
        ...toAdd.map((skill) =>
          fetch(`/api/agent/${agentId}/skill`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ skillId: skill.id }),
          }),
        ),
        ...toRemove.map((skill: any) =>
          fetch(`/api/agent/${agentId}/skill`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ skillId: skill.id }),
          }),
        ),
      ]);
    },
    [skills, skillsEnabled, initialAgent],
  );

  const syncSkillGroups = useCallback(
    async (agentId: string) => {
      const current = (initialAgent as any)?.skillGroups ?? [];
      const targetGroups = skillsEnabled ? skillGroups : [];
      const currentIds = new Set(current.map((group: any) => group.id));
      const newIds = new Set(targetGroups.map((group) => group.id));

      const toAdd = targetGroups.filter((group) => !currentIds.has(group.id));
      const toRemove = current.filter((group: any) => !newIds.has(group.id));

      await Promise.all([
        ...toAdd.map((group) =>
          fetch(`/api/agent/${agentId}/skill-group`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ groupId: group.id }),
          }),
        ),
        ...toRemove.map((group: any) =>
          fetch(`/api/agent/${agentId}/skill-group`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ groupId: group.id }),
          }),
        ),
      ]);
    },
    [skillGroups, skillsEnabled, initialAgent],
  );

  const saveAgent = useCallback(() => {
    if (initialAgent) {
      safe(() => setIsSaving(true))
        .map(() => AgentUpdateSchema.parse({ ...agent, subAgentsEnabled }))
        .map((parsed) =>
          JSON.stringify({
            ...parsed,
            subAgents: subAgents.map(
              ({ id, agentId, createdAt, updatedAt, ...rest }) => rest,
            ),
          }),
        )
        .map(async (body) =>
          fetcher(`/api/agent/${initialAgent.id}`, {
            method: "PUT",
            body,
          }),
        )
        .ifOk(async (updatedAgent) => {
          await Promise.all([
            syncKnowledgeGroups(initialAgent.id),
            syncSkills(initialAgent.id),
            syncSkillGroups(initialAgent.id),
          ]);
          mutateAgents(updatedAgent);
          toast.success(t("Agent.updated"));
          router.push(`/agents`);
        })
        .ifFail(handleErrorWithToast)
        .watch(() => setIsSaving(false));
    } else {
      safe(() => setIsSaving(true))
        .map(() =>
          AgentCreateSchema.parse({ ...agent, userId, subAgentsEnabled }),
        )
        .map((parsed) =>
          JSON.stringify({
            ...parsed,
            subAgents: subAgents.map(
              ({ id, agentId, createdAt, updatedAt, ...rest }) => rest,
            ),
          }),
        )
        .map(async (body) => {
          return fetcher(`/api/agent`, {
            method: "POST",
            body,
          });
        })
        .ifOk(async (updatedAgent) => {
          if (updatedAgent?.id) {
            await Promise.all([
              syncKnowledgeGroups(updatedAgent.id),
              syncSkills(updatedAgent.id),
              syncSkillGroups(updatedAgent.id),
            ]);
          }
          mutateAgents(updatedAgent);
          toast.success(t("Agent.created"));
          router.push(`/agents`);
        })
        .ifFail(handleErrorWithToast)
        .watch(() => setIsSaving(false));
    }
  }, [
    agent,
    userId,
    mutateAgents,
    router,
    initialAgent,
    t,
    subAgents,
    subAgentsEnabled,
    syncKnowledgeGroups,
    syncSkills,
    syncSkillGroups,
  ]);

  const updateVisibility = useCallback(
    async (visibility: Visibility) => {
      if (initialAgent?.id) {
        safe(() => setIsVisibilityChangeLoading(true))
          .map(() => AgentUpdateSchema.parse({ visibility }))
          .map(JSON.stringify)
          .map(async (body) =>
            fetcher(`/api/agent/${initialAgent.id}`, {
              method: "PUT",
              body,
            }),
          )
          .ifOk(() => {
            setAgent({ visibility });
            mutateAgents({ id: initialAgent.id, visibility });
            toast.success(t("Agent.visibilityUpdated"));
          })
          .ifFail(handleErrorWithToast)
          .watch(() => setIsVisibilityChangeLoading(false));
      } else {
        setAgent({ visibility });
      }
    },
    [initialAgent?.id, mutateAgents, setAgent, setIsVisibilityChangeLoading, t],
  );

  const deleteAgent = useCallback(async () => {
    if (!initialAgent?.id) return;
    const ok = await notify.confirm({
      description: t("Agent.deleteConfirm"),
    });
    if (!ok) return;
    safe(() => setIsDeleting(true))
      .map(() =>
        fetcher(`/api/agent/${initialAgent.id}`, {
          method: "DELETE",
        }),
      )
      .ifOk(() => {
        mutateAgents({ id: initialAgent.id }, true);
        toast.success(t("Agent.deleted"));
        router.push("/agents");
      })
      .ifFail(handleErrorWithToast)
      .watch(() => setIsDeleting(false));
  }, [initialAgent?.id, mutateAgents, router, t]);

  const handleBookmarkToggle = useCallback(async () => {
    if (!initialAgent?.id || isBookmarkToggleLoading) return;
    safe(async () => {
      await toggleBookmark({
        id: initialAgent.id,
        isBookmarked: agent.isBookmarked,
      });
    })
      .ifOk(() => {
        setAgent({ isBookmarked: !agent.isBookmarked });
      })
      .ifFail(handleErrorWithToast);
  }, [
    initialAgent?.id,
    toggleBookmark,
    agent.isBookmarked,
    isBookmarkToggleLoading,
  ]);

  useEffect(() => {
    setBrowserOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    if (!showAgentAccessTab && activeTab !== "details") {
      setActiveTab("details");
      return;
    }

    if (!showDashboardTab && activeTab === "dashboard") {
      setActiveTab("details");
    }
  }, [activeTab, showAgentAccessTab, showDashboardTab]);

  useEffect(() => {
    if (!agentMcpLocalStorageKey || typeof window === "undefined") return;

    const removeStored = () => {
      localStorage.removeItem(agentMcpLocalStorageKey);
    };

    try {
      const raw = localStorage.getItem(agentMcpLocalStorageKey);
      if (!raw) return;

      const parsed = JSON.parse(raw) as { key?: string; preview?: string };
      if (!parsed?.key) {
        removeStored();
        return;
      }

      const storedPreview = parsed.preview || parsed.key.slice(-4);
      const serverPreview =
        initialAgent?.mcpApiKeyPreview ||
        initialAgent?.a2aApiKeyPreview ||
        null;

      if (!serverPreview || storedPreview !== serverPreview) {
        removeStored();
        return;
      }

      setAgentMcpApiKey(parsed.key);
      setAgentMcpKeyPreview(serverPreview);
    } catch {
      removeStored();
    }
  }, [
    agentMcpLocalStorageKey,
    initialAgent?.a2aApiKeyPreview,
    initialAgent?.mcpApiKeyPreview,
  ]);

  const copyToClipboard = useCallback(
    (text: string) => {
      navigator.clipboard.writeText(text);
      toast.success(t("Agent.agentMcpCopied"));
    },
    [t],
  );

  const handleGenerateAgentMcpKey = useCallback(async () => {
    if (!initialAgent?.id || !agentMcpLocalStorageKey) return;
    setIsAgentMcpGeneratingKey(true);
    try {
      const res = await fetch(`/api/agent/${initialAgent.id}/mcp-key`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate" }),
      });
      if (!res.ok) {
        throw new Error("Failed to generate key");
      }
      const data = await res.json();
      setAgentMcpApiKey(data.key);
      setAgentMcpKeyPreview(data.preview);
      localStorage.setItem(
        agentMcpLocalStorageKey,
        JSON.stringify({
          key: data.key,
          preview: data.preview,
          createdAt: Date.now(),
        }),
      );
      toast.success(t("Agent.agentMcpKeyGenerated"));
    } catch {
      toast.error(t("Agent.agentMcpKeyGenerateFailed"));
    } finally {
      setIsAgentMcpGeneratingKey(false);
    }
  }, [agentMcpLocalStorageKey, initialAgent?.id, t]);

  const handleRevokeAgentMcpKey = useCallback(async () => {
    if (!initialAgent?.id || !agentMcpLocalStorageKey) return;
    setIsAgentMcpRevokingKey(true);
    try {
      const res = await fetch(`/api/agent/${initialAgent.id}/mcp-key`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revoke" }),
      });
      if (!res.ok) {
        throw new Error("Failed to revoke key");
      }
      localStorage.removeItem(agentMcpLocalStorageKey);
      setAgentMcpApiKey(null);
      setAgentMcpKeyPreview(null);
      toast.success(t("Agent.agentMcpKeyRevoked"));
    } catch {
      toast.error(t("Agent.agentMcpKeyRevokeFailed"));
    } finally {
      setIsAgentMcpRevokingKey(false);
    }
  }, [agentMcpLocalStorageKey, initialAgent?.id, t]);

  const handleToggleAgentMcp = useCallback(
    async (enabled: boolean) => {
      if (!initialAgent?.id) return;
      setIsAgentMcpToggling(true);
      try {
        const res = await fetch(`/api/agent/${initialAgent.id}/mcp-key`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled }),
        });
        if (!res.ok) {
          throw new Error("Failed to toggle MCP");
        }
        setAgentMcpEnabled(enabled);
        toast.success(
          enabled ? t("Agent.agentMcpEnabled") : t("Agent.agentMcpDisabled"),
        );
      } catch {
        toast.error(t("Agent.agentMcpToggleFailed"));
      } finally {
        setIsAgentMcpToggling(false);
      }
    },
    [initialAgent?.id, t],
  );

  const handleChangeAgentMcpModel = useCallback(
    async (value: string) => {
      if (!initialAgent?.id) return;

      const parsedModel = parseMcpModelValue(value);

      setIsAgentMcpUpdatingModel(true);
      try {
        const res = await fetch(`/api/agent/${initialAgent.id}/mcp-key`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: parsedModel,
          }),
        });

        if (!res.ok) {
          throw new Error("Failed to update MCP model");
        }

        setAgentMcpModel(parsedModel);
        toast.success(
          parsedModel
            ? t("Agent.agentMcpModelUpdated")
            : t("Agent.agentMcpModelAutoSelected"),
        );
      } catch {
        toast.error(t("Agent.agentMcpModelUpdateFailed"));
      } finally {
        setIsAgentMcpUpdatingModel(false);
      }
    },
    [initialAgent?.id, t],
  );

  const handleToggleAgentContinueCodingMode = useCallback(
    async (enabled: boolean) => {
      if (!initialAgent?.id) return;

      setIsAgentContinueUpdatingCodingMode(true);
      try {
        const res = await fetch(`/api/agent/${initialAgent.id}/mcp-key`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            codingMode: enabled,
          }),
        });

        if (!res.ok) {
          throw new Error("Failed to update coding mode");
        }

        setAgentContinueCodingMode(enabled);
        toast.success(
          enabled
            ? t("Agent.agentContinueCodingModeEnabled")
            : t("Agent.agentContinueCodingModeDisabled"),
        );
      } catch {
        toast.error(t("Agent.agentContinueCodingModeUpdateFailed"));
      } finally {
        setIsAgentContinueUpdatingCodingMode(false);
      }
    },
    [initialAgent?.id, t],
  );

  const handleToggleAgentChatPersonalization = useCallback(
    async (enabled: boolean) => {
      if (!initialAgent?.id) return;

      setIsAgentChatPersonalizationUpdating(true);
      try {
        const res = await fetch(`/api/agent/${initialAgent.id}/mcp-key`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chatPersonalizationEnabled: enabled,
          }),
        });

        if (!res.ok) {
          throw new Error("Failed to update chat personalization");
        }

        setAgentChatPersonalizationEnabled(enabled);
        setAgent({ chatPersonalizationEnabled: enabled });
        toast.success(
          enabled
            ? t("Agent.agentChatPersonalizationEnabled")
            : t("Agent.agentChatPersonalizationDisabled"),
        );
      } catch {
        toast.error(t("Agent.agentChatPersonalizationUpdateFailed"));
      } finally {
        setIsAgentChatPersonalizationUpdating(false);
      }
    },
    [initialAgent?.id, setAgent, t],
  );

  const handleChangeAgentAutocompleteModel = useCallback(
    async (value: string) => {
      if (!initialAgent?.id) return;

      const parsedModel =
        value === MCP_AUTOCOMPLETE_MODEL_NONE_VALUE
          ? null
          : parseMcpModelValue(value);

      setIsAgentContinueUpdatingAutocompleteModel(true);
      try {
        const res = await fetch(`/api/agent/${initialAgent.id}/mcp-key`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            autocompleteModel: parsedModel,
          }),
        });

        if (!res.ok) {
          throw new Error("Failed to update autocomplete model");
        }

        setAgentAutocompleteModel(parsedModel);
        toast.success(
          parsedModel
            ? t("Agent.agentContinueAutocompleteModelUpdated")
            : t("Agent.agentContinueAutocompleteModelCleared"),
        );
      } catch {
        toast.error(t("Agent.agentContinueAutocompleteModelUpdateFailed"));
      } finally {
        setIsAgentContinueUpdatingAutocompleteModel(false);
      }
    },
    [initialAgent?.id, t],
  );

  const handleChangeAgentMcpPresentationMode = useCallback(
    async (value: string) => {
      if (!initialAgent?.id) return;

      const presentationMode =
        value === MCP_PRESENTATION_COPILOT_NATIVE
          ? MCP_PRESENTATION_COPILOT_NATIVE
          : MCP_PRESENTATION_COMPATIBILITY;

      setIsAgentMcpUpdatingPresentationMode(true);
      try {
        const res = await fetch(`/api/agent/${initialAgent.id}/mcp-key`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            presentationMode,
          }),
        });

        if (!res.ok) {
          throw new Error("Failed to update MCP presentation mode");
        }

        setAgentMcpPresentationMode(presentationMode);
        toast.success(t("Agent.agentMcpPresentationModeUpdated"));
      } catch {
        toast.error(t("Agent.agentMcpPresentationModeUpdateFailed"));
      } finally {
        setIsAgentMcpUpdatingPresentationMode(false);
      }
    },
    [initialAgent?.id, t],
  );

  const handleApplyInstructionEnhancement = useCallback(
    (nextInstructions: string) => {
      const before = agent.instructions?.systemPrompt || "";

      setAgent((prev) => ({
        instructions: {
          ...prev.instructions,
          systemPrompt: nextInstructions,
        },
      }));
      setInstructionReview({
        before,
        after: nextInstructions,
      });

      if (textareaRef.current) {
        textareaRef.current.scrollTo({
          top: 0,
        });
      }
    },
    [agent.instructions?.systemPrompt, setAgent],
  );

  const handleAcceptInstructionEnhancement = useCallback(() => {
    setInstructionReview(null);
  }, []);

  const handleCancelInstructionEnhancement = useCallback(() => {
    if (!instructionReview) {
      return;
    }

    setAgent((prev) => ({
      instructions: {
        ...prev.instructions,
        systemPrompt: instructionReview.before,
      },
    }));
    setInstructionReview(null);
  }, [instructionReview, setAgent]);
  const handleAgentChange = useCallback(
    (generatedData: any) => {
      if (textareaRef.current) {
        textareaRef.current.scrollTo({
          top: textareaRef.current.scrollHeight,
        });
      }
      setInstructionReview(null);
      setAgent((prev) => {
        const update: Partial<Agent> = {};
        objectFlow(generatedData).forEach((data, key) => {
          if (key === "name") {
            update.name = data as string;
          }
          if (key === "description") {
            update.description = data as string;
          }
          if (key === "instructions") {
            update.instructions = {
              ...prev.instructions,
              systemPrompt: data as string,
            };
          }
          if (key === "role") {
            update.instructions = {
              ...prev.instructions,
              role: data as string,
            };
          }
        });
        return { ...prev, ...update };
      });

      // Handle generated subagents from the AI
      if (generatedData?.subAgentsEnabled === true) {
        setSubAgentsEnabled(true);
      }
      if (
        Array.isArray(generatedData?.subAgents) &&
        generatedData.subAgents.length > 0
      ) {
        const generated = (generatedData.subAgents as any[])
          .filter((sa) => sa?.name)
          .map((sa, i) => ({
            id: `generated-${i}-${Date.now()}`,
            agentId: "",
            name: sa.name ?? "",
            description: sa.description ?? "",
            instructions: sa.instructions ?? "",
            tools: resolveMentionsFromNames(
              Array.isArray(sa.tools)
                ? (sa.tools as string[]).filter(Boolean)
                : [],
            ),
            enabled: true,
            sortOrder: i,
            createdAt: new Date(),
            updatedAt: new Date(),
          }));
        setSubAgents(generated);
        setSubAgentsEnabled(true);
      }
    },
    [resolveMentionsFromNames],
  );

  const isLoadingTool = useMemo(() => {
    return isMcpLoading || isWorkflowLoading;
  }, [isMcpLoading, isWorkflowLoading]);
  const agentMcpConfig = useMemo(
    () =>
      JSON.stringify(
        {
          type: "http",
          url: agentMcpUrl || "https://your-domain/api/mcp/agent/{agentId}",
          headers: {
            Authorization: `Bearer ${agentMcpApiKey ?? "YOUR_AGENT_API_KEY"}`,
          },
        },
        null,
        2,
      ),
    [agentMcpApiKey, agentMcpUrl],
  );
  const continueAgentSystemMessage = useMemo(
    () =>
      buildContinueAgentSystemMessage(
        agent.name || initialAgent?.name || undefined,
      ),
    [agent.name, initialAgent?.name],
  );
  const continuePlanSystemMessage = useMemo(
    () =>
      buildContinuePlanSystemMessage(
        agent.name || initialAgent?.name || undefined,
      ),
    [agent.name, initialAgent?.name],
  );
  const agentContinueConfig = useMemo(
    () =>
      [
        `- name: ${yamlScalar(agent.name || "Emma Agent")}`,
        "  provider: openai",
        `  model: ${yamlScalar(agentContinueModelId)}`,
        `  apiBase: ${yamlScalar(
          agentContinueApiBase ||
            "https://your-domain/api/agent/{agentId}/openai/v1",
        )}`,
        `  apiKey: ${yamlScalar(agentMcpApiKey ?? "YOUR_AGENT_API_KEY")}`,
        "  roles:",
        "    - chat",
        "    - edit",
        "    - apply",
        "  capabilities:",
        "    - tool_use",
        ...(agentContinueCodingMode
          ? [
              "  chatOptions:",
              `    baseAgentSystemMessage: ${yamlScalar(
                continueAgentSystemMessage,
              )}`,
              `    basePlanSystemMessage: ${yamlScalar(
                continuePlanSystemMessage,
              )}`,
            ]
          : []),
        "",
        ...(agentAutocompleteModel
          ? []
          : [t("Agent.agentContinueConfigAutocompleteWarning")]),
        `- name: ${yamlScalar(`${agent.name || "Emma Agent"} Autocomplete`)}`,
        "  provider: openai",
        `  model: ${yamlScalar(agentContinueAutocompleteModelId)}`,
        `  apiBase: ${yamlScalar(
          agentContinueApiBase ||
            "https://your-domain/api/agent/{agentId}/openai/v1",
        )}`,
        `  apiKey: ${yamlScalar(agentMcpApiKey ?? "YOUR_AGENT_API_KEY")}`,
        "  roles:",
        "    - autocomplete",
        "  useLegacyCompletionsEndpoint: true",
      ].join("\n"),
    [
      agent.name,
      agentAutocompleteModel,
      agentContinueApiBase,
      agentContinueAutocompleteModelId,
      agentContinueCodingMode,
      agentContinueModelId,
      agentMcpApiKey,
      continueAgentSystemMessage,
      continuePlanSystemMessage,
      t,
    ],
  );
  const isAgentMcpBusy = useMemo(
    () =>
      isAgentMcpGeneratingKey ||
      isAgentMcpRevokingKey ||
      isAgentMcpToggling ||
      isAgentMcpUpdatingModel ||
      isAgentChatPersonalizationUpdating ||
      isAgentContinueUpdatingCodingMode ||
      isAgentContinueUpdatingAutocompleteModel ||
      isAgentMcpUpdatingPresentationMode,
    [
      isAgentMcpGeneratingKey,
      isAgentMcpRevokingKey,
      isAgentMcpToggling,
      isAgentMcpUpdatingModel,
      isAgentChatPersonalizationUpdating,
      isAgentContinueUpdatingCodingMode,
      isAgentContinueUpdatingAutocompleteModel,
      isAgentMcpUpdatingPresentationMode,
    ],
  );
  const agentMcpVisibleToolsDescription = useMemo(() => {
    return agentMcpPresentationMode === MCP_PRESENTATION_COPILOT_NATIVE
      ? t("Agent.agentMcpToolInventoryNative")
      : t("Agent.agentMcpToolInventoryCompatibility");
  }, [agentMcpPresentationMode, t]);

  const isLoading = useMemo(() => {
    return (
      isLoadingTool ||
      isSaving ||
      isDeleting ||
      isVisibilityChangeLoading ||
      isBookmarkToggleLoading
    );
  }, [
    isLoadingTool,
    isSaving,
    isDeleting,
    isVisibilityChangeLoading,
    isBookmarkToggleLoading,
  ]);

  const isGenerating = openGenerateAgentDialog;

  return (
    <ScrollArea className="h-full w-full relative">
      <div className="w-full h-8 absolute bottom-0 left-0 bg-gradient-to-t from-background to-transparent z-20 pointer-events-none" />
      <div className="z-10 relative flex flex-col gap-4 px-8 pt-8 pb-14 max-w-3xl h-full mx-auto">
        <div className="sticky top-0 bg-background z-10 flex flex-wrap items-center justify-between pb-4 gap-2">
          <div className="w-full h-8 absolute top-[100%] left-0 bg-gradient-to-b from-background to-transparent z-20 pointer-events-none" />
          {isGenerating ? (
            <TextShimmer className="min-w-0 flex-1 text-2xl font-bold">
              {t("Agent.generatingAgent")}
            </TextShimmer>
          ) : (
            <p className="min-w-0 flex-1 text-2xl font-bold">
              {t("Agent.title")}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2">
            {hasEditAccess && !initialAgent && (
              <>
                <Button
                  variant="ghost"
                  disabled={isLoading}
                  onClick={() => setOpenGenerateAgentDialog(true)}
                  data-testid="agent-generate-with-ai-button"
                >
                  <WandSparklesIcon className="size-3" />
                  {t("Common.generateWithAI")}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      className="justify-between data-[state=open]:bg-input"
                      disabled={isLoading}
                      data-testid="agent-create-with-example-button"
                    >
                      {t("Common.createWithExample")}
                      <ChevronDownIcon className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-54" align="end">
                    <DropdownMenuItem
                      onClick={() => setAgent(RandomDataGeneratorExample)}
                    >
                      <div className="flex items-center gap-2">
                        <span>ðŸŽ²</span>
                        <span>Generate Random Data</span>
                      </div>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      data-testid="agent-create-with-example-weather-button"
                      onClick={() => setAgent(WeatherExample)}
                    >
                      <div className="flex items-center gap-2">
                        <span>ðŸŒ¤ï¸</span>
                        <span>Weather Checker</span>
                      </div>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}

            {hasEditAccess && !initialAgent && (
              <Button
                onClick={saveAgent}
                disabled={
                  isLoading || !hasEditAccess || isInstructionReviewActive
                }
                data-testid="agent-save-button"
              >
                {isSaving ? (
                  <Loader className="size-4 animate-spin" />
                ) : (
                  <SaveIcon className="size-4" />
                )}
                {isSaving ? t("Common.saving") : t("Common.save")}
              </Button>
            )}

            {hasEditAccess && initialAgent && (
              <>
                {isOwner && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={deleteAgent}
                    disabled={isLoading}
                    aria-label={t("Common.delete")}
                    title={t("Common.delete")}
                  >
                    {isDeleting ? (
                      <Loader className="size-4 animate-spin" />
                    ) : (
                      <Trash2Icon className="size-4" />
                    )}
                  </Button>
                )}

                <Button
                  onClick={saveAgent}
                  disabled={
                    isLoading || !hasEditAccess || isInstructionReviewActive
                  }
                  data-testid="agent-save-button"
                >
                  {isSaving ? (
                    <Loader className="size-4 animate-spin" />
                  ) : (
                    <SaveIcon className="size-4" />
                  )}
                  {isSaving ? t("Common.saving") : t("Common.save")}
                </Button>
              </>
            )}

            {initialAgent && (
              <div className="flex items-center gap-2">
                <ShareableActions
                  type="agent"
                  visibility={agent.visibility || "private"}
                  isBookmarked={agent?.isBookmarked || false}
                  isOwner={isOwner}
                  onVisibilityChange={updateVisibility}
                  isVisibilityChangeLoading={isVisibilityChangeLoading}
                  disabled={isLoading}
                  onBookmarkToggle={handleBookmarkToggle}
                  isBookmarkToggleLoading={isBookmarkToggleLoading}
                />
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-4 mt-4">
          <div className="flex flex-col justify-between gap-2 flex-1">
            <Label htmlFor="agent-name">
              {t("Agent.agentNameAndIconLabel")}
            </Label>
            {false ? (
              <Skeleton className="w-full h-10" />
            ) : (
              <Input
                value={agent.name || ""}
                onChange={(e) => setAgent({ name: e.target.value })}
                autoFocus
                disabled={isLoading || !hasEditAccess}
                className="hover:bg-input bg-secondary/40 transition-colors border-transparent border-none! focus-visible:bg-input! ring-0!"
                id="agent-name"
                data-testid="agent-name-input"
                placeholder={t("Agent.agentNamePlaceholder")}
                readOnly={!hasEditAccess}
              />
            )}
          </div>
          {false ? (
            <Skeleton className="w-16 h-16" />
          ) : (
            <AgentIconPicker
              icon={agent.icon}
              disabled={!hasEditAccess}
              onChange={(icon) => setAgent({ icon })}
            />
          )}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="agent-description">
            {t("Agent.agentDescriptionLabel")}
          </Label>
          {false ? (
            <Skeleton className="w-full h-10" />
          ) : (
            <Input
              id="agent-description"
              data-testid="agent-description-input"
              disabled={isLoading || !hasEditAccess}
              placeholder={t("Agent.agentDescriptionPlaceholder")}
              className="hover:bg-input placeholder:text-xs bg-secondary/40 transition-colors border-transparent border-none! focus-visible:bg-input! ring-0!"
              value={agent.description || ""}
              onChange={(e) => setAgent({ description: e.target.value })}
              readOnly={!hasEditAccess}
            />
          )}
        </div>

        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="w-full mt-2 gap-4"
        >
          <TabsList
            className={cn(
              "grid w-full",
              showAgentAccessTab && showDashboardTab
                ? "max-w-md grid-cols-3"
                : showAgentAccessTab
                  ? "max-w-xs grid-cols-2"
                  : "max-w-[140px] grid-cols-1",
            )}
          >
            <TabsTrigger value="details">
              {t("Agent.agentMcpTabDetails")}
            </TabsTrigger>
            {showAgentAccessTab && (
              <TabsTrigger value="agent-access">
                {t("Agent.agentAccessTabLabel")}
              </TabsTrigger>
            )}
            {showDashboardTab && (
              <TabsTrigger value="dashboard" disabled={!initialAgent}>
                {t("Agent.agentDashboardTabLabel")}
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="details" className="flex flex-col gap-6 mt-2">
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                {t("Agent.agentSettingsDescription")}
              </p>
            </div>

            <div className="flex gap-2 items-center">
              <span>{t("Agent.thisAgentIs")}</span>
              {false ? (
                <Skeleton className="w-44 h-10" />
              ) : (
                <Input
                  id="agent-role"
                  data-testid="agent-role-input"
                  disabled={isLoading || !hasEditAccess}
                  placeholder={t("Agent.agentRolePlaceholder")}
                  className="hover:bg-input placeholder:text-xs bg-secondary/40 w-44 transition-colors border-transparent border-none! focus-visible:bg-input! ring-0!"
                  value={agent.instructions?.role || ""}
                  onChange={(e) =>
                    setAgent({
                      instructions: {
                        ...agent.instructions,
                        role: e.target.value || "",
                      },
                    })
                  }
                  readOnly={!hasEditAccess}
                />
              )}
              <span>{t("Agent.expertIn")}</span>
            </div>

            <div className="flex gap-2 flex-col">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="agent-prompt" className="text-base">
                  {t("Agent.agentInstructionsLabel")}
                </Label>
                {hasEditAccess && initialAgent && (
                  <AgentInstructionEnhancePopover
                    currentInstructions={agent.instructions?.systemPrompt || ""}
                    agentContext={{
                      name: agent.name || "",
                      description: agent.description || "",
                      role: agent.instructions?.role || "",
                    }}
                    disabled={isLoading || isInstructionReviewActive}
                    iconOnly
                    onGenerated={handleApplyInstructionEnhancement}
                  />
                )}
              </div>
              {false ? (
                <Skeleton className="w-full h-48" />
              ) : (
                <Textarea
                  id="agent-prompt"
                  data-testid="agent-prompt-textarea"
                  ref={textareaRef}
                  disabled={isLoading || !hasEditAccess}
                  placeholder={t("Agent.agentInstructionsPlaceholder")}
                  className={cn(
                    "p-6 hover:bg-input min-h-48 max-h-96 overflow-y-auto resize-none placeholder:text-xs bg-secondary/40 transition-colors border-transparent border-none! focus-visible:bg-input! ring-0!",
                    isInstructionReviewActive &&
                      "cursor-not-allowed opacity-90",
                  )}
                  value={agent.instructions?.systemPrompt || ""}
                  onChange={(e) =>
                    setAgent({
                      instructions: {
                        ...agent.instructions,
                        systemPrompt: e.target.value || "",
                      },
                    })
                  }
                  readOnly={!hasEditAccess || isInstructionReviewActive}
                />
              )}
              {instructionReview && (
                <>
                  <AgentInstructionDiffPreview
                    before={instructionReview.before}
                    after={instructionReview.after}
                  />
                  <div
                    className="flex flex-wrap items-center justify-between gap-3"
                    data-testid="agent-instruction-review-actions"
                  >
                    <p className="text-xs text-muted-foreground">
                      {t("Agent.instructionsAiAcceptHint")}
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={handleCancelInstructionEnhancement}
                        data-testid="agent-instruction-review-cancel-button"
                      >
                        {t("Common.cancel")}
                      </Button>
                      <Button
                        type="button"
                        onClick={handleAcceptInstructionEnhancement}
                        data-testid="agent-instruction-review-accept-button"
                      >
                        {t("Agent.instructionsAiAccept")}
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="flex gap-2 flex-col">
              <Label htmlFor="agent-tool-bindings" className="text-base">
                {t("Agent.agentToolsLabel")}
              </Label>
              {false ? (
                <Skeleton className="w-full h-12" />
              ) : (
                <AgentToolSelector
                  mentions={agent.instructions?.mentions || []}
                  isLoading={isLoadingTool}
                  disabled={isLoading}
                  hasEditAccess={hasEditAccess}
                  onChange={(mentions) =>
                    setAgent({
                      instructions: {
                        ...agent.instructions,
                        mentions,
                      },
                    })
                  }
                />
              )}
            </div>

            <div className="flex gap-2 flex-col border-t pt-4 mt-2">
              <SubAgentSection
                agentId={initialAgent?.id}
                subAgents={subAgents}
                subAgentsEnabled={subAgentsEnabled}
                isLoadingTools={isLoadingTool}
                hasEditAccess={hasEditAccess}
                onChange={(newSubAgents, newEnabled) => {
                  setSubAgents(newSubAgents);
                  setSubAgentsEnabled(newEnabled);
                }}
              />
            </div>

            <div className="flex gap-2 flex-col border-t pt-4 mt-2">
              <KnowledgeAgentSection
                agentId={initialAgent?.id}
                knowledgeGroups={knowledgeGroups}
                enabled={knowledgeEnabled}
                hasEditAccess={hasEditAccess}
                onChange={(groups, enabled) => {
                  setKnowledgeGroups(groups);
                  setKnowledgeEnabled(enabled);
                }}
              />
            </div>

            <div className="flex gap-2 flex-col border-t pt-4 mt-2">
              <SkillAgentSection
                skills={skills}
                skillGroups={skillGroups}
                enabled={skillsEnabled}
                hasEditAccess={hasEditAccess}
                onChange={(updatedSkills, updatedGroups, enabled) => {
                  setSkills(updatedSkills);
                  setSkillGroups(updatedGroups);
                  setSkillsEnabled(enabled);
                }}
              />
            </div>
          </TabsContent>

          {showAgentAccessTab && (
            <TabsContent value="agent-access" className="mt-2">
              {!initialAgent && (
                <div className="border rounded-xl p-4 flex items-start gap-3">
                  <ShieldAlertIcon className="size-4 mt-0.5 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">
                      {t("Agent.agentAccessSaveFirstTitle")}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {t("Agent.agentAccessSaveFirstDescription")}
                    </p>
                  </div>
                </div>
              )}

              {initialAgent && !isOwner && (
                <div className="border rounded-xl p-4 flex items-start gap-3">
                  <ShieldAlertIcon className="size-4 mt-0.5 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">
                      {t("Agent.agentAccessOwnerOnlyTitle")}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {t("Agent.agentAccessOwnerOnlyDescription")}
                    </p>
                  </div>
                </div>
              )}

              {initialAgent && isOwner && (
                <div className="flex flex-col gap-4">
                  <div className="border rounded-xl p-4 flex flex-col gap-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <ServerIcon className="size-4 text-primary" />
                          <p className="text-sm font-medium">
                            {t("Agent.agentAccessTitle")}
                          </p>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {t("Agent.agentAccessDescription")}
                        </p>
                      </div>
                      <Switch
                        checked={agentMcpEnabled}
                        onCheckedChange={handleToggleAgentMcp}
                        disabled={isAgentMcpBusy}
                      />
                    </div>

                    <div className="space-y-2">
                      <p className="text-xs font-medium">
                        {t("Agent.agentMcpModelLabel")}
                      </p>
                      <Select
                        value={agentMcpModelValue}
                        onValueChange={handleChangeAgentMcpModel}
                        disabled={isAgentMcpBusy || isChatModelsLoading}
                      >
                        <SelectTrigger className="w-full h-8 text-xs">
                          <SelectValue
                            placeholder={t("Agent.agentMcpModelPlaceholder")}
                          />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={MCP_MODEL_AUTO_VALUE}>
                            {t("Agent.agentMcpModelAuto")}
                          </SelectItem>
                          {mcpModelProviders.map((provider) => (
                            <SelectGroup key={provider.provider}>
                              <SelectLabel>{provider.provider}</SelectLabel>
                              {provider.models.map((model) => (
                                <SelectItem
                                  key={`${provider.provider}:${model.name}`}
                                  value={makeMcpModelValue({
                                    provider: provider.provider,
                                    model: model.name,
                                  })}
                                >
                                  {model.name}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        {isChatModelsLoading
                          ? t("Agent.agentMcpModelLoading")
                          : !isAgentMcpModelAvailable
                            ? t("Agent.agentMcpModelUnavailable")
                            : mcpModelProviders.length > 0
                              ? t("Agent.agentMcpModelDescription")
                              : t("Agent.agentMcpModelNotFound")}
                      </p>
                    </div>

                    <div className="flex items-start justify-between gap-4 rounded-lg border bg-secondary/30 p-3">
                      <div className="space-y-1">
                        <p className="text-xs font-medium">
                          {t("Agent.agentChatPersonalizationLabel")}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {t("Agent.agentChatPersonalizationDescription")}
                        </p>
                      </div>
                      <Switch
                        checked={agentChatPersonalizationEnabled}
                        onCheckedChange={handleToggleAgentChatPersonalization}
                        disabled={isAgentMcpBusy}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label className="text-sm">
                        {t("Agent.agentMcpApiKeyLabel")}
                      </Label>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 px-3 py-2 rounded-lg border bg-secondary/40 text-xs font-mono break-all">
                          {agentMcpApiKey ? (
                            <span>{agentMcpApiKey}</span>
                          ) : agentMcpKeyPreview ? (
                            <span className="text-muted-foreground">
                              â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢
                              {agentMcpKeyPreview}
                            </span>
                          ) : (
                            <span className="text-muted-foreground italic">
                              {t("Agent.agentMcpNoKey")}
                            </span>
                          )}
                        </div>
                        {agentMcpApiKey && (
                          <Button
                            size="icon"
                            variant="outline"
                            className="size-9 shrink-0"
                            onClick={() => copyToClipboard(agentMcpApiKey)}
                          >
                            <CopyIcon className="size-3.5" />
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5 shrink-0"
                          onClick={handleGenerateAgentMcpKey}
                          disabled={isAgentMcpBusy}
                        >
                          {isAgentMcpGeneratingKey ? (
                            <RefreshCwIcon className="size-3.5 animate-spin" />
                          ) : (
                            <KeyIcon className="size-3.5" />
                          )}
                          {agentMcpKeyPreview
                            ? t("Agent.agentMcpRegenerate")
                            : t("Agent.agentMcpGenerate")}
                        </Button>
                      </div>
                      {agentMcpKeyPreview && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="px-0 text-xs text-muted-foreground hover:text-destructive w-fit"
                          onClick={handleRevokeAgentMcpKey}
                          disabled={isAgentMcpBusy}
                        >
                          {isAgentMcpRevokingKey && (
                            <RefreshCwIcon className="size-3.5 animate-spin mr-1" />
                          )}
                          {t("Agent.agentMcpRevoke")}
                        </Button>
                      )}
                    </div>
                  </div>

                  <Accordion type="multiple" className="space-y-4">
                    <AccordionItem
                      value="agent-a2a"
                      className="rounded-xl border px-4 last:border-b"
                    >
                      <AccordionTrigger className="py-4 hover:no-underline">
                        <div className="flex min-w-0 items-start gap-3 text-left">
                          <WaypointsIcon className="mt-0.5 size-4 text-primary" />
                          <div className="min-w-0 space-y-1">
                            <p className="text-sm font-medium">
                              Publish via A2A
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Expose this agent as a per-agent A2A server
                              endpoint.
                            </p>
                          </div>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent className="space-y-4 pb-4">
                        <A2APublishPanel
                          agentId={initialAgent.id}
                          initialEnabled={initialAgent.a2aEnabled ?? false}
                          initialPreview={agentMcpKeyPreview}
                          isOwner={isOwner}
                          embedded
                        />
                      </AccordionContent>
                    </AccordionItem>

                    <AccordionItem
                      value="agent-mcp"
                      className="rounded-xl border px-4 last:border-b"
                    >
                      <AccordionTrigger className="py-4 hover:no-underline">
                        <div className="flex min-w-0 items-start gap-3 text-left">
                          <ServerIcon className="mt-0.5 size-4 text-primary" />
                          <div className="min-w-0 space-y-1">
                            <p className="text-sm font-medium">
                              {t("Agent.agentMcpTitle")}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {t("Agent.agentMcpDescription")}
                            </p>
                          </div>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent className="space-y-4 pb-4">
                        <div className="space-y-2">
                          <p className="text-xs font-medium">
                            {t("Agent.agentMcpPresentationModeLabel")}
                          </p>
                          <Select
                            value={agentMcpPresentationMode}
                            onValueChange={handleChangeAgentMcpPresentationMode}
                            disabled={isAgentMcpBusy}
                          >
                            <SelectTrigger className="w-full h-8 text-xs">
                              <SelectValue
                                placeholder={t(
                                  "Agent.agentMcpPresentationModePlaceholder",
                                )}
                              />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem
                                value={MCP_PRESENTATION_COMPATIBILITY}
                              >
                                {t(
                                  "Agent.agentMcpPresentationModeCompatibility",
                                )}
                              </SelectItem>
                              <SelectItem
                                value={MCP_PRESENTATION_COPILOT_NATIVE}
                              >
                                {t(
                                  "Agent.agentMcpPresentationModeCopilotNative",
                                )}
                              </SelectItem>
                            </SelectContent>
                          </Select>
                          <p className="text-xs text-muted-foreground">
                            {agentMcpPresentationMode ===
                            MCP_PRESENTATION_COPILOT_NATIVE
                              ? t(
                                  "Agent.agentMcpPresentationModeNativeDescription",
                                )
                              : t(
                                  "Agent.agentMcpPresentationModeCompatibilityDescription",
                                )}
                          </p>
                        </div>

                        <div className="rounded-lg border bg-secondary/30 p-3 space-y-1">
                          <p className="text-xs font-medium">
                            {t("Agent.agentMcpToolInventoryLabel")}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {agentMcpVisibleToolsDescription}
                          </p>
                        </div>

                        <div className="rounded-lg border bg-secondary/30 p-3 space-y-1">
                          <p className="text-xs font-medium">
                            {t("Agent.agentMcpVisibilityLimitTitle")}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {t("Agent.agentMcpVisibilityLimitDescription")}
                          </p>
                        </div>

                        <div className="space-y-2">
                          <Label className="text-sm">
                            {t("Agent.agentMcpEndpointLabel")}
                          </Label>
                          <div className="flex items-center gap-2">
                            <div className="flex-1 px-3 py-2 rounded-lg border bg-secondary/40 text-xs font-mono truncate">
                              {agentMcpUrl}
                            </div>
                            <Button
                              size="icon"
                              variant="outline"
                              className="size-9 shrink-0"
                              onClick={() => copyToClipboard(agentMcpUrl)}
                            >
                              <CopyIcon className="size-3.5" />
                            </Button>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <Label className="text-sm">
                            {t("Agent.agentMcpConfigLabel")}
                          </Label>
                          <p className="text-xs text-muted-foreground">
                            {t("Agent.agentMcpAuthHint")}
                          </p>
                          <div className="relative">
                            <pre className="text-xs p-3 bg-secondary/40 border rounded-lg overflow-x-auto">
                              {agentMcpConfig}
                            </pre>
                            <Button
                              size="icon"
                              variant="outline"
                              className="size-7 absolute top-2 right-2"
                              onClick={() => copyToClipboard(agentMcpConfig)}
                            >
                              <CopyIcon className="size-3" />
                            </Button>
                          </div>
                        </div>
                      </AccordionContent>
                    </AccordionItem>

                    <AccordionItem
                      value="continue-openai"
                      className="rounded-xl border px-4 last:border-b"
                    >
                      <AccordionTrigger className="py-4 hover:no-underline">
                        <div className="flex min-w-0 items-start gap-3 text-left">
                          <WandSparklesIcon className="mt-0.5 size-4 text-primary" />
                          <div className="min-w-0 space-y-1">
                            <p className="text-sm font-medium">
                              {t("Agent.agentContinueTitle")}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {t("Agent.agentContinueDescription")}
                            </p>
                          </div>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent className="space-y-4 pb-4">
                        <div className="flex items-start justify-between gap-4 rounded-lg border bg-secondary/30 p-3">
                          <div className="space-y-1">
                            <p className="text-xs font-medium">
                              {t("Agent.agentContinueCodingModeLabel")}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {t("Agent.agentContinueCodingModeDescription")}
                            </p>
                          </div>
                          <Switch
                            checked={agentContinueCodingMode}
                            onCheckedChange={
                              handleToggleAgentContinueCodingMode
                            }
                            disabled={isAgentMcpBusy}
                          />
                        </div>

                        <div className="rounded-lg border bg-secondary/30 p-3 space-y-1">
                          <p className="text-xs font-medium">
                            {t("Agent.agentContinueCodingModeSummaryTitle")}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {t(
                              "Agent.agentContinueCodingModeSummaryDescription",
                            )}
                          </p>
                        </div>

                        <div className="rounded-lg border bg-secondary/30 p-3 space-y-1">
                          <p className="text-xs font-medium">
                            {t("Agent.agentContinueConstraintTitle")}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {t("Agent.agentContinueConstraintDescription")}
                          </p>
                        </div>

                        <div className="space-y-2">
                          <p className="text-xs font-medium">
                            {t("Agent.agentContinueAutocompleteModelLabel")}
                          </p>
                          <Select
                            value={agentAutocompleteModelValue}
                            onValueChange={handleChangeAgentAutocompleteModel}
                            disabled={isAgentMcpBusy || isChatModelsLoading}
                          >
                            <SelectTrigger className="w-full h-8 text-xs">
                              <SelectValue
                                placeholder={t(
                                  "Agent.agentContinueAutocompleteModelPlaceholder",
                                )}
                              />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem
                                value={MCP_AUTOCOMPLETE_MODEL_NONE_VALUE}
                              >
                                {t("Agent.agentContinueAutocompleteModelNone")}
                              </SelectItem>
                              {autocompleteModelProviders.map((provider) => (
                                <SelectGroup key={provider.provider}>
                                  <SelectLabel>{provider.provider}</SelectLabel>
                                  {provider.models.map((model) => (
                                    <SelectItem
                                      key={`${provider.provider}:${model.name}`}
                                      value={makeMcpModelValue({
                                        provider: provider.provider,
                                        model: model.name,
                                      })}
                                    >
                                      {model.name}
                                    </SelectItem>
                                  ))}
                                </SelectGroup>
                              ))}
                            </SelectContent>
                          </Select>
                          <p className="text-xs text-muted-foreground">
                            {isChatModelsLoading
                              ? t("Agent.agentMcpModelLoading")
                              : !isAgentAutocompleteModelAvailable
                                ? t(
                                    "Agent.agentContinueAutocompleteModelUnavailable",
                                  )
                                : agentAutocompleteModel
                                  ? t(
                                      "Agent.agentContinueAutocompleteModelDescription",
                                    )
                                  : t(
                                      "Agent.agentContinueAutocompleteModelSelectFirst",
                                    )}
                          </p>
                        </div>

                        <div className="space-y-2">
                          <Label className="text-sm">
                            {t("Agent.agentContinueApiBaseLabel")}
                          </Label>
                          <div className="flex items-center gap-2">
                            <div className="flex-1 px-3 py-2 rounded-lg border bg-secondary/40 text-xs font-mono truncate">
                              {agentContinueApiBase}
                            </div>
                            <Button
                              size="icon"
                              variant="outline"
                              className="size-9 shrink-0"
                              onClick={() =>
                                copyToClipboard(agentContinueApiBase)
                              }
                            >
                              <CopyIcon className="size-3.5" />
                            </Button>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <Label className="text-sm">
                            {t("Agent.agentContinueModelIdLabel")}
                          </Label>
                          <div className="flex items-center gap-2">
                            <div className="flex-1 px-3 py-2 rounded-lg border bg-secondary/40 text-xs font-mono truncate">
                              {agentContinueModelId}
                            </div>
                            <Button
                              size="icon"
                              variant="outline"
                              className="size-9 shrink-0"
                              onClick={() =>
                                copyToClipboard(agentContinueModelId)
                              }
                            >
                              <CopyIcon className="size-3.5" />
                            </Button>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <Label className="text-sm">
                            {t("Agent.agentContinueAutocompleteModelIdLabel")}
                          </Label>
                          <div className="flex items-center gap-2">
                            <div className="flex-1 px-3 py-2 rounded-lg border bg-secondary/40 text-xs font-mono truncate">
                              {agentContinueAutocompleteModelId}
                            </div>
                            <Button
                              size="icon"
                              variant="outline"
                              className="size-9 shrink-0"
                              onClick={() =>
                                copyToClipboard(
                                  agentContinueAutocompleteModelId,
                                )
                              }
                            >
                              <CopyIcon className="size-3.5" />
                            </Button>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <Label className="text-sm">
                            {t("Agent.agentContinueConfigLabel")}
                          </Label>
                          <p className="text-xs text-muted-foreground">
                            {t("Agent.agentContinueConfigHint")}
                          </p>
                          <div className="relative">
                            <pre className="text-xs p-3 bg-secondary/40 border rounded-lg overflow-x-auto">
                              {agentContinueConfig}
                            </pre>
                            <Button
                              size="icon"
                              variant="outline"
                              className="size-7 absolute top-2 right-2"
                              onClick={() =>
                                copyToClipboard(agentContinueConfig)
                              }
                            >
                              <CopyIcon className="size-3" />
                            </Button>
                          </div>
                        </div>

                        <div className="rounded-lg border bg-secondary/30 p-3 space-y-1">
                          <p className="text-xs font-medium">
                            {t("Agent.agentContinueContextTitle")}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {t("Agent.agentContinueContextDescription")}
                          </p>
                        </div>

                        <div className="rounded-lg border bg-secondary/30 p-3 space-y-1">
                          <p className="text-xs font-medium">
                            {t("Agent.agentContinueDocsTitle")}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {t("Agent.agentContinueDocsDescription")}
                          </p>
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </div>
              )}
            </TabsContent>
          )}

          {showDashboardTab && initialAgent && (
            <TabsContent value="dashboard" className="mt-2">
              <AgentDashboardTab agentId={initialAgent.id} />
            </TabsContent>
          )}
        </Tabs>
      </div>

      <GenerateAgentDialog
        open={openGenerateAgentDialog}
        onOpenChange={setOpenGenerateAgentDialog}
        onAgentChange={handleAgentChange}
        onToolsGenerated={assignToolsByNames}
      />
    </ScrollArea>
  );
}
