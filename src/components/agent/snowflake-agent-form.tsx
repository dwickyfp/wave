"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useMutateAgents } from "@/hooks/queries/use-agents";
import { fetcher } from "lib/utils";
import { safe } from "ts-safe";
import { handleErrorWithToast } from "ui/shared-toast";
import { Loader, Eye, EyeOff, KeyRound, ChevronDown } from "lucide-react";
import { Button } from "ui/button";
import { Input } from "ui/input";
import { Label } from "ui/label";
import { Textarea } from "ui/textarea";
import { ScrollArea } from "ui/scroll-area";
import { Separator } from "ui/separator";
import { SnowflakeAgentCreateSchema } from "app-types/snowflake-agent";
import type { SnowflakeAgentConfig } from "app-types/snowflake-agent";
import type { Agent, AgentIcon } from "app-types/agent";
import { AgentIconPicker } from "./agent-icon-picker";
import { A2APublishPanel } from "./a2a-publish-panel";
import {
  ShareableActions,
  type Visibility,
} from "@/components/shareable-actions";
import { BACKGROUND_COLORS } from "lib/const";

type SnowflakeFormState = {
  name: string;
  description: string;
  icon: AgentIcon;
  visibility: "public" | "private" | "readonly";
  accountLocator: string;
  account: string;
  snowflakeUser: string;
  snowflakeRole: string;
  privateKeyPem: string;
  privateKeyPassphrase: string;
  database: string;
  schema: string;
  cortexAgentName: string;
};

const defaultAgentIcon = (): AgentIcon => ({
  type: "emoji",
  value:
    "https://cdn.jsdelivr.net/npm/emoji-datasource-apple/img/apple/64/1f916.png",
  style: {
    backgroundColor: BACKGROUND_COLORS[0],
  },
});

const defaultFormState = (): SnowflakeFormState => ({
  name: "",
  description: "",
  icon: defaultAgentIcon(),
  visibility: "private",
  accountLocator: "",
  account: "",
  snowflakeUser: "",
  snowflakeRole: "",
  privateKeyPem: "",
  privateKeyPassphrase: "",
  database: "",
  schema: "",
  cortexAgentName: "",
});

interface SnowflakeAgentFormProps {
  /** When editing an existing agent, pass the agent + its config */
  initialAgent?: Agent;
  initialConfig?: SnowflakeAgentConfig;
  userId: string;
  isOwner?: boolean;
  hasEditAccess?: boolean;
}

export default function SnowflakeAgentForm({
  initialAgent,
  initialConfig,
  userId: _userId,
  isOwner = true,
  hasEditAccess = true,
}: SnowflakeAgentFormProps) {
  const t = useTranslations();
  const mutateAgents = useMutateAgents();
  const router = useRouter();

  const [isSaving, setIsSaving] = useState(false);
  const [isVisibilityChangeLoading, setIsVisibilityChangeLoading] =
    useState(false);
  const [showPrivateKey, setShowPrivateKey] = useState(false);
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [showKeyChange, setShowKeyChange] = useState(false);

  const [form, setForm] = useState<SnowflakeFormState>(() => {
    if (initialAgent && initialConfig) {
      return {
        name: initialAgent.name,
        description: initialAgent.description ?? "",
        icon: initialAgent.icon ?? defaultAgentIcon(),
        visibility: initialAgent.visibility ?? "private",
        accountLocator: initialConfig.accountLocator,
        account: initialConfig.account,
        snowflakeUser: initialConfig.snowflakeUser,
        snowflakeRole: initialConfig.snowflakeRole ?? "",
        // The private key is redacted on load; user must re-enter to change it
        privateKeyPem: "••••••••",
        privateKeyPassphrase: initialConfig.privateKeyPassphrase
          ? "••••••••"
          : "",
        database: initialConfig.database,
        schema: initialConfig.schema,
        cortexAgentName: initialConfig.cortexAgentName,
      };
    }
    return defaultFormState();
  });

  const setField = useCallback(
    <K extends keyof SnowflakeFormState>(
      key: K,
      value: SnowflakeFormState[K],
    ) => {
      setForm((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const updateVisibility = useCallback(
    async (visibility: Visibility) => {
      if (initialAgent?.id) {
        safe(() => setIsVisibilityChangeLoading(true))
          .map(() =>
            fetcher(`/api/agent/${initialAgent.id}`, {
              method: "PUT",
              body: JSON.stringify({ visibility }),
            }),
          )
          .ifOk(() => {
            setField("visibility", visibility);
            mutateAgents({ id: initialAgent.id, visibility });
            toast.success(t("Agent.visibilityUpdated"));
          })
          .ifFail(handleErrorWithToast)
          .watch(() => setIsVisibilityChangeLoading(false));
      } else {
        setField("visibility", visibility);
      }
    },
    [initialAgent?.id, mutateAgents, setField, t],
  );

  const saveAgent = useCallback(() => {
    if (initialAgent) {
      // Update existing agent name/description
      safe(() => setIsSaving(true))
        .map(async () => {
          await fetcher(`/api/agent/${initialAgent.id}`, {
            method: "PUT",
            body: JSON.stringify({
              name: form.name,
              description: form.description,
              icon: form.icon,
              visibility: form.visibility,
            }),
          });
          // Update Snowflake config (skip privateKeyPem if unchanged/redacted)
          const configUpdate: Record<string, string> = {
            accountLocator: form.accountLocator,
            account: form.account,
            snowflakeUser: form.snowflakeUser,
            database: form.database,
            schema: form.schema,
            cortexAgentName: form.cortexAgentName,
            ...(form.snowflakeRole
              ? { snowflakeRole: form.snowflakeRole }
              : {}),
          };
          if (form.privateKeyPem && form.privateKeyPem !== "••••••••") {
            configUpdate.privateKeyPem = form.privateKeyPem;
          }
          if (
            form.privateKeyPassphrase &&
            form.privateKeyPassphrase !== "••••••••"
          ) {
            configUpdate.privateKeyPassphrase = form.privateKeyPassphrase;
          }
          await fetcher(`/api/agent/snowflake/${initialAgent.id}`, {
            method: "PUT",
            body: JSON.stringify(configUpdate),
          });
          return { id: initialAgent.id };
        })
        .ifOk(() => {
          mutateAgents({
            id: initialAgent.id,
            name: form.name,
            description: form.description,
            icon: form.icon,
            visibility: form.visibility,
          });
          toast.success(t("Agent.updated"));
          router.push("/agents");
        })
        .ifFail(handleErrorWithToast)
        .watch(() => setIsSaving(false));
    } else {
      // Validate via Zod before sending
      const parseResult = SnowflakeAgentCreateSchema.safeParse({
        name: form.name,
        description: form.description || undefined,
        icon: form.icon,
        visibility: form.visibility,
        snowflakeConfig: {
          accountLocator: form.accountLocator,
          account: form.account,
          snowflakeUser: form.snowflakeUser,
          privateKeyPem: form.privateKeyPem,
          privateKeyPassphrase: form.privateKeyPassphrase || undefined,
          snowflakeRole: form.snowflakeRole || undefined,
          database: form.database,
          schema: form.schema,
          cortexAgentName: form.cortexAgentName,
        },
      });

      if (!parseResult.success) {
        toast.error(parseResult.error.issues[0]?.message ?? "Validation error");
        return;
      }

      safe(() => setIsSaving(true))
        .map(async () =>
          fetcher("/api/agent/snowflake", {
            method: "POST",
            body: JSON.stringify(parseResult.data),
          }),
        )
        .ifOk((newAgent) => {
          mutateAgents(newAgent);
          toast.success(t("Agent.created"));
          router.push("/agents");
        })
        .ifFail(handleErrorWithToast)
        .watch(() => setIsSaving(false));
    }
  }, [form, initialAgent, mutateAgents, router, t]);

  const isEditing = Boolean(initialAgent);
  const isLoading = isSaving || isVisibilityChangeLoading;

  return (
    <ScrollArea className="h-full w-full relative">
      <div className="w-full h-8 absolute bottom-0 left-0 bg-gradient-to-t from-background to-transparent z-20 pointer-events-none" />
      <div className="z-10 relative flex flex-col gap-4 px-8 pt-8 pb-14 max-w-3xl h-full mx-auto">
        <div className="sticky top-0 bg-background z-10 flex items-center justify-between pb-4 gap-2">
          <div className="w-full h-8 absolute top-[100%] left-0 bg-gradient-to-b from-background to-transparent z-20 pointer-events-none" />
          <p className="w-full text-2xl font-bold">
            {isEditing
              ? "Edit Snowflake Intelligence"
              : "Snowflake Intelligence"}
          </p>
          {isEditing && (
            <ShareableActions
              type="agent"
              visibility={form.visibility}
              isBookmarked={false}
              isOwner={isOwner}
              onVisibilityChange={updateVisibility}
              isVisibilityChangeLoading={isVisibilityChangeLoading}
              disabled={isLoading || !hasEditAccess}
            />
          )}
        </div>

        <div className="flex gap-4 mt-4">
          <div className="flex flex-col justify-between gap-2 flex-1">
            <Label htmlFor="sf-name">Agent Name & Icon</Label>
            <Input
              id="sf-name"
              placeholder="e.g. Sales Analytics Assistant"
              value={form.name}
              disabled={isLoading || !hasEditAccess}
              readOnly={!hasEditAccess}
              onChange={(e) => setField("name", e.target.value)}
              className="hover:bg-input bg-secondary/40 transition-colors border-transparent border-none! focus-visible:bg-input! ring-0!"
            />
          </div>
          <AgentIconPicker
            icon={form.icon}
            disabled={isLoading || !hasEditAccess}
            onChange={(icon) => setField("icon", icon)}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="sf-description">Description</Label>
          <Input
            id="sf-description"
            placeholder="Brief description of what this agent does"
            value={form.description}
            disabled={isLoading || !hasEditAccess}
            readOnly={!hasEditAccess}
            onChange={(e) => setField("description", e.target.value)}
            className="hover:bg-input placeholder:text-xs bg-secondary/40 transition-colors border-transparent border-none! focus-visible:bg-input! ring-0!"
          />
        </div>

        <div className="mt-10 flex items-center gap-2">
          <p className="text-sm text-muted-foreground">
            Configure Snowflake connection and Cortex Agent target for this
            agent.
          </p>
        </div>

        <Separator />

        {/* Snowflake Connection */}
        <div className="rounded-xl border bg-secondary/20 p-4 flex flex-col gap-4">
          <div>
            <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Snowflake Connection
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Configure how this agent connects to your Snowflake Cortex Agent.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="sf-account-locator">
                Account Locator{" "}
                <span className="text-muted-foreground font-normal text-xs">
                  (for JWT auth, e.g. ABC12345)
                </span>
              </Label>
              <Input
                id="sf-account-locator"
                placeholder="ABC12345"
                value={form.accountLocator}
                disabled={isLoading || !hasEditAccess}
                readOnly={!hasEditAccess}
                onChange={(e) => setField("accountLocator", e.target.value)}
                className="hover:bg-input placeholder:text-xs bg-secondary/40 transition-colors border-transparent border-none! focus-visible:bg-input! ring-0!"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="sf-account">
                Account{" "}
                <span className="text-muted-foreground font-normal text-xs">
                  (for API URL, e.g. MYORG-MYACCOUNT)
                </span>
              </Label>
              <Input
                id="sf-account"
                placeholder="MYORG-MYACCOUNT"
                value={form.account}
                disabled={isLoading || !hasEditAccess}
                readOnly={!hasEditAccess}
                onChange={(e) => setField("account", e.target.value)}
                className="hover:bg-input placeholder:text-xs bg-secondary/40 transition-colors border-transparent border-none! focus-visible:bg-input! ring-0!"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="sf-user">Snowflake Username</Label>
              <Input
                id="sf-user"
                placeholder="your_snowflake_user"
                value={form.snowflakeUser}
                disabled={isLoading || !hasEditAccess}
                readOnly={!hasEditAccess}
                onChange={(e) => setField("snowflakeUser", e.target.value)}
                className="hover:bg-input placeholder:text-xs bg-secondary/40 transition-colors border-transparent border-none! focus-visible:bg-input! ring-0!"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="sf-role">
                Snowflake Role{" "}
                <span className="text-muted-foreground font-normal text-xs">
                  (required for Cortex Agent access)
                </span>
              </Label>
              <Input
                id="sf-role"
                placeholder="e.g. SYSADMIN"
                value={form.snowflakeRole}
                disabled={isLoading || !hasEditAccess}
                readOnly={!hasEditAccess}
                onChange={(e) =>
                  setField("snowflakeRole", e.target.value.toUpperCase())
                }
                className="hover:bg-input placeholder:text-xs bg-secondary/40 transition-colors border-transparent border-none! focus-visible:bg-input! ring-0!"
              />
            </div>
          </div>

          {/* Private key (sensitive field) */}
          {isEditing && !showKeyChange ? (
            /* Edit mode — show status row, hide the actual key */
            <div className="flex items-center justify-between rounded-lg bg-muted px-4 py-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <KeyRound className="size-4 text-blue-500" />
                <span>RSA private key: configured</span>
                {initialConfig?.privateKeyPassphrase && (
                  <span className="text-xs opacity-70">· passphrase set</span>
                )}
              </div>
              {hasEditAccess && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs gap-1"
                  onClick={() => {
                    setShowKeyChange(true);
                    setField("privateKeyPem", "");
                    setField("privateKeyPassphrase", "");
                  }}
                >
                  <ChevronDown className="size-3.5" />
                  Change key
                </Button>
              )}
            </div>
          ) : (
            /* Create mode or change-key expanded */
            <>
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="sf-private-key">
                    RSA Private Key{" "}
                    <span className="text-muted-foreground font-normal text-xs">
                      (PEM/PKCS8 format)
                    </span>
                  </Label>
                  <div className="flex items-center gap-1">
                    {hasEditAccess && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs"
                        onClick={() => setShowPrivateKey((v) => !v)}
                      >
                        {showPrivateKey ? (
                          <EyeOff className="size-3.5 mr-1" />
                        ) : (
                          <Eye className="size-3.5 mr-1" />
                        )}
                        {showPrivateKey ? "Hide" : "Show"}
                      </Button>
                    )}
                    {isEditing && showKeyChange && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs text-muted-foreground"
                        onClick={() => {
                          setShowKeyChange(false);
                          setShowPrivateKey(false);
                          setShowPassphrase(false);
                          setField("privateKeyPem", "••••••••");
                          setField(
                            "privateKeyPassphrase",
                            initialConfig?.privateKeyPassphrase
                              ? "••••••••"
                              : "",
                          );
                        }}
                      >
                        Cancel
                      </Button>
                    )}
                  </div>
                </div>
                <Textarea
                  id="sf-private-key"
                  placeholder={`-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----`}
                  value={form.privateKeyPem}
                  disabled={isLoading || !hasEditAccess}
                  readOnly={!hasEditAccess}
                  onChange={(e) => setField("privateKeyPem", e.target.value)}
                  rows={5}
                  className={`font-mono text-xs p-4 hover:bg-input min-h-28 resize-none placeholder:text-xs bg-secondary/40 transition-colors border-transparent border-none! focus-visible:bg-input! ring-0! ${
                    !showPrivateKey ? "blur-sm" : ""
                  }`}
                  style={!showPrivateKey ? { filter: "blur(3px)" } : undefined}
                />
              </div>

              {/* Private key passphrase (optional, for encrypted keys) */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="sf-passphrase">
                    Key Passphrase{" "}
                    <span className="text-muted-foreground font-normal text-xs">
                      (only if your private key is encrypted)
                    </span>
                  </Label>
                  {hasEditAccess && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      onClick={() => setShowPassphrase((v) => !v)}
                    >
                      {showPassphrase ? (
                        <EyeOff className="size-3.5 mr-1" />
                      ) : (
                        <Eye className="size-3.5 mr-1" />
                      )}
                      {showPassphrase ? "Hide" : "Show"}
                    </Button>
                  )}
                </div>
                <Input
                  id="sf-passphrase"
                  type={showPassphrase ? "text" : "password"}
                  placeholder="Leave empty if key is unencrypted"
                  value={form.privateKeyPassphrase}
                  disabled={isLoading || !hasEditAccess}
                  readOnly={!hasEditAccess}
                  onChange={(e) =>
                    setField("privateKeyPassphrase", e.target.value)
                  }
                  className="hover:bg-input placeholder:text-xs bg-secondary/40 transition-colors border-transparent border-none! focus-visible:bg-input! ring-0!"
                />
              </div>
            </>
          )}
        </div>

        <Separator />

        {/* Cortex Agent */}
        <div className="rounded-xl border bg-secondary/20 p-4 flex flex-col gap-4">
          <div>
            <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Cortex Agent Location
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Specify the Snowflake database, schema, and Cortex Agent name.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="sf-database">Database</Label>
              <Input
                id="sf-database"
                placeholder="MY_DATABASE"
                value={form.database}
                disabled={isLoading || !hasEditAccess}
                readOnly={!hasEditAccess}
                onChange={(e) =>
                  setField("database", e.target.value.toUpperCase())
                }
                className="hover:bg-input placeholder:text-xs bg-secondary/40 transition-colors border-transparent border-none! focus-visible:bg-input! ring-0!"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="sf-schema">Schema</Label>
              <Input
                id="sf-schema"
                placeholder="PUBLIC"
                value={form.schema}
                disabled={isLoading || !hasEditAccess}
                readOnly={!hasEditAccess}
                onChange={(e) =>
                  setField("schema", e.target.value.toUpperCase())
                }
                className="hover:bg-input placeholder:text-xs bg-secondary/40 transition-colors border-transparent border-none! focus-visible:bg-input! ring-0!"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="sf-agent-name">Cortex Agent Name</Label>
              <Input
                id="sf-agent-name"
                placeholder="MY_CORTEX_AGENT"
                value={form.cortexAgentName}
                disabled={isLoading || !hasEditAccess}
                readOnly={!hasEditAccess}
                onChange={(e) =>
                  setField("cortexAgentName", e.target.value.toUpperCase())
                }
                className="hover:bg-input placeholder:text-xs bg-secondary/40 transition-colors border-transparent border-none! focus-visible:bg-input! ring-0!"
              />
            </div>
          </div>

          {/* Computed API URL preview */}
          {form.account &&
            form.database &&
            form.schema &&
            form.cortexAgentName && (
              <div className="rounded-lg bg-muted p-3">
                <p className="text-xs text-muted-foreground font-mono break-all">
                  API:{" "}
                  <span className="text-foreground">
                    https://{form.account}
                    .snowflakecomputing.com/api/v2/databases/
                    {form.database}/schemas/{form.schema}/agents/
                    {form.cortexAgentName}:run
                  </span>
                </p>
              </div>
            )}
        </div>

        <A2APublishPanel
          agentId={initialAgent?.id}
          initialEnabled={initialAgent?.a2aEnabled ?? false}
          initialRequireAuth={initialAgent?.a2aRequireAuth ?? true}
          initialPreview={
            initialAgent?.mcpApiKeyPreview ??
            initialAgent?.a2aApiKeyPreview ??
            null
          }
          isOwner={isOwner}
        />

        {hasEditAccess && (
          <div className="flex justify-end gap-2 mt-2">
            <Button
              variant="ghost"
              onClick={() => router.push("/agents")}
              disabled={isLoading}
            >
              {t("Common.cancel")}
            </Button>
            <Button
              onClick={saveAgent}
              disabled={isLoading || !form.name}
              data-testid="snowflake-agent-save-button"
            >
              {isSaving ? t("Common.saving") : t("Common.save")}
              {isSaving && <Loader className="size-4 animate-spin" />}
            </Button>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
