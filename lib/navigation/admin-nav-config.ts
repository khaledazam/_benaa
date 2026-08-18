/**
 * Admin sidebar nav config (REQ-0094).
 * Single source for AdminSidebar hrefs and RouteWarmPrefetch admin RSC warm.
 */

import type { AdminCounts } from "@/types";

export type AdminNavItemConfig = {
  href: string;
  label: string;
  /** Key in admin counts for badge (optional) */
  countKey?: keyof Pick<
    AdminCounts,
    | "clientOrders"
    | "clientInvoices"
    | "supportTickets"
    | "productReviews"
    | "products"
    | "warehouses"
    | "suppliers"
    | "clients"
    | "users"
  >;
};

export const ADMIN_MY_STORE_ITEMS: AdminNavItemConfig[] = [
  {
    href: "/admin/dashboard-overall-insights",
    label: "Store Overview",
  },
  {
    href: "/admin/orders",
    label: "Orders",
    countKey: "clientOrders",
  },
  {
    href: "/admin/invoices",
    label: "Invoices",
    countKey: "clientInvoices",
  },
  {
    href: "/admin/support-tickets",
    label: "Support Tickets",
    countKey: "supportTickets",
  },
  {
    href: "/admin/product-reviews",
    label: "Product Reviews",
    countKey: "productReviews",
  },
];

export const ADMIN_MANAGEMENT_ITEMS: AdminNavItemConfig[] = [
  {
    href: "/admin/products",
    label: "Products",
    countKey: "products",
  },
  {
    href: "/admin/warehouses",
    label: "Warehouses",
    countKey: "warehouses",
  },
  {
    href: "/admin/supplier-portal",
    label: "Supplier Portal",
    countKey: "suppliers",
  },
  {
    href: "/admin/client-portal",
    label: "Client Portal",
    countKey: "clients",
  },
  {
    href: "/admin/user-management",
    label: "User Management",
    countKey: "users",
  },
  {
    href: "/admin/activity-history",
    label: "Activity History",
  },
];

export const BUILDSTOCK_DASHBOARD_ITEMS: AdminNavItemConfig[] = [
  {
    href: "/admin/dashboard-overall-insights",
    label: "Overview Dashboard",
  },
];

export const BUILDSTOCK_WAREHOUSE_ITEMS: AdminNavItemConfig[] = [
  {
    href: "/warehouses",
    label: "Warehouses",
    countKey: "warehouses",
  },
  {
    href: "/inventory",
    label: "Physical Inventory",
  },
  {
    href: "/inventory/reservations",
    label: "Stock Reservations",
  },
  {
    href: "/inventory/picking",
    label: "Picking & Pick Lists",
  },
  {
    href: "/inventory/dispatches",
    label: "Dispatches & Stock Deduction",
  },
  {
    href: "/inventory/reconciliation",
    label: "Inventory Reconciliation",
  },
  {
    href: "/inventory/adjustments",
    label: "Stock Adjustments",
  },
  {
    href: "/inventory/counting",
    label: "Inventory Counting",
  },
  {
    href: "/inventory/reports",
    label: "Inventory Control Reports",
  },
  {
    href: "/inventory/relocations",
    label: "Bin Relocations",
  },
  {
    href: "/inventory/transfers",
    label: "Stock Transfers",
  },
  {
    href: "/inventory/movements",
    label: "Stock Movements",
  },
];

export const BUILDSTOCK_PROCUREMENT_ITEMS: AdminNavItemConfig[] = [
  {
    href: "/suppliers",
    label: "Suppliers",
    countKey: "suppliers",
  },
  {
    href: "/purchasing",
    label: "Purchase Orders",
  },
  {
    href: "/purchasing/goods-receipts",
    label: "Goods Receipts",
  },
];

export const BUILDSTOCK_CATALOG_ITEMS: AdminNavItemConfig[] = [
  {
    href: "/products",
    label: "Products",
    countKey: "products",
  },
  {
    href: "/categories",
    label: "Categories",
  },
  {
    href: "/brands",
    label: "Brands",
  },
  {
    href: "/units",
    label: "Units of Measure",
  },
];

export const BUILDSTOCK_SALES_ITEMS: AdminNavItemConfig[] = [
  {
    href: "/customers",
    label: "Customers",
  },
  {
    href: "/sales",
    label: "Sales Orders",
  },
];

export const BUILDSTOCK_ADMIN_ITEMS: AdminNavItemConfig[] = [
  {
    href: "/admin/user-management",
    label: "Users & Permissions",
    countKey: "users",
  },
  {
    href: "/admin/activity-history",
    label: "Audit Logs",
  },
  {
    href: "/settings",
    label: "Settings",
  },
];

export const ADMIN_MY_ACTIVITY_ITEMS: AdminNavItemConfig[] = [
  {
    href: "/admin/my-activity",
    label: "My Activity",
  },
];

export const ADMIN_SETTINGS_EMAIL_HREF = "/admin/settings/email-preferences";

/** Flat deduped admin sidebar paths for idle RSC warm (admin/user roles). */
export function getAdminSidebarWarmPaths(): string[] {
  const paths = [
    ...ADMIN_MY_STORE_ITEMS.map((item) => item.href),
    ...ADMIN_MANAGEMENT_ITEMS.map((item) => item.href),
    ...ADMIN_MY_ACTIVITY_ITEMS.map((item) => item.href),
    ...BUILDSTOCK_WAREHOUSE_ITEMS.map((item) => item.href),
    ...BUILDSTOCK_PROCUREMENT_ITEMS.map((item) => item.href),
    ...BUILDSTOCK_SALES_ITEMS.map((item) => item.href),
    ...BUILDSTOCK_CATALOG_ITEMS.map((item) => item.href),
    ...BUILDSTOCK_ADMIN_ITEMS.map((item) => item.href),
    ADMIN_SETTINGS_EMAIL_HREF,
  ];
  return [...new Set(paths)];
}
