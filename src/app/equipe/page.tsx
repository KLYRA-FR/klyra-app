import type { Metadata } from "next";
import { Suspense } from "react";
import { FilEquipe } from "@/components/team/FilEquipe";
import { TeamScreen } from "@/components/team/TeamScreen";

export const metadata: Metadata = { title: "Équipe — KLYRA" };

/** `/equipe?agent=<id>` ouvre la fiche d'un agent. */
export default function TeamPage() {
  return (
    <Suspense>
      <div className="flex h-full flex-col">
        <FilEquipe />
        <div className="min-h-0 flex-1">
          <TeamScreen />
        </div>
      </div>
    </Suspense>
  );
}
