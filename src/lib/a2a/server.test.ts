import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Agent } from "app-types/agent";
import type { A2AAgentCard, A2AAgentConfig } from "app-types/a2a-agent";

vi.mock("server-only", () => ({}));

let buildPublishedA2AAgentCard: typeof import(
  "./server",
)["buildPublishedA2AAgentCard"];

function createAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "agent-1",
    name: "Wave Test Agent",
    description: "Test description",
    userId: "user-1",
    visibility: "private",
    createdAt: new Date("2026-03-08T00:00:00.000Z"),
    updatedAt: new Date("2026-03-08T00:00:00.000Z"),
    instructions: {
      role: "assistant",
      systemPrompt: "Be helpful",
      mentions: [],
    },
    ...overrides,
  };
}

function createRemoteConfig(cardOverrides: Partial<A2AAgentCard> = {}) {
  return {
    id: "cfg-1",
    agentId: "agent-1",
    inputUrl: "https://remote.example.com",
    agentCardUrl: "https://remote.example.com/.well-known/agent-card.json",
    rpcUrl: "https://remote.example.com/rpc",
    authMode: "none" as const,
    authHeaderName: undefined,
    authSecret: undefined,
    lastDiscoveredAt: new Date("2026-03-08T00:00:00.000Z"),
    createdAt: new Date("2026-03-08T00:00:00.000Z"),
    updatedAt: new Date("2026-03-08T00:00:00.000Z"),
    agentCard: {
      name: "Remote Agent",
      description: "Remote description",
      protocolVersion: "0.3.0",
      version: "2.1.0",
      url: "https://remote.example.com/rpc",
      skills: [
        {
          id: "remote-chat",
          name: "Remote Chat",
        },
      ],
      capabilities: {
        streaming: true,
      },
      defaultInputModes: ["text"],
      defaultOutputModes: ["text"],
      ...cardOverrides,
    } satisfies A2AAgentCard,
  } satisfies A2AAgentConfig;
}

describe("a2a server card generation", () => {
  beforeAll(async () => {
    ({ buildPublishedA2AAgentCard } = await import("./server"));
  });

  it("builds a local published card for standard agents", () => {
    const card = buildPublishedA2AAgentCard({
      agent: createAgent({
        a2aEnabled: true,
      }),
      origin: "https://wave.example.com",
    });

    expect(card.name).toBe("Wave Test Agent");
    expect(card.url).toBe("https://wave.example.com/api/a2a/agent/agent-1");
    expect(card.capabilities.streaming).toBe(true);
    expect(card.securitySchemes).toMatchObject({
      bearerAuth: {
        type: "http",
        scheme: "Bearer",
      },
    });
    expect(card.skills[0]).toMatchObject({
      id: "wave-agent-agent-1",
      name: "Wave Test Agent",
    });
  });

  it("falls back to the cached remote card for wrapped A2A agents", () => {
    const card = buildPublishedA2AAgentCard({
      agent: createAgent({
        agentType: "a2a_remote",
        name: "",
        description: undefined,
      }),
      origin: "https://wave.example.com",
      remoteConfig: createRemoteConfig(),
    });

    expect(card.name).toBe("Remote Agent");
    expect(card.description).toBe("Remote description");
    expect(card.skills[0]).toMatchObject({
      id: "remote-chat",
      name: "Remote Chat",
      description: "",
    });
  });
});
