"use client";

import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ClipboardCheck, Search, Filter, Warehouse, Clock, CheckCircle2, XCircle, ArrowRight, Lock } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/contexts";
import { hasPermission, BuildStockPermissions } from "@/lib/auth/permissions";

const STATUS_TABS = [
  { id: "ALL", label: "All Reservations" },
  { id: "ACTIVE", label: "Active" },
  { id: "PARTIALLY_FULFILLED", label: "Partially Fulfilled" },
  { id: "FULFILLED", label: "Fulfilled" },
  { id: "RELEASED", label: "Released" },
  { id: "CANCELLED", label: "Cancelled" },
];

export default function ReservationsView() {
  const { user } = useAuth();
  const userRole = user?.role || "VIEWER";

  const [activeTab, setActiveTab] = useState<string>("ALL");
  const [search, setSearch] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [page, setPage] = useState(1);

  // Fetch Warehouses for Filter
  const { data: warehouses } = useQuery({
    queryKey: ["reservation-warehouses-filter"],
    queryFn: async () => {
      const res = await fetch("/api/warehouses");
      return res.ok ? res.json() : [];
    },
  });

  // Fetch Reservations
  const { data, isLoading } = useQuery({
    queryKey: ["reservations-list", activeTab, search, warehouseId, page],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (activeTab !== "ALL") params.set("status", activeTab);
      if (search) params.set("search", search);
      if (warehouseId) params.set("warehouseId", warehouseId);
      params.set("page", page.toString());
      params.set("limit", "20");

      const res = await fetch(`/api/reservations?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch reservations");
      return res.json();
    },
  });

  const reservations = data?.items || [];
  const pagination = data?.pagination;

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "ACTIVE":
        return <Badge className="bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300 text-[10px]">ACTIVE</Badge>;
      case "PARTIALLY_FULFILLED":
        return <Badge className="bg-indigo-100 text-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300 text-[10px]">PARTIALLY FULFILLED</Badge>;
      case "FULFILLED":
        return <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 text-[10px]">FULFILLED</Badge>;
      case "RELEASED":
        return <Badge variant="outline" className="border-amber-400 text-amber-800 dark:text-amber-300 text-[10px]">RELEASED</Badge>;
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
            <ClipboardCheck className="h-6 w-6 text-sky-600" /> Stock Reservations
          </h1>
          <p className="text-sm text-muted-foreground">
            Commercial inventory commitments for approved Sales Orders before physical picking/dispatch.
          </p>
        </div>
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
                placeholder="Search reservation #, SO #, customer..."
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

      {/* RESERVATIONS TABLE */}
      <Card className="shadow-sm">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Reservation #</TableHead>
                <TableHead className="text-xs">Sales Order #</TableHead>
                <TableHead className="text-xs">Customer</TableHead>
                <TableHead className="text-xs">Warehouse</TableHead>
                <TableHead className="text-xs">Items</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-xs text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-xs text-muted-foreground">
                    Loading stock reservations...
                  </TableCell>
                </TableRow>
              ) : reservations.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-xs text-muted-foreground">
                    No stock reservations found.
                  </TableCell>
                </TableRow>
              ) : (
                reservations.map((res: any) => (
                  <TableRow key={res.id}>
                    <TableCell className="font-mono text-xs font-semibold">
                      <Link href={`/inventory/reservations/${res.id}`} className="text-sky-600 hover:underline">
                        {res.reservationNumber}
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      <Link href={`/sales/${res.salesOrderId}`} className="hover:underline">
                        {res.salesOrder?.salesOrderNumber || "SO"}
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs font-medium">
                      {res.salesOrder?.customerNameSnapshot || "Customer"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {res.warehouse?.name}
                    </TableCell>
                    <TableCell className="text-xs font-mono">
                      {res.items?.length || 0} items
                    </TableCell>
                    <TableCell className="text-xs">
                      {getStatusBadge(res.status)}
                    </TableCell>
                    <TableCell className="text-xs text-right">
                      <Button variant="ghost" size="sm" asChild>
                        <Link href={`/inventory/reservations/${res.id}`}>
                          View <ArrowRight className="ml-1 h-3 w-3" />
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
                Page {pagination.page} of {pagination.totalPages} ({pagination.total} total reservations)
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
