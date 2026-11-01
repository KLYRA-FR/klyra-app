"use client";

import { useSyncExternalStore } from "react";
import { CLE_CARNET, lireCarnet, type ServeurConnu } from "./serveur-vps";

/**
 * Où tourne une conversation : ce PC (null) ou un VPS relié (son origine https).
 * Les VPS viennent du carnet de l'écran Serveurs ; le dernier choix sert aux nouvelles conversations.
 */

const CLE_LIEU = "klyra:lieu-actif";
const EVENEMENT = "klyra:carnet";

const abonnes = new Set<() => void>();
let instantane: ServeurConnu[] | null = null;
let brut: string | null = null;

function lire(): ServeurConnu[] {
  let texte: string | null = null;
  try {
    texte = localStorage.getItem(CLE_CARNET);
  } catch {
    texte = null;
  }
  if (instantane && texte === brut) return instantane;
  brut = texte;
  instantane = lireCarnet(texte).liste.filter((s) => s.etat === "joint");
  return instantane;
}

function abonner(rappel: () => void) {
  abonnes.add(rappel);
  const surStockage = (e: StorageEvent) => e.key === CLE_CARNET && rappel();
  window.addEventListener(EVENEMENT, rappel);
  window.addEventListener("storage", surStockage);
  return () => {
    abonnes.delete(rappel);
    window.removeEventListener(EVENEMENT, rappel);
    window.removeEventListener("storage", surStockage);
  };
}

/** À appeler après chaque écriture du carnet. */
export function signalerCarnet() {
  window.dispatchEvent(new Event(EVENEMENT));
}

const VIDE: ServeurConnu[] = [];

/** Les VPS reliés (pas ceux qu'on a quittés). */
export function useServeursRelies(): ServeurConnu[] {
  return useSyncExternalStore(abonner, lire, () => VIDE);
}

/** Le lieu des nouvelles conversations : le dernier choisi, s'il est encore relié. */
export function lieuParDefaut(): string | null {
  try {
    const lieu = localStorage.getItem(CLE_LIEU);
    return lieu && lire().some((s) => s.adresse === lieu) ? lieu : null;
  } catch {
    return null;
  }
}

export function retenirLieu(lieu: string | null) {
  try {
    if (lieu) localStorage.setItem(CLE_LIEU, lieu);
    else localStorage.removeItem(CLE_LIEU);
  } catch {
    /* Sans stockage, les nouvelles conversations restent sur ce PC. */
  }
}

/** Le nom à afficher pour un lieu. */
export function nomLieu(lieu: string | null | undefined, serveurs: ServeurConnu[]): string {
  if (!lieu) return "Ce PC";
  return serveurs.find((s) => s.adresse === lieu)?.nom ?? new URL(lieu).hostname.split(".")[0];
}
