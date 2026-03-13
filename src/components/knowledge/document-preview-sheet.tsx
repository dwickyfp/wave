"use client";

import type {
  KnowledgeDocument,
  KnowledgeDocumentImagePreview,
  KnowledgeDocumentHistoryEvent,
  KnowledgeDocumentPreview,
  KnowledgeDocumentVersionContent,
  KnowledgeDocumentVersionSummary,
} from "app-types/knowledge";
import { formatKnowledgeDocumentProcessingState } from "lib/knowledge/processing-state";
import { cn } from "lib/utils";
import {
  Clock3Icon,
  DownloadIcon,
  ExternalLinkIcon,
  FileIcon,
  FileTextIcon,
  LinkIcon,
  Loader2Icon,
  RotateCcwIcon,
  SaveIcon,
  TableIcon,
  XIcon,
} from "lucide-react";
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { Badge } from "ui/badge";
import { Button } from "ui/button";
import { Input } from "ui/input";
import { Label } from "ui/label";
import { ScrollArea } from "ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "ui/tabs";
import { Textarea } from "ui/textarea";

const FILE_ICONS: Record<string, React.FC<{ className?: string }>> = {
  pdf: FileTextIcon,
  docx: FileTextIcon,
  xlsx: TableIcon,
  csv: TableIcon,
  url: LinkIcon,
  txt: FileTextIcon,
  md: FileTextIcon,
  html: FileTextIcon,
};

type MainTab = "configuration" | "original" | "images" | "markdown" | "history";

const LIVE_IMAGE_CACHE_KEY = "__live__";

function isMainTab(value: string): value is MainTab {
  return (
    value === "configuration" ||
    value === "original" ||
    value === "images" ||
    value === "markdown" ||
    value === "history"
  );
}

function formatBytes(bytes?: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function getImageCacheKey(versionId?: string | null) {
  return versionId ?? LIVE_IMAGE_CACHE_KEY;
}

function formatVersionLabel(version: KnowledgeDocumentVersionSummary) {
  return `Version ${version.versionNumber}`;
}

function getSelectionOffsetsWithinElement(element: HTMLElement) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return null;
  }

  const range = selection.getRangeAt(0);
  if (
    !element.contains(range.startContainer) ||
    !element.contains(range.endContainer)
  ) {
    return null;
  }

  const startRange = range.cloneRange();
  startRange.selectNodeContents(element);
  startRange.setEnd(range.startContainer, range.startOffset);

  const endRange = range.cloneRange();
  endRange.selectNodeContents(element);
  endRange.setEnd(range.endContainer, range.endOffset);

  return {
    start: startRange.toString().length,
    end: endRange.toString().length,
  };
}

function VersionLabel({
  version,
}: {
  version: KnowledgeDocumentVersionSummary;
}) {
  return (
    <span className="flex items-center gap-2">
      <span>{formatVersionLabel(version)}</span>
      {version.isActive ? (
        <Badge className="border-emerald-500/30 bg-emerald-500/15 text-[10px] text-emerald-400 hover:bg-emerald-500/15">
          Active
        </Badge>
      ) : null}
    </span>
  );
}

function describeHistoryEvent(event: KnowledgeDocumentHistoryEvent) {
  switch (event.eventType) {
    case "bootstrap":
      return "Bootstrapped the first tracked version from the existing live document.";
    case "created":
      return "Created a new version from source ingestion.";
    case "edited":
      return "Saved edited markdown as a new embedded version.";
    case "rollback":
      return "Duplicated an older version as the new active version.";
    case "reingest":
      return "Re-ingested the source document into a new version.";
    case "failed":
      return String(event.details?.errorMessage ?? "Version job failed.");
    default:
      return "Version event recorded.";
  }
}

function getHistoryEventTitle(event: KnowledgeDocumentHistoryEvent) {
  switch (event.eventType) {
    case "bootstrap":
      return "Initial version tracked";
    case "created":
      return "Source version created";
    case "edited":
      return "Markdown updated";
    case "rollback":
      return "Rollback duplicated";
    case "reingest":
      return "Source re-ingested";
    case "failed":
      return "Version job failed";
    default:
      return "Version event";
  }
}

function getHistoryEventIcon(event: KnowledgeDocumentHistoryEvent) {
  switch (event.eventType) {
    case "edited":
      return SaveIcon;
    case "rollback":
      return RotateCcwIcon;
    case "failed":
      return XIcon;
    case "created":
    case "reingest":
    case "bootstrap":
      return FileTextIcon;
    default:
      return Clock3Icon;
  }
}

function getHistoryEventTone(event: KnowledgeDocumentHistoryEvent) {
  switch (event.eventType) {
    case "edited":
      return "border-sky-500/30 bg-sky-500/10 text-sky-400";
    case "rollback":
      return "border-violet-500/30 bg-violet-500/10 text-violet-400";
    case "failed":
      return "border-rose-500/30 bg-rose-500/10 text-rose-400";
    case "created":
    case "reingest":
    case "bootstrap":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-400";
    default:
      return "border-border bg-muted/20 text-muted-foreground";
  }
}

interface Props {
  doc: KnowledgeDocument | null;
  groupId: string;
  open: boolean;
  onClose: () => void;
  onDocumentUpdated?: (doc: KnowledgeDocument) => void;
}

export function DocumentPreviewSheet({
  doc,
  groupId,
  open,
  onClose,
  onDocumentUpdated,
}: Props) {
  const [previewData, setPreviewData] =
    useState<KnowledgeDocumentPreview | null>(null);
  const [history, setHistory] = useState<KnowledgeDocumentHistoryEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [savingConfig, setSavingConfig] = useState(false);
  const [savingVersion, setSavingVersion] = useState(false);
  const [savingImages, setSavingImages] = useState(false);
  const [mainTab, setMainTab] = useState<MainTab>("configuration");
  const [isMarkdownEditing, setIsMarkdownEditing] = useState(false);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(
    null,
  );
  const [preferredVersionId, setPreferredVersionId] = useState<string | null>(
    null,
  );
  const [draftMarkdown, setDraftMarkdown] = useState("");
  const [markdownByVersion, setMarkdownByVersion] = useState<
    Record<string, string>
  >({});
  const [markdownLoading, setMarkdownLoading] = useState(false);
  const [markdownError, setMarkdownError] = useState<string | null>(null);
  const [documentImages, setDocumentImages] = useState<
    KnowledgeDocumentImagePreview[]
  >([]);
  const [imagesByVersion, setImagesByVersion] = useState<
    Record<string, KnowledgeDocumentImagePreview[]>
  >({});
  const [draftImages, setDraftImages] = useState<
    KnowledgeDocumentImagePreview[]
  >([]);
  const [imagesLoading, setImagesLoading] = useState(false);
  const markdownEditorRef = useRef<HTMLTextAreaElement | null>(null);
  const markdownPreviewViewportRef = useRef<HTMLDivElement | null>(null);
  const pendingMarkdownScrollTopRef = useRef<number | null>(null);
  const pendingMarkdownSelectionRef = useRef<{
    start: number;
    end: number;
  } | null>(null);

  const syncDraftMarkdownFromEditor = () => {
    const editor = markdownEditorRef.current;
    if (!editor) {
      return draftMarkdown;
    }

    const nextValue = editor.value;
    setDraftMarkdown(nextValue);
    return nextValue;
  };

  const loadPreview = useEffectEvent(
    async ({ showLoader = true }: { showLoader?: boolean } = {}) => {
      if (!doc) return;
      if (showLoader) {
        setLoading(true);
      }
      setError(null);

      try {
        const response = await fetch(
          `/api/knowledge/${groupId}/documents/${doc.id}/preview?ts=${Date.now()}`,
          {
            cache: "no-store",
          },
        );
        const data = (await response.json()) as KnowledgeDocumentPreview & {
          error?: string;
        };
        if (!response.ok || data.error) {
          throw new Error(data.error || "Failed to load preview");
        }
        setPreviewData(data);
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Failed to load preview",
        );
      } finally {
        if (showLoader) {
          setLoading(false);
        }
      }
    },
  );

  const loadHistory = useEffectEvent(
    async (
      documentId: string,
      { silent = false }: { silent?: boolean } = {},
    ) => {
      if (!silent) {
        setHistoryLoading(true);
      }
      try {
        const response = await fetch(
          `/api/knowledge/${groupId}/documents/${documentId}/history?ts=${Date.now()}`,
          {
            cache: "no-store",
          },
        );
        const data = (await response.json()) as {
          history?: KnowledgeDocumentHistoryEvent[];
          error?: string;
        };
        if (!response.ok || data.error) {
          throw new Error(data.error || "Failed to load history");
        }
        setHistory(data.history ?? []);
      } catch (historyError) {
        if (!silent) {
          toast.error(
            historyError instanceof Error
              ? historyError.message
              : "Failed to load history",
          );
        }
      } finally {
        if (!silent) {
          setHistoryLoading(false);
        }
      }
    },
  );

  const loadImages = useEffectEvent(
    async (
      documentId: string,
      versionId?: string | null,
      { silent = false }: { silent?: boolean } = {},
    ) => {
      const cacheKey = getImageCacheKey(versionId);
      const cachedImages = imagesByVersion[cacheKey];
      if (cachedImages !== undefined) {
        setDocumentImages(cachedImages);
        return;
      }

      if (
        versionId &&
        versionId === previewData?.activeVersionId &&
        previewData.images.length > 0
      ) {
        setImagesByVersion((current) => ({
          ...current,
          [cacheKey]: previewData.images,
        }));
        setDocumentImages(previewData.images);
        return;
      }

      if (!silent) {
        setImagesLoading(true);
      }
      try {
        const search = versionId
          ? `?versionId=${encodeURIComponent(versionId)}`
          : "";
        const response = await fetch(
          `/api/knowledge/${groupId}/documents/${documentId}/images${search}`,
          {
            cache: "no-store",
          },
        );
        const data = (await response.json()) as {
          images?: KnowledgeDocumentImagePreview[];
          error?: string;
        };
        if (!response.ok || data.error) {
          throw new Error(data.error || "Failed to load images");
        }
        const nextImages = data.images ?? [];
        setImagesByVersion((current) => ({
          ...current,
          [cacheKey]: nextImages,
        }));
        setDocumentImages(nextImages);
      } catch (imagesError) {
        if (!silent) {
          toast.error(
            imagesError instanceof Error
              ? imagesError.message
              : "Failed to load images",
          );
        }
      } finally {
        if (!silent) {
          setImagesLoading(false);
        }
      }
    },
  );

  const loadVersionMarkdown = useEffectEvent(
    async (
      documentId: string,
      versionId: string,
      { force = false }: { force?: boolean } = {},
    ) => {
      if (!force && markdownByVersion[versionId] !== undefined) {
        setDraftMarkdown(markdownByVersion[versionId] ?? "");
        setMarkdownError(null);
        return;
      }

      setMarkdownLoading(true);
      setMarkdownError(null);
      try {
        const response = await fetch(
          `/api/knowledge/${groupId}/documents/${documentId}/versions/${versionId}/content?ts=${Date.now()}`,
          {
            cache: "no-store",
          },
        );
        const data = (await response.json()) as
          | (KnowledgeDocumentVersionContent & { error?: string })
          | { error?: string };
        if (!response.ok || data.error) {
          throw new Error(data.error || "Failed to load markdown");
        }

        const markdown =
          "markdownContent" in data ? (data.markdownContent ?? "") : "";
        setMarkdownByVersion((current) => ({
          ...current,
          [versionId]: markdown,
        }));
        setDraftMarkdown(markdown);
      } catch (loadError) {
        setMarkdownError(
          loadError instanceof Error
            ? loadError.message
            : "Failed to load markdown",
        );
        setDraftMarkdown("");
      } finally {
        setMarkdownLoading(false);
      }
    },
  );

  useEffect(() => {
    if (!open || !doc) {
      setPreviewData(null);
      setHistory([]);
      setError(null);
      setSelectedVersionId(null);
      setPreferredVersionId(null);
      setIsMarkdownEditing(false);
      setDraftMarkdown("");
      setMarkdownByVersion({});
      setMarkdownLoading(false);
      setMarkdownError(null);
      setDocumentImages([]);
      setImagesByVersion({});
      setDraftImages([]);
      setMainTab("configuration");
      return;
    }

    void loadPreview();
  }, [open, doc, groupId]);

  useEffect(() => {
    if (!previewData?.doc) return;
    setTitle(previewData.doc.name ?? "");
    setDescription(previewData.doc.description ?? "");
  }, [
    previewData?.doc?.id,
    previewData?.doc?.name,
    previewData?.doc?.description,
  ]);

  useEffect(() => {
    if (!previewData?.activeVersionId) return;
    const activeImages = previewData.images ?? [];
    const activeCacheKey = getImageCacheKey(previewData.activeVersionId);
    setImagesByVersion((current) =>
      current[activeCacheKey] === activeImages
        ? current
        : {
            ...current,
            [activeCacheKey]: activeImages,
          },
    );

    if (
      (selectedVersionId ?? previewData.activeVersionId) ===
      previewData.activeVersionId
    ) {
      setDocumentImages(activeImages);
    }
  }, [previewData?.activeVersionId, previewData?.images, selectedVersionId]);

  useEffect(() => {
    if (mainTab === "history" && previewData?.doc?.id) {
      void loadHistory(previewData.doc.id);
    }
    if (mainTab === "images" && previewData?.doc?.id) {
      void loadImages(previewData.doc.id, selectedVersionId ?? null);
    }
    if (mainTab === "markdown" && previewData?.doc?.id && selectedVersionId) {
      void loadVersionMarkdown(previewData.doc.id, selectedVersionId);
    }
  }, [
    mainTab,
    previewData?.doc?.id,
    groupId,
    selectedVersionId,
    loadVersionMarkdown,
  ]);

  const hasPendingVersionJob =
    previewData?.versions.some((version) => version.status === "processing") ??
    false;

  useEffect(() => {
    if (!open || !doc || !previewData || !hasPendingVersionJob) {
      return;
    }

    const pollId = window.setInterval(() => {
      void loadPreview({ showLoader: false });
      if (mainTab === "history" && previewData.doc.id) {
        void loadHistory(previewData.doc.id, { silent: true });
      }
    }, 2000);

    return () => window.clearInterval(pollId);
  }, [
    open,
    doc,
    previewData,
    hasPendingVersionJob,
    mainTab,
    loadPreview,
    loadHistory,
  ]);

  useEffect(() => {
    if (!previewData) return;
    const activeVersion =
      previewData.versions.find((version) => version.isActive) ?? null;
    const initialVersionId = activeVersion?.id ?? previewData.activeVersionId;
    setSelectedVersionId((current) =>
      preferredVersionId &&
      previewData.versions.some((version) => version.id === preferredVersionId)
        ? preferredVersionId
        : current &&
            previewData.versions.some((version) => version.id === current)
          ? current
          : (initialVersionId ?? null),
    );
  }, [previewData, preferredVersionId]);

  useEffect(() => {
    if (
      previewData?.activeVersionId &&
      preferredVersionId === previewData.activeVersionId
    ) {
      setPreferredVersionId(null);
    }
  }, [previewData?.activeVersionId, preferredVersionId]);

  useEffect(() => {
    if (
      selectedVersionId &&
      markdownByVersion[selectedVersionId] !== undefined
    ) {
      setDraftMarkdown(markdownByVersion[selectedVersionId] ?? "");
      setMarkdownError(null);
    }
  }, [selectedVersionId, markdownByVersion]);

  useEffect(() => {
    setIsMarkdownEditing(false);
    pendingMarkdownSelectionRef.current = null;
    pendingMarkdownScrollTopRef.current = null;
  }, [selectedVersionId, mainTab, previewData?.activeVersionId]);

  useLayoutEffect(() => {
    if (!isMarkdownEditing) {
      return;
    }

    const editor = markdownEditorRef.current;
    if (!editor) {
      return;
    }

    const selection = pendingMarkdownSelectionRef.current;
    const scrollTop = pendingMarkdownScrollTopRef.current;
    if (document.activeElement !== editor) {
      editor.focus();
    }
    if (selection) {
      editor.setSelectionRange(selection.start, selection.end);
    } else {
      editor.setSelectionRange(0, 0);
    }
    if (scrollTop !== null) {
      editor.scrollTop = scrollTop;
    }
  }, [isMarkdownEditing]);

  useEffect(() => {
    setDraftImages(documentImages);
  }, [documentImages]);

  const currentTitle = previewData?.doc?.name ?? "";
  const currentDescription = previewData?.doc?.description ?? "";
  const isInherited = !!previewData?.doc?.isInherited;
  const activeVersion =
    previewData?.versions.find((version) => version.isActive) ?? null;
  const processingLabel = formatKnowledgeDocumentProcessingState(
    doc?.processingState,
  );
  const isProcessing = doc?.status === "processing" || !!doc?.processingState;
  const selectedVersion =
    previewData?.versions.find((version) => version.id === selectedVersionId) ??
    activeVersion ??
    null;
  const baselineMarkdown =
    (selectedVersionId && markdownByVersion[selectedVersionId]) ?? "";
  const currentMarkdownDraft =
    isMarkdownEditing && markdownEditorRef.current
      ? markdownEditorRef.current.value
      : draftMarkdown;
  const markdownAvailable =
    !!previewData?.markdownAvailable && !!selectedVersionId;
  const hasLoadedMarkdown =
    !!selectedVersionId && markdownByVersion[selectedVersionId] !== undefined;
  const hasConfigChanges =
    !isInherited &&
    (title.trim() !== currentTitle ||
      description.trim() !== currentDescription);
  const hasVersionSelectionChange =
    !!previewData &&
    (selectedVersionId ?? previewData.activeVersionId ?? null) !==
      (previewData.activeVersionId ?? null);
  const hasMarkdownDraftChanges = currentMarkdownDraft !== baselineMarkdown;
  const rollbackSelectionBlocked =
    hasVersionSelectionChange &&
    (!selectedVersion || !selectedVersion.canRollback);
  const showMarkdownActions =
    mainTab === "markdown" &&
    markdownAvailable &&
    (hasVersionSelectionChange || hasMarkdownDraftChanges);
  const isActiveVersionSelected =
    !!selectedVersion &&
    selectedVersion.id === (previewData?.activeVersionId ?? null);
  const canStartMarkdownEdit =
    !isInherited &&
    isActiveVersionSelected &&
    mainTab === "markdown" &&
    hasLoadedMarkdown;
  const canEditMarkdown = canStartMarkdownEdit && isMarkdownEditing;
  const canEditImages =
    !isInherited && isActiveVersionSelected && mainTab === "images";
  const hasImageDraftChanges =
    draftImages.length !== documentImages.length ||
    draftImages.some((image, index) => {
      const baseline = documentImages[index];
      if (!baseline) return true;
      return (
        image.label !== baseline.label ||
        image.description !== baseline.description ||
        (image.stepHint ?? "") !== (baseline.stepHint ?? "")
      );
    });

  const handleSaveConfiguration = async () => {
    if (!doc || !previewData?.doc) return;
    if (previewData.doc.isInherited) {
      toast.error("Inherited documents are read-only");
      return;
    }
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      toast.error("Title is required");
      return;
    }

    setSavingConfig(true);
    try {
      const trimmedDescription = description.trim();
      const response = await fetch(
        `/api/knowledge/${groupId}/documents/${doc.id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: trimmedTitle,
            description: trimmedDescription ? trimmedDescription : null,
          }),
        },
      );
      if (!response.ok) throw new Error("Failed to update document");
      const updated = (await response.json()) as KnowledgeDocument;

      setPreviewData((prev) =>
        prev
          ? {
              ...prev,
              doc: {
                ...prev.doc,
                name: updated.name,
                description: updated.description ?? null,
                titleManual: updated.titleManual ?? true,
                descriptionManual: updated.descriptionManual ?? true,
              },
            }
          : prev,
      );
      onDocumentUpdated?.(updated);
      toast.success("Document metadata updated");
    } catch {
      toast.error("Failed to update document metadata");
    } finally {
      setSavingConfig(false);
    }
  };

  const resetMarkdownState = () => {
    setSelectedVersionId(previewData?.activeVersionId ?? null);
    setPreferredVersionId(null);
    setIsMarkdownEditing(false);
    if (previewData?.activeVersionId) {
      setDraftMarkdown(markdownByVersion[previewData.activeVersionId] ?? "");
      setMarkdownError(null);
    } else {
      setDraftMarkdown("");
    }
  };

  const handleSaveMarkdown = async () => {
    if (!doc || !previewData) return;

    const nextMarkdownDraft = syncDraftMarkdownFromEditor();

    setSavingVersion(true);
    try {
      let queuedVersionId: string | null = null;
      if (hasVersionSelectionChange && selectedVersionId) {
        if (rollbackSelectionBlocked) {
          throw new Error(
            selectedVersion?.rollbackBlockedReason ||
              "This version cannot be rolled back right now.",
          );
        }
        const response = await fetch(
          `/api/knowledge/${groupId}/documents/${doc.id}/versions/${selectedVersionId}/rollback`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              expectedActiveVersionId: previewData.activeVersionId,
            }),
          },
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.error || "Failed to queue rollback");
        }
        queuedVersionId =
          typeof data.version?.id === "string" ? data.version.id : null;
        toast.success("Rollback version queued");
      } else if (hasMarkdownDraftChanges) {
        const response = await fetch(
          `/api/knowledge/${groupId}/documents/${doc.id}/versions`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              markdownContent: nextMarkdownDraft,
              expectedActiveVersionId: previewData.activeVersionId,
            }),
          },
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.error || "Failed to queue markdown save");
        }
        queuedVersionId =
          typeof data.version?.id === "string" ? data.version.id : null;
        toast.success("Markdown edit queued for re-embedding");
      }

      if (queuedVersionId) {
        setPreferredVersionId(queuedVersionId);
        setSelectedVersionId(queuedVersionId);
        setIsMarkdownEditing(false);
      } else {
        setPreferredVersionId(null);
        setIsMarkdownEditing(false);
      }
      await loadPreview();
      if (mainTab === "markdown" && queuedVersionId) {
        await loadVersionMarkdown(doc.id, queuedVersionId, { force: true });
      }
      if (mainTab === "history") {
        await loadHistory(doc.id);
      }
    } catch (saveError) {
      toast.error(
        saveError instanceof Error
          ? saveError.message
          : "Failed to save changes",
      );
    } finally {
      setSavingVersion(false);
    }
  };

  const handleSaveImageAnnotations = async () => {
    if (!doc || !previewData || !canEditImages) return;

    setSavingImages(true);
    try {
      const response = await fetch(
        `/api/knowledge/${groupId}/documents/${doc.id}/images/annotations`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedActiveVersionId: previewData.activeVersionId,
            images: draftImages.map((image) => ({
              imageId: image.id,
              label: image.label,
              description: image.description,
              stepHint: image.stepHint ?? null,
            })),
          }),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "Failed to save image annotations");
      }

      const queuedVersionId =
        typeof data.version?.id === "string" ? data.version.id : null;
      if (queuedVersionId) {
        setPreferredVersionId(queuedVersionId);
        setSelectedVersionId(queuedVersionId);
      }
      toast.success("Image annotation edit queued for re-embedding");
      await loadPreview();
      await loadImages(doc.id, queuedVersionId ?? previewData.activeVersionId);
    } catch (saveError) {
      toast.error(
        saveError instanceof Error
          ? saveError.message
          : "Failed to save image annotations",
      );
    } finally {
      setSavingImages(false);
    }
  };

  const handleSelectVersion = (value: string) => {
    setSelectedVersionId(value);
    setIsMarkdownEditing(false);
    setDraftMarkdown(markdownByVersion[value] ?? "");
    setMarkdownError(null);
    setDocumentImages(imagesByVersion[getImageCacheKey(value)] ?? []);
  };

  const startMarkdownEdit = ({
    selection,
    scrollTop,
  }: {
    selection?: { start: number; end: number } | null;
    scrollTop?: number | null;
  } = {}) => {
    if (!canStartMarkdownEdit) {
      return;
    }

    pendingMarkdownSelectionRef.current = selection ?? null;
    pendingMarkdownScrollTopRef.current = scrollTop ?? null;
    setIsMarkdownEditing(true);
  };

  const handleBeginMarkdownEdit = (event: React.MouseEvent<HTMLElement>) => {
    const offsets = getSelectionOffsetsWithinElement(event.currentTarget);
    const caretOffset = offsets?.end ?? 0;
    startMarkdownEdit({
      selection: {
        start: caretOffset,
        end: caretOffset,
      },
      scrollTop: markdownPreviewViewportRef.current?.scrollTop ?? null,
    });
  };

  const FileIconComp = FILE_ICONS[doc?.fileType ?? ""] ?? FileIcon;

  return (
    <Sheet open={open} onOpenChange={(value) => !value && onClose()}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-[min(96vw,90rem)]"
      >
        <Tabs
          value={mainTab}
          onValueChange={(value) => {
            if (isMainTab(value)) {
              setMainTab(value);
            }
          }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <SheetHeader className="shrink-0 border-b px-6 py-4">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 shrink-0 rounded-md bg-primary/10 p-2">
                <FileIconComp className="size-5 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <SheetTitle className="truncate text-base font-semibold leading-snug">
                  {previewData?.doc.name ?? doc?.name}
                </SheetTitle>
                <SheetDescription className="mt-0.5 truncate text-xs text-muted-foreground">
                  {previewData?.doc.originalFilename ?? doc?.originalFilename}
                </SheetDescription>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {doc?.fileType && (
                    <Badge variant="outline" className="px-1.5 py-0 text-xs">
                      {doc.fileType.toUpperCase()}
                    </Badge>
                  )}
                  {doc?.fileSize && (
                    <span className="text-xs text-muted-foreground">
                      {formatBytes(doc.fileSize)}
                    </span>
                  )}
                  {activeVersion && (
                    <div className="text-xs">
                      <VersionLabel version={activeVersion} />
                    </div>
                  )}
                </div>
                {isProcessing ? (
                  <div className="mt-2 flex max-w-sm flex-col gap-1">
                    <div className="text-xs text-muted-foreground">
                      {processingLabel ?? "Processing document"}
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-blue-500 transition-all duration-500 ease-out"
                        style={{ width: `${doc.processingProgress ?? 0}%` }}
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <TabsList className="h-8">
                <TabsTrigger value="configuration" className="h-7 text-xs">
                  Configuration
                </TabsTrigger>
                <TabsTrigger value="original" className="h-7 text-xs">
                  Real Docs
                </TabsTrigger>
                <TabsTrigger value="images" className="h-7 text-xs">
                  Images
                </TabsTrigger>
                <TabsTrigger
                  value="markdown"
                  className="h-7 text-xs"
                  disabled={!previewData?.markdownAvailable}
                >
                  Result Markdown
                </TabsTrigger>
                <TabsTrigger value="history" className="h-7 text-xs">
                  History
                </TabsTrigger>
              </TabsList>

              {previewData?.versions.length ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Select
                    value={
                      selectedVersionId ?? previewData.activeVersionId ?? ""
                    }
                    onValueChange={handleSelectVersion}
                  >
                    <SelectTrigger className="h-8 min-w-52 text-xs">
                      {selectedVersion ? (
                        <VersionLabel version={selectedVersion} />
                      ) : (
                        <SelectValue placeholder="Select version" />
                      )}
                    </SelectTrigger>
                    <SelectContent>
                      {previewData.versions.map((version) => (
                        <SelectItem key={version.id} value={version.id}>
                          <VersionLabel version={version} />
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
            </div>
          </SheetHeader>

          <div className="relative min-h-0 flex-1">
            {loading && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60">
                <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
              </div>
            )}

            {error && (
              <div className="flex h-full flex-col items-center justify-center p-8 text-center">
                <p className="text-sm text-muted-foreground">{error}</p>
              </div>
            )}

            {!loading && !error && previewData && (
              <>
                <TabsContent value="configuration" className="mt-0 h-full">
                  <ScrollArea className="h-full">
                    <div className="flex flex-col gap-4 p-6">
                      {isInherited && (
                        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
                          Read-only document from{" "}
                          <span className="font-medium">
                            {previewData.doc.sourceGroupName ??
                              "a linked source group"}
                          </span>
                          .
                        </div>
                      )}
                      <div className="flex flex-col gap-1.5">
                        <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                          Title
                        </Label>
                        <Input
                          value={title}
                          onChange={(event) => setTitle(event.target.value)}
                          placeholder="Document title"
                          className="h-9 text-sm"
                          disabled={isInherited}
                        />
                        <p className="text-xs text-muted-foreground">
                          Used for metadata retrieval and document ranking.
                        </p>
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                          Description
                        </Label>
                        <Textarea
                          value={description}
                          onChange={(event) =>
                            setDescription(event.target.value)
                          }
                          placeholder="Short summary of this document"
                          className="min-h-[140px] resize-y text-sm"
                          disabled={isInherited}
                        />
                        <p className="text-xs text-muted-foreground">
                          Improves semantic and keyword retrieval from title +
                          description.
                        </p>
                      </div>

                      <div className="flex items-center justify-end gap-2 pt-2">
                        <Button
                          size="sm"
                          className="gap-1.5"
                          onClick={handleSaveConfiguration}
                          disabled={savingConfig || !hasConfigChanges}
                        >
                          <SaveIcon
                            className={cn(
                              "size-3.5",
                              savingConfig && "animate-pulse",
                            )}
                          />
                          Save
                        </Button>
                      </div>
                    </div>
                  </ScrollArea>
                </TabsContent>

                <TabsContent value="original" className="mt-0 h-full">
                  <PreviewContent data={previewData} />
                </TabsContent>

                <TabsContent value="images" className="mt-0 h-full">
                  <ScrollArea className="h-full">
                    <div className="flex flex-col gap-4 p-6">
                      {imagesLoading ? (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Loader2Icon className="size-4 animate-spin" />
                          Loading images...
                        </div>
                      ) : draftImages.length === 0 ? (
                        <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                          No extracted images for this document version.
                        </div>
                      ) : (
                        draftImages.map((image, index) => (
                          <div
                            key={image.id}
                            className="grid gap-4 rounded-2xl border border-border/70 bg-background/60 p-4 lg:grid-cols-[200px_minmax(0,1fr)]"
                          >
                            <div className="overflow-hidden rounded-xl border border-border/60 bg-muted/20">
                              {image.assetUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={image.assetUrl}
                                  alt={image.label}
                                  className="h-full max-h-60 w-full object-contain"
                                />
                              ) : (
                                <div className="flex h-48 items-center justify-center text-xs text-muted-foreground">
                                  Preview unavailable
                                </div>
                              )}
                            </div>

                            <div className="flex min-w-0 flex-col gap-3">
                              <div className="text-xs text-muted-foreground">
                                Image {index + 1}
                                {image.pageNumber != null
                                  ? ` • page ${image.pageNumber}`
                                  : ""}
                              </div>

                              <div className="flex flex-col gap-1.5">
                                <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                                  Label
                                </Label>
                                <Input
                                  value={image.label}
                                  onChange={(event) =>
                                    setDraftImages((current) =>
                                      current.map((entry) =>
                                        entry.id === image.id
                                          ? {
                                              ...entry,
                                              label: event.target.value,
                                            }
                                          : entry,
                                      ),
                                    )
                                  }
                                  disabled={!canEditImages}
                                />
                              </div>

                              <div className="flex flex-col gap-1.5">
                                <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                                  Description
                                </Label>
                                <Textarea
                                  value={image.description}
                                  onChange={(event) =>
                                    setDraftImages((current) =>
                                      current.map((entry) =>
                                        entry.id === image.id
                                          ? {
                                              ...entry,
                                              description: event.target.value,
                                            }
                                          : entry,
                                      ),
                                    )
                                  }
                                  className="min-h-[120px] resize-y text-sm"
                                  disabled={!canEditImages}
                                />
                              </div>

                              <div className="flex flex-col gap-1.5">
                                <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                                  Step Hint
                                </Label>
                                <Input
                                  value={image.stepHint ?? ""}
                                  onChange={(event) =>
                                    setDraftImages((current) =>
                                      current.map((entry) =>
                                        entry.id === image.id
                                          ? {
                                              ...entry,
                                              stepHint: event.target.value,
                                            }
                                          : entry,
                                      ),
                                    )
                                  }
                                  disabled={!canEditImages}
                                />
                              </div>

                              <div className="text-xs text-muted-foreground">
                                {image.headingPath || "No heading association"}
                              </div>
                            </div>
                          </div>
                        ))
                      )}

                      {canEditImages && draftImages.length > 0 ? (
                        <div className="flex justify-end">
                          <Button
                            size="sm"
                            className="gap-1.5"
                            onClick={handleSaveImageAnnotations}
                            disabled={savingImages || !hasImageDraftChanges}
                          >
                            <SaveIcon
                              className={cn(
                                "size-3.5",
                                savingImages && "animate-pulse",
                              )}
                            />
                            Save image annotations
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  </ScrollArea>
                </TabsContent>

                <TabsContent value="markdown" className="mt-0 h-full">
                  {previewData.markdownAvailable ? (
                    <div className="flex h-full min-h-0 flex-col">
                      <div className="border-b px-6 py-3">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="text-xs text-muted-foreground">
                            {canStartMarkdownEdit
                              ? "Raw markdown. Click Edit to modify the active version. Double-click also works."
                              : "Raw markdown"}
                          </div>

                          {showMarkdownActions ? (
                            <div className="flex flex-wrap items-center gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 gap-1.5 text-xs"
                                onClick={resetMarkdownState}
                                disabled={savingVersion}
                              >
                                <XIcon className="size-3.5" />
                                Cancel
                              </Button>
                              <Button
                                size="sm"
                                className="h-8 gap-1.5 text-xs"
                                onClick={handleSaveMarkdown}
                                disabled={
                                  savingVersion ||
                                  (!hasVersionSelectionChange &&
                                    !hasMarkdownDraftChanges) ||
                                  rollbackSelectionBlocked
                                }
                              >
                                {hasVersionSelectionChange ? (
                                  <RotateCcwIcon
                                    className={cn(
                                      "size-3.5",
                                      savingVersion && "animate-spin",
                                    )}
                                  />
                                ) : (
                                  <SaveIcon
                                    className={cn(
                                      "size-3.5",
                                      savingVersion && "animate-pulse",
                                    )}
                                  />
                                )}
                                Save
                              </Button>
                            </div>
                          ) : canStartMarkdownEdit && !canEditMarkdown ? (
                            <div className="flex flex-wrap items-center gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 gap-1.5 text-xs"
                                onClick={() =>
                                  startMarkdownEdit({
                                    scrollTop:
                                      markdownPreviewViewportRef.current
                                        ?.scrollTop ?? null,
                                  })
                                }
                              >
                                <FileTextIcon className="size-3.5" />
                                Edit markdown
                              </Button>
                            </div>
                          ) : null}
                        </div>
                      </div>

                      {!isActiveVersionSelected && selectedVersion ? (
                        <div className="border-b bg-muted/20 px-6 py-3 text-xs text-muted-foreground">
                          Viewing historical version{" "}
                          <span className="font-medium">
                            v{selectedVersion.versionNumber}
                          </span>
                          . Save to duplicate it as the new latest version.
                        </div>
                      ) : null}

                      {!!selectedVersion?.rollbackBlockedReason &&
                      !selectedVersion.isActive ? (
                        <div className="border-b border-amber-500/40 bg-amber-500/10 px-6 py-3 text-xs text-amber-700">
                          {selectedVersion.rollbackBlockedReason}
                        </div>
                      ) : null}

                      <div className="min-h-0 flex-1">
                        {markdownLoading ? (
                          <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
                            <Loader2Icon className="size-4 animate-spin" />
                            Loading markdown...
                          </div>
                        ) : markdownError ? (
                          <div className="flex h-full items-center justify-center px-8 text-center text-sm text-muted-foreground">
                            {markdownError}
                          </div>
                        ) : !hasLoadedMarkdown ? (
                          <div className="flex h-full items-center justify-center px-8 text-center text-sm text-muted-foreground">
                            Markdown for this version is not available yet.
                          </div>
                        ) : canEditMarkdown ? (
                          <div
                            className="relative isolate z-20 h-full overflow-hidden bg-background pointer-events-auto"
                            onPointerDown={(event) => event.stopPropagation()}
                            onMouseDown={(event) => event.stopPropagation()}
                            onClick={(event) => event.stopPropagation()}
                            onKeyDown={(event) => event.stopPropagation()}
                            onKeyUp={(event) => event.stopPropagation()}
                          >
                            <textarea
                              key={selectedVersionId ?? "markdown-editor"}
                              ref={markdownEditorRef}
                              id="knowledge-document-markdown-editor"
                              name="knowledgeDocumentMarkdown"
                              defaultValue={draftMarkdown}
                              onChange={(event) => {
                                setDraftMarkdown(event.target.value);
                              }}
                              onKeyDown={(event) => {
                                event.stopPropagation();
                              }}
                              onKeyUp={(event) => {
                                event.stopPropagation();
                              }}
                              onPointerDown={(event) => event.stopPropagation()}
                              onMouseDown={(event) => event.stopPropagation()}
                              onClick={(event) => event.stopPropagation()}
                              spellCheck={false}
                              className="relative z-20 h-full w-full resize-none border-0 bg-transparent px-6 py-6 font-mono text-xs leading-relaxed text-foreground caret-foreground outline-none pointer-events-auto"
                            />
                          </div>
                        ) : (
                          <div
                            ref={markdownPreviewViewportRef}
                            className="h-full overflow-auto"
                          >
                            <pre
                              onDoubleClick={handleBeginMarkdownEdit}
                              className={cn(
                                "min-h-full cursor-text select-text p-6 font-mono text-xs whitespace-pre-wrap break-words leading-relaxed text-foreground/90",
                                canStartMarkdownEdit &&
                                  "transition-colors hover:bg-muted/10",
                              )}
                            >
                              {draftMarkdown || "No markdown content."}
                            </pre>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center p-8 text-center">
                      <p className="text-sm text-muted-foreground">
                        No markdown content yet. The document will be processed
                        after ingestion.
                      </p>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="history" className="mt-0 h-full">
                  <ScrollArea className="h-full">
                    <div className="p-6">
                      {historyLoading && history.length === 0 ? (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Loader2Icon className="size-4 animate-spin" />
                          Loading history...
                        </div>
                      ) : history.length === 0 ? (
                        <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                          No version history yet.
                        </div>
                      ) : (
                        <div className="relative pl-10">
                          <div className="absolute top-0 bottom-0 left-4 w-px bg-border/70" />
                          <div className="space-y-5">
                            {history.map((event) => {
                              const EventIcon = getHistoryEventIcon(event);
                              return (
                                <div key={event.id} className="relative">
                                  <div
                                    className={cn(
                                      "absolute top-5 left-0 z-10 flex size-8 -translate-x-1/2 items-center justify-center rounded-full border shadow-sm",
                                      getHistoryEventTone(event),
                                    )}
                                  >
                                    <EventIcon className="size-3.5" />
                                  </div>

                                  <div className="ml-2 rounded-2xl border border-border/70 bg-background/70 p-4 shadow-sm backdrop-blur-sm">
                                    <div className="flex flex-wrap items-start justify-between gap-3">
                                      <div className="space-y-2">
                                        <div className="flex flex-wrap items-center gap-2">
                                          <span className="text-sm font-semibold">
                                            {getHistoryEventTitle(event)}
                                          </span>
                                          {event.toVersionNumber ? (
                                            <Badge
                                              variant="outline"
                                              className="text-[10px]"
                                            >
                                              Version {event.toVersionNumber}
                                            </Badge>
                                          ) : null}
                                          {event.fromVersionNumber ? (
                                            <Badge
                                              variant="secondary"
                                              className="text-[10px]"
                                            >
                                              From Version{" "}
                                              {event.fromVersionNumber}
                                            </Badge>
                                          ) : null}
                                        </div>
                                        <p className="text-sm leading-relaxed text-muted-foreground">
                                          {describeHistoryEvent(event)}
                                        </p>
                                      </div>

                                      <div className="text-right text-xs text-muted-foreground">
                                        <div>
                                          {new Date(
                                            event.createdAt,
                                          ).toLocaleString()}
                                        </div>
                                        {event.actorUserName ? (
                                          <div className="mt-1">
                                            {event.actorUserName}
                                          </div>
                                        ) : null}
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  </ScrollArea>
                </TabsContent>
              </>
            )}
          </div>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

function PreviewContent({ data }: { data: KnowledgeDocumentPreview }) {
  const { doc, previewUrl, sourceUrl, content, isUrlOnly } = data;
  const url = previewUrl ?? sourceUrl;

  if (isUrlOnly) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <LinkIcon className="size-10 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">
          This is a URL source document.
        </p>
        {sourceUrl && (
          <Button variant="outline" size="sm" asChild>
            <a href={sourceUrl} target="_blank" rel="noreferrer">
              <ExternalLinkIcon className="mr-1.5 size-3.5" />
              Open URL
            </a>
          </Button>
        )}
      </div>
    );
  }

  if (doc.fileType === "pdf" && url) {
    return (
      <iframe src={url} className="h-full w-full border-0" title={doc.name} />
    );
  }

  if (["png", "jpg", "jpeg", "gif", "webp"].includes(doc.fileType) && url) {
    return (
      <div className="flex h-full items-center justify-center overflow-auto p-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={doc.name}
          className="max-h-full max-w-full rounded-lg object-contain"
        />
      </div>
    );
  }

  if (content !== null) {
    return (
      <ScrollArea className="h-full">
        <pre
          className={cn(
            "p-6 text-xs font-mono whitespace-pre-wrap break-words leading-relaxed text-foreground/90",
            doc.fileType === "md" &&
              "prose prose-sm dark:prose-invert max-w-none",
          )}
        >
          {content}
        </pre>
      </ScrollArea>
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <FileIcon className="size-10 text-muted-foreground/50" />
      <p className="text-sm text-muted-foreground">
        Preview not available for{" "}
        <span className="font-medium">{doc.fileType.toUpperCase()}</span> files.
      </p>
      {url && (
        <Button variant="outline" size="sm" asChild>
          <a href={url} download={doc.originalFilename}>
            <DownloadIcon className="mr-1.5 size-3.5" />
            Download to view
          </a>
        </Button>
      )}
    </div>
  );
}
