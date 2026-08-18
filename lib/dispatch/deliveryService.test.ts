import { describe, it, expect, beforeEach, vi } from "vitest";

const mockDispatch = {
  id: "dsp-100",
  dispatchNumber: "DSP-2026-000100",
  status: "POSTED",
  deliveryStatus: "POSTED",
  driverName: null,
};

let dbAuditLogs: any[] = [];

vi.mock("@/prisma/client", () => {
  return {
    prisma: {
      dispatch: {
        findUnique: vi.fn(async () => mockDispatch),
        update: vi.fn(async ({ data }: any) => {
          Object.assign(mockDispatch, data);
          return mockDispatch;
        }),
      },
      auditLog: {
        create: vi.fn(async ({ data }: any) => {
          dbAuditLogs.push(data);
          return data;
        }),
      },
    },
  };
});

import { updateDeliveryStatus } from "@/lib/dispatch/dispatchService";

describe("Phase 7 — Dispatch Delivery Status Workflow", () => {
  beforeEach(() => {
    dbAuditLogs = [];
    mockDispatch.deliveryStatus = "POSTED";
    mockDispatch.driverName = null;
  });

  it("Updates delivery status to OUT_FOR_DELIVERY with driver info (0 physical stock mutation)", async () => {
    const updated = await updateDeliveryStatus(
      "dsp-100",
      "OUT_FOR_DELIVERY",
      {
        driverName: "Hassan Driver",
        driverPhone: "+966500000000",
        vehicleNumber: "TRK-9876",
      },
      "user-mgr"
    );

    expect(updated.deliveryStatus).toBe("OUT_FOR_DELIVERY");
    expect(updated.driverName).toBe("Hassan Driver");
    expect(dbAuditLogs.length).toBe(1);
    expect(dbAuditLogs[0].action).toBe("delivery_status_changed");
  });

  it("Rejects invalid delivery status values", async () => {
    await expect(
      updateDeliveryStatus("dsp-100", "INVALID_STATUS", {}, "user-mgr")
    ).rejects.toThrow("Invalid delivery status");
  });
});
