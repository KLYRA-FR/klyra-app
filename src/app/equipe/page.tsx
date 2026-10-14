import type { Metadata } from "next";
import { Suspense } from "react";
import { TeamScreen } from "@/components/team/TeamScreen";

export const metadata: Metadata = { title: "Équipe — KLYRA" };

/** `/equipe?agent=<id>` ouvre la fiche d'un agent. */
export default function TeamPage() {
  return (
    <Suspense>
      <TeamScreen />
    </Suspense>
  );
}
