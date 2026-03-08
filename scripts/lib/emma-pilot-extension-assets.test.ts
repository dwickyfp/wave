import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EMMA_PILOT_ICON_TARGETS } from "./emma-pilot-extension-assets";

describe("emma pilot extension assets", () => {
  it("defines the expected icon sizes for browser packaging", () => {
    expect(EMMA_PILOT_ICON_TARGETS).toEqual([
      {
        size: 16,
        filename: "icon16.png",
      },
      {
        size: 32,
        filename: "icon32.png",
      },
      {
        size: 48,
        filename: "icon48.png",
      },
      {
        size: 128,
        filename: "icon128.png",
      },
    ]);
  });

  it("ships all static icon files used by the extension package", () => {
    const iconRoot = path.join(
      process.cwd(),
      "extensions",
      "emma-pilot",
      "assets",
      "icons",
    );

    for (const target of EMMA_PILOT_ICON_TARGETS) {
      expect(existsSync(path.join(iconRoot, target.filename))).toBe(true);
    }
  });
});
