import { describe, expect, it } from "vitest";
import {
  buildA2ACardUrlCandidates,
  buildA2AAuthHeaders,
  extractA2AEventState,
  extractA2AEventText,
  fetchA2AAgentCard,
  resolveA2ACardLookup,
} from "./client";

describe("a2a client helpers", () => {
  it("resolves a base URL to the well-known agent card path", () => {
    expect(resolveA2ACardLookup("https://example.com/a2a")).toEqual({
      normalizedInputUrl: "https://example.com/a2a",
      agentCardUrl: "https://example.com/a2a/.well-known/agent-card.json",
      clientBaseUrl: "https://example.com/a2a",
    });
  });

  it("keeps a direct agent card URL intact", () => {
    expect(
      resolveA2ACardLookup("https://example.com/.well-known/agent-card.json"),
    ).toEqual({
      normalizedInputUrl: "https://example.com/.well-known/agent-card.json",
      agentCardUrl: "https://example.com/.well-known/agent-card.json",
      clientBaseUrl: "https://example.com/.well-known/agent-card.json",
      clientPath: "",
    });
  });

  it("builds discovery candidates for base, endpoint, and root well-known paths", () => {
    expect(buildA2ACardUrlCandidates("https://example.com/a2a")).toEqual([
      "https://example.com/a2a",
      "https://example.com/a2a/.well-known/agent-card.json",
      "https://example.com/.well-known/agent-card.json",
    ]);
  });

  it("builds bearer and custom header auth", () => {
    const bearer = buildA2AAuthHeaders({
      authMode: "bearer",
      authSecret: "abc123",
    });
    const header = buildA2AAuthHeaders({
      authMode: "header",
      authHeaderName: "X-API-Key",
      authSecret: "secret",
    });

    expect(bearer.get("Authorization")).toBe("Bearer abc123");
    expect(header.get("X-API-Key")).toBe("secret");
  });

  it("extracts text and continuity state from A2A events", () => {
    const messageEvent = {
      kind: "message" as const,
      messageId: "message-1",
      role: "agent" as const,
      contextId: "ctx-1",
      taskId: "task-1",
      parts: [{ kind: "text" as const, text: "Hello from A2A" }],
    };
    const taskEvent = {
      kind: "task" as const,
      id: "task-1",
      contextId: "ctx-1",
      status: {
        state: "completed" as const,
        message: {
          kind: "message" as const,
          messageId: "message-2",
          role: "agent" as const,
          parts: [{ kind: "text" as const, text: "Task completed" }],
        },
      },
      artifacts: [
        {
          artifactId: "artifact-1",
          parts: [{ kind: "text" as const, text: "Artifact text" }],
        },
      ],
    };

    expect(extractA2AEventText(messageEvent)).toBe("Hello from A2A");
    expect(extractA2AEventState(messageEvent)).toEqual({
      contextId: "ctx-1",
      taskId: "task-1",
    });
    expect(extractA2AEventText(taskEvent)).toBe(
      "Task completed\nArtifact text",
    );
    expect(extractA2AEventState(taskEvent)).toEqual({
      contextId: "ctx-1",
      taskId: "task-1",
    });
  });

  it("skips HTML responses and falls back to the next agent-card candidate", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);

      if (url === "https://example.com/a2a") {
        return new Response("<!DOCTYPE html><html></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      }

      if (url === "https://example.com/a2a/.well-known/agent-card.json") {
        return new Response(
          JSON.stringify({
            name: "Remote Agent",
            description: "Remote description",
            protocolVersion: "0.3.0",
            version: "1.0.0",
            url: "https://example.com/a2a/rpc",
            skills: [],
            capabilities: {
              streaming: true,
            },
            defaultInputModes: ["text"],
            defaultOutputModes: ["text"],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }

      return new Response("Not found", { status: 404 });
    };

    const result = await fetchA2AAgentCard({
      inputUrl: "https://example.com/a2a",
      fetchImpl,
    });

    expect(result.agentCardUrl).toBe(
      "https://example.com/a2a/.well-known/agent-card.json",
    );
    expect(result.agentCard.name).toBe("Remote Agent");
    expect(result.attempts[0]).toMatchObject({
      url: "https://example.com/a2a",
      reason: "Returned HTML instead of an A2A agent card JSON document",
    });
  });
});
