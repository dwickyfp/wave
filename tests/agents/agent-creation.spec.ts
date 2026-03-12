import { expect, Page, test } from "@playwright/test";

import { TEST_USERS } from "../constants/test-users";
import {
  clickAndWaitForNavigation,
  openDropdown,
  selectDropdownOption,
  uniqueTestName,
} from "../utils/test-helpers";

async function createAgent(
  page: Page,
  name: string,
  description: string,
): Promise<void> {
  await page.goto("/agent/new");

  await page.getByTestId("agent-name-input").fill(name);
  await page.getByTestId("agent-description-input").fill(description);

  await clickAndWaitForNavigation(page, "agent-save-button", "**/agents");
}

test.describe("Agent Creation and Sharing Workflow", () => {
  test.use({ storageState: TEST_USERS.editor.authFile });

  test("should create a new agent successfully", async ({ page }) => {
    await page.goto("/agent/new");
    await createAgent(
      page,
      "Test Agent for Sharing",
      "This agent tests the sharing workflow",
    );

    expect(page.url()).toContain("/agents");
  });

  test("should show created agent on agents page", async ({ page }) => {
    const agentName = uniqueTestName("Test Agent");
    await createAgent(page, agentName, "Should appear in agent list");

    expect(page.url()).toContain("/agents");

    await expect(
      page.locator(`[data-testid*="agent-card-name"]:has-text("${agentName}")`),
    ).toBeVisible({ timeout: 5000 });
  });

  test("should show agent in sidebar after creation", async ({ page }) => {
    const agentName = uniqueTestName("Sidebar Agent");
    await createAgent(page, agentName, "Should appear in sidebar");

    await page.goto("/");

    await expect(
      page.locator(
        `[data-testid*="sidebar-agent-name"]:has-text("${agentName}")`,
      ),
    ).toBeVisible({ timeout: 5000 });
  });

  test("should navigate to agent from agents list", async ({ page }) => {
    const agentName = uniqueTestName("Clickable Agent");
    await createAgent(page, agentName, "Click to open");

    await page.locator(`main a:has-text("${agentName}")`).first().click();
    await expect(page.getByTestId("agent-name-input")).toHaveValue(agentName);
  });

  test("should edit an existing agent", async ({ page }) => {
    const originalName = uniqueTestName("Original Agent");
    const updatedName = uniqueTestName("Updated Agent");
    await createAgent(page, originalName, "Will be edited");

    await page.locator(`main a:has-text("${originalName}")`).first().click();

    await page.getByTestId("agent-name-input").fill(updatedName);
    await page
      .getByTestId("agent-description-input")
      .fill("Updated description after editing");

    await clickAndWaitForNavigation(page, "agent-save-button", "**/agents");

    await expect(
      page.locator(
        `[data-testid*="agent-card-name"]:has-text("${updatedName}")`,
      ),
    ).toBeVisible({ timeout: 5000 });
  });

  test.skip("should generate an agent with AI", async ({ page }) => {
    await page.goto("/agent/new");

    await page.getByTestId("agent-generate-with-ai-button").click();

    await expect(
      page.getByTestId("agent-generate-agent-prompt-textarea"),
    ).toBeVisible({ timeout: 5000 });
    await page
      .getByTestId("agent-generate-agent-prompt-textarea")
      .fill("Help me come up with a dog names.");
    await page.getByTestId("agent-generate-agent-prompt-submit-button").click();
    await expect(page.getByTestId("agent-name-input")).toHaveValue(/Dog/i, {
      timeout: 10000,
    });
  });

  test("should create an agent with example", async ({ page }) => {
    await page.goto("/agent/new");

    await openDropdown(page, "agent-create-with-example-button");
    await selectDropdownOption(
      page,
      "agent-create-with-example-weather-button",
    );
    await expect(page.getByTestId("agent-name-input")).toHaveValue(/Weather/i, {
      timeout: 5000,
    });
  });

  test("should add instructions to agent", async ({ page }) => {
    await page.goto("/agent/new");

    await page.getByTestId("agent-name-input").fill("Agent with Instructions");
    await page
      .getByTestId("agent-description-input")
      .fill("Has custom instructions");

    await page
      .getByTestId("agent-prompt-textarea")
      .fill(
        "You are a helpful assistant that specializes in testing and quality assurance.",
      );

    await clickAndWaitForNavigation(page, "agent-save-button", "**/agents");
    expect(page.url()).toContain("/agents");
  });

  test("should review AI instruction updates before saving", async ({
    page,
  }) => {
    const agentName = uniqueTestName("Instruction Review Agent");
    const initialInstructions =
      "You are a helpful assistant.\nAnswer clearly and with examples.";
    const generatedInstructions =
      "You are a helpful assistant.\nAnswer clearly and with examples.\nUse a three-step review checklist before every final response.";

    await page.goto("/agent/new");
    await page.getByTestId("agent-name-input").fill(agentName);
    await page
      .getByTestId("agent-description-input")
      .fill("Agent used for AI instruction revision tests");
    await page.getByTestId("agent-prompt-textarea").fill(initialInstructions);
    await clickAndWaitForNavigation(page, "agent-save-button", "**/agents");

    await page.locator(`main a:has-text("${agentName}")`).first().click();

    await page.route("**/api/agent/instructions/ai", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/plain",
        body: JSON.stringify({ instructions: generatedInstructions }),
      });
    });

    await page.getByTestId("agent-instruction-enhance-button").click();
    await page
      .getByTestId("agent-instruction-enhance-prompt-textarea")
      .fill("Add a three-step review checklist before every final response.");
    await page.getByTestId("agent-instruction-enhance-generate-button").click();

    await expect(page.getByTestId("agent-prompt-textarea")).toHaveValue(
      generatedInstructions,
    );
    await expect(
      page.getByTestId("agent-instruction-review-actions"),
    ).toBeVisible();
    await expect(
      page.getByTestId("agent-instruction-diff-preview"),
    ).toContainText(
      "Use a three-step review checklist before every final response.",
    );

    await page.getByTestId("agent-instruction-review-cancel-button").click();
    await expect(page.getByTestId("agent-prompt-textarea")).toHaveValue(
      initialInstructions,
    );

    await page.getByTestId("agent-instruction-enhance-button").click();
    await page
      .getByTestId("agent-instruction-enhance-prompt-textarea")
      .fill("Add a three-step review checklist before every final response.");
    await page.getByTestId("agent-instruction-enhance-generate-button").click();
    await page.getByTestId("agent-instruction-review-accept-button").click();

    await clickAndWaitForNavigation(page, "agent-save-button", "**/agents");
    await page.locator(`main a:has-text("${agentName}")`).first().click();
    await expect(page.getByTestId("agent-prompt-textarea")).toHaveValue(
      generatedInstructions,
    );
  });
});
