import type { Tache } from "@/types/domain";

/** En mémoire seulement ; ni corbeille ni nouveau champ dans conversations.json. */
export interface RappelSupprime {
  tache: Tache;
  index: number;
}

interface EtatRappels {
  taches: Tache[];
  rappelsSupprimes: RappelSupprime[];
}

export function supprimerRappel<T extends EtatRappels>(etat: T, id: string): T {
  const index = etat.taches.findIndex((t) => t.id === id);
  if (index < 0) return etat;
  return {
    ...etat,
    taches: etat.taches.filter((t) => t.id !== id),
    rappelsSupprimes: [...etat.rappelsSupprimes, { tache: { ...etat.taches[index] }, index }],
  };
}

export function restaurerRappels<T extends EtatRappels>(etat: T): T {
  if (!etat.rappelsSupprimes.length) return etat;
  const taches = [...etat.taches];
  // Les index ont été pris après chaque suppression : on remonte les gestes.
  for (const { tache, index } of etat.rappelsSupprimes.toReversed()) {
    if (!taches.some((t) => t.id === tache.id)) taches.splice(Math.min(index, taches.length), 0, tache);
  }
  return { ...etat, taches, rappelsSupprimes: [] };
}

/** Une fin de notification ne recrée jamais un rappel ni n'écrase une modification. */
export function marquerRappelNotifie<T extends EtatRappels>(etat: T, id: string): T {
  if (!etat.taches.some((t) => t.id === id && !t.notifiee)) return etat;
  return { ...etat, taches: etat.taches.map((t) => t.id === id ? { ...t, notifiee: true } : t) };
}
