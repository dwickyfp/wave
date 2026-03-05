"use client";

import { useState } from "react";
import { KnowledgeDocument } from "app-types/knowledge";
import { DocumentCard } from "./document-card";
import { DocumentUploadZone } from "./document-upload-zone";
import { DocumentPreviewSheet } from "./document-preview-sheet";
import { useKnowledgeDocuments } from "@/hooks/queries/use-knowledge";

interface Props {
  groupId: string;
  initialDocuments: KnowledgeDocument[];
  uploadDisabledMessage?: string;
}

export function KnowledgeDocumentsTab({
  groupId,
  initialDocuments,
  uploadDisabledMessage,
}: Props) {
  const { data: docs, mutate } = useKnowledgeDocuments(groupId);
  const [previewDoc, setPreviewDoc] = useState<KnowledgeDocument | null>(null);

  const documents = docs ?? initialDocuments;

  const handleUploaded = () => mutate();
  const handleDelete = (docId: string) => {
    if (previewDoc?.id === docId) setPreviewDoc(null);
    mutate(
      documents.filter((d) => d.id !== docId),
      false,
    );
  };

  const handleReEmbed = () => {
    // Refresh after a brief delay to show the status change
    setTimeout(() => mutate(), 400);
  };

  return (
    <>
      <div className="flex flex-col gap-4">
        <DocumentUploadZone
          groupId={groupId}
          onUploaded={handleUploaded}
          disabledMessage={uploadDisabledMessage}
        />

        {documents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground text-sm">
            <p>No documents yet. Upload files or add URLs above.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {documents.map((doc) => (
              <DocumentCard
                key={doc.id}
                doc={doc}
                groupId={groupId}
                onDelete={handleDelete}
                onPreview={setPreviewDoc}
                onReEmbed={handleReEmbed}
              />
            ))}
          </div>
        )}
      </div>

      <DocumentPreviewSheet
        doc={previewDoc}
        groupId={groupId}
        open={previewDoc !== null}
        onClose={() => setPreviewDoc(null)}
      />
    </>
  );
}
