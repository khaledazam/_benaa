"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeftRight,
  ArrowUpDown,
  Boxes,
  ClipboardCheck,
  FileText,
  History,
  Layers,
  LayoutDashboard,
  Mail,
  MessageSquare,
  Package,
  PackageCheck,
  Receipt,
  Scale,
  Settings,
  ShoppingCart,
  Star,
  Store,
  Tag,
  Truck,
  UserCircle,
  Users,
  Warehouse,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAdminCounts } from "@/hooks/queries";
import { isDataSlotUnsettled } from "@/lib/react-query";
import { DataSlotPulse } from "@/components/shared/DataSlotPulse";
import { LanguageToggle } from "@/components/shared/LanguageToggle";
import { useLanguage } from "@/contexts/language-context";
import {
  BUILDSTOCK_DASHBOARD_ITEMS,
  BUILDSTOCK_WAREHOUSE_ITEMS,
  BUILDSTOCK_PROCUREMENT_ITEMS,
  BUILDSTOCK_SALES_ITEMS,
  BUILDSTOCK_CATALOG_ITEMS,
  BUILDSTOCK_ADMIN_ITEMS,
  type AdminNavItemConfig,
} from "@/lib/navigation/admin-nav-config";
import { adminSidebarLinkClass } from "@/lib/navigation/nav-link-styles";
import type { AdminCounts } from "@/types";

/** Icon map for admin sidebar items (REQ-0094 — hrefs live in admin-nav-config). */
const ADMIN_NAV_ICONS: Record<string, LucideIcon> = {
  "/admin/dashboard-overall-insights": LayoutDashboard,
  "/warehouses": Warehouse,
  "/inventory": PackageCheck,
  "/inventory/reservations": ClipboardCheck,
  "/inventory/relocations": ArrowLeftRight,
  "/inventory/transfers": ArrowUpDown,
  "/inventory/movements": History,
  "/suppliers": Truck,
  "/purchasing": ShoppingCart,
  "/purchasing/goods-receipts": ClipboardCheck,
  "/customers": Users,
  "/sales": Receipt,
  "/products": Package,
  "/categories": Layers,
  "/brands": Tag,
  "/units": Scale,
  "/admin/user-management": Users,
  "/admin/activity-history": History,
  "/settings": Settings,
  "/admin/orders": ShoppingCart,
  "/admin/invoices": FileText,
  "/admin/support-tickets": MessageSquare,
  "/admin/product-reviews": Star,
  "/admin/supplier-portal": Truck,
  "/admin/client-portal": Store,
  "/admin/my-activity": UserCircle,
};

export default function AdminSidebar({
  collapsed = false,
  initialCounts,
}: {
  collapsed?: boolean;
  /** SSR-passed sidebar badge counts (REQ-0025) */
  initialCounts?: AdminCounts;
} = {}) {
  const pathname = usePathname();
  const { t } = useLanguage();
  const countsQuery = useAdminCounts(initialCounts);
  const counts = countsQuery.data ?? initialCounts;
  const countsLoading = isDataSlotUnsettled(countsQuery, initialCounts);

  const getCount = (key: AdminNavItemConfig["countKey"]): number | undefined => {
    if (!counts || !key) return undefined;
    return counts[key];
  };

  const renderNavItems = (items: AdminNavItemConfig[], isSub = true) =>
    items.map((item) => {
      const Icon = ADMIN_NAV_ICONS[item.href] ?? Package;
      const count = getCount(item.countKey);
      const showBadge = item.countKey != null;
      const translatedLabel = t(item.label, item.label);
      return (
        <Link
          key={item.href}
          href={item.href}
          prefetch
          className={adminSidebarLinkClass(pathname, item.href, {
            isSub,
            collapsed,
          })}
          title={collapsed ? translatedLabel : undefined}
        >
          <Icon className="h-4 w-4 flex-shrink-0" />
          {!collapsed && (
            <span className="min-w-0 flex-1 truncate">{translatedLabel}</span>
          )}
          {!collapsed && showBadge && (
            <span
              className={cn(
                "flex-shrink-0 rounded-full px-1 py-0.5 text-xs font-medium min-w-[1.25rem] text-center",
                "bg-muted text-muted-foreground",
              )}
              aria-label={
                countsLoading
                  ? "Loading count"
                  : count !== undefined
                    ? `${count} items`
                    : undefined
              }
            >
              {countsLoading ? (
                <DataSlotPulse variant="badge" className="mx-auto" />
              ) : count !== undefined && count > 0 ? (
                count > 99 ? (
                  "99+"
                ) : (
                  count
                )
              ) : null}
            </span>
          )}
        </Link>
      );
    });

  if (collapsed) {
    return (
      <nav
        className="flex min-h-0 flex-col items-center px-2 gap-1"
        aria-label="Admin navigation"
      >
        {renderNavItems(BUILDSTOCK_DASHBOARD_ITEMS)}
        <div className="w-6 border-t border-gray-200/50 dark:border-white/10 my-1" />
        {renderNavItems(BUILDSTOCK_WAREHOUSE_ITEMS)}
        <div className="w-6 border-t border-gray-200/50 dark:border-white/10 my-1" />
        {renderNavItems(BUILDSTOCK_PROCUREMENT_ITEMS)}
        <div className="w-6 border-t border-gray-200/50 dark:border-white/10 my-1" />
        {renderNavItems(BUILDSTOCK_SALES_ITEMS)}
        <div className="w-6 border-t border-gray-200/50 dark:border-white/10 my-1" />
        {renderNavItems(BUILDSTOCK_CATALOG_ITEMS)}
        <div className="w-6 border-t border-gray-200/50 dark:border-white/10 my-1" />
        {renderNavItems(BUILDSTOCK_ADMIN_ITEMS)}
      </nav>
    );
  }

  return (
    <nav className="flex min-h-0 flex-col p-2 gap-1">
      <p className="px-2 pt-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {t("nav.cat.dashboard", "Dashboard")}
      </p>
      {renderNavItems(BUILDSTOCK_DASHBOARD_ITEMS)}

      <p className="px-2 pt-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {t("nav.cat.warehouse", "Warehouse Operations")}
      </p>
      {renderNavItems(BUILDSTOCK_WAREHOUSE_ITEMS)}

      <p className="px-2 pt-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {t("nav.cat.procurement", "Procurement & Suppliers")}
      </p>
      {renderNavItems(BUILDSTOCK_PROCUREMENT_ITEMS)}

      <p className="px-2 pt-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {t("nav.cat.sales", "Sales & Customers")}
      </p>
      {renderNavItems(BUILDSTOCK_SALES_ITEMS)}

      <p className="px-2 pt-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {t("nav.cat.catalog", "Catalog & Products")}
      </p>
      {renderNavItems(BUILDSTOCK_CATALOG_ITEMS)}

      <p className="px-2 pt-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {t("nav.cat.administration", "Administration & Audit")}
      </p>
      {renderNavItems(BUILDSTOCK_ADMIN_ITEMS)}

      <div className="w-full border-t border-gray-200/50 dark:border-white/10 my-2" />
      <div className="px-2 py-1 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Language / اللغة
        </span>
        <LanguageToggle />
      </div>
    </nav>
  );
}
