/**
 * Notification API validation schemas
 */

import { z } from "zod";

/** In-app notification PUT body (id comes from route param) */
export const updateInAppNotificationBodySchema = z.object({
  read: z.boolean({ error: "read is required" }),
});

const emailNotificationTypeSchema = z.enum([
  "low_stock_alert",
  "stock_out_notification",
  "inventory_report",
  "product_expiration_warning",
  "order_confirmation",
  "invoice_email",
  "shipping_notification",
  "order_status_update",
]);

/** POST /api/notifications — Brevo email dispatch */
export const emailNotificationBodySchema = z.object({
  type: emailNotificationTypeSchema,
  recipientEmail: z.string().email("Invalid recipient email"),
  recipientName: z.string().optional(),
  data: z.record(z.string(), z.unknown()),
  adminEmail: z.string().email().optional(),
});
