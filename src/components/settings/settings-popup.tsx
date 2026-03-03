"use client";

import { appStore } from "@/app/store";
import { useShallow } from "zustand/shallow";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerPortal,
  DrawerTitle,
} from "ui/drawer";
import { Button } from "ui/button";
import { X } from "lucide-react";
import { SettingsContent } from "./settings-content";

export function SettingsPopup() {
  const [openSettings, appStoreMutate] = appStore(
    useShallow((state) => [state.openSettings, state.mutate]),
  );

  return (
    <Drawer
      handleOnly
      open={openSettings}
      direction="top"
      onOpenChange={(open) => appStoreMutate({ openSettings: open })}
    >
      <DrawerPortal>
        <DrawerContent
          style={{ userSelect: "text" }}
          className="max-h-[100vh]! w-full h-full rounded-none flex flex-col overflow-hidden p-4 md:p-6"
        >
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-lg font-semibold">Settings</h2>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => appStoreMutate({ openSettings: false })}
            >
              <X />
            </Button>
          </div>
          <DrawerTitle className="sr-only">Settings</DrawerTitle>
          <DrawerDescription className="sr-only" />
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex-1 overflow-y-auto">
              <SettingsContent />
            </div>
          </div>
        </DrawerContent>
      </DrawerPortal>
    </Drawer>
  );
}
