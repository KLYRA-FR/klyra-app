import { useSyncExternalStore } from "react";
import type { Graphe } from "@/types/workflows";
import type { Geste } from "./construction";

/**
 * Les chantiers : un agent en train de construire un workflow (outil `construire_workflow`). Ils
 * changent à chaque morceau que le modèle écrit : gardés hors de l'état de l'app (qui est enregistré
 * et que tout l'écran lit), dans ce petit magasin que seule la page Workflows écoute. Rien n'est
 * écrit sur le disque : un chantier finit enregistré (le workflow), ou disparaît.
 */

export interface Chantier {
  /** `<conversation>:<agent>` : un agent construit un workflow à la fois par conversation. */
  cle: string;
  roleId: string;
  chatId: string;
  /** L'outil en cours d'écriture (tool_use), pour l'abandonner s'il est refusé. */
  etapeId: string | null;
  /** Le workflow modifié, ou l'id que le nouveau workflow prendra. */
  workflowId: string;
  nouveau: boolean;
  titre: string;
  graphe: Graphe;
  /** Les cartes et liens posés par l'agent, et les cartes qu'il modifie. */
  nouveaux: string[];
  modifies: string[];
  liensNouveaux: string[];
  gestes: Geste[];
  /** La carte ou le lien qui s'écrit ; null : rien en particulier. */
  enEcriture: string | null;
  /**
   * ecrit : l'agent écrit encore l'outil (aperçu) ; pose : l'app pose les étapes une à une (l'outil
   * est appelé) ; fini : enregistré, gardé un instant pour l'animation de fin.
   */
  phase: "ecrit" | "pose" | "fini";
  debut: number;
}

let chantiers: Readonly<Record<string, Chantier>> = {};
const abonnes = new Set<() => void>();
const VIDE: Readonly<Record<string, Chantier>> = {};

function avertir() {
  for (const f of abonnes) f();
}

export function lireChantiers(): Readonly<Record<string, Chantier>> {
  return chantiers;
}

export function chantierDe(cle: string): Chantier | null {
  return chantiers[cle] ?? null;
}

/** Pose ou retire (null) un chantier. */
export function poserChantier(cle: string, c: Chantier | null): void {
  if (!c && !chantiers[cle]) return;
  const suite = { ...chantiers };
  if (c) suite[cle] = c;
  else delete suite[cle];
  chantiers = suite;
  avertir();
}

function abonner(f: () => void) {
  abonnes.add(f);
  return () => {
    abonnes.delete(f);
  };
}

/** Les chantiers en cours, les plus récents d'abord. */
export function useChantiers(): Chantier[] {
  const tous = useSyncExternalStore(abonner, lireChantiers, () => VIDE);
  return Object.values(tous).sort((a, b) => b.debut - a.debut);
}
