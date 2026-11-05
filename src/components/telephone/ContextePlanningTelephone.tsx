"use client";

import { createContext, useContext } from "react";
import type { FunctionReturnType } from "convex/server";
import type { api } from "../../../convex/_generated/api";
import type { LecturePoste, ResultatPoste } from "@/lib/poste/client";
import { majuscule, texteErreurPoste } from "@/lib/poste-texte";
import { AucunPoste, BandeauVueGardee, DemandeEnCours, ErreurPoste, PasDeReponse, PosteFerme } from "./etats";
import type { Report } from "@/lib/report";
import type { ElementJour, RappelTelephone } from "@/lib/telephone/planning";
import type { Categorie, Evenement } from "@/types/domain";

/**
 * Ce que les écrans du Planning du téléphone (T-05 à T-07) partagent : qui je suis, les catégories
 * lues sur l'ordinateur, et les gestes sur un rappel (cocher, reporter, ouvrir). Fourni par
 * `PlanningTelephone`.
 */

export type OccurrenceCompte = FunctionReturnType<typeof api.evenements.entre>[number];

/** Un événement que l'on peut ouvrir en T-07 : du calendrier du compte, ou de l'ordinateur. */
export type EvenementTelephone = { source: "compte"; occurrence: OccurrenceCompte } | { source: "poste"; evenement: Evenement };

/** Une ligne de l'agenda : un événement, ou un départ de routine (en pointillé). */
export interface ElementAgenda extends ElementJour {
  /** Clé de la ligne (une occurrence d'un événement répété a la sienne). */
  cle: string;
  genre: "evenement" | "depart";
  /** D'où vient la ligne : le compte reste actif, ce qui vient de l'ordinateur peut être une vue gardée. */
  origine: "compte" | "poste";
  titre: string;
  fin: string | null;
  /** « Toute l'équipe », « Par Léa », l'agent d'une routine. */
  detail: string | null;
  /** Ce que porte `data-echeance` : l'élément s'éclaire au retour de T-07. */
  eclairage: string | null;
  /** null : la ligne ne s'ouvre pas (Weekly, événement d'un autre, départ de routine). */
  evenement: EvenementTelephone | null;
}

export interface PlanningTelephoneApi {
  moiId: string | null;
  aujourdhui: string;
  /** « ton Mac », « ton PC », le nom du poste. */
  sur: string;
  posteOuvert: boolean;
  /** Ce téléphone est hors ligne : aucune écriture, les saisies restent dans la page. */
  horsLigne: boolean;
  /** La date de la vue gardée de l'ordinateur, s'il est fermé et qu'on en a une. */
  gardeeLe: number | null;
  /** Un geste sur l'ordinateur ; réussi, le planning de l'ordinateur est relu. */
  surPoste: <T>(type: string, args: unknown) => Promise<ResultatPoste<T>>;
  /** null : l'ordinateur ne les a pas données (fermé, ou en cours de lecture). */
  categories: Categorie[] | null;
  /** Les noms de l'équipe, par id de membre. */
  noms: ReadonlyMap<string, string>;
  /** Cochés à l'instant sur ce téléphone : ils restent à leur place, barrés. */
  gardes: ReadonlySet<string>;
  /** Un geste sur un rappel de l'ordinateur est en cours. */
  occupes: ReadonlySet<string>;
  cocher: (rappel: RappelTelephone) => void;
  reporter: (rappel: RappelTelephone, report: Report) => void;
  supprimer: (rappel: RappelTelephone) => void;
  ouvrirRappel: (rappel: RappelTelephone | null, champ?: "jour") => void;
  ouvrirEvenement: (evenement: EvenementTelephone | null) => void;
  /** La feuille d'une catégorie (nom, couleur, icône) ; null : une nouvelle. */
  modifierCategorie: (categorie: Categorie | null) => void;
}

/**
 * D-8 : ce que l'ordinateur doit encore dire, dans sa propre section. Il ne cache jamais le compte et
 * ne conclut rien sur ce qui y serait : en cours, sans réponse, en erreur, fermé sans vue gardée,
 * ou aucun ordinateur relié. Lu, ou fermé avec une vue gardée : rien ici, l'écran montre les lignes.
 */
export function SectionPoste({ lecture, ferme }: { lecture: LecturePoste<unknown> & { relancer: () => void }; ferme: (sur: string) => string }) {
  switch (lecture.etat) {
    case "ok":
      return null;
    case "aucun":
      return <AucunPoste forme="encadre" className="px-0 pb-0" phrase={ferme} />;
    case "attente":
      return <DemandeEnCours lent={lecture.lent} lignes={2} />;
    case "ferme":
      return lecture.gardee ? null : <PosteFerme forme="encadre" phrase={ferme} />;
    case "delai":
      return <PasDeReponse forme="encadre" relancer={lecture.relancer} />;
    default:
      return <ErreurPoste forme="encadre" code={lecture.code} message={lecture.message} relancer={lecture.relancer} />;
  }
}

export const ContextePlanning = createContext<PlanningTelephoneApi | null>(null);

export function usePlanningTelephone(): PlanningTelephoneApi {
  const contexte = useContext(ContextePlanning);
  if (!contexte) throw new Error("usePlanningTelephone hors de PlanningTelephone");
  return contexte;
}

/**
 * Ce qui vient de l'ordinateur dans une liste du compte, en une ligne : fermé avec sa vue gardée
 * (« Vus à 18:42 · ton Mac est fermé »), fermé sans vue (le texte donné), demande en cours
 * (« Demande à ton Mac… », après 300 ms), sans réponse ou en erreur (« Réessayer »). Rien quand la
 * lecture est là, ni sans aucun ordinateur relié (il n'y a rien d'autre à lire).
 */
export function LignePoste({
  lecture,
  ferme,
  sur,
  mot,
}: {
  lecture: LecturePoste<unknown> & { relancer: () => void };
  ferme: string;
  sur: string;
  /** L'accord de « Vue » (« Vus » pour des rappels, « Vus » pour des événements). */
  mot?: string;
}) {
  if (lecture.etat === "ok" || lecture.etat === "aucun") return null;
  if (lecture.etat === "attente") {
    return lecture.lent ? <p className="flex min-h-11 items-center text-ui text-texte-secondaire">Demande à {sur}…</p> : null;
  }
  if (lecture.etat === "ferme") {
    if (lecture.gardee) return <BandeauVueGardee lu={lecture.gardee.lu} mot={mot} className="my-2" />;
    return <p className="flex min-h-11 items-center text-ui text-texte-secondaire">{ferme}</p>;
  }
  const texte = lecture.etat === "delai" ? `${majuscule(sur)} ne répond pas.` : texteErreurPoste(lecture, sur);
  return (
    <p role="alert" className="flex min-h-11 flex-wrap items-center gap-x-2 text-ui text-texte-secondaire">
      {texte}
      <button type="button" onClick={lecture.relancer} className="min-h-11 text-ui font-medium text-texte-principal">
        Réessayer
      </button>
    </p>
  );
}
