"use client";

import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PackageCheck, Warehouse, User, AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

interface CreatePickListModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (pickListId: string) => void;
}

export default function CreatePickListModal({ isOpen, onClose, onSuccess }: CreatePickListModalProps) {
  const [selectedReservationId, setSelectedReservationId] = useState<string>("");
  const [assignedTo, setAssignedTo] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fetch active reservations without existing active pick list
  const { data: reservations, isLoading: isLoadingReservations } = useQuery({
    queryKey: ["active-reservations-for-picking"],
    queryFn: async () => {
      const res = await fetch("/api/reservations?status=ACTIVE");
      if (!res.ok) throw new Error("Failed to fetch active reservations");
      const json = await res.json();
      return json.items || [];
    },
    enabled: isOpen,
  });

  // Fetch users for assignment dropdown
  const { data: users } = useQuery({
    queryKey: ["warehouse-users-for-picking"],
    queryFn: async () => {
      const res = await fetch("/api/users");
      if (!res.ok) return [];
      const json = await res.json();
      return json.users || json.data || json || [];
    },
    enabled: isOpen,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedReservationId) {
      setError("Please select an active Stock Reservation.");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/pick-lists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reservationId: selectedReservationId,
          assignedTo: assignedTo || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to create Pick List");
      }

      onSuccess(data.id);
      onClose();
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[550px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl font-bold">
            <PackageCheck className="h-6 w-6 text-emerald-600" /> Create Pick List
          </DialogTitle>
          <DialogDescription>
            Select an active Stock Reservation to generate a warehouse Pick List.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5 py-3">
          {error && (
            <div className="flex items-center gap-2 rounded-md bg-destructive/15 p-3 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium leading-none text-foreground flex items-center gap-1.5">
              <Warehouse className="h-4 w-4 text-muted-foreground" /> Stock Reservation *
            </label>
            {isLoadingReservations ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading active reservations...
              </div>
            ) : !reservations || reservations.length === 0 ? (
              <p className="text-sm text-amber-600 dark:text-amber-400 bg-amber-500/10 p-3 rounded-md border border-amber-500/20">
                No active Stock Reservations available for picking. Only APPROVED Sales Orders with active stock reservations can be picked.
              </p>
            ) : (
              <select
                value={selectedReservationId}
                onChange={(e) => setSelectedReservationId(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
                required
              >
                <option value="">-- Select Active Reservation --</option>
                {reservations.map((res: any) => (
                  <option key={res.id} value={res.id}>
                    {res.reservationNumber} | {res.salesOrder?.salesOrderNumber} ({res.salesOrder?.customer?.name || "Customer"}) [{res.warehouse?.name}]
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium leading-none text-foreground flex items-center gap-1.5">
              <User className="h-4 w-4 text-muted-foreground" /> Assign Picker (Optional)
            </label>
            <select
              value={assignedTo}
              onChange={(e) => setAssignedTo(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">-- Unassigned (DRAFT) --</option>
              {Array.isArray(users) &&
                users.map((u: any) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.role})
                  </option>
                ))}
            </select>
            <p className="text-xs text-muted-foreground">
              If left unassigned, the Pick List status will be DRAFT. Assigning a picker sets status to ASSIGNED.
            </p>
          </div>

          <DialogFooter className="pt-3">
            <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || !selectedReservationId} className="bg-emerald-600 hover:bg-emerald-700 text-white">
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creating...
                </>
              ) : (
                "Create Pick List"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
