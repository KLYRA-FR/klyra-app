import type { Metadata } from "next";
import { Suspense } from "react";
import { RoutinesScreen } from "@/components/workflows/RoutinesScreen";

export const metadata: Metadata = { title: "Routines — KLYRA" };

/** `/routines` (les workflows), `/routines?vue=calendrier`. */
export default function RoutinesPage() {
  return (
    <Suspense>
      <RoutinesScreen />
    </Suspense>
  );
}
