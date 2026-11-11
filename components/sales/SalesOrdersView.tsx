"use client";

import React, { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Receipt, Plus, Search, Filter, Warehouse, Clock, CheckCircle2, AlertTriangle, XCircle, ArrowRight } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/contexts";
import { hasPermission, BuildStockPermissions } from "@/lib/auth/permissions";

const STATUS_TABS = [
  { id: "ALL", label: "All Sales Orders" },
  { id: "DRAFT", label: "Draft" },
  { id: "PENDING_APPROVAL", label: "Pending Approval" },
  { id: "APPROVED", label: "Approved" },
  { id: "PROCESSING", label: "Processing" },
  { id: "COMPLETED", label: "Completed" },
  { id: "CANCELLED", label: "Cancelled" },
];

export default function SalesOrdersView() {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => { setHydrated(true); }, []);
  const { user } = useAuth();
  const userRole = user?.role || "VIEWER";

  const [activeTab, setActiveTab] = useState<string>("ALL");
  const [search, setSearch] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [page, setPage] = useState(1);

  const canCreate = hasPermission(user, BuildStockPermissions.SALES_ORDER_CREATE);

  // Fetch Warehouses for Filter
  const { data: warehouses } = useQuery({
    queryKey: ["sales-warehouses-filter"],
    queryFn: async () => {
      const res = await fetch("/api/warehouses");
      return res.ok ? res.json() : [];
    },
  });

  // Fetch Sales Orders
  const { data, isLoading } = useQuery({
    queryKey: ["sales-orders-list", activeTab, search, warehouseId, page],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (activeTab !== "ALL") params.set("status", activeTab);
      if (search) params.set("search", search);
      if (warehouseId) params.set("warehouseId", warehouseId);
      params.set("page", page.toString());
      params.set("limit", "20");

      const res = await fetch(`/api/sales-orders?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch sales orders");
      return res.json();
    },
  });

  const salesOrders = data?.items || [];
  const pagination = data?.pagination;

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "DRAFT":
        return <Badge variant="outline" className="border-amber-400 bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300 text-[10px]">DRAFT</Badge>;
      case "PENDING_APPROVAL":
        return <Badge variant="outline" className="border-sky-400 bg-sky-50 text-sky-800 dark:bg-sky-950/30 dark:text-sky-300 text-[10px]">PENDING APPROVAL</Badge>;
      case "APPROVED":
        return <Badge className="bg-indigo-100 text-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300 text-[10px]">APPROVED</Badge>;
      case "PROCESSING":
        return <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300 text-[10px]">PROCESSING</Badge>;
      case "COMPLETED":
        return <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 text-[10px]">COMPLETED</Badge>;
      case "CANCELLED":
        return <Badge variant="secondary" className="text-[10px]">CANCELLED</Badge>;
      default:
        return <Badge variant="outline" className="text-[10px]">{status}</Badge>;
    }
  };

  // Persisted queries may already be populated on the first browser render.
  if (!hydrated) return <div className="space-y-6 p-6" aria-busy="true">Loading sales orders...</div>;

  return (
    <div className="space-y-6 p-6">
      {/* HEADER */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Receipt className="h-6 w-6 text-sky-600" /> Sales Orders
          </h1>
          <p className="text-sm text-muted-foreground">
            Customer sales order management, approvals, and order fulfillment status.
          </p>
        </div>

        {canCreate && (
          <Button asChild className="gap-2 text-xs font-semibold">
            <Link href="/sales/new">
              <Plus className="h-4 w-4" /> Create Sales Order
            </Link>
          </Button>
        )}
      </div>

      {/* STATUS TABS */}
      <div className="flex flex-wrap gap-2 border-b pb-2">
        {STATUS_TABS.map((tab) => (
          <Button
            key={tab.id}
            variant={activeTab === tab.id ? "default" : "ghost"}
            size="sm"
            onClick={() => {
              setActiveTab(tab.id);
              setPage(1);
            }}
            className="text-xs h-8"
          >
            {tab.label}
          </Button>
        ))}
      </div>

      {/* FILTERS */}
      <Card className="shadow-sm">
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row gap-3 justify-between items-center">
            <div className="relative w-full md:w-80">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search SO number, customer name, phone..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                className="pl-9 text-xs"
              />
            </div>

            <div className="flex items-center gap-2 w-full md:w-auto">
              <Warehouse className="h-4 w-4 text-muted-foreground" />
              <select
                value={warehouseId}
                onChange={(e) => {
                  setWarehouseId(e.target.value);
                  setPage(1);
                }}
                className="h-9 rounded-md border border-input bg-background px-3 text-xs shadow-sm focus:outline-none"
              >
                <option value="">All Warehouses</option>
                {warehouses?.map((wh: any) => (
                  <option key={wh.id} value={wh.id}>
                    {wh.name} ({wh.code || "WH"})
                  </option>
                ))}
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* SALES ORDERS TABLE */}
      <Card className="shadow-sm">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">SO Number</TableHead>
                <TableHead className="text-xs">Customer</TableHead>
                <TableHead className="text-xs">Warehouse</TableHead>
                <TableHead className="text-xs">Order Date</TableHead>
                <TableHead className="text-xs">Items</TableHead>
                <TableHead className="text-xs">Total</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-xs text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-xs text-muted-foreground">
                    Loading sales orders...
                  </TableCell>
                </TableRow>
              ) : salesOrders.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-xs text-muted-foreground">
                    No sales orders found matching current criteria.
                  </TableCell>
                </TableRow>
              ) : (
                salesOrders.map((so: any) => (
                  <TableRow key={so.id}>
                    <TableCell className="font-mono text-xs font-semibold">
                      <Link href={`/sales/${so.id}`} className="text-sky-600 hover:underline">
                        {so.salesOrderNumber}
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs">
                      <div>
                        <p className="font-medium">{so.customerNameSnapshot || so.customer?.name}</p>
                        <p className="text-[10px] font-mono text-muted-foreground">{so.customerCodeSnapshot || so.customer?.customerCode}</p>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {so.warehouse?.name || "Warehouse"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(so.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-xs font-mono">
                      {so._count?.items || 0} items
                    </TableCell>
                    <TableCell className="text-xs font-mono font-semibold">
                      ${so.total.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-xs">
                      {getStatusBadge(so.status)}
                    </TableCell>
                    <TableCell className="text-xs text-right">
                      <Button variant="ghost" size="sm" asChild>
                        <Link href={`/sales/${so.id}`}>
                          View Details <ArrowRight className="ml-1 h-3 w-3" />
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          {/* PAGINATION */}
          {pagination && pagination.totalPages > 1 && (
            <div className="p-4 border-t flex justify-between items-center text-xs">
              <span className="text-muted-foreground">
                Page {pagination.page} of {pagination.totalPages} ({pagination.total} total orders)
              </span>
              <div className="space-x-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= pagination.totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
