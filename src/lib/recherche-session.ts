"use client";

import { useSyncExternalStore } from "react";
import type { Requete } from "./recherche";

/**
 * Ce que la fenêtre de recherche partage avec le reste de l'app, le temps que
 * l'app reste ouverte : si elle est ouverte (le bouton du rail), et la requête
 * du dernier résultat ouvert (le fil y surligne les mots trouvés). Rien n'est
 * écrit sur le disque.
 */

/** Ouvre la fenêtre de recherche (bouton du rail) ; `basculer` la ferme si elle est ouverte (⌘K). */
export function ouvrirRecherche(basculer = false) {
  window.dispatchEvent(new CustomEvent("klyra:recherche", { detail: { basculer } }));
}

let ouverte = false;
const abonnes = new Set<() => void>();

export function signalerRecherche(valeur: boolean) {
  ouverte = valeur;
  abonnes.forEach((f) => f());
}

export function useRechercheOuverte(): boolean {
  return useSyncExternalStore(
    (f) => {
      abonnes.add(f);
      return () => abonnes.delete(f);
    },
    () => ouverte,
    () => false,
  );
}

let requeteOuverte: Requete | null = null;

export function retenirRequete(requete: Requete | null) {
  requeteOuverte = requete;
}

/** La requête du résultat qu'on vient d'ouvrir, pour surligner ses mots dans le message. */
export function requeteRetenue(): Requete | null {
  return requeteOuverte;
}
