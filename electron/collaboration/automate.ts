import { bailTermine, BAIL_MS, type Carte } from "./carte.ts";
import { relever, risqueDesLabels, type Risque } from "./risque.ts";

/**
 * Ce qu'il faut faire ensuite sur une Issue, décidé en code à partir de ce que dit GitHub, sans appel de
 * modèle. Ainsi, surveiller ne coûte aucun jeton, et un modèle ne se réveille que s'il y a du travail.
 * Module pur : le runner lit l'état, appelle cette fonction, exécute l'action.
 */

export const LABEL_PRET = "agent:prêt";
export const LABEL_EN_COURS = "agent:en-cours";
export const LABEL_BLOQUE = "agent:bloqué";
export const LABEL_A_REVOIR = "agent:à-revoir";

/** Une correction après une CI rouge, puis une personne. */
export const ESSAIS_CI_MAX = 1;
/** Deux tours de review, puis une personne. */
export const TOURS_REVUE_MAX = 2;

export type Verifications = "vertes" | "rouges" | "en_cours" | "aucune";

export interface EtatPull {
  numero: number;
  sha: string;
  fusionnee: boolean;
  fermee: boolean;
  verifications: Verifications;
  /** Calculé d'après les fichiers de la PR (`risque.ts`). */
  risque: Risque;
}

export interface EtatIssue {
  numero: number;
  ouverte: boolean;
  labels: string[];
  carte: Carte | null;
  branche: boolean;
  pull: EtatPull | null;
  /** Le compte GitHub de la personne qui fait tourner ce poste. */
  moi: string;
  /** Un agent de ce poste travaille déjà sur cette Issue. */
  enCoursIci: boolean;
  maintenant: number;
  /** Depuis quand ce poste voit la branche sans carte (réservation interrompue), ou null. */
  sansCarteDepuis: number | null;
}

export type Action =
  | { type: "attendre"; motif: string }
  | { type: "reserver" }
  | { type: "reprendre"; generation: number }
  | { type: "executer" }
  | { type: "corriger_ci"; pull: number }
  | { type: "reviewer"; pull: number; sha: string }
  | { type: "corriger_revue"; pull: number }
  | { type: "demander_fusion"; pull: number; sha: string }
  | { type: "bloquer"; motif: string }
  | { type: "cloturer" };

const attendre = (motif: string): Action => ({ type: "attendre", motif });

export function prochaineAction(e: EtatIssue): Action {
  if (e.carte?.statut === "termine") return attendre("deja_terminee");
  if (e.pull?.fusionnee) return { type: "cloturer" };
  if (!e.ouverte) return e.branche || e.carte ? { type: "cloturer" } : attendre("fermee");
  if (e.labels.includes(LABEL_BLOQUE) || e.carte?.statut === "bloque") return attendre("bloquee");
  if (e.enCoursIci) return attendre("en_cours_ici");

  if (!e.branche) return e.labels.includes(LABEL_PRET) ? { type: "reserver" } : attendre("pas_prete");

  if (e.carte === null) {
    /* Réservation interrompue entre la branche et la carte : on laisse au poste le temps de finir. */
    const ancienne = e.sansCarteDepuis !== null && e.maintenant - e.sansCarteDepuis >= BAIL_MS;
    return ancienne ? { type: "reprendre", generation: 1 } : attendre("reservation_en_cours");
  }

  const mienne = e.carte.responsable === e.moi;
  if (!mienne) {
    return bailTermine(e.carte, e.maintenant) ? { type: "reprendre", generation: e.carte.generation + 1 } : attendre("a_un_autre_poste");
  }
  if (e.pull === null || e.pull.fermee) return { type: "executer" };
  return actionSurLaPull(e.carte, e.pull, risqueDesLabels(e.labels));
}

function actionSurLaPull(carte: Carte, pull: EtatPull, annonce: Risque | null): Action {
  if (pull.verifications === "en_cours") return attendre("verifications_en_cours");
  if (pull.verifications === "rouges") {
    return carte.essaisCi < ESSAIS_CI_MAX ? { type: "corriger_ci", pull: pull.numero } : { type: "bloquer", motif: "ci_rouge" };
  }

  /* Le label peut relever le risque, jamais le baisser sous ce que disent les fichiers. */
  const risque = annonce === null ? pull.risque : relever(annonce, pull.risque);
  if (risque !== "faible") {
    if (carte.revueSha !== pull.sha) {
      /* Pas de nouvelle review sans nouveau commit, et pas plus de deux tours. */
      return carte.toursRevue < TOURS_REVUE_MAX ? { type: "reviewer", pull: pull.numero, sha: pull.sha } : { type: "bloquer", motif: "tours_de_revue" };
    }
    if (carte.revue === "corrections") {
      return carte.toursRevue < TOURS_REVUE_MAX ? { type: "corriger_revue", pull: pull.numero } : { type: "bloquer", motif: "tours_de_revue" };
    }
  }

  return carte.fusionDemandeeSha === pull.sha ? attendre("fusion_demandee") : { type: "demander_fusion", pull: pull.numero, sha: pull.sha };
}
