"use client";

import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PackageCheck, Search, Plus, Filter, Warehouse, Clock, CheckCircle2, XCircle, ArrowRight, User } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/contexts";
import { hasPermission, BuildStockPermissions } from "@/lib/auth/permissions";
import CreatePickListModal from "./CreatePickListModal";

const STATUS_TABS = [
  { id: "ALL", label: "All Pick Lists" },
  { id: "DRAFT", label: "Draft" },
  { id: "ASSIGNED", label: "Assigned" },
  { id: "IN_PROGRESS", label: "In Progress" },
  { id: "COMPLETED", label: "Completed" },
  { id: "CANCELLED", label: "Cancelled" },
];

export default function PickListsView() {
  const router = useRouter();
  const { user } = useAuth();
  const userRole = user?.role || "VIEWER";

  const [activeTab, setActiveTab] = useState<string>("ALL");
  const [search, setSearch] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [page, setPage] = useState(1);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  const canCreate = hasPermission(userRole, BuildStockPermissions.PICK_LIST_CREATE);

  // Fetch Warehouses for Filter
  const { data: warehouses } = useQuery({
    queryKey: ["pick-list-warehouses-filter"],
    queryFn: async () => {
      const res = await fetch("/api/warehouses");
      return res.ok ? res.json() : [];
    },
  });

  // Fetch Pick Lists
  const { data, isLoading } = useQuery({
    queryKey: ["pick-lists-list", activeTab, search, warehouseId, page],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (activeTab !== "ALL") params.set("status", activeTab);
      if (search) params.set("search", search);
      if (warehouseId) params.set("warehouseId", warehouseId);
      params.set("page", page.toString());
      params.set("limit", "20");

      const res = await fetch(`/api/pick-lists?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch pick lists");
      return res.json();
    },
  });

  const pickLists = data?.items || [];
  const pagination = data?.pagination;

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "DRAFT":
        return <Badge variant="outline" className="border-slate-300 text-slate-700 dark:text-slate-300 text-[10px]">DRAFT</Badge>;
      case "ASSIGNED":
        return <Badge className="bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300 text-[10px]">ASSIGNED</Badge>;
      case "IN_PROGRESS":
        return <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 text-[10px]">IN PROGRESS</Badge>;
      case "COMPLETED":
        return <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 text-[10px]">COMPLETED</Badge>;
      case "CANCELLED":
        return <Badge variant="secondary" className="text-[10px]">CANCELLED</Badge>;
      default:
        return <Badge variant="outline" className="text-[10px]">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6 p-6">
      {/* HEADER */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <PackageCheck className="h-6 w-6 text-emerald-600" /> Picking & Pick Lists
          </h1>
          <p className="text-sm text-muted-foreground">
            Physical selection and bin assignment of reserved stock prior to dispatch.
          </p>
        </div>
        {canCreate && (
          <Button onClick={() => setIsCreateModalOpen(true)} className="bg-emerald-600 hover:bg-emerald-700 text-white">
            <Plus className="mr-2 h-4 w-4" /> Create Pick List
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
            className="text-xs"
          >
            {tab.label}
          </Button>
        ))}
      </div>

      {/* FILTERS & SEARCH */}
      <Card className="border-border/50 shadow-sm">
        <CardContent className="p-4">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by Pick List #, Sales Order #, or Customer name..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                className="pl-9"
              />
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <Warehouse className="h-4 w-4 text-muted-foreground" />
                <select
                  value={warehouseId}
                  onChange={(e) => {
                    setWarehouseId(e.target.value);
                    setPage(1);
                  }}
                  className="rounded-md border border-input bg-background px-3 py-2 text-xs ring-offset-background focus:outline-none"
                >
                  <option value="">All Warehouses</option>
                  {Array.isArray(warehouses) &&
                    warehouses.map((w: any) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                </select>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* TABLE */}
      <Card className="border-border/50 shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30">
              <TableHead className="font-semibold">Pick List #</TableHead>
              <TableHead className="font-semibold">Sales Order</TableHead>
              <TableHead className="font-semibold">Customer</TableHead>
              <TableHead className="font-semibold">Warehouse</TableHead>
              <TableHead className="font-semibold text-center">Items</TableHead>
              <TableHead className="font-semibold text-center">Status</TableHead>
              <TableHead className="font-semibold">Assigned To</TableHead>
              <TableHead className="font-semibold">Created Date</TableHead>
              <TableHead className="font-semibold text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={9} className="h-32 text-center text-muted-foreground">
                  Loading pick lists...
                </TableCell>
              </TableRow>
            ) : pickLists.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="h-32 text-center text-muted-foreground">
                  No pick lists found matching the criteria.
                </TableCell>
              </TableRow>
            ) : (
              pickLists.map((pl: any) => (
                <TableRow key={pl.id} className="hover:bg-muted/20">
                  <TableCell className="font-mono text-xs font-bold text-foreground">
                    {pl.pickListNumber}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-sky-600 dark:text-sky-400">
                    <Link href={`/sales/${pl.salesOrderId}`} className="hover:underline">
                      {pl.salesOrder?.salesOrderNumber || "SO"}
                    </Link>
                  </TableCell>
                  <TableCell className="text-xs">
                    {pl.salesOrder?.customer?.name || "Customer"}
                  </TableCell>
                  <TableCell className="text-xs">
                    {pl.warehouse?.name || "Warehouse"}
                  </TableCell>
                  <TableCell className="text-xs text-center font-medium">
                    {pl.items?.length || 0} line(s)
                  </TableCell>
                  <TableCell className="text-center">{getStatusBadge(pl.status)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {pl.assignedTo ? (
                      <span className="flex items-center gap-1">
                        <User className="h-3 w-3 text-sky-500" /> Assigned
                      </span>
                    ) : (
                      <span className="italic text-muted-foreground/60">Unassigned</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(pl.createdAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => router.push(`/inventory/picking/${pl.id}`)}
                      className="text-xs"
                    >
                      View / Pick <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        {/* PAGINATION */}
        {pagination && pagination.totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t">
            <span className="text-xs text-muted-foreground">
              Showing page {pagination.page} of {pagination.totalPages} ({pagination.total} items)
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="text-xs"
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= pagination.totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="text-xs"
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* CREATE MODAL */}
      <CreatePickListModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSuccess={(id) => {
          router.push(`/inventory/picking/${id}`);
        }}
      />
    </div>
  );
}
