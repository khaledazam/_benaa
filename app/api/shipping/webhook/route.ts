import { NextResponse } from "next/server";
// Tracking updates must remain disabled until provider authenticity verification is implemented.
export async function POST() {
  return NextResponse.json({ error: "Shipping webhook verification is not configured" }, { status: 503 });
}
