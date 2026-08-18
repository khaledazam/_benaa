"use client";

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Users, Plus, Search, Filter, Edit, Power, CheckCircle2, UserCheck, UserX, Phone, Mail, MapPin } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useAuth } from "@/contexts";
import { hasPermission, BuildStockPermissions } from "@/lib/auth/permissions";

export default function CustomersView() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const userRole = user?.role || "VIEWER";

  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<string>("all");
  const [page, setPage] = useState(1);

  // Dialog States
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<any>(null);
  const [deactivatingCustomer, setDeactivatingCustomer] = useState<any>(null);

  // Form inputs
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [alternatePhone, setAlternatePhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("");
  const [taxNumber, setTaxNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const canCreate = hasPermission(userRole, BuildStockPermissions.CUSTOMER_CREATE);
  const canUpdate = hasPermission(userRole, BuildStockPermissions.CUSTOMER_UPDATE);
  const canDeactivate = hasPermission(userRole, BuildStockPermissions.CUSTOMER_DEACTIVATE);

  // 1. Fetch Customers
  const { data, isLoading } = useQuery({
    queryKey: ["customers-list", search, activeFilter, page],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (activeFilter !== "all") params.set("active", activeFilter === "active" ? "true" : "false");
      params.set("page", page.toString());
      params.set("limit", "20");

      const res = await fetch(`/api/customers?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch customers");
      return res.json();
    },
  });

  // Create Mutation
  const createMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error || "Failed to create customer");
      return resData;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers-list"] });
      setIsCreateOpen(false);
      resetForm();
    },
    onError: (err: any) => setErrorMsg(err.message),
  });

  // Update Mutation
  const updateMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: any }) => {
      const res = await fetch(`/api/customers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error || "Failed to update customer");
      return resData;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers-list"] });
      setEditingCustomer(null);
      resetForm();
    },
    onError: (err: any) => setErrorMsg(err.message),
  });

  // Deactivate Mutation
  const deactivateMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/customers/${id}`, {
        method: "DELETE",
      });
      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error || "Failed to deactivate customer");
      return resData;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers-list"] });
      setDeactivatingCustomer(null);
    },
  });

  const resetForm = () => {
    setName("");
    setPhone("");
    setAlternatePhone("");
    setEmail("");
    setAddress("");
    setCity("");
    setCountry("");
    setTaxNumber("");
    setNotes("");
    setErrorMsg(null);
  };

  const handleOpenCreate = () => {
    resetForm();
    setIsCreateOpen(true);
  };

  const handleOpenEdit = (customer: any) => {
    resetForm();
    setEditingCustomer(customer);
    setName(customer.name || "");
    setPhone(customer.phone || "");
    setAlternatePhone(customer.alternatePhone || "");
    setEmail(customer.email || "");
    setAddress(customer.address || "");
    setCity(customer.city || "");
    setCountry(customer.country || "");
    setTaxNumber(customer.taxNumber || "");
    setNotes(customer.notes || "");
  };

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate({
      name,
      phone,
      alternatePhone,
      email,
      address,
      city,
      country,
      taxNumber,
      notes,
    });
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCustomer) return;
    updateMutation.mutate({
      id: editingCustomer.id,
      payload: {
        name,
        phone,
        alternatePhone,
        email,
        address,
        city,
        country,
        taxNumber,
        notes,
      },
    });
  };

  const customers = data?.items || [];
  const pagination = data?.pagination;

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2 text-foreground">
            <Users className="h-6 w-6 text-sky-600" /> Customer Directory
          </h1>
          <p className="text-sm text-muted-foreground">
            Manage commercial clients, decoration firms, and retail buyers for BuildStock sales.
          </p>
        </div>

        {canCreate && (
          <Button onClick={handleOpenCreate} className="gap-2 text-xs font-semibold">
            <Plus className="h-4 w-4" /> Add New Customer
          </Button>
        )}
      </div>

      {/* FILTER & SEARCH BAR */}
      <Card className="shadow-sm">
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row gap-3 justify-between items-center">
            <div className="relative w-full md:w-80">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search name, code, phone, email..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                className="pl-9 text-xs"
              />
            </div>

            <div className="flex items-center gap-2 w-full md:w-auto">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <select
                value={activeFilter}
                onChange={(e) => {
                  setActiveFilter(e.target.value);
                  setPage(1);
                }}
                className="h-9 rounded-md border border-input bg-background px-3 text-xs shadow-sm focus:outline-none"
              >
                <option value="all">All Statuses</option>
                <option value="active">Active Only</option>
                <option value="inactive">Inactive Only</option>
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* CUSTOMERS TABLE */}
      <Card className="shadow-sm">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Customer Code</TableHead>
                <TableHead className="text-xs">Customer Name</TableHead>
                <TableHead className="text-xs">Phone & Email</TableHead>
                <TableHead className="text-xs">Location</TableHead>
                <TableHead className="text-xs">Total Orders</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-xs text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-xs text-muted-foreground">
                    Loading customer directory...
                  </TableCell>
                </TableRow>
              ) : customers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-xs text-muted-foreground">
                    No customer records found matching search filters.
                  </TableCell>
                </TableRow>
              ) : (
                customers.map((c: any) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono text-xs font-semibold">
                      <Link href={`/customers/${c.id}`} className="text-sky-600 hover:underline">
                        {c.customerCode}
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs font-medium">
                      <Link href={`/customers/${c.id}`} className="hover:underline">
                        {c.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs">
                      <div className="flex flex-col text-[11px]">
                        {c.phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3 text-muted-foreground" /> {c.phone}</span>}
                        {c.email && <span className="flex items-center gap-1 text-muted-foreground"><Mail className="h-3 w-3" /> {c.email}</span>}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {c.city || c.country ? (
                        <span className="flex items-center gap-1">
                          <MapPin className="h-3 w-3" /> {[c.city, c.country].filter(Boolean).join(", ")}
                        </span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-xs font-mono font-medium">
                      {c._count?.salesOrders || 0} orders
                    </TableCell>
                    <TableCell className="text-xs">
                      {c.active ? (
                        <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 text-[10px]">
                          ACTIVE
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="text-[10px]">
                          INACTIVE
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-right space-x-1">
                      <Button variant="ghost" size="sm" asChild>
                        <Link href={`/customers/${c.id}`}>View</Link>
                      </Button>
                      {canUpdate && (
                        <Button variant="ghost" size="sm" onClick={() => handleOpenEdit(c)}>
                          <Edit className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {canDeactivate && c.active && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-rose-600 hover:text-rose-700"
                          onClick={() => setDeactivatingCustomer(c)}
                        >
                          <Power className="h-3.5 w-3.5" />
                        </Button>
                      )}
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
                Page {pagination.page} of {pagination.totalPages} ({pagination.total} total customers)
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

      {/* CREATE CUSTOMER DIALOG */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold">Add New Customer</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateSubmit} className="space-y-4">
            {errorMsg && <div className="p-2 border border-destructive bg-destructive/10 text-destructive text-xs rounded">{errorMsg}</div>}

            <div className="space-y-1">
              <Label className="text-xs font-medium">Customer Name *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} required className="text-xs" placeholder="e.g. ABC Decoration & Contracting" />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs font-medium">Phone</Label>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} className="text-xs" placeholder="+966 50 123 4567" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium">Alt Phone</Label>
                <Input value={alternatePhone} onChange={(e) => setAlternatePhone(e.target.value)} className="text-xs" placeholder="Secondary Phone" />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-medium">Email</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="text-xs" placeholder="billing@abc-decoration.com" />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs font-medium">City</Label>
                <Input value={city} onChange={(e) => setCity(e.target.value)} className="text-xs" placeholder="Riyadh" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium">Country</Label>
                <Input value={country} onChange={(e) => setCountry(e.target.value)} className="text-xs" placeholder="Saudi Arabia" />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-medium">Tax / VAT Number</Label>
              <Input value={taxNumber} onChange={(e) => setTaxNumber(e.target.value)} className="text-xs" placeholder="310000000000003" />
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-medium">Address</Label>
              <Input value={address} onChange={(e) => setAddress(e.target.value)} className="text-xs" placeholder="Industrial Area, Sector 4" />
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-medium">Notes</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} className="text-xs" placeholder="VIP Commercial Client" />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={createMutation.isPending}>
                {createMutation.isPending ? "Saving..." : "Create Customer"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* EDIT CUSTOMER DIALOG */}
      <Dialog open={!!editingCustomer} onOpenChange={(open) => !open && setEditingCustomer(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold">Edit Customer — {editingCustomer?.customerCode}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleEditSubmit} className="space-y-4">
            {errorMsg && <div className="p-2 border border-destructive bg-destructive/10 text-destructive text-xs rounded">{errorMsg}</div>}

            <div className="space-y-1">
              <Label className="text-xs font-medium">Customer Name *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} required className="text-xs" />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs font-medium">Phone</Label>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} className="text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium">Alt Phone</Label>
                <Input value={alternatePhone} onChange={(e) => setAlternatePhone(e.target.value)} className="text-xs" />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-medium">Email</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="text-xs" />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs font-medium">City</Label>
                <Input value={city} onChange={(e) => setCity(e.target.value)} className="text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium">Country</Label>
                <Input value={country} onChange={(e) => setCountry(e.target.value)} className="text-xs" />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-medium">Tax / VAT Number</Label>
              <Input value={taxNumber} onChange={(e) => setTaxNumber(e.target.value)} className="text-xs" />
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-medium">Address</Label>
              <Input value={address} onChange={(e) => setAddress(e.target.value)} className="text-xs" />
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-medium">Notes</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} className="text-xs" />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setEditingCustomer(null)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={updateMutation.isPending}>
                {updateMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* DEACTIVATE DIALOG */}
      <Dialog open={!!deactivatingCustomer} onOpenChange={(open) => !open && setDeactivatingCustomer(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base font-bold">Deactivate Customer?</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Deactivating customer <strong className="text-foreground">{deactivatingCustomer?.name} ({deactivatingCustomer?.customerCode})</strong> will prevent them from receiving new Sales Orders. Historical orders will remain accessible.
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setDeactivatingCustomer(null)}>Cancel</Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={deactivateMutation.isPending}
              onClick={() => deactivateMutation.mutate(deactivatingCustomer.id)}
            >
              {deactivateMutation.isPending ? "Deactivating..." : "Confirm Deactivation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
