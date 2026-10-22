import type { Metadata } from "next";
import { Suspense } from "react";
import { PlanningScreen } from "@/components/planning/PlanningScreen";

export const metadata: Metadata = { title: "Planning — KLYRA" };

/** `/planning`, `/planning?vue=taches`, `/planning?vue=automatisations`. */
export default function PlanningPage() {
  return (
    <Suspense>
      <PlanningScreen />
    </Suspense>
  );
}
