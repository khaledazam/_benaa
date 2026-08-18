"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Truck,
  Search,
  Filter,
  Plus,
  ArrowUpDown,
  CheckCircle2,
  Clock,
  XCircle,
  Building2,
  FileText,
  Boxes,
  ChevronRight,
  Eye,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface DispatchListItem {
  id: string;
  dispatchNumber: string;
  status: string;
  createdAt: string;
  postedAt?: string;
  salesOrder: { salesOrderNumber: string };
  pickList: { pickListNumber: string };
  warehouse: { id: string; name: string; code: string };
  customerNameSnapshot?: string;
  items: Array<{
    id: string;
    requestedQuantity: number;
    pickedQuantity: number;
    dispatchedQuantity: number;
  }>;
}

export function DispatchesView() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [dispatches, setDispatches] = useState<DispatchListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(searchParams.get("search") || "");
  const [statusFilter, setStatusFilter] = useState(searchParams.get("status") || "ALL");
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 1 });

  const fetchDispatches = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (statusFilter && statusFilter !== "ALL") params.set("status", statusFilter);
      params.set("page", pagination.page.toString());
      params.set("limit", pagination.limit.toString());

      const res = await fetch(`/api/dispatches?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setDispatches(data.items);
        setPagination(data.pagination);
      }
    } catch (err) {
      console.error("Failed to fetch dispatches:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDispatches();
  }, [statusFilter, search, pagination.page]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "DRAFT":
        return (
          <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-300 flex items-center gap-1 font-medium">
            <Clock className="h-3 w-3" /> Draft
          </Badge>
        );
      case "POSTED":
        return (
          <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-300 flex items-center gap-1 font-medium">
            <CheckCircle2 className="h-3 w-3" /> Posted (Deducted)
          </Badge>
        );
      case "CANCELLED":
        return (
          <Badge variant="outline" className="bg-rose-50 text-rose-700 border-rose-300 flex items-center gap-1 font-medium">
            <XCircle className="h-3 w-3" /> Cancelled
          </Badge>
        );
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6 p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b pb-5">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2.5 bg-indigo-600 text-white rounded-xl shadow-md">
              <Truck className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Dispatch & Physical Out</h1>
              <p className="text-sm text-slate-500">
                Execute physical warehouse inventory deduction for completed pick lists
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="border shadow-sm">
          <CardHeader className="py-3 px-4 flex flex-row items-center justify-between space-y-0 pb-1">
            <CardTitle className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Dispatches</CardTitle>
            <Truck className="h-4 w-4 text-indigo-600" />
          </CardHeader>
          <CardContent className="py-2 px-4">
            <div className="text-2xl font-bold text-slate-900">{pagination.total}</div>
          </CardContent>
        </Card>

        <Card className="border shadow-sm">
          <CardHeader className="py-3 px-4 flex flex-row items-center justify-between space-y-0 pb-1">
            <CardTitle className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Draft Dispatches</CardTitle>
            <Clock className="h-4 w-4 text-amber-600" />
          </CardHeader>
          <CardContent className="py-2 px-4">
            <div className="text-2xl font-bold text-amber-700">
              {dispatches.filter((d) => d.status === "DRAFT").length}
            </div>
          </CardContent>
        </Card>

        <Card className="border shadow-sm">
          <CardHeader className="py-3 px-4 flex flex-row items-center justify-between space-y-0 pb-1">
            <CardTitle className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Posted (Physical Out)</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          </CardHeader>
          <CardContent className="py-2 px-4">
            <div className="text-2xl font-bold text-emerald-700">
              {dispatches.filter((d) => d.status === "POSTED").length}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter Tabs & Search */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 bg-slate-50 p-3 rounded-xl border">
        <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0">
          {["ALL", "DRAFT", "POSTED", "CANCELLED"].map((tab) => (
            <Button
              key={tab}
              variant={statusFilter === tab ? "default" : "ghost"}
              size="sm"
              onClick={() => setStatusFilter(tab)}
              className={statusFilter === tab ? "bg-indigo-600 hover:bg-indigo-700 text-white font-medium" : "text-slate-600"}
            >
              {tab === "ALL" ? "All Dispatches" : tab}
            </Button>
          ))}
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Search dispatch #, customer..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-white"
          />
        </div>
      </div>

      {/* Table */}
      <Card className="border shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-slate-50">
              <TableRow>
                <TableHead className="font-semibold">Dispatch Number</TableHead>
                <TableHead className="font-semibold">Sales Order</TableHead>
                <TableHead className="font-semibold">Pick List</TableHead>
                <TableHead className="font-semibold">Warehouse</TableHead>
                <TableHead className="font-semibold">Customer</TableHead>
                <TableHead className="font-semibold text-center">Status</TableHead>
                <TableHead className="font-semibold text-right">Created Date</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-slate-500">
                    Loading dispatches...
                  </TableCell>
                </TableRow>
              ) : dispatches.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-12 text-slate-500">
                    <Boxes className="h-10 w-10 text-slate-300 mx-auto mb-2" />
                    No dispatches found
                  </TableCell>
                </TableRow>
              ) : (
                dispatches.map((d) => (
                  <TableRow key={d.id} className="hover:bg-slate-50/80 transition-colors">
                    <TableCell className="font-mono font-semibold text-indigo-600">
                      <Link href={`/inventory/dispatches/${d.id}`} className="hover:underline flex items-center gap-1">
                        {d.dispatchNumber}
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono text-slate-700">{d.salesOrder.salesOrderNumber}</TableCell>
                    <TableCell className="font-mono text-slate-700">{d.pickList.pickListNumber}</TableCell>
                    <TableCell className="text-slate-800 font-medium">
                      <div className="flex items-center gap-1.5">
                        <Building2 className="h-3.5 w-3.5 text-slate-400" />
                        {d.warehouse.name}
                      </div>
                    </TableCell>
                    <TableCell className="text-slate-800">{d.customerNameSnapshot || "—"}</TableCell>
                    <TableCell className="text-center">{getStatusBadge(d.status)}</TableCell>
                    <TableCell className="text-right text-slate-500 text-xs font-mono">
                      {new Date(d.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <Link href={`/inventory/dispatches/${d.id}`}>
                        <Button variant="ghost" size="sm" className="h-8 gap-1 text-slate-600 hover:text-indigo-600">
                          <Eye className="h-3.5 w-3.5" /> View
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
