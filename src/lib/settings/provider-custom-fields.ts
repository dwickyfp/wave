import type { ProviderSettings } from "app-types/settings";

export type ProviderCustomFieldType = "text" | "number" | "boolean";

export type ProviderCustomFieldDefinition = {
  key: string;
  label: string;
  type: ProviderCustomFieldType;
  required?: boolean;
  placeholder?: string;
  description?: string;
};

const PROVIDER_CUSTOM_FIELDS: Record<string, ProviderCustomFieldDefinition[]> =
  {
    azure: [
      {
        key: "resourceName",
        label: "Resource Name",
        type: "text",
        required: true,
        placeholder: "my-azure-resource",
        description:
          "Azure resource name only (without .openai.azure.com domain).",
      },
      {
        key: "apiVersion",
        label: "API Version",
        type: "text",
        placeholder: "v1",
        description:
          "Optional override. Needed for preview/legacy deployment-based URLs.",
      },
      {
        key: "useDeploymentBasedUrls",
        label: "Use Deployment-Based URLs",
        type: "boolean",
        description:
          "Enable legacy Azure deployment URL format for compatible deployments.",
      },
    ],
  };

export function getProviderCustomFields(
  providerName: string,
): ProviderCustomFieldDefinition[] {
  return PROVIDER_CUSTOM_FIELDS[providerName] ?? [];
}

export function validateRequiredProviderSettings(
  providerName: string,
  settings: ProviderSettings | null | undefined,
): string[] {
  const fields = getProviderCustomFields(providerName).filter(
    (field) => field.required,
  );
  if (fields.length === 0) return [];

  const valueMap = settings ?? {};
  const errors: string[] = [];

  for (const field of fields) {
    const value = valueMap[field.key];
    if (field.type === "boolean") {
      if (typeof value !== "boolean") {
        errors.push(`${field.label} is required`);
      }
      continue;
    }
    if (field.type === "number") {
      if (typeof value !== "number" || Number.isNaN(value)) {
        errors.push(`${field.label} is required`);
      }
      continue;
    }
    if (typeof value !== "string" || value.trim().length === 0) {
      errors.push(`${field.label} is required`);
    }
  }

  return errors;
}
