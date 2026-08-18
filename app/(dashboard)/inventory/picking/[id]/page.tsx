import React from "react";
import PickListDetailView from "@/components/picking/PickListDetailView";

export const metadata = {
  title: "Pick List Detail | BuildStock WMS",
  description: "View and execute bin picking for reserved stock.",
};

export default async function PickListDetailPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  return <PickListDetailView id={id} />;
}
