import { describe, expect, it } from "vitest";
import {
  getProviderCustomFields,
  validateRequiredProviderSettings,
} from "./provider-custom-fields";

describe("provider-custom-fields", () => {
  it("exposes Azure custom fields", () => {
    const fields = getProviderCustomFields("azure");
    expect(fields.some((field) => field.key === "resourceName")).toBe(true);
  });

  it("validates required Azure resource name", () => {
    expect(validateRequiredProviderSettings("azure", {})).toEqual([
      "Resource Name is required",
    ]);
    expect(
      validateRequiredProviderSettings("azure", {
        resourceName: "my-azure-resource",
      }),
    ).toEqual([]);
  });
});
