import { createContext, useContext } from "react";
import type { OptionListe } from "@/components/ui/ListeDeroulante";
import type { Tache } from "@/types/domain";

/** Ce qu'un rappel emporte quand on le donne à quelqu'un de l'équipe. */
export type SaisieRappel = Pick<Tache, "titre" | "notes" | "date" | "heure" | "fin" | "priorite">;

/**
 * L'équipe, pour les rappels : connectée au compte, chaque rappel peut être pour
 * quelqu'un d'autre (choix « Pour »). Absente hors connexion : les rappels restent à soi.
 */
export interface EquipeRappels {
  /** Les membres ; « » = moi. */
  personnes: OptionListe<string>[];
  /** Crée le rappel dans le compte, assigné à ce membre. Vrai si c'est fait. */
  donner: (saisie: SaisieRappel, membreId: string) => Promise<boolean>;
}

export const ContexteEquipeRappels = createContext<EquipeRappels | null>(null);

export const useEquipeRappels = () => useContext(ContexteEquipeRappels);
