import type { Metadata } from "next";
import { Suspense } from "react";
import { PlanningScreen } from "@/components/planning/PlanningScreen";

export const metadata: Metadata = { title: "Planning — KLYRA" };

/** `/planning` : le calendrier et les rappels. */
export default function PlanningPage() {
  return (
    <Suspense>
      <PlanningScreen />
    </Suspense>
  );
}
