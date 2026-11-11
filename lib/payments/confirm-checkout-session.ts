import type Stripe from "stripe";
/**
 * REQ-0209 gap — Apply Stripe Checkout Session on browser return (`?payment=success&session_id=`).
 * Idempotent vs webhook: if PaymentIntent already stored, only re-run payment→status sync
 * (confirms Pending→Confirmed on first money when webhook used older logic or remote webhook).
 * REQ-0215 — after apply (and alreadyApplied), always heal invoice + sync order so
 * partial→remainder settle promotes invoice paid / order paymentStatus paid.
 */

import { getStripe } from "@/lib/stripe";
import { prisma } from "@/prisma/client";
import { invalidateOnOrderChange } from "@/lib/cache";
import { recordVerifiedPayment, recoverPaymentFulfillment } from "./payment-integrity";

export type ConfirmCheckoutSessionResult = {
  ok: boolean;
  alreadyApplied: boolean;
  orderId?: string;
  invoiceId?: string;
  paymentStatus?: string | null;
  orderStatus?: string | null;
  /** REQ-0215 — healed invoice status when available */
  invoiceStatus?: string | null;
  stockFulfilled?: boolean;
  error?: string;
};

export async function confirmCheckoutSessionById(sessionId: string, providerSession?: Stripe.Checkout.Session): Promise<ConfirmCheckoutSessionResult> {
  if (!sessionId.startsWith("cs_")) return { ok: false, alreadyApplied: false, error: "Invalid session id" };
  const session = providerSession ?? await getStripe().checkout.sessions.retrieve(sessionId);
  if (session.payment_status !== "paid") return { ok: false, alreadyApplied: false, error: "Session is not paid" };
  const metadata = session.metadata || {};
  const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  const chargeAmount = (session.amount_total || 0) / 100;
  // A verified captured amount must agree with checkout metadata; do not silently
  // allocate a mismatched charge or invent a refund/overpayment policy.
  if (!paymentIntentId || !(chargeAmount > 0) || (metadata.chargeAmount && Number(metadata.chargeAmount) !== chargeAmount)) {
    return { ok: false, alreadyApplied: false, error: "Verified charge requires amount reconciliation" };
  }
  const invoiceId = metadata.type === "invoice" ? metadata.invoiceId || metadata.referenceId : undefined;
  const orderId = metadata.type === "order" ? metadata.orderId || metadata.referenceId : undefined;
  if (!invoiceId && !orderId) return { ok: false, alreadyApplied: false, error: "Unknown checkout reference" };
  const applied = await recordVerifiedPayment(prisma, { paymentIntentId, invoiceId, orderId, chargeAmount });
  // Throws on failure: webhook returns500 and browser confirmation cannot report
  // successful fulfillment. Retrying this payment cannot increment money twice.
  const recovery = await recoverPaymentFulfillment(prisma, applied.invoiceId);
  await invalidateOnOrderChange();
  const invoice = await prisma.invoice.findUnique({ where: { id: applied.invoiceId } });
  return { ok: true, alreadyApplied: applied.alreadyApplied, orderId: applied.orderId, invoiceId: applied.invoiceId,
    paymentStatus: recovery.order?.paymentStatus, orderStatus: recovery.order?.status,
    invoiceStatus: invoice?.status, stockFulfilled: recovery.stockFulfilled };
}
