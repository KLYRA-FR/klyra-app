import type { Metadata } from "next";
import { Suspense } from "react";
import { RoutinesScreen } from "@/components/workflows/RoutinesScreen";

export const metadata: Metadata = { title: "Automatisations — KLYRA" };

/** `/routines` et `/routines?vue=workflows` : deux fonctions distinctes. */
export default function RoutinesPage() {
  return (
    <Suspense>
      <RoutinesScreen />
    </Suspense>
  );
}
