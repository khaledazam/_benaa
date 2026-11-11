/**
 * REQ-0152 / REQ-0209 — Derive order paymentStatus from invoice money fields.
 * unpaid (paid<=0) | partial (0 < paid < total) | paid (paid >= total).
 * Does not invent an invoice "partial" status — money fields carry mid-pay.
 * REQ-0209 — first money (partial or paid) while pending → confirm + fulfill once.
 * REQ-0215 — cent-safe compare so partial→remainder settle promotes paid (no float stuck sent/partial).
 */

import { prisma } from "@/prisma/client";
import { fulfillPaidOrderInTx } from "./order-fulfillment";
import { inventoryTransaction } from "@/lib/inventory/transaction";

import type { PaymentStatus } from "@/types";

// Keep the historical API while client caches import the pure module directly.
import { toCents, deriveOrderPaymentStatus } from "./payment-status";
export { toCents, deriveOrderPaymentStatus } from "./payment-status";

/**
 * REQ-0209 — When first money lands on a pending order, bump fulfillment to confirmed
 * and fulfill reserved stock once. Partial → paid later must not fulfill again.
 */
export function shouldConfirmAndFulfillOnPaymentSync(args: {
  derived: Exclude<PaymentStatus, "refunded">;
  orderStatus: string | null | undefined;
}): boolean {
  const status = args.orderStatus ?? "pending";
  if (status !== "pending") return false;
  return args.derived === "partial" || args.derived === "paid";
}

export type SyncOrderPaymentFromInvoiceInput = {
  amountPaid: number;
  total: number;
  /** When cancelled, leave order payment untouched. */
  invoiceStatus?: string | null;
};

/**
 * Sync linked order.paymentStatus from invoice money.
 * Skips refunded orders.
 * REQ-0209 — pending + (partial|paid) → status confirmed + fulfillPendingOrderLines once.
 * Returns the payment status written, or null if skipped.
 */
export async function syncOrderPaymentStatusFromInvoice(
  orderId: string | null | undefined,
  input: SyncOrderPaymentFromInvoiceInput,
): Promise<Exclude<PaymentStatus, "refunded"> | null> {
  if (!orderId) return null;
  if (input.invoiceStatus === "cancelled") return null;

  return inventoryTransaction(prisma, async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: true } });
    if (!order || order.paymentStatus === "refunded" || order.status === "cancelled") return null;
    const invoice = await tx.invoice.findUnique({ where: { orderId } });
    if (invoice?.status === "cancelled") return null;
    const money = invoice || input;
    if (!Number.isFinite(money.amountPaid) || !Number.isFinite(money.total) || money.amountPaid < 0 || money.total < 0) throw new Error("Invalid invoice money");
    const derived = deriveOrderPaymentStatus(money.amountPaid, money.total);
    const fulfill = shouldConfirmAndFulfillOnPaymentSync({ derived, orderStatus: order.status });
    if (!fulfill && order.paymentStatus === derived) return derived;
    if (fulfill) await fulfillPaidOrderInTx(tx, order);
    await tx.order.update({ where: { id: order.id }, data: { paymentStatus: derived,
      ...(fulfill ? { status: "confirmed" } : {}), updatedAt: new Date() } });
    return derived;
  });
}

/**
 * Apply a Stripe charge amount onto invoice money (incremental).
 * Returns next amountPaid / amountDue / status for prisma update.
 * When not fully paid, caller should clear paidAt (set null).
 * REQ-0215 — cent-safe fullyPaid; clamp amountDue to 0 when settled.
 */
export function applyIncrementalInvoicePayment(args: {
  priorAmountPaid: number;
  total: number;
  chargeAmount: number;
  priorStatus: string;
}): {
  amountPaid: number;
  amountDue: number;
  status: string;
  fullyPaid: boolean;
} {
  const total = Math.max(0, args.total);
  const priorPaid = Math.max(0, args.priorAmountPaid);
  const charge = Math.max(0, args.chargeAmount);
  const totalCents = toCents(total);
  const newPaidCents = Math.min(
    totalCents,
    toCents(priorPaid) + toCents(charge),
  );
  const fullyPaid = totalCents > 0 && newPaidCents >= totalCents;
  // Prefer exact total dollars when settled so UI matches invoice.total
  const amountPaid = fullyPaid ? total : newPaidCents / 100;
  const amountDue = fullyPaid ? 0 : Math.max(0, (totalCents - newPaidCents) / 100);
  let status = args.priorStatus;
  if (args.priorStatus === "cancelled") {
    status = "cancelled";
  } else if (fullyPaid) {
    status = "paid";
  } else if (newPaidCents > 0) {
    // REQ-0211 — any money: draft→sent; keep overdue; never revive cancelled
    if (args.priorStatus === "cancelled") {
      status = "cancelled";
    } else if (args.priorStatus === "overdue") {
      status = "overdue";
    } else {
      status = "sent";
    }
  }
  return { amountPaid, amountDue, status, fullyPaid };
}

/**
 * REQ-0211 / REQ-0215 — Recompute invoice status from current money (chargeAmount 0).
 * Promotes draft→sent on mid-pay; sent/overdue/draft → paid when fully settled.
 */
export function resolveInvoiceStatusAfterMoney(args: {
  status: string;
  amountPaid: number;
  total: number;
}): string {
  return applyIncrementalInvoicePayment({
    priorAmountPaid: args.amountPaid,
    total: args.total,
    chargeAmount: 0,
    priorStatus: args.status,
  }).status;
}
