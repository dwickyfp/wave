"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "ui/tabs";
import { BrainCircuit, Database, Settings2 } from "lucide-react";
import { ProviderConfigTab } from "./provider-config-tab";
import { MinioSettingsTab } from "./minio-settings-tab";
import { OtherConfigsTab } from "./other-configs-tab";

export function SettingsContent() {
  return (
    <Tabs defaultValue="providers" className="w-full">
      <TabsList className="mb-6">
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
