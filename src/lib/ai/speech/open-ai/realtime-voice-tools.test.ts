import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DefaultToolName } from "lib/ai/tools";
import {
  buildVoiceFillerInstructions,
  buildVoiceRealtimeToolDefinitions,
  buildVoiceToolResumeInstructions,
  pickVoiceFillerLine,
  summarizeToolOutputForVoice,
} from "./realtime-voice-tools";

describe("realtime voice tool helpers", () => {
  it("builds voice-safe metadata for tool definitions", () => {
    const tools = buildVoiceRealtimeToolDefinitions({
      mcpTools: {
        [DefaultToolName.WebSearch]: {
          description: "Search the web",
          inputSchema: z.object({
            query: z.string(),
          }),
        } as any,
      },
      appDefaultTools: {
        [DefaultToolName.PythonExecution]: {
          description: "Run Python",
          inputSchema: z.object({
            code: z.string(),
          }),
        } as any,
      },
      skillTools: {
        repoSkill: {
          description: "Inspect the repo",
          inputSchema: z.object({
            path: z.string(),
          }),
        } as any,
      },
    });

    expect(tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: DefaultToolName.WebSearch,
          fillerKey: "search",
          preferSilentExecution: false,
          source: "mcp",
        }),
        expect.objectContaining({
          name: DefaultToolName.PythonExecution,
          fillerKey: "code",
          preferSilentExecution: true,
          source: "app-default",
        }),
        expect.objectContaining({
          name: "repoSkill",
          fillerKey: "tool",
          preferSilentExecution: true,
          source: "skill",
        }),
      ]),
    );
  });

  it("returns staged filler instructions by tool category", () => {
    expect(
      buildVoiceFillerInstructions({
        fillerKey: "search",
        spokenLabel: "web search",
      }),
    ).toMatch(/^Say exactly: /);

    expect(
      buildVoiceFillerInstructions({
        fillerKey: "lookup",
        spokenLabel: "inventory",
      }),
    ).toMatch(/^Say exactly: /);

    expect(
      buildVoiceFillerInstructions(
        {
          fillerKey: "lookup",
          spokenLabel: "inventory",
        },
        {
          stage: "long-progress",
          seed: "call-1",
        },
      ),
    ).toMatch(/^Say exactly: /);
  });

  it("varies filler lines deterministically across progress stages", () => {
    const ack = pickVoiceFillerLine(
      {
        fillerKey: "search",
        spokenLabel: "web search",
      },
      {
        stage: "ack",
        seed: "call-1",
      },
    );

    const progress = pickVoiceFillerLine(
      {
        fillerKey: "search",
        spokenLabel: "web search",
      },
      {
        stage: "progress",
        seed: "call-1",
      },
    );

    const repeatedAck = pickVoiceFillerLine(
      {
        fillerKey: "search",
        spokenLabel: "web search",
      },
      {
        stage: "ack",
        seed: "call-1",
      },
    );

    expect(ack).not.toBe(progress);
    expect(repeatedAck).toBe(ack);
  });

  it("summarizes tool output for speech without dumping long payloads", () => {
    const spokenSummary = summarizeToolOutputForVoice({
      output: {
        summary:
          "The latest shipment is delayed by two days because of weather.",
      },
      metadata: {
        toolName: "lookupInventory",
        source: "mcp",
        voiceSafe: true,
        spokenLabel: "inventory",
        fillerKey: "lookup",
        maxSpokenSummaryChars: 50,
        preferSilentExecution: false,
      },
    });

    expect(spokenSummary).toContain("delayed by two days");
    expect(spokenSummary?.length).toBeLessThanOrEqual(50);

    expect(
      summarizeToolOutputForVoice({
        output: {
          results: [{ id: 1 }, { id: 2 }, { id: 3 }],
        },
        metadata: {
          toolName: "webSearch",
          source: "mcp",
          voiceSafe: true,
          spokenLabel: "web search",
          fillerKey: "search",
          maxSpokenSummaryChars: 80,
          preferSilentExecution: false,
        },
      }),
    ).toBe("I found 3 results.");
  });

  it("builds concise tool-resume instructions that avoid repeating filler", () => {
    expect(
      buildVoiceToolResumeInstructions({
        ok: true,
        spokenSummary: "The shipment arrives tomorrow morning.",
        tool: {
          spokenLabel: "shipment lookup",
          preferSilentExecution: false,
        },
      }),
    ).toContain("Do not repeat the earlier progress line.");

    expect(
      buildVoiceToolResumeInstructions({
        ok: false,
        tool: {
          spokenLabel: "shipment lookup",
          preferSilentExecution: false,
        },
      }),
    ).toContain("failed");
  });
});
