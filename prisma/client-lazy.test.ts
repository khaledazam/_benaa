import { expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ constructed: vi.fn(), connected: vi.fn() }));
vi.mock("@prisma/client", () => ({ PrismaClient: class {
  constructor() { state.constructed(); }
  $connect = state.connected;
} }));
it("service imports neither construct nor connect a default database before isolation is selected", async () => {
  const previous = globalThis.prisma;
  globalThis.prisma = undefined;
  try {
    vi.resetModules();
    const { prisma } = await import("./client");
    expect(state.constructed).not.toHaveBeenCalled();
    expect(state.connected).not.toHaveBeenCalled();
    const local = { user: { isolated: true } };
    globalThis.prisma = local as any;
    expect(prisma.user).toBe(local.user);
    expect(state.constructed).not.toHaveBeenCalled();
  } finally { globalThis.prisma = previous; }
});
