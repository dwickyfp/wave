import { expect, test } from "@playwright/test";
import { TEST_USERS } from "../constants/test-users";
import { ensureSidebarOpen } from "../helpers/sidebar-helper";

test.describe("Skills Feature", () => {
  test.use({ storageState: TEST_USERS.editor.authFile });

  test("shows Skills in sidebar and navigates to skills page", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await ensureSidebarOpen(page);

    const skillsLink = page.locator('a[href="/skills"]');
    await expect(skillsLink).toBeVisible();

    await skillsLink.click();
    await page.waitForURL("**/skills");
    await expect(page.getByRole("heading", { name: "Skills" })).toBeVisible();
  });

  test("creates a skill from skills page", async ({ page }) => {
    const skillTitle = `Skill ${Date.now()}`;

    await page.goto("/skills");
    await page.waitForLoadState("networkidle");

    await page.getByTestId("skills-new-button").click();
    await page.getByTestId("skill-title-input").fill(skillTitle);
    await page
      .getByTestId("skill-instructions-textarea")
      .fill("## Goal\n- Draft technical updates\n## Steps\n- Gather context");
    await page.getByTestId("skill-create-button").click();

    await expect(
      page.getByTestId("skill-card-title").filter({ hasText: skillTitle }),
    ).toBeVisible({ timeout: 10000 });
  });
});
