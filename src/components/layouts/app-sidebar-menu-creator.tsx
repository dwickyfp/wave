"use client";

import { BrainIcon, ChevronRight, SparklesIcon, Waypoints } from "lucide-react";
import { MCPIcon } from "ui/mcp-icon";
import { useTranslations } from "next-intl";
import { Fragment, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "ui/sidebar";
import { Tooltip } from "ui/tooltip";

const CREATOR_PATHS = ["/workflow", "/skills", "/knowledge", "/mcp"];

export function AppSidebarCreator() {
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations("");
  const isOnCreatorPage = useMemo(
    () => CREATOR_PATHS.some((path) => pathname.startsWith(path)),
    [pathname],
  );
  const [isOpen, setIsOpen] = useState(isOnCreatorPage);

  useEffect(() => {
    if (isOnCreatorPage) setIsOpen(true);
  }, [isOnCreatorPage]);

  const creatorItems = useMemo(
    () => [
      {
        id: "workflow",
        title: t("Layout.workflow"),
        url: "/workflow",
        icon: Waypoints,
        isActive: pathname.startsWith("/workflow"),
      },
      {
        id: "skills",
        title: t("Layout.skills"),
        url: "/skills",
        icon: SparklesIcon,
        isActive: pathname.startsWith("/skills"),
      },
      {
        id: "contextx",
        title: t("Layout.contextx"),
        url: "/knowledge",
        icon: BrainIcon,
        isActive: pathname.startsWith("/knowledge"),
      },
      {
        id: "mcp",
        title: t("Layout.mcpConfiguration"),
        url: "/mcp",
        icon: MCPIcon,
        isActive: pathname.startsWith("/mcp"),
      },
    ],
    [pathname, t],
  );

  return (
    <SidebarMenu className="group/creator">
      <Tooltip>
        <SidebarMenuItem>
          <SidebarMenuButton
            className="font-semibold"
            onClick={() => setIsOpen((prev) => !prev)}
          >
            <SparklesIcon className="size-4 text-foreground" />
            {t("Layout.creator")}
            <ChevronRight
              className={`ml-auto size-4 transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`}
            />
          </SidebarMenuButton>
        </SidebarMenuItem>
      </Tooltip>
      <div
        className={`overflow-hidden transition-all duration-200 ease-in-out ${isOpen ? "max-h-96 opacity-100" : "max-h-0 opacity-0"}`}
      >
        <SidebarMenuSub className="mb-2">
          <SidebarMenuSubItem className="mt-2">
            <SidebarGroupLabel className="h-6 px-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80">
              {t("Layout.creator")}
            </SidebarGroupLabel>
          </SidebarMenuSubItem>
          {creatorItems.map((item) => (
            <Fragment key={item.id}>
              <SidebarMenuSubItem>
                <SidebarMenuSubButton
                  className="text-muted-foreground"
                  onClick={() => {
                    router.push(item.url);
                  }}
                  isActive={item.isActive}
                >
                  <item.icon className="size-4" />
                  {item.title}
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            </Fragment>
          ))}
        </SidebarMenuSub>
      </div>
    </SidebarMenu>
  );
}
