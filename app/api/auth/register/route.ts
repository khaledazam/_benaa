import { NextResponse } from "next/server";
// BENAA is one company: the owner provisions employees through the guarded admin API.
export async function POST() {
  return NextResponse.json({ error: "Contact the platform owner to create an account" }, { status: 403 });
}
