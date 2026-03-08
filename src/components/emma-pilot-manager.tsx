"use client";

import Link from "next/link";
import useSWR, { mutate } from "swr";
import { useShallow } from "zustand/shallow";
import { appStore } from "@/app/store";
import { fetcher } from "lib/utils";
import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "ui/dialog";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "ui/accordion";
import { Button } from "ui/button";
import { Badge } from "ui/badge";
import { ScrollArea } from "ui/scroll-area";
import { Separator } from "ui/separator";
import { ExternalLink, Loader2, RefreshCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";

type PilotConfig = {
  backendOrigin: string;
  authorizeUrlBase: string;
  release: {
    version: string;
    generatedAt: string;
    chrome: {
      downloadUrl: string | null;
    };
    edge: {
      downloadUrl: string | null;
    };
  };
  sessions: Array<{
    id: string;
    browser: "chrome" | "edge";
    browserVersion?: string | null;
    extensionId: string;
    lastUsedAt?: string | null;
    createdAt: string;
    revokedAt?: string | null;
  }>;
  latestThread: {
    id: string;
    title: string;
    url: string;
    lastMessageAt: string;
  } | null;
  agents: Array<{
    id: string;
    name: string;
    description: string;
  }>;
  defaultChatModel: {
    provider: string;
    model: string;
  } | null;
};

export function EmmaPilotManager() {
  const t = useTranslations();
  const [openEmmaPilotManager, appStoreMutate] = appStore(
    useShallow((state) => [state.openEmmaPilotManager, state.mutate]),
  );

  const { data, error, isLoading } = useSWR<PilotConfig>(
    openEmmaPilotManager ? "/api/pilot/config" : null,
    fetcher,
  );

  const refreshConfig = async () => {
    await mutate("/api/pilot/config");
  };

  const revokeSession = async (sessionId: string) => {
    try {
      await fetcher("/api/pilot/auth/revoke", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sessionId }),
      });
      toast.success(t("Layout.EmmaPilot.sessionRevoked"));
      await refreshConfig();
    } catch (fetchError) {
      toast.error(
        (fetchError as Error).message || t("Layout.EmmaPilot.actionFailed"),
      );
    }
  };

  const revokeAllSessions = async () => {
    try {
      await fetcher("/api/pilot/auth/revoke", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ revokeAll: true }),
      });
      toast.success(t("Layout.EmmaPilot.allSessionsRevoked"));
      await refreshConfig();
    } catch (fetchError) {
      toast.error(
        (fetchError as Error).message || t("Layout.EmmaPilot.actionFailed"),
      );
    }
  };

  return (
    <Dialog
      open={openEmmaPilotManager}
      onOpenChange={(open) => appStoreMutate({ openEmmaPilotManager: open })}
    >
      <DialogContent className="w-[calc(100vw-2rem)] max-w-5xl overflow-hidden p-0">
        <DialogHeader className="border-b px-6 py-5">
          <DialogTitle>{t("Layout.EmmaPilot.title")}</DialogTitle>
          <DialogDescription>
            {t("Layout.EmmaPilot.description")}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[85vh]">
          <div className="px-6 py-5">
            <div className="grid gap-6 xl:grid-cols-[1.25fr,0.95fr]">
              <section className="space-y-4">
                <div className="rounded-xl border bg-muted/20 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">
                        {t("Layout.EmmaPilot.releaseTitle")}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t("Layout.EmmaPilot.releaseDescription")}
                      </p>
                    </div>
                    <Button variant="ghost" size="icon" onClick={refreshConfig}>
                      <RefreshCcw className="size-4" />
                    </Button>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">
                      {t("Layout.EmmaPilot.versionLabel", {
                        version: data?.release.version || "0.0.0",
                      })}
                    </Badge>
                    {data?.defaultChatModel ? (
                      <Badge variant="outline">
                        {data.defaultChatModel.provider}/
                        {data.defaultChatModel.model}
                      </Badge>
                    ) : null}
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <DownloadCard
                      title="Chrome"
                      href={data?.release.chrome.downloadUrl ?? null}
                      subtitle={t("Layout.EmmaPilot.chromeHint")}
                    />
                    <DownloadCard
                      title="Edge"
                      href={data?.release.edge.downloadUrl ?? null}
                      subtitle={t("Layout.EmmaPilot.edgeHint")}
                    />
                  </div>

                  <div className="mt-4 rounded-lg border bg-background p-3 text-sm">
                    <p className="font-medium">
                      {t("Layout.EmmaPilot.installTitle")}
                    </p>
                    <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
                      <li>{t("Layout.EmmaPilot.installStepOne")}</li>
                      <li>{t("Layout.EmmaPilot.installStepTwo")}</li>
                      <li>{t("Layout.EmmaPilot.installStepThree")}</li>
                    </ol>
                  </div>
                </div>

                <div className="rounded-xl border bg-muted/20 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">
                        {t("Layout.EmmaPilot.sessionsTitle")}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t("Layout.EmmaPilot.sessionsDescription")}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={revokeAllSessions}
                      disabled={!data?.sessions?.length}
                    >
                      <Trash2 className="mr-2 size-4" />
                      {t("Layout.EmmaPilot.revokeAll")}
                    </Button>
                  </div>

                  <div className="mt-4 space-y-3">
                    {isLoading ? (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="size-4 animate-spin" />
                        {t("Layout.EmmaPilot.loading")}
                      </div>
                    ) : data?.sessions?.length ? (
                      data.sessions.map((session) => (
                        <div
                          key={session.id}
                          className="flex items-center justify-between gap-3 rounded-lg border bg-background p-3"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-medium capitalize">
                                {session.browser}
                              </p>
                              {session.revokedAt ? (
                                <Badge variant="secondary">
                                  {t("Layout.EmmaPilot.revoked")}
                                </Badge>
                              ) : (
                                <Badge variant="outline">
                                  {t("Layout.EmmaPilot.connected")}
                                </Badge>
                              )}
                            </div>
                            <p className="truncate text-xs text-muted-foreground">
                              {session.extensionId}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {t("Layout.EmmaPilot.lastUsedLabel", {
                                value: session.lastUsedAt || session.createdAt,
                              })}
                            </p>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => revokeSession(session.id)}
                          >
                            {t("Layout.EmmaPilot.revoke")}
                          </Button>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        {t("Layout.EmmaPilot.noSessions")}
                      </p>
                    )}
                  </div>
                </div>
              </section>

              <section className="space-y-4">
                <div className="rounded-xl border bg-muted/20 p-4">
                  <p className="text-sm font-medium">
                    {t("Layout.EmmaPilot.latestThreadTitle")}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("Layout.EmmaPilot.latestThreadDescription")}
                  </p>
                  <Separator className="my-4" />
                  {data?.latestThread ? (
                    <div className="space-y-3">
                      <div>
                        <p className="text-sm font-medium">
                          {data.latestThread.title || t("Layout.newChat")}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {data.latestThread.lastMessageAt}
                        </p>
                      </div>
                      <Button
                        asChild
                        variant="outline"
                        className="w-full justify-between"
                      >
                        <Link href={data.latestThread.url}>
                          {t("Layout.EmmaPilot.openLatestThread")}
                          <ExternalLink className="size-4" />
                        </Link>
                      </Button>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {t("Layout.EmmaPilot.noThreadYet")}
                    </p>
                  )}
                </div>

                <div className="rounded-xl border bg-muted/20 p-4">
                  <Accordion type="single" collapsible>
                    <AccordionItem value="agents" className="border-b-0">
                      <AccordionTrigger className="py-0 hover:no-underline">
                        <div>
                          <p className="text-sm font-medium">
                            {t("Layout.EmmaPilot.agentTitle")} (
                            {data?.agents?.length ?? 0})
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {t("Layout.EmmaPilot.agentDescription")}
                          </p>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent className="pt-4 pb-0">
                        {data?.agents?.length ? (
                          <ScrollArea className="max-h-72 pr-4">
                            <div className="space-y-2">
                              {data.agents.map((agent) => (
                                <div
                                  key={agent.id}
                                  className="rounded-lg border bg-background px-3 py-2"
                                >
                                  <p className="text-sm font-medium">
                                    {agent.name}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {agent.description ||
                                      t("Layout.EmmaPilot.agentFallback")}
                                  </p>
                                </div>
                              ))}
                            </div>
                          </ScrollArea>
                        ) : (
                          <p className="text-sm text-muted-foreground">
                            {t("Layout.EmmaPilot.noAgents")}
                          </p>
                        )}
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </div>

                {error ? (
                  <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                    {(error as Error).message ||
                      t("Layout.EmmaPilot.actionFailed")}
                  </div>
                ) : null}
              </section>
            </div>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function DownloadCard(props: {
  title: string;
  subtitle: string;
  href: string | null;
}) {
  const t = useTranslations();

  return (
    <div className="rounded-lg border bg-background p-3">
      <p className="text-sm font-medium">{props.title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{props.subtitle}</p>
      <Button
        asChild={Boolean(props.href)}
        className="mt-4 w-full"
        variant={props.href ? "default" : "secondary"}
        disabled={!props.href}
      >
        {props.href ? (
          <a href={props.href} download>
            {t("Layout.EmmaPilot.download")}
          </a>
        ) : (
          <span>{t("Layout.EmmaPilot.notReady")}</span>
        )}
      </Button>
    </div>
  );
}
