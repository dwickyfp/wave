import { useMemo, useState, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  SidebarMenu,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "ui/sidebar";
import { Tooltip } from "ui/tooltip";
import { SidebarMenuItem } from "ui/sidebar";
import { SidebarMenuButton } from "ui/sidebar";
import { BarChart2, ChevronRight, Shield, Users } from "lucide-react";
import { useTranslations } from "next-intl";

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
      {isOpen && (
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
      )}
    </SidebarMenu>
  );
};

export { AppSidebarAdmin };
