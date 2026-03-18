import {
  BarChart2,
  BrainCircuit,
  ChevronRight,
  Shield,
  Users,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  SidebarMenu,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "ui/sidebar";
import { SidebarMenuItem } from "ui/sidebar";
import { SidebarMenuButton } from "ui/sidebar";
import { Tooltip } from "ui/tooltip";

const AppSidebarAdmin = () => {
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations("Admin");
  const isOnAdminPage = useMemo(
    () => pathname.startsWith("/admin"),
    [pathname],
  );
  const [isOpen, setIsOpen] = useState(isOnAdminPage);

  useEffect(() => {
    if (isOnAdminPage) setIsOpen(true);
  }, [isOnAdminPage]);

  const adminNavItems = useMemo(
    () => [
      {
        id: "users",
        title: t("Users.title"),
        url: "/admin",
        icon: Users,
        isActive: pathname === "/admin" || pathname.startsWith("/admin/users"),
      },
      {
        id: "usage-monitoring",
        title: t("UsageMonitoring.title"),
        url: "/admin/usage-monitoring",
        icon: BarChart2,
        isActive: pathname.startsWith("/admin/usage-monitoring"),
      },
      {
        id: "agent-dashboard",
        title: "Agent Dashboard",
        url: "/admin/dashboard/agent",
        icon: BarChart2,
        isActive: pathname.startsWith("/admin/dashboard/agent"),
      },
      {
        id: "mcp-dashboard",
        title: "MCP Dashboard",
        url: "/admin/dashboard/mcp",
        icon: BarChart2,
        isActive: pathname.startsWith("/admin/dashboard/mcp"),
      },
      {
        id: "contextx-dashboard",
        title: "ContextX Dashboard",
        url: "/admin/dashboard/contextx",
        icon: BarChart2,
        isActive: pathname.startsWith("/admin/dashboard/contextx"),
      },
      {
        id: "skills-dashboard",
        title: "Skills Dashboard",
        url: "/admin/dashboard/skill",
        icon: BarChart2,
        isActive: pathname.startsWith("/admin/dashboard/skill"),
      },
      {
        id: "workflow-dashboard",
        title: "Workflow Dashboard",
        url: "/admin/dashboard/workflow",
        icon: BarChart2,
        isActive: pathname.startsWith("/admin/dashboard/workflow"),
      },
      {
        id: "evaluation-system",
        title: "Evaluation System",
        url: "/admin/evaluation",
        icon: BrainCircuit,
        isActive: pathname.startsWith("/admin/evaluation"),
      },
    ],
    [t, pathname],
  );

  return (
    <SidebarMenu className="group/admin">
      <Tooltip>
        <SidebarMenuItem>
          <SidebarMenuButton
            className="font-semibold"
            data-testid="admin-sidebar-link"
            onClick={() => setIsOpen((prev) => !prev)}
          >
            <Shield className="size-4 text-foreground" />
            {t("title")}
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
          {adminNavItems.map((item) => (
            <SidebarMenuSubItem key={item.id}>
              <SidebarMenuSubButton
                className="text-muted-foreground"
                data-testid={`admin-sidebar-link-${item.id}`}
                onClick={() => {
                  router.push(item.url);
                }}
                isActive={item.isActive}
              >
                {item.title}
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>
          ))}
        </SidebarMenuSub>
      </div>
    </SidebarMenu>
  );
};

export { AppSidebarAdmin };
