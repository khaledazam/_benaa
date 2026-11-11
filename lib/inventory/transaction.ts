const delay = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));

export async function inventoryTransaction<T>(db: any, work: (tx: any) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(work, { maxWait: 10000, timeout: 20000 });
    } catch (error: any) {
      // MongoDB aborts the WHOLE transaction on conflict. Re-read current state;
      // never retry one stock write independently of its ledger/state transition.
      if (!["P2034", "P2002"].includes(error?.code) || attempt >= 9) throw error;
      await delay(Math.min(5 * 2 ** attempt, 100));
    }
  }
}
