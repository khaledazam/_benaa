import React from "react";
import ReservationsView from "@/components/reservations/ReservationsView";

export const metadata = {
  title: "Stock Reservations | BuildStock WMS",
  description: "Stock Reservation Engine for BuildStock WMS",
};

export default function StockReservationsPage() {
  return <ReservationsView />;
}
