"use client";

import { texteRoutines } from "@/lib/poste-texte";
import { EcranPoste } from "./ListesTelephone";
import { usePostes } from "./poste";

/** Automatisations : routines et workflows (T-14 à T-19). Route : /routines. */

/** MO-T17 : une routine d'un VPS tourne même l'ordinateur fermé. */
export function AutomatisationsTelephone() {
  const { principal } = usePostes();
  return <EcranPoste titre="Automatisations" phrase={() => texteRoutines(principal)} />;
}
