/** Ce que l'écran reçoit du runner. Sans import : `src/` lit ce fichier sans passer par le reste du module. */

export interface LigneIssue {
  numero: number;
  titre: string;
  etat: string;
  pull: number | null;
}

export interface Lancement {
  numero: number;
  titre: string;
  brief: string;
  chemin: string;
  /** L'agent demandé par un label `executant:<id>`, sinon l'assistant. */
  agent: string;
}

export interface BilanTour {
  lignes: LigneIssue[];
  aLancer: Lancement[];
  erreurs: string[];
}

export type FinEtape = { statut: "pr"; pull: number } | { statut: "resultat" } | { statut: "bloque"; raison: string } | { statut: "ignore"; raison: string };
