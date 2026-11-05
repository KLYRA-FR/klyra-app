"use client";

import { Bouton } from "@/components/ui/Bouton";
import { nomLieu, useServeursRelies } from "@/lib/lieux";
import { useWorkspace } from "@/lib/workspace";

/** Un lien mène à ce qui est sur un autre serveur : on propose d'y passer, rien ne change de machine. */
export function AutreServeur({ lieu, quoi }: { lieu: string | null; quoi: string }) {
  const { basculerMachine } = useWorkspace();
  const nom = nomLieu(lieu, useServeursRelies());
  return (
    <div role="status" className="flex items-center gap-3 border-b border-bordure-subtile bg-fond-surface-grise px-5 py-2 text-ui-s text-texte-secondaire">
      <span className="min-w-0 flex-1">
        {quoi} est sur {nom}, pas sur le serveur affiché.
      </span>
      <Bouton variant="blanc" taille="compact" onClick={() => basculerMachine(lieu)}>
        Passer sur {nom}
      </Bouton>
    </div>
  );
}
