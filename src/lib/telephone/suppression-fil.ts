/**
 * La suppression d'un fil, différée (lot 2, E2-51) : le compte ne sait pas défaire une suppression
 * (`archiverFil({ supprime: true })` retire la ligne), donc rien ne part pendant le délai de l'annonce
 * (8 s, arrêté tant que le doigt est dessus). « Annuler » n'envoie rien. Page quittée, espace changé,
 * app rechargée avant l'échéance : la suppression est abandonnée, elle ne part jamais plus tard.
 * Après l'envoi, une seule demande ; un échec restaure le fil, une réussite ne promet aucune restauration.
 */

export type EtatSuppression = "prevue" | "en-cours" | "faite" | "restauree" | "abandonnee";

export interface SuppressionPrevue {
  readonly etat: EtatSuppression;
  /** « Annuler » pendant le délai : rien n'est envoyé, le fil revient. */
  annuler: () => void;
  /** Le délai est passé sans « Annuler » : la demande part, une seule fois. */
  echeance: () => void;
  /** L'écran est quitté avant l'échéance : rien ne part. */
  abandonner: () => void;
}

export function prevoirSuppression({ supprimer, suivre }: { supprimer: () => Promise<unknown>; suivre: (etat: EtatSuppression, erreur?: unknown) => void }): SuppressionPrevue {
  let etat: EtatSuppression = "prevue";
  const passer = (suivant: EtatSuppression, erreur?: unknown) => {
    etat = suivant;
    suivre(suivant, erreur);
  };
  return {
    get etat() {
      return etat;
    },
    annuler: () => {
      if (etat === "prevue") passer("restauree");
    },
    echeance: () => {
      if (etat !== "prevue") return;
      passer("en-cours");
      supprimer().then(
        () => passer("faite"),
        (erreur: unknown) => passer("restauree", erreur),
      );
    },
    abandonner: () => {
      if (etat === "prevue") passer("abandonnee");
    },
  };
}
