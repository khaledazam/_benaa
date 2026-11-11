"use client";

import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Users, Phone, Mail, MapPin, FileText, ShoppingCart, CheckCircle2, Clock, XCircle, ArrowLeft, Plus } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/contexts";
import { hasPermission, BuildStockPermissions } from "@/lib/auth/permissions";

export default function CustomerDetailView({ customerId }: { customerId: string }) {
  const { user } = useAuth();
  const userRole = user?.role || "VIEWER";
  const canCreateSO = hasPermission(user, BuildStockPermissions.SALES_ORDER_CREATE);

  const { data, isLoading, error } = useQuery({
    queryKey: ["customer-detail-stats", customerId],
    queryFn: async () => {
      const res = await fetch(`/api/customers/${customerId}/sales`);
      if (!res.ok) throw new Error("Failed to fetch customer statistics");
      return res.json();
    },
  });

  if (isLoading) {
    return <div className="p-8 text-center text-xs text-muted-foreground">Loading customer profile & purchasing history...</div>;
  }

  if (error || !data) {
    return <div className="p-8 text-center text-xs text-destructive">Failed to load customer profile.</div>;
  }

  const customer = data.customer;
  const stats = data.stats;
  const recentOrders = data.recentOrders || [];

  return (
    <div className="space-y-6 p-6">
      {/* HEADER */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" asChild>
            <Link href="/customers">
              <ArrowLeft className="h-4 w-4" /> Back to Directory
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">{customer.name}</h1>
              <Badge variant="outline" className="font-mono text-xs">{customer.customerCode}</Badge>
              {customer.active ? (
                <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 text-[10px]">ACTIVE</Badge>
              ) : (
                <Badge variant="secondary" className="text-[10px]">INACTIVE</Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">Client profile and historical sales orders overview.</p>
          </div>
        </div>

        {canCreateSO && customer.active && (
          <Button asChild className="gap-2 text-xs font-semibold">
            <Link href={`/sales/new?customerId=${customer.id}`}>
              <Plus className="h-4 w-4" /> Create Sales Order
            </Link>
          </Button>
        )}
      </div>

      {/* KPI STATS ROW */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">Total Sales Orders</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalOrders}</div>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">Open Orders</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-sky-600">{stats.openOrders}</div>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">Completed Orders</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-600">{stats.completedOrders}</div>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">Total Order Value</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono">${stats.totalOrderValue.toLocaleString("en-US", { minimumFractionDigits: 2 })}</div>
          </CardContent>
        </Card>
      </div>

      {/* PROFILE DETAILS GRID */}
      <div className="grid gap-6 md:grid-cols-3">
        <Card className="shadow-sm md:col-span-1">
          <CardHeader>
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Users className="h-4 w-4 text-sky-600" /> Customer Information
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-xs">
            <div>
              <p className="text-muted-foreground font-medium">Contact Phone</p>
              <p className="font-semibold">{customer.phone || "—"}</p>
              {customer.alternatePhone && <p className="text-muted-foreground">Alt: {customer.alternatePhone}</p>}
            </div>

            <div>
              <p className="text-muted-foreground font-medium">Email Address</p>
              <p className="font-semibold">{customer.email || "—"}</p>
            </div>

            <div>
              <p className="text-muted-foreground font-medium">Tax / VAT Number</p>
              <p className="font-mono">{customer.taxNumber || "—"}</p>
            </div>

            <div>
              <p className="text-muted-foreground font-medium">Location Address</p>
              <p>{[customer.address, customer.city, customer.country].filter(Boolean).join(", ") || "—"}</p>
            </div>

            {customer.notes && (
              <div>
                <p className="text-muted-foreground font-medium">Internal Notes</p>
                <p className="bg-muted p-2 rounded text-[11px]">{customer.notes}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* RECENT SALES ORDERS TABLE */}
        <Card className="shadow-sm md:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <ShoppingCart className="h-4 w-4 text-sky-600" /> Recent Sales Orders ({recentOrders.length})
            </CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link href={`/sales?customerId=${customer.id}`} className="text-xs">View All</Link>
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">SO Number</TableHead>
                  <TableHead className="text-xs">Date</TableHead>
                  <TableHead className="text-xs">Total Amount</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentOrders.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-6 text-xs text-muted-foreground">
                      No sales orders found for this customer.
                    </TableCell>
                  </TableRow>
                ) : (
                  recentOrders.map((so: any) => (
                    <TableRow key={so.id}>
                      <TableCell className="font-mono text-xs font-semibold">
                        <Link href={`/sales/${so.id}`} className="text-sky-600 hover:underline">
                          {so.salesOrderNumber}
                        </Link>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(so.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-xs font-mono font-medium">
                        ${so.total.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-xs">
                        <Badge variant="outline" className="text-[10px]">
                          {so.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-right">
                        <Button variant="ghost" size="sm" asChild>
                          <Link href={`/sales/${so.id}`}>Details</Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
