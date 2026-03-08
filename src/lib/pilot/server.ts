import type { ChatModel } from "app-types/chat";
import {
  type PilotModelProvider,
  type PilotThreadDetail,
  type PilotThreadSummary,
} from "app-types/pilot";
import { getPilotBackendOrigin, getPilotReleaseMetadata } from "./config";
import {
  buildPilotModelProviders,
  resolveDefaultPilotChatModelFromProviders,
} from "./model-catalog";
import {
  agentRepository,
  pilotExtensionRepository,
  settingsRepository,
} from "lib/db/repository";

export async function resolveDefaultPilotChatModel(): Promise<ChatModel | null> {
  const providers = await settingsRepository.getProviders({
    enabledOnly: true,
  });

  return resolveDefaultPilotChatModelFromProviders(providers);
}

export async function getPilotModelProviders(): Promise<PilotModelProvider[]> {
  const providers = await settingsRepository.getProviders({
    enabledOnly: true,
  });

  return buildPilotModelProviders(providers);
}

export async function getPilotThreadsForUser(
  userId: string,
): Promise<PilotThreadSummary[]> {
  const threads =
    await pilotExtensionRepository.selectPilotThreadsByUserId(userId);

  return threads.map((thread) => ({
    id: thread.id,
    title: thread.title,
    createdAt: thread.createdAt.toISOString(),
    lastMessageAt: thread.lastMessageAt.toISOString(),
    lastChatModel: thread.lastChatModel,
    lastAgentId: thread.lastAgentId,
  }));
}

export async function getPilotThreadForUser(
  userId: string,
  threadId: string,
): Promise<PilotThreadDetail | null> {
  const thread =
    await pilotExtensionRepository.selectPilotThreadDetailsByUserId(
      userId,
      threadId,
    );

  if (!thread) {
    return null;
  }

  const lastMessageAt =
    thread.messages.at(-1)?.createdAt?.toISOString() ||
    thread.createdAt.toISOString();

  return {
    id: thread.id,
    title: thread.title,
    createdAt: thread.createdAt.toISOString(),
    lastMessageAt,
    lastChatModel: thread.lastChatModel,
    lastAgentId: thread.lastAgentId,
    messages: thread.messages.map((message) => ({
      id: message.id,
      role: message.role,
      parts: message.parts,
      metadata: message.metadata,
    })),
  };
}

export async function getPilotConfigForUser(userId: string) {
  const [release, sessions, latestThread, agents, defaultChatModel] =
    await Promise.all([
      getPilotReleaseMetadata(),
      pilotExtensionRepository.listSessionsByUserId(userId),
      pilotExtensionRepository.selectLatestPilotThreadByUserId(userId),
      agentRepository.selectAgentsByUserId(userId),
      resolveDefaultPilotChatModel(),
    ]);

  return {
    backendOrigin: getPilotBackendOrigin(),
    authorizeUrlBase: `${getPilotBackendOrigin()}/pilot/authorize`,
    release,
    sessions: sessions.map((session) => ({
      id: session.id,
      browser: session.browser,
      browserVersion: session.browserVersion,
      extensionId: session.extensionId,
      lastUsedAt: session.lastUsedAt?.toISOString() ?? null,
      createdAt: session.createdAt.toISOString(),
      revokedAt: session.revokedAt?.toISOString() ?? null,
    })),
    latestThread: latestThread
      ? {
          id: latestThread.id,
          title: latestThread.title,
          url: `/chat/${latestThread.id}`,
          lastMessageAt: latestThread.lastMessageAt.toISOString(),
        }
      : null,
    agents: agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      description: agent.description ?? "",
      icon: agent.icon ?? null,
      agentType: agent.agentType,
    })),
    defaultChatModel,
  };
}
