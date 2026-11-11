"use client";

import React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  Warehouse,
  Package,
  AlertTriangle,
  ShoppingCart,
  ArrowLeftRight,
  TrendingDown,
  Clock,
  CheckCircle2,
  Boxes,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DataSlotPulse } from "@/components/shared/DataSlotPulse";

export default function BuildStockOperationsDashboard() {
  // The browser may restore cached queries before hydration. Render the same
  // placeholders as the server until the first client effect has completed.
  const [hydrated, setHydrated] = React.useState(false);
  React.useEffect(() => { setHydrated(true); }, []);
  // Fetch dashboard summary metrics
  const { data: stats, isLoading: statsPending } = useQuery({
    queryKey: ["buildstock-dashboard-stats"],
    queryFn: async () => {
      // Use existing scoped APIs; no speculative summary endpoint.
      {
        // Fetch from core entities
        const [whRes, prodRes, poRes] = await Promise.all([
          fetch("/api/warehouses"),
          fetch("/api/products"),
          fetch("/api/purchase-orders"),
        ]);
        const warehouses = whRes.ok ? await whRes.json() : [];
        const products = prodRes.ok ? await prodRes.json() : [];
        const pos = poRes.ok ? await poRes.json() : [];

        const lowStock = products.filter((p: any) => p.status === "LOW_STOCK" || (p.quantity <= (p.minimumStock || 0) && p.quantity > 0));
        const outOfStock = products.filter((p: any) => p.status === "OUT_OF_STOCK" || p.quantity <= 0);
        const overstock = products.filter((p: any) => p.status === "OVERSTOCK");
        const inStock = products.filter((p: any) => p.status === "IN_STOCK" || (p.quantity > (p.minimumStock || 0)));

        const pendingPOs = pos.filter((po: any) => po.status === "DRAFT" || po.status === "PENDING_APPROVAL" || po.status === "APPROVED" || po.status === "PARTIALLY_RECEIVED");

        return {
          totalWarehouses: warehouses.length || 0,
          totalProducts: products.length || 0,
          inStockCount: inStock.length || 0,
          lowStockCount: lowStock.length || 0,
          outOfStockCount: outOfStock.length || 0,
          overstockCount: overstock.length || 0,
          pendingPOCount: pendingPOs.length || 0,
          warehouses: warehouses || [],
          recentPOs: pos.slice(0, 5) || [],
        };
      }
    },
  });

  // Fetch recent stock movements
  const { data: movements, isLoading: movementsPending } = useQuery({
    queryKey: ["buildstock-recent-movements"],
    queryFn: async () => {
      const res = await fetch("/api/stock-movements?limit=6");
      if (!res.ok) return [];
      const json = await res.json();
      return Array.isArray(json) ? json.slice(0, 6) : (json.data || []).slice(0, 6);
    },
  });

  // Fetch sales order summary
  const { data: salesStats } = useQuery({
    queryKey: ["buildstock-dashboard-sales-stats"],
    queryFn: async () => {
      const res = await fetch("/api/sales-orders?limit=50");
      if (!res.ok) return { total: 0, draft: 0, pending: 0, approved: 0, processing: 0, completed: 0 };
      const data = await res.json();
      const items = data.items || [];
      return {
        total: items.length,
        draft: items.filter((i: any) => i.status === "DRAFT").length,
        pending: items.filter((i: any) => i.status === "PENDING_APPROVAL").length,
        approved: items.filter((i: any) => i.status === "APPROVED").length,
        processing: items.filter((i: any) => i.status === "PROCESSING").length,
        completed: items.filter((i: any) => i.status === "COMPLETED").length,
      };
    },
  });

  if (!hydrated) return <div className="space-y-6 p-6" aria-busy="true"><DataSlotPulse variant="metric" /></div>;

  const statsLoading = statsPending;
  const movementsLoading = !hydrated || movementsPending;
  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Benaa Operations Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Real-time construction & decoration warehouse operations, stock distribution, and procurement pipeline.
        </p>
      </div>

      {/* TOP KPI ROW */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="border-l-4 border-l-sky-500 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Total Warehouses
            </CardTitle>
            <Warehouse className="h-5 w-5 text-sky-600" />
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <DataSlotPulse variant="metric" />
            ) : (
              <div className="text-3xl font-bold">{stats?.totalWarehouses ?? 0}</div>
            )}
            <p className="text-xs text-muted-foreground mt-1">Active storage facilities</p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-blue-500 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Total Products
            </CardTitle>
            <Package className="h-5 w-5 text-blue-600" />
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <DataSlotPulse variant="metric" />
            ) : (
              <div className="text-3xl font-bold">{stats?.totalProducts ?? 0}</div>
            )}
            <p className="text-xs text-muted-foreground mt-1">Catalog items tracked</p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-amber-500 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Low Stock Alerts
            </CardTitle>
            <AlertTriangle className="h-5 w-5 text-amber-600" />
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <DataSlotPulse variant="metric" />
            ) : (
              <div className="text-3xl font-bold text-amber-600">{stats?.lowStockCount ?? 0}</div>
            )}
            <p className="text-xs text-muted-foreground mt-1">Requires reorder attention</p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-purple-500 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Pending POs
            </CardTitle>
            <ShoppingCart className="h-5 w-5 text-purple-600" />
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <DataSlotPulse variant="metric" />
            ) : (
              <div className="text-3xl font-bold">{stats?.pendingPOCount ?? 0}</div>
            )}
            <p className="text-xs text-muted-foreground mt-1">Orders in receiving pipeline</p>
          </CardContent>
        </Card>
      </div>

      {/* STOCK STATUS BREAKDOWN */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="bg-emerald-500/5 border-emerald-200 dark:border-emerald-900/50">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">IN STOCK</p>
              <p className="text-2xl font-bold text-emerald-900 dark:text-emerald-100">{stats?.inStockCount ?? 0}</p>
            </div>
            <CheckCircle2 className="h-8 w-8 text-emerald-500 opacity-80" />
          </CardContent>
        </Card>

        <Card className="bg-amber-500/5 border-amber-200 dark:border-amber-900/50">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-amber-700 dark:text-amber-400">LOW STOCK</p>
              <p className="text-2xl font-bold text-amber-900 dark:text-amber-100">{stats?.lowStockCount ?? 0}</p>
            </div>
            <TrendingDown className="h-8 w-8 text-amber-500 opacity-80" />
          </CardContent>
        </Card>

        <Card className="bg-rose-500/5 border-rose-200 dark:border-rose-900/50">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-rose-700 dark:text-rose-400">OUT OF STOCK</p>
              <p className="text-2xl font-bold text-rose-900 dark:text-rose-100">{stats?.outOfStockCount ?? 0}</p>
            </div>
            <AlertTriangle className="h-8 w-8 text-rose-500 opacity-80" />
          </CardContent>
        </Card>

        <Card className="bg-indigo-500/5 border-indigo-200 dark:border-indigo-900/50">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-indigo-700 dark:text-indigo-400">OVERSTOCK</p>
              <p className="text-2xl font-bold text-indigo-900 dark:text-indigo-100">{stats?.overstockCount ?? 0}</p>
            </div>
            <Boxes className="h-8 w-8 text-indigo-500 opacity-80" />
          </CardContent>
        </Card>
      </div>

      {/* SALES ORDER PIPELINE BANNER */}
      <Card className="shadow-sm border-l-4 border-l-sky-600">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <div>
            <CardTitle className="text-sm font-semibold">Sales Order Pipeline</CardTitle>
            <p className="text-xs text-muted-foreground">Active customer orders across WMS status stages</p>
          </div>
          <Link href="/sales" className="text-xs font-medium text-sky-600 hover:underline">
            Manage Sales Orders →
          </Link>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-5 gap-2 text-center text-xs">
            <div className="p-2 bg-amber-50 dark:bg-amber-950/20 rounded border border-amber-200">
              <p className="text-muted-foreground text-[10px]">Draft</p>
              <p className="text-base font-bold text-amber-700 dark:text-amber-300">{salesStats?.draft ?? 0}</p>
            </div>
            <div className="p-2 bg-sky-50 dark:bg-sky-950/20 rounded border border-sky-200">
              <p className="text-muted-foreground text-[10px]">Pending</p>
              <p className="text-base font-bold text-sky-700 dark:text-sky-300">{salesStats?.pending ?? 0}</p>
            </div>
            <div className="p-2 bg-indigo-50 dark:bg-indigo-950/20 rounded border border-indigo-200">
              <p className="text-muted-foreground text-[10px]">Approved</p>
              <p className="text-base font-bold text-indigo-700 dark:text-indigo-300">{salesStats?.approved ?? 0}</p>
            </div>
            <div className="p-2 bg-blue-50 dark:bg-blue-950/20 rounded border border-blue-200">
              <p className="text-muted-foreground text-[10px]">Processing</p>
              <p className="text-base font-bold text-blue-700 dark:text-blue-300">{salesStats?.processing ?? 0}</p>
            </div>
            <div className="p-2 bg-emerald-50 dark:bg-emerald-950/20 rounded border border-emerald-200">
              <p className="text-muted-foreground text-[10px]">Completed</p>
              <p className="text-base font-bold text-emerald-700 dark:text-emerald-300">{salesStats?.completed ?? 0}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* LOWER SECTION: RECENT MOVEMENTS & WAREHOUSES */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* RECENT MOVEMENTS LEDGER */}
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base font-semibold">Recent Stock Movements</CardTitle>
              <p className="text-xs text-muted-foreground">Latest inventory transactions</p>
            </div>
            <Link href="/inventory/reports" className="text-xs font-medium text-sky-600 hover:underline">
              View All →
            </Link>
          </CardHeader>
          <CardContent>
            {movementsLoading ? (
              <DataSlotPulse variant="chart" />
            ) : !movements || movements.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">No stock movements recorded yet.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Type</TableHead>
                    <TableHead className="text-xs">Product</TableHead>
                    <TableHead className="text-xs text-right">Qty</TableHead>
                    <TableHead className="text-xs">Time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {movements.map((mov: any) => (
                    <TableRow key={mov.id}>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px] font-mono uppercase">
                          {mov.movementType}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs font-medium truncate max-w-[140px]">
                        {mov.product?.name || mov.productId}
                      </TableCell>
                      <TableCell className="text-xs text-right font-mono font-semibold">
                        {mov.quantity}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(mov.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* WAREHOUSE OVERVIEW TABLE */}
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base font-semibold">Warehouse Network</CardTitle>
              <p className="text-xs text-muted-foreground">Active storage facilities and stock status</p>
            </div>
            <Link href="/warehouses" className="text-xs font-medium text-sky-600 hover:underline">
              Manage →
            </Link>
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <DataSlotPulse variant="chart" />
            ) : !stats?.warehouses || stats.warehouses.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">No warehouses defined.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Warehouse</TableHead>
                    <TableHead className="text-xs">Code</TableHead>
                    <TableHead className="text-xs">Location</TableHead>
                    <TableHead className="text-xs text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stats.warehouses.map((wh: any) => (
                    <TableRow key={wh.id}>
                      <TableCell className="text-xs font-medium">{wh.name}</TableCell>
                      <TableCell className="text-xs font-mono">{wh.code || "WH"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{wh.location || "Main"}</TableCell>
                      <TableCell className="text-xs text-right">
                        <Link href={`/warehouses/${wh.id}`} className="text-sky-600 hover:underline text-xs font-medium">
                          Inspect
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
