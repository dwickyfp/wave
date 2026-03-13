import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("ai", () => ({
  generateText: vi.fn(),
}));
vi.mock("lib/ai/provider-factory", () => ({
  createModelFromConfig: vi.fn(() => ({ provider: "mock-model" })),
}));
vi.mock("lib/db/repository", () => ({
  settingsRepository: {
    getSetting: vi.fn(),
    getProviderByName: vi.fn(async () => ({
      enabled: true,
      apiKey: "key",
      baseUrl: null,
      settings: {},
    })),
    getModelForChat: vi.fn(async (_provider: string, model: string) => ({
      apiName: model,
    })),
  },
}));

import { generateText } from "ai";
import {
  extractAutoDocumentMetadata,
  generateDocumentMetadata,
} from "./document-metadata";

describe("document metadata generation", () => {
  it("extracts heuristic metadata from headings and paragraphs", () => {
    expect(
      extractAutoDocumentMetadata(
        "# Peraturan Menteri Keuangan\n\nDokumen ini mengatur pemberitahuan barang kena cukai yang selesai dibuat.",
        "fallback",
      ),
    ).toEqual({
      title: "Peraturan Menteri Keuangan",
      description:
        "Dokumen ini mengatur pemberitahuan barang kena cukai yang selesai dibuat.",
    });
  });

  it("prefers llm-generated metadata when available", async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: "Title: Peraturan Menteri Keuangan Nomor 134/PMK.04/2019\nDescription: Peraturan ini mengatur perubahan atas ketentuan pemberitahuan barang kena cukai yang selesai dibuat di Indonesia.",
    } as never);

    const metadata = await generateDocumentMetadata({
      markdown:
        "# PERATURAN MENTERI KEUANGAN REPUBLIK INDONESIA\n\nPeraturan Menteri Keuangan ini menetapkan perubahan atas pemberitahuan barang kena cukai yang selesai dibuat.",
      fallbackTitle: "fallback",
      modelConfig: { provider: "openai", model: "gpt-4.1-mini" },
    });

    expect(metadata).toEqual({
      title: "Peraturan Menteri Keuangan Nomor 134/PMK.04/2019",
      description:
        "Peraturan ini mengatur perubahan atas ketentuan pemberitahuan barang kena cukai yang selesai dibuat di Indonesia.",
    });
  });
});
