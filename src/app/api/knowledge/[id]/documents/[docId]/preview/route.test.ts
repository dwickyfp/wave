import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("auth/server", () => ({
  getSession: vi.fn(),
}));

vi.mock("lib/db/repository", () => ({
  knowledgeRepository: {
    selectGroupById: vi.fn(),
    selectDocumentById: vi.fn(),
    selectGroupSources: vi.fn(),
    getDocumentImages: vi.fn(),
    getDocumentImagesByVersion: vi.fn(),
  },
}));

vi.mock("lib/file-storage", () => ({
  serverFileStorage: {
    getDownloadUrl: vi.fn(),
    getSourceUrl: vi.fn(),
    download: vi.fn(),
  },
}));

vi.mock("lib/knowledge/versioning", () => ({
  listDocumentVersions: vi.fn(),
  getDocumentVersionContent: vi.fn(),
}));

const { getSession } = await import("auth/server");
const { knowledgeRepository } = await import("lib/db/repository");
const { serverFileStorage } = await import("lib/file-storage");
const { getDocumentVersionContent, listDocumentVersions } = await import(
  "lib/knowledge/versioning"
);
const { GET } = await import("./route");

function withParams(id: string, docId: string) {
  return {
    params: Promise.resolve({ id, docId }),
  } as {
    params: Promise<{ id: string; docId: string }>;
  };
}

function withRequest(url: string) {
  return {
    nextUrl: new URL(url),
  } as any;
}

describe("knowledge document preview route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSession).mockResolvedValue({
      user: {
        id: "user-1",
      },
    } as any);
  });

  it("returns version metadata for a previewable document", async () => {
    vi.mocked(knowledgeRepository.selectGroupById).mockResolvedValue({
      id: "group-1",
      userId: "user-1",
    } as any);
    vi.mocked(knowledgeRepository.selectDocumentById).mockResolvedValue({
      id: "doc-1",
      groupId: "group-1",
      userId: "user-1",
      name: "Legal Draft",
      description: "Processed markdown",
      originalFilename: "draft.txt",
      fileType: "txt",
      fileSize: 128,
      storagePath: null,
      sourceUrl: "https://example.com/draft",
      markdownContent: "# Draft",
      activeVersionId: "version-2",
      latestVersionNumber: 2,
    } as any);
    vi.mocked(listDocumentVersions).mockResolvedValue([
      {
        id: "version-2",
        versionNumber: 2,
        status: "ready",
        changeType: "edit",
        isActive: true,
        resolvedTitle: "Legal Draft",
        resolvedDescription: "Processed markdown",
        embeddingProvider: "openai",
        embeddingModel: "text-embedding-3-small",
        embeddingTokenCount: 42,
        chunkCount: 3,
        tokenCount: 120,
        sourceVersionId: "version-1",
        createdByUserId: "user-1",
        createdAt: new Date("2026-03-09T08:00:00.000Z"),
        updatedAt: new Date("2026-03-09T08:00:00.000Z"),
        canRollback: false,
        rollbackBlockedReason: null,
      },
    ]);
    vi.mocked(knowledgeRepository.getDocumentImagesByVersion).mockResolvedValue(
      [
        {
          id: "image-1",
          documentId: "doc-1",
          groupId: "group-1",
          versionId: "version-2",
          kind: "embedded",
          ordinal: 1,
          marker: "CTX_IMAGE_1",
          label: "Legal clause screenshot",
          description: "Screenshot for the legal clause walkthrough.",
          headingPath: "Draft > Clause review",
          stepHint: "Review the legal clause screenshot.",
          sourceUrl: "https://example.com/image-1.png",
          storagePath: "knowledge-images/doc-1/version-2/image-1.png",
          mediaType: "image/png",
          pageNumber: 1,
          width: 640,
          height: 480,
          altText: null,
          caption: null,
          surroundingText: null,
          isRenderable: true,
          manualLabel: false,
          manualDescription: false,
          embedding: null,
          createdAt: new Date("2026-03-09T08:00:00.000Z"),
          updatedAt: new Date("2026-03-09T08:00:00.000Z"),
        },
      ] as any,
    );

    const response = await GET(
      withRequest(
        "http://localhost/api/knowledge/group-1/documents/doc-1/preview",
      ),
      withParams("group-1", "doc-1"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      activeVersionId: "version-2",
      activeVersionNumber: 2,
      content: "# Draft",
      versions: [
        {
          id: "version-2",
          versionNumber: 2,
          isActive: true,
        },
      ],
      images: [
        {
          id: "image-1",
          label: "Legal clause screenshot",
          assetUrl:
            "/api/knowledge/group-1/documents/doc-1/images/image-1/asset?versionId=version-2",
        },
      ],
      doc: {
        activeVersionId: "version-2",
        latestVersionNumber: 2,
      },
      markdownAvailable: true,
    });
  });

  it("returns version-aware asset metadata for historical previews", async () => {
    vi.mocked(knowledgeRepository.selectGroupById).mockResolvedValue({
      id: "group-1",
      userId: "user-1",
    } as any);
    vi.mocked(knowledgeRepository.selectDocumentById).mockResolvedValue({
      id: "doc-1",
      groupId: "group-1",
      userId: "user-1",
      name: "Annual Report",
      description: "Processed markdown",
      originalFilename: "report.pdf",
      fileType: "pdf",
      fileSize: 2048,
      storagePath: "knowledge/doc-1/report.pdf",
      sourceUrl: null,
      markdownContent: "# Active report",
      activeVersionId: "version-2",
      latestVersionNumber: 2,
    } as any);
    vi.mocked(listDocumentVersions).mockResolvedValue([
      {
        id: "version-1",
        versionNumber: 1,
        status: "ready",
        changeType: "initial_ingest",
        isActive: false,
        resolvedTitle: "Annual Report",
        resolvedDescription: "Archived source",
        embeddingProvider: "openai",
        embeddingModel: "text-embedding-3-small",
        embeddingTokenCount: 42,
        chunkCount: 3,
        tokenCount: 120,
        sourceVersionId: null,
        createdByUserId: "user-1",
        createdAt: new Date("2026-03-08T08:00:00.000Z"),
        updatedAt: new Date("2026-03-08T08:00:00.000Z"),
        canRollback: true,
        rollbackBlockedReason: null,
      },
      {
        id: "version-2",
        versionNumber: 2,
        status: "ready",
        changeType: "edit",
        isActive: true,
        resolvedTitle: "Annual Report",
        resolvedDescription: "Current source",
        embeddingProvider: "openai",
        embeddingModel: "text-embedding-3-small",
        embeddingTokenCount: 42,
        chunkCount: 3,
        tokenCount: 120,
        sourceVersionId: "version-1",
        createdByUserId: "user-1",
        createdAt: new Date("2026-03-09T08:00:00.000Z"),
        updatedAt: new Date("2026-03-09T08:00:00.000Z"),
        canRollback: false,
        rollbackBlockedReason: null,
      },
    ]);
    vi.mocked(getDocumentVersionContent).mockResolvedValue({
      documentId: "doc-1",
      versionId: "version-1",
      markdownContent: "# Historical report",
      title: "Annual Report",
      description: "Archived source",
      createdAt: new Date("2026-03-08T08:00:00.000Z"),
      updatedAt: new Date("2026-03-08T08:00:00.000Z"),
    } as any);
    vi.mocked(knowledgeRepository.getDocumentImagesByVersion).mockResolvedValue(
      [],
    );
    vi.mocked(knowledgeRepository.getDocumentImages).mockResolvedValue([]);
    vi.mocked(serverFileStorage.getDownloadUrl!).mockResolvedValue(
      "https://storage.example/report.pdf",
    );

    const response = await GET(
      withRequest(
        "http://localhost/api/knowledge/group-1/documents/doc-1/preview?versionId=version-1",
      ),
      withParams("group-1", "doc-1"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      requestedVersionId: "version-1",
      resolvedVersionId: "version-1",
      binaryMatchesRequestedVersion: false,
      fallbackWarning: expect.stringContaining("historical file snapshots"),
      assetUrl:
        "/api/knowledge/group-1/documents/doc-1/asset?versionId=version-1",
      content: "# Historical report",
    });
  });

  it("resolves citation page from excerpt when citation metadata is missing", async () => {
    vi.mocked(knowledgeRepository.selectGroupById).mockResolvedValue({
      id: "group-1",
      userId: "user-1",
    } as any);
    vi.mocked(knowledgeRepository.selectDocumentById).mockResolvedValue({
      id: "doc-1",
      groupId: "group-1",
      userId: "user-1",
      name: "PMK 161",
      description: "Processed markdown",
      originalFilename: "pmk-161.pdf",
      fileType: "pdf",
      fileSize: 2048,
      storagePath: "knowledge/doc-1/pmk-161.pdf",
      sourceUrl: null,
      markdownContent: [
        "<!--CTX_PAGE:1-->",
        "Opening definitions and title page.",
        "",
        "<!--CTX_PAGE:2-->",
        "Vape products become taxable under the updated reporting framework.",
      ].join("\n"),
      activeVersionId: "version-2",
      latestVersionNumber: 2,
    } as any);
    vi.mocked(listDocumentVersions).mockResolvedValue([
      {
        id: "version-2",
        versionNumber: 2,
        status: "ready",
        changeType: "edit",
        isActive: true,
        resolvedTitle: "PMK 161",
        resolvedDescription: "Processed markdown",
        embeddingProvider: "openai",
        embeddingModel: "text-embedding-3-small",
        embeddingTokenCount: 42,
        chunkCount: 3,
        tokenCount: 120,
        sourceVersionId: "version-1",
        createdByUserId: "user-1",
        createdAt: new Date("2026-03-09T08:00:00.000Z"),
        updatedAt: new Date("2026-03-09T08:00:00.000Z"),
        canRollback: false,
        rollbackBlockedReason: null,
      },
    ]);
    vi.mocked(knowledgeRepository.getDocumentImagesByVersion).mockResolvedValue(
      [],
    );
    vi.mocked(serverFileStorage.getDownloadUrl!).mockResolvedValue(
      "https://storage.example/pmk-161.pdf",
    );

    const response = await GET(
      withRequest(
        "http://localhost/api/knowledge/group-1/documents/doc-1/preview?excerpt=Vape%20products%20become%20taxable%20under%20the%20updated%20reporting%20framework.",
      ),
      withParams("group-1", "doc-1"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      resolvedCitationPageStart: 2,
      resolvedCitationPageEnd: 2,
    });
  });

  it("overrides an incorrect saved single page when section heading and excerpt point to pasal 7", async () => {
    vi.mocked(knowledgeRepository.selectGroupById).mockResolvedValue({
      id: "group-1",
      userId: "user-1",
    } as any);
    vi.mocked(knowledgeRepository.selectDocumentById).mockResolvedValue({
      id: "doc-1",
      groupId: "group-1",
      userId: "user-1",
      name: "161_PMK.04_2022.pdf",
      description: "Processed markdown",
      originalFilename: "161_PMK.04_2022.pdf",
      fileType: "pdf",
      fileSize: 2048,
      storagePath: "knowledge/doc-1/161_PMK.04_2022.pdf",
      sourceUrl: null,
      markdownContent: [
        "<!--CTX_PAGE:6-->",
        "Pasal 3",
        "Pengusaha Pabrik wajib memberitahukan secara berkala kepada Kepala Kantor mengenai barang kena cukai yang selesai dibuat.",
        "",
        "<!--CTX_PAGE:7-->",
        "Pasal 7",
        "Pemberitahuan bulanan disampaikan oleh Pengusaha Pabrik paling lambat pada tanggal 10 (sepuluh) bulan berikutnya.",
      ].join("\n"),
      activeVersionId: "version-161",
      latestVersionNumber: 1,
    } as any);
    vi.mocked(listDocumentVersions).mockResolvedValue([
      {
        id: "version-161",
        versionNumber: 1,
        status: "ready",
        changeType: "initial_ingest",
        isActive: true,
        resolvedTitle: "161_PMK.04_2022.pdf",
        resolvedDescription: "Processed markdown",
        embeddingProvider: "openai",
        embeddingModel: "text-embedding-3-small",
        embeddingTokenCount: 42,
        chunkCount: 3,
        tokenCount: 120,
        sourceVersionId: null,
        createdByUserId: "user-1",
        createdAt: new Date("2026-03-09T08:00:00.000Z"),
        updatedAt: new Date("2026-03-09T08:00:00.000Z"),
        canRollback: false,
        rollbackBlockedReason: null,
      },
    ]);
    vi.mocked(knowledgeRepository.getDocumentImagesByVersion).mockResolvedValue(
      [],
    );
    vi.mocked(serverFileStorage.getDownloadUrl!).mockResolvedValue(
      "https://storage.example/161_PMK.04_2022.pdf",
    );

    const response = await GET(
      withRequest(
        "http://localhost/api/knowledge/group-1/documents/doc-1/preview?pageStart=6&pageEnd=6&sectionHeading=Pasal%207&excerpt=Pemberitahuan%20bulanan%20disampaikan%20oleh%20Pengusaha%20Pabrik%20paling%20lambat%20pada%20tanggal%2010%20(sepuluh)%20bulan%20berikutnya.",
      ),
      withParams("group-1", "doc-1"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      resolvedCitationPageStart: 7,
      resolvedCitationPageEnd: 7,
    });
  });

  it("uses section heading to recover a legal page when the excerpt is generic", async () => {
    vi.mocked(knowledgeRepository.selectGroupById).mockResolvedValue({
      id: "group-1",
      userId: "user-1",
    } as any);
    vi.mocked(knowledgeRepository.selectDocumentById).mockResolvedValue({
      id: "doc-1",
      groupId: "group-1",
      userId: "user-1",
      name: "161_PMK.04_2022.pdf",
      description: "Processed markdown",
      originalFilename: "161_PMK.04_2022.pdf",
      fileType: "pdf",
      fileSize: 2048,
      storagePath: "knowledge/doc-1/161_PMK.04_2022.pdf",
      sourceUrl: null,
      markdownContent: [
        "<!--CTX_PAGE:6-->",
        "Pasal 3",
        "Pengusaha Pabrik wajib memberitahukan secara berkala kepada Kepala Kantor mengenai barang kena cukai yang selesai dibuat.",
        "",
        "<!--CTX_PAGE:7-->",
        "Pasal 7",
        "Ketentuan rinci mengenai pemberitahuan bulanan.",
      ].join("\n"),
      activeVersionId: "version-161",
      latestVersionNumber: 1,
    } as any);
    vi.mocked(listDocumentVersions).mockResolvedValue([
      {
        id: "version-161",
        versionNumber: 1,
        status: "ready",
        changeType: "initial_ingest",
        isActive: true,
        resolvedTitle: "161_PMK.04_2022.pdf",
        resolvedDescription: "Processed markdown",
        embeddingProvider: "openai",
        embeddingModel: "text-embedding-3-small",
        embeddingTokenCount: 42,
        chunkCount: 3,
        tokenCount: 120,
        sourceVersionId: null,
        createdByUserId: "user-1",
        createdAt: new Date("2026-03-09T08:00:00.000Z"),
        updatedAt: new Date("2026-03-09T08:00:00.000Z"),
        canRollback: false,
        rollbackBlockedReason: null,
      },
    ]);
    vi.mocked(knowledgeRepository.getDocumentImagesByVersion).mockResolvedValue(
      [],
    );
    vi.mocked(serverFileStorage.getDownloadUrl!).mockResolvedValue(
      "https://storage.example/161_PMK.04_2022.pdf",
    );

    const response = await GET(
      withRequest(
        "http://localhost/api/knowledge/group-1/documents/doc-1/preview?sectionHeading=Pasal%207&excerpt=Ketentuan%20rinci%20pelaporan&pageStart=6&pageEnd=6",
      ),
      withParams("group-1", "doc-1"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      resolvedCitationPageStart: 7,
      resolvedCitationPageEnd: 7,
    });
  });

  it("corrects a wrong saved single page for a general manual citation", async () => {
    vi.mocked(knowledgeRepository.selectGroupById).mockResolvedValue({
      id: "group-1",
      userId: "user-1",
    } as any);
    vi.mocked(knowledgeRepository.selectDocumentById).mockResolvedValue({
      id: "doc-1",
      groupId: "group-1",
      userId: "user-1",
      name: "Product Manual",
      description: "Processed markdown",
      originalFilename: "manual.pdf",
      fileType: "pdf",
      fileSize: 2048,
      storagePath: "knowledge/doc-1/manual.pdf",
      sourceUrl: null,
      markdownContent: [
        "<!--CTX_PAGE:2-->",
        "Installation",
        "Install the desktop app from the downloads page and sign in.",
        "",
        "<!--CTX_PAGE:5-->",
        "Workspace Settings",
        "To enable automatic backup, open Settings > Backup and toggle Auto Backup.",
      ].join("\n"),
      activeVersionId: "version-1",
      latestVersionNumber: 1,
    } as any);
    vi.mocked(listDocumentVersions).mockResolvedValue([
      {
        id: "version-1",
        versionNumber: 1,
        status: "ready",
        changeType: "initial_ingest",
        isActive: true,
        resolvedTitle: "Product Manual",
        resolvedDescription: "Processed markdown",
        embeddingProvider: "openai",
        embeddingModel: "text-embedding-3-small",
        embeddingTokenCount: 42,
        chunkCount: 3,
        tokenCount: 120,
        sourceVersionId: null,
        createdByUserId: "user-1",
        createdAt: new Date("2026-03-09T08:00:00.000Z"),
        updatedAt: new Date("2026-03-09T08:00:00.000Z"),
        canRollback: false,
        rollbackBlockedReason: null,
      },
    ]);
    vi.mocked(knowledgeRepository.getDocumentImagesByVersion).mockResolvedValue(
      [],
    );
    vi.mocked(serverFileStorage.getDownloadUrl!).mockResolvedValue(
      "https://storage.example/manual.pdf",
    );

    const response = await GET(
      withRequest(
        "http://localhost/api/knowledge/group-1/documents/doc-1/preview?pageStart=2&pageEnd=2&sectionHeading=Workspace%20Settings&excerpt=Open%20Settings%20Backup%20and%20toggle%20Auto%20Backup.",
      ),
      withParams("group-1", "doc-1"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      resolvedCitationPageStart: 5,
      resolvedCitationPageEnd: 5,
    });
  });

  it("returns 404 when the requested version does not exist", async () => {
    vi.mocked(knowledgeRepository.selectGroupById).mockResolvedValue({
      id: "group-1",
      userId: "user-1",
    } as any);
    vi.mocked(knowledgeRepository.selectDocumentById).mockResolvedValue({
      id: "doc-1",
      groupId: "group-1",
      userId: "user-1",
      name: "Annual Report",
      description: "Processed markdown",
      originalFilename: "report.pdf",
      fileType: "pdf",
      fileSize: 2048,
      storagePath: "knowledge/doc-1/report.pdf",
      sourceUrl: null,
      markdownContent: "# Active report",
      activeVersionId: "version-2",
      latestVersionNumber: 2,
    } as any);
    vi.mocked(listDocumentVersions).mockResolvedValue([
      {
        id: "version-2",
        versionNumber: 2,
        status: "ready",
        changeType: "edit",
        isActive: true,
        resolvedTitle: "Annual Report",
        resolvedDescription: "Current source",
        embeddingProvider: "openai",
        embeddingModel: "text-embedding-3-small",
        embeddingTokenCount: 42,
        chunkCount: 3,
        tokenCount: 120,
        sourceVersionId: "version-1",
        createdByUserId: "user-1",
        createdAt: new Date("2026-03-09T08:00:00.000Z"),
        updatedAt: new Date("2026-03-09T08:00:00.000Z"),
        canRollback: false,
        rollbackBlockedReason: null,
      },
    ]);

    const response = await GET(
      withRequest(
        "http://localhost/api/knowledge/group-1/documents/doc-1/preview?versionId=missing-version",
      ),
      withParams("group-1", "doc-1"),
    );

    expect(response.status).toBe(404);
  });
});
