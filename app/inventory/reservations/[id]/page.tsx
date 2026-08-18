import React from "react";
import ReservationDetailView from "@/components/reservations/ReservationDetailView";

export const metadata = {
  title: "Reservation Details | BuildStock WMS",
  description: "Stock Reservation details and release controls in BuildStock WMS",
};

export default async function ReservationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReservationDetailView reservationId={id} />;
}
