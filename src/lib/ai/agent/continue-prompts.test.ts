import { describe, expect, it } from "vitest";
import {
  buildContinueAgentSystemMessage,
  buildContinueRoutePrompt,
  isPlanOnlyContinueRequest,
  shouldUseContinuePlanningPrimer,
} from "./continue-prompts";

describe("continue prompt profiles", () => {
  it("detects plan-only requests", () => {
    expect(
      isPlanOnlyContinueRequest([
        {
          role: "user",
          content:
            "Plan the architecture and break down the steps for this migration.",
        },
      ]),
    ).toBe(true);
  });

  it("adds a planning primer for complex implementation asks", () => {
    expect(
      shouldUseContinuePlanningPrimer([
        {
          role: "user",
          content:
            "Refactor the agent access page, add analytics storage, wire API routes, and verify the dashboard output.",
        },
      ]),
    ).toBe(true);
  });

  it("builds coding-mode prompts with client tool constraints", () => {
    const prompts = buildContinueRoutePrompt({
      codingMode: true,
      agentName: "Coder",
      clientOwnsWorkspaceTools: true,
      messages: [{ role: "user", content: "Fix the failing tests." }],
    });

    expect(prompts.join("\n")).toContain("Continue owns workspace reads");
    expect(buildContinueAgentSystemMessage("Coder")).toContain("Wave agent");
  });
});
