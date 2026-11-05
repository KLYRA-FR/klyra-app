"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { IconName } from "@/components/icons/Icon";
import { libelleEcheance } from "@/lib/dates";
import { Feuille } from "./Feuille";
import { EtatEcran, Squelette } from "./etats";
import { GroupeListe, LigneListe, SectionListe, TuileIcone } from "./Liste";

const TYPES: Record<string, { libelle: string; icone: IconName }> = {
  assigne: { libelle: "Rappel assigné", icone: "users-profiles-01" },
  echeance: { libelle: "Rappel en retard", icone: "clock-01" },
  fait: { libelle: "Rappel terminé", icone: "check-01" },
  modifie: { libelle: "Rappel modifié", icone: "pencil-01" },
};

/**
 * Les notifications des rappels (E3-29), la même liste qu'au bureau : ouvrir la feuille les marque lues
 * (`rappels.marquerLues`, comme sa liste), mais celles qui étaient nouvelles le restent à l'écran
 * le temps de la feuille. Les rappels supprimés n'y figurent plus.
 */
export function FeuilleNotifications({ onOuvrir, onFermer }: { onOuvrir: (rappelId: string) => void; onFermer: () => void }) {
  const lues = useQuery(api.rappels.notifications, {});
  const marquerLues = useMutation(api.rappels.marquerLues);
  const [nouvelles, setNouvelles] = useState<ReadonlySet<string> | null>(null);
  if (lues && nouvelles === null) setNouvelles(new Set(lues.liste.filter((n) => !n.lue).map((n) => n._id as string)));

  const aMarquer = (lues?.nonLues ?? 0) > 0;
  useEffect(() => {
    if (aMarquer) void marquerLues({}).catch(() => undefined);
  }, [aMarquer, marquerLues]);

  const liste = lues?.liste ?? [];
  const groupe = (titre: string, lignes: typeof liste) =>
    lignes.length ? (
      <SectionListe titre={titre} compte={titre === "Nouvelles" ? lignes.length : undefined} className="mt-2">
        <GroupeListe>
          {lignes.map((n) => {
            const type = TYPES[n.type] ?? { libelle: "Rappel", icone: "bell-01" as const };
            return (
              <LigneListe
                key={n._id}
                retrait="tuile"
                debut={<TuileIcone icone={type.icone} bleue={titre === "Nouvelles"} />}
                nom={type.libelle}
                ligne2={[n.titre, n.jour ? libelleEcheance(n.jour, n.heure) : null].filter(Boolean).join(" · ")}
                fin="chevron"
                onClick={() => onOuvrir(n.rappelId)}
              />
            );
          })}
        </GroupeListe>
      </SectionListe>
    ) : null;

  return (
    <Feuille titre="Notifications" sousTitre="Les rappels de l’équipe" onFermer={onFermer}>
      {lues === undefined ? (
        <Squelette lignes={3} />
      ) : liste.length === 0 ? (
        <EtatEcran forme="encadre" icone="bell-01" titre="Aucune notification" texte="Quand on t’assigne un rappel ou qu’il passe en retard, il s’affiche ici." />
      ) : (
        <>
          {groupe("Nouvelles", liste.filter((n) => nouvelles?.has(n._id)))}
          {groupe("Déjà vues", liste.filter((n) => !nouvelles?.has(n._id)))}
        </>
      )}
    </Feuille>
  );
}
