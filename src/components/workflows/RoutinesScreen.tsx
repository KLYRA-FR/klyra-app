"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Icon } from "@/components/icons/Icon";
import { EditeurRoutine, nouvelleRoutine } from "@/components/planning/EditeurRoutine";
import { Routines } from "@/components/planning/Routines";
import { BoutonPrincipal } from "@/components/ui/BoutonPrincipal";
import { Onglets } from "@/components/ui/Onglets";
import { useWorkspace } from "@/lib/workspace";
import type { Routine } from "@/types/domain";
import { WorkflowsScreen } from "./WorkflowsScreen";

type Onglet = "workflows" | "calendrier";

/** Routines : les workflows (le canevas), et le calendrier de ce qui part à heure fixe. */
export function RoutinesScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const onglet: Onglet = useSearchParams().get("vue") === "calendrier" ? "calendrier" : "workflows";
  const { enregistrerRoutine } = useWorkspace();
  const [edition, setEdition] = useState<Routine | null>(null);

  const onglets = (
    <Onglets<Onglet>
      libelle="Routines"
      valeur={onglet}
      onChange={(o) => router.replace(o === "calendrier" ? `${pathname}?vue=calendrier` : pathname)}
      onglets={[
        { id: "workflows", label: "Workflows", icone: <Icon name="lightning-01" size={16} /> },
        { id: "calendrier", label: "Calendrier", icone: <Icon name="calendar-01" size={16} /> },
      ]}
    />
  );

  if (onglet === "workflows") return <WorkflowsScreen entete={onglets} />;

  return (
    <div className="h-full overflow-y-auto">
      <div className="@container flex flex-col gap-5 px-5 pt-5 pb-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="m-0 text-h3 leading-[1] tracking-[-0.04em] text-texte-principal">
            <span className="font-semibold">Routines</span> <span className="font-normal">planifiées</span>
          </h1>
          <div className="flex items-center gap-2">
            {onglets}
            {!edition && <BoutonPrincipal onClick={() => setEdition(nouvelleRoutine())}>Nouvelle routine</BoutonPrincipal>}
          </div>
        </header>
        {edition && (
          <EditeurRoutine
            key={edition.id}
            initiale={edition}
            onAnnuler={() => setEdition(null)}
            onEnregistrer={(r) => {
              enregistrerRoutine(r);
              setEdition(null);
            }}
          />
        )}
        <Routines onModifier={setEdition} />
      </div>
    </div>
  );
}
