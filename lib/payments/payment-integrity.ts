import { createHash } from "node:crypto";
import { inventoryTransaction } from "@/lib/inventory/transaction";
import { applyIncrementalInvoicePayment, syncOrderPaymentStatusFromInvoice } from "./order-payment-from-amounts";
import { applyStripeChargeToOrderInvoice } from "@/prisma/invoice";

/** Persist verified provider money once. The ledger survives later fulfillment
 * failure, so a webhook retry recovers stock without charging the invoice again. */
export async function recordVerifiedPayment(db: any, input: { paymentIntentId: string; invoiceId?: string; orderId?: string; chargeAmount: number }) {
  if (!/^pi_[a-zA-Z0-9_]+$/.test(input.paymentIntentId) || !Number.isFinite(input.chargeAmount) || input.chargeAmount <= 0) throw new Error("Invalid verified payment");
  const requestHash = createHash("sha256").update(JSON.stringify({ invoiceId: input.invoiceId || null, orderId: input.orderId || null, chargeAmount: input.chargeAmount })).digest("hex");
  return inventoryTransaction(db, async tx => {
    const operationKey = `stripe-payment:${input.paymentIntentId}`;
    const prior = await tx.inventoryOperation.findUnique({ where: { operationKey } });
    if (prior) {
      if (prior.requestHash !== requestHash) throw new Error("Payment identity cannot be reused for a different reference or amount");
      return { ...(prior.response as any), alreadyApplied: true };
    }
    const orderId = input.orderId || (await tx.invoice.findUnique({ where: { id: input.invoiceId } }))?.orderId;
    const order = orderId ? await tx.order.findUnique({ where: { id: orderId } }) : null;
    if (!order || order.status === "cancelled" || order.paymentStatus === "refunded") throw new Error("Cancelled/refunded order payment requires operator review");
    if (!Number.isFinite(order.total) || order.total < 0) throw new Error("Historical order money requires reconciliation");
    let invoice = await tx.invoice.findUnique({ where: input.invoiceId ? { id: input.invoiceId } : { orderId } });
    if (invoice && invoice.orderId !== orderId) throw new Error("Invoice and order payment references do not match");
    if (input.invoiceId && !invoice) throw new Error("Invoice not found");
    if (invoice && [invoice.total, invoice.amountPaid, invoice.amountDue].some(value => !Number.isFinite(value) || value < 0)) throw new Error("Historical invoice money requires reconciliation");
    if (invoice?.status === "cancelled") throw new Error("Cancelled invoice payment requires operator review");
    // Older last-intent fields are evidence of prior application, never apply that
    // same intent again. Earlier overwritten historical intents need reconciliation.
    const legacyApplied = invoice?.stripePaymentIntentId === input.paymentIntentId || order.stripePaymentIntentId === input.paymentIntentId;
    if (!legacyApplied) {
      if (!input.invoiceId) invoice = await applyStripeChargeToOrderInvoice(orderId, input.chargeAmount, tx);
      else {
        const next = applyIncrementalInvoicePayment({ priorAmountPaid: invoice.amountPaid, total: invoice.total, chargeAmount: input.chargeAmount, priorStatus: invoice.status });
        invoice = await tx.invoice.update({ where: { id: invoice.id }, data: { status: next.status, amountPaid: next.amountPaid, amountDue: next.amountDue,
          paidAt: next.status === "paid" ? new Date() : null, updatedAt: new Date() } });
      }
    }
    if (!invoice) throw new Error("Invoice not found for applied payment");
    await tx.invoice.update({ where: { id: invoice.id }, data: { stripePaymentIntentId: input.paymentIntentId, updatedAt: new Date() } });
    await tx.order.update({ where: { id: orderId }, data: { stripePaymentIntentId: input.paymentIntentId, updatedAt: new Date() } });
    const response = { invoiceId: invoice.id, orderId, alreadyApplied: legacyApplied };
    await tx.inventoryOperation.create({ data: { operationKey, actorId: invoice.userId, requestHash, response } });
    return response;
  });
}

export async function recoverPaymentFulfillment(db: any, invoiceId: string) {
  const invoice = await db.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) throw new Error("Invoice not found");
  await syncOrderPaymentStatusFromInvoice(invoice.orderId, { amountPaid: invoice.amountPaid, total: invoice.total, invoiceStatus: invoice.status });
  const [order, fulfillment] = await Promise.all([
    db.order.findUnique({ where: { id: invoice.orderId } }),
    db.inventoryOperation.findUnique({ where: { operationKey: `order-fulfillment:${invoice.orderId}` } }),
  ]);
  if (!fulfillment && invoice.amountPaid > 0) throw new Error("Historical fulfillment requires reconciliation; no successful stock fulfillment is recorded");
  return { order, stockFulfilled: !!fulfillment };
}
