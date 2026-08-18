"use client";

import React, { useState, useEffect } from "react";
import {
  ShieldCheck,
  AlertTriangle,
  AlertOctagon,
  Search,
  Filter,
  RefreshCw,
  Warehouse,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Boxes,
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
import { useAuth } from "@/contexts";
import { hasPermission, BuildStockPermissions } from "@/lib/auth/permissions";

export function ReconciliationView() {
  const { user } = useAuth();
  const role = user?.role || "VIEWER";
  const canView = hasPermission(role, BuildStockPermissions.INVENTORY_RECONCILIATION_VIEW);

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [search, setSearch] = useState<string>("");

  const fetchReconciliationReport = async () => {
    setLoading(true);
    try {
      const queryParams = new URLSearchParams();
      if (statusFilter !== "ALL") queryParams.set("status", statusFilter);

      const res = await fetch(`/api/inventory/reconciliation?${queryParams.toString()}`);
      if (res.ok) {
        const report = await res.json();
        setData(report);
      }
    } catch (err) {
      console.error("Failed to load inventory reconciliation report:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (canView) {
      fetchReconciliationReport();
    }
  }, [canView, statusFilter]);

  if (!canView) {
    return (
      <div className="p-8 text-center">
        <AlertOctagon className="mx-auto h-12 w-12 text-rose-500 mb-4" />
        <h2 className="text-xl font-bold text-foreground mb-2">Access Denied</h2>
        <p className="text-muted-foreground">You do not have permission to view inventory reconciliation reports.</p>
      </div>
    );
  }

  const summary = data?.summary || { healthyCount: 0, warningCount: 0, criticalCount: 0, totalDiscrepancies: 0 };
  const results = (data?.results || []).filter((r: any) => {
    if (!search.trim()) return true;
    const s = search.toLowerCase().trim();
    return (
      r.productName?.toLowerCase().includes(s) ||
      r.productSku?.toLowerCase().includes(s) ||
      r.warehouseName?.toLowerCase().includes(s)
    );
  });

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <ShieldCheck className="h-7 w-7 text-emerald-500" />
            Inventory Reconciliation Engine
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Read-only master audit & discrepancy detection enforcing Invariants A–F across physical stock, bins, reservations, and ledger.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={fetchReconciliationReport}
          disabled={loading}
          className="self-start md:self-auto gap-2"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Re-Run Audit
        </Button>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-emerald-500/20 bg-emerald-500/5 dark:bg-emerald-500/10">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">
                Healthy Subsets
              </p>
              <h3 className="text-2xl font-bold text-emerald-700 dark:text-emerald-300 mt-1">
                {summary.healthyCount}
              </h3>
            </div>
            <CheckCircle2 className="h-8 w-8 text-emerald-500 opacity-80" />
          </CardContent>
        </Card>

        <Card className="border-amber-500/20 bg-amber-500/5 dark:bg-amber-500/10">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-amber-600 dark:text-amber-400 uppercase tracking-wider">
                Warnings
              </p>
              <h3 className="text-2xl font-bold text-amber-700 dark:text-amber-300 mt-1">
                {summary.warningCount}
              </h3>
            </div>
            <AlertTriangle className="h-8 w-8 text-amber-500 opacity-80" />
          </CardContent>
        </Card>

        <Card className="border-rose-500/20 bg-rose-500/5 dark:bg-rose-500/10">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-rose-600 dark:text-rose-400 uppercase tracking-wider">
                Critical Inconsistencies
              </p>
              <h3 className="text-2xl font-bold text-rose-700 dark:text-rose-300 mt-1">
                {summary.criticalCount}
              </h3>
            </div>
            <AlertOctagon className="h-8 w-8 text-rose-500 opacity-80" />
          </CardContent>
        </Card>

        <Card className="border-blue-500/20 bg-blue-500/5 dark:bg-blue-500/10">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wider">
                Total Discrepancies
              </p>
              <h3 className="text-2xl font-bold text-blue-700 dark:text-blue-300 mt-1">
                {summary.totalDiscrepancies}
              </h3>
            </div>
            <Boxes className="h-8 w-8 text-blue-500 opacity-80" />
          </CardContent>
        </Card>
      </div>

      {/* Filters & Controls */}
      <Card>
        <CardContent className="p-4 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="relative w-full md:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by product, SKU, warehouse..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          <div className="flex items-center gap-2 w-full md:w-auto">
            <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
              <Filter className="h-3.5 w-3.5" /> Filter Status:
            </span>
            <div className="flex gap-1">
              {["ALL", "HEALTHY", "WARNING", "CRITICAL"].map((st) => (
                <Button
                  key={st}
                  size="sm"
                  variant={statusFilter === st ? "default" : "outline"}
                  onClick={() => setStatusFilter(st)}
                  className="text-xs h-8"
                >
                  {st}
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Reconciliation Breakdown Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold text-foreground flex items-center justify-between">
            <span>Inventory Subsets Audit List</span>
            <Badge variant="outline" className="text-xs">
              Strict Read-Only Mode
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-12 text-center text-muted-foreground">
              <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2" />
              Running Master Reconciliation Audit...
            </div>
          ) : results.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              <ShieldCheck className="h-10 w-10 text-emerald-500 mx-auto mb-2 opacity-80" />
              No discrepancy records found matching query filter.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product & SKU</TableHead>
                  <TableHead>Warehouse</TableHead>
                  <TableHead className="text-right">Physical Stock</TableHead>
                  <TableHead className="text-right">Bin Stock</TableHead>
                  <TableHead className="text-right">Reserved</TableHead>
                  <TableHead className="text-right">Available</TableHead>
                  <TableHead className="text-right">Ledger Stock</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                  <TableHead>Discrepancy Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.map((item: any, idx: number) => {
                  const isHealthy = item.status === "HEALTHY";
                  const isCritical = item.status === "CRITICAL";

                  return (
                    <TableRow key={`${item.productId}-${item.warehouseId}-${idx}`}>
                      <TableCell>
                        <div className="font-medium text-foreground">{item.productName}</div>
                        <div className="text-xs text-muted-foreground">{item.productSku || "No SKU"}</div>
                      </TableCell>
                      <TableCell className="text-xs font-medium">
                        <span className="flex items-center gap-1">
                          <Warehouse className="h-3.5 w-3.5 text-muted-foreground" />
                          {item.warehouseName}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-mono font-medium">{item.physicalStock}</TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground">{item.binStock}</TableCell>
                      <TableCell className="text-right font-mono text-amber-600 dark:text-amber-400 font-medium">
                        {item.reservedStock}
                      </TableCell>
                      <TableCell className="text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                        {item.availableStock}
                      </TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground">{item.ledgerStock}</TableCell>
                      <TableCell className="text-center">
                        {isHealthy && (
                          <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30">
                            HEALTHY
                          </Badge>
                        )}
                        {item.status === "WARNING" && (
                          <Badge className="bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30">
                            WARNING
                          </Badge>
                        )}
                        {isCritical && (
                          <Badge variant="destructive" className="bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30">
                            CRITICAL
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {item.discrepancies.length === 0 ? (
                          <span className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                            <CheckCircle2 className="h-3.5 w-3.5" /> Invariants A–F Confirmed
                          </span>
                        ) : (
                          <div className="space-y-1">
                            {item.discrepancies.map((d: any, dIdx: number) => (
                              <div
                                key={dIdx}
                                className={`text-xs p-1.5 rounded border ${
                                  d.severity === "CRITICAL"
                                    ? "bg-rose-500/10 border-rose-500/20 text-rose-700 dark:text-rose-300"
                                    : "bg-amber-500/10 border-amber-500/20 text-amber-700 dark:text-amber-300"
                                }`}
                              >
                                <span className="font-semibold uppercase tracking-wider">{d.category}: </span>
                                <span>{d.reason}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
