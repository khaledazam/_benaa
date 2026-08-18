"use client";

import React from "react";
import { PageContentWrapper } from "@/components/shared";
import BuildStockOperationsDashboard from "./BuildStockOperationsDashboard";
import type { DashboardStats } from "@/types";

export type AdminDashboardMergedViewProps = {
  variant: "store" | "personal";
  initialStats?: DashboardStats | null;
  initialForecasting?: import("@/types").ForecastingSummary;
};

export default function AdminDashboardMergedView({
  variant,
  initialStats,
  initialForecasting,
}: AdminDashboardMergedViewProps) {
  return (
    <PageContentWrapper noPadding={variant === "store"}>
      <BuildStockOperationsDashboard />
    </PageContentWrapper>
  );
}
