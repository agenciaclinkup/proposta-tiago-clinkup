"use client";

import dynamic from "next/dynamic";

// Recharts só é baixado quando a aba Funil é aberta (o Quadro não paga esse peso).
export const FunnelChartLazy = dynamic(() => import("./funnel-chart").then((mod) => mod.FunnelChart), {
  ssr: false,
  loading: () => <div className="h-72 w-full animate-pulse rounded-lg bg-secondary/40" aria-hidden />,
});
