"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useMutateAgents } from "@/hooks/queries/use-agents";
import { fetcher } from "lib/utils";
import { safe } from "ts-safe";
import { handleErrorWithToast } from "ui/shared-toast";
import { Loader, Snowflake, Eye, EyeOff } from "lucide-react";
import { Button } from "ui/button";
import { Input } from "ui/input";
import { Label } from "ui/label";
import { Textarea } from "ui/textarea";
import { ScrollArea } from "ui/scroll-area";
import { Separator } from "ui/separator";
import { SnowflakeAgentCreateSchema } from "app-types/snowflake-agent";
import type { SnowflakeAgentConfig } from "app-types/snowflake-agent";
import type { Agent } from "app-types/agent";

type SnowflakeFormState = {
  name: string;
  description: string;
  visibility: "public" | "private" | "readonly";
  accountLocator: string;
  account: string;
  snowflakeUser: string;
  privateKeyPem: string;
  database: string;
  schema: string;
  cortexAgentName: string;
};

const defaultFormState = (): SnowflakeFormState => ({
  name: "",
  description: "",
  visibility: "private",
  accountLocator: "",
  account: "",
  snowflakeUser: "",
  privateKeyPem: "",
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
  hasEditAccess = true,
}: SnowflakeAgentFormProps) {
  const t = useTranslations();
  const mutateAgents = useMutateAgents();
  const router = useRouter();

  const [isSaving, setIsSaving] = useState(false);
  const [showPrivateKey, setShowPrivateKey] = useState(false);

  const [form, setForm] = useState<SnowflakeFormState>(() => {
    if (initialAgent && initialConfig) {
      return {
        name: initialAgent.name,
        description: initialAgent.description ?? "",
        visibility: initialAgent.visibility ?? "private",
        accountLocator: initialConfig.accountLocator,
        account: initialConfig.account,
        snowflakeUser: initialConfig.snowflakeUser,
        // The private key is redacted on load; user must re-enter to change it
        privateKeyPem: "••••••••",
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
          };
          if (form.privateKeyPem && form.privateKeyPem !== "••••••••") {
            configUpdate.privateKeyPem = form.privateKeyPem;
          }
          await fetcher(`/api/agent/snowflake/${initialAgent.id}`, {
            method: "PUT",
            body: JSON.stringify(configUpdate),
          });
          return { id: initialAgent.id };
        })
        .ifOk(() => {
          mutateAgents({ id: initialAgent.id, name: form.name });
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
        visibility: form.visibility,
        snowflakeConfig: {
          accountLocator: form.accountLocator,
          account: form.account,
          snowflakeUser: form.snowflakeUser,
          privateKeyPem: form.privateKeyPem,
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

  return (
    <ScrollArea className="h-full w-full relative">
      <div className="w-full h-8 absolute bottom-0 left-0 bg-gradient-to-t from-background to-transparent z-20 pointer-events-none" />
      <div className="z-10 relative flex flex-col gap-4 px-8 pt-8 pb-14 max-w-3xl h-full mx-auto">
        {/* Header */}
        <div className="sticky top-0 bg-background z-10 flex items-center justify-between pb-4 gap-2">
          <div className="w-full h-8 absolute top-[100%] left-0 bg-gradient-to-b from-background to-transparent z-20 pointer-events-none" />
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-blue-500/10 text-blue-500">
              <Snowflake className="size-5" />
            </div>
            <p className="text-2xl font-bold">
              {isEditing
                ? "Edit Snowflake Intelligence"
                : "Snowflake Intelligence"}
            </p>
          </div>
        </div>

        {/* Agent identity */}
        <div className="rounded-xl border bg-secondary/20 p-4 flex flex-col gap-4">
          <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Agent Identity
          </p>

          <div className="flex flex-col gap-2">
            <Label htmlFor="sf-name">Agent Name</Label>
            <Input
              id="sf-name"
              placeholder="e.g. Sales Analytics Assistant"
              value={form.name}
              disabled={isSaving || !hasEditAccess}
              readOnly={!hasEditAccess}
              onChange={(e) => setField("name", e.target.value)}
              className="hover:bg-input bg-secondary/40 transition-colors border-transparent border-none! focus-visible:bg-input! ring-0!"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="sf-description">Description</Label>
            <Input
              id="sf-description"
              placeholder="Brief description of what this agent does"
              value={form.description}
              disabled={isSaving || !hasEditAccess}
              readOnly={!hasEditAccess}
              onChange={(e) => setField("description", e.target.value)}
              className="hover:bg-input placeholder:text-xs bg-secondary/40 transition-colors border-transparent border-none! focus-visible:bg-input! ring-0!"
            />
          </div>
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
                disabled={isSaving || !hasEditAccess}
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
                disabled={isSaving || !hasEditAccess}
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
                disabled={isSaving || !hasEditAccess}
                readOnly={!hasEditAccess}
                onChange={(e) => setField("snowflakeUser", e.target.value)}
                className="hover:bg-input placeholder:text-xs bg-secondary/40 transition-colors border-transparent border-none! focus-visible:bg-input! ring-0!"
              />
            </div>
          </div>

          {/* Private key (sensitive field) */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="sf-private-key">
                RSA Private Key{" "}
                <span className="text-muted-foreground font-normal text-xs">
                  (PEM/PKCS8 format)
                </span>
              </Label>
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
            </div>
            <Textarea
              id="sf-private-key"
              placeholder={`-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----`}
              value={form.privateKeyPem}
              disabled={isSaving || !hasEditAccess}
              readOnly={!hasEditAccess}
              onChange={(e) => setField("privateKeyPem", e.target.value)}
              rows={5}
              className={`font-mono text-xs p-4 hover:bg-input min-h-28 resize-none placeholder:text-xs bg-secondary/40 transition-colors border-transparent border-none! focus-visible:bg-input! ring-0! ${
                !showPrivateKey ? "blur-sm" : ""
              }`}
              style={!showPrivateKey ? { filter: "blur(3px)" } : undefined}
              onFocus={() => {
                if (form.privateKeyPem === "••••••••") {
                  setField("privateKeyPem", "");
                }
              }}
            />
            {isEditing && (
              <p className="text-xs text-muted-foreground">
                Leave unchanged to keep the current key. Paste a new key to
                replace it.
              </p>
            )}
          </div>
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
                disabled={isSaving || !hasEditAccess}
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
                disabled={isSaving || !hasEditAccess}
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
                disabled={isSaving || !hasEditAccess}
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

        {hasEditAccess && (
          <div className="flex justify-end gap-2 mt-2">
            <Button
              variant="ghost"
              onClick={() => router.push("/agents")}
              disabled={isSaving}
            >
              {t("Common.cancel")}
            </Button>
            <Button
              onClick={saveAgent}
              disabled={isSaving || !form.name}
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
