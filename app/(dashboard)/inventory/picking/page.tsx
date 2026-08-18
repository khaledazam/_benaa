import React from "react";
import PickListsView from "@/components/picking/PickListsView";

export const metadata = {
  title: "Picking & Pick Lists | BuildStock WMS",
  description: "Manage warehouse pick lists and bin allocation.",
};

export default function PickingPage() {
  return <PickListsView />;
}
