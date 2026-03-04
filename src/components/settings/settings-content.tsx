"use client";

import { useRef, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "ui/tabs";
import {
  BrainCircuit,
  Database,
  Download,
  Settings2,
  Upload,
} from "lucide-react";
import { Button } from "ui/button";
import { toast } from "sonner";
import { ProviderConfigTab } from "./provider-config-tab";
import { MinioSettingsTab } from "./minio-settings-tab";
import { OtherConfigsTab } from "./other-configs-tab";

export function SettingsContent() {
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleExport() {
    try {
      const res = await fetch("/api/settings/backup");
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="(.+?)"/);
      const filename = match?.[1] ?? "settings-backup.json";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Failed to export settings");
    }
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset so the same file can be re-imported
    e.target.value = "";

    setImporting(true);
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const res = await fetch("/api/settings/backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(json),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      toast.success(
        `Imported ${data.providers} provider(s), ${data.modelsAdded} new model(s)`,
      );
    } catch (err: any) {
      toast.error(err.message || "Failed to import settings");
    } finally {
      setImporting(false);
    }
  }

  return (
    <Tabs defaultValue="providers" className="w-full">
      <div className="flex items-center justify-between mb-6">
        <TabsList>
          <TabsTrigger value="providers" className="gap-2">
            <BrainCircuit className="size-4" />
            AI Providers
          </TabsTrigger>
          <TabsTrigger value="storage" className="gap-2">
            <Database className="size-4" />
            Storage
          </TabsTrigger>
          <TabsTrigger value="other" className="gap-2">
            <Settings2 className="size-4" />
            Other Configurations
          </TabsTrigger>
        </TabsList>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={handleExport}
          >
            <Download className="size-4" />
            Export
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            disabled={importing}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="size-4" />
            {importing ? "Importing…" : "Import"}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={handleImport}
          />
        </div>
      </div>

      <TabsContent value="providers">
        <ProviderConfigTab />
      </TabsContent>

      <TabsContent value="storage">
        <MinioSettingsTab />
      </TabsContent>

      <TabsContent value="other">
        <OtherConfigsTab />
      </TabsContent>
    </Tabs>
  );
}
