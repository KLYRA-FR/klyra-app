"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { getBridge, type CompteClaude, type ModeleMoteur, type MoteurPoste } from "@/lib/bridge";

/**
 * Les moteurs de ce poste, leur compte et leurs modèles, lus une fois et partagés par tous les écrans
 * (choix rapide de la conversation, Réglages du serveur). `actualiser` les relit.
 */

export interface EtatMoteur {
  moteur: MoteurPoste;
  compte: CompteClaude | null;
  /** null : pas encore lus (ou le moteur n'en annonce pas : Claude Code, cf. ChoixModele). */
  modeles: ModeleMoteur[] | null;
  erreur: string | null;
}

let etat: EtatMoteur[] | null = null;
let lecture: Promise<void> | null = null;
const abonnes = new Set<() => void>();
const signaler = () => abonnes.forEach((f) => f());

async function lire(): Promise<void> {
  const bridge = getBridge()?.moteurs;
  if (!bridge) {
    etat = [];
    return signaler();
  }
  const liste = await bridge.liste();
  if (!liste.ok) {
    etat = [];
    return signaler();
  }
  const suivant: EtatMoteur[] = await Promise.all(
    liste.data.map(async (moteur) => {
      if (!moteur.chemin) return { moteur, compte: null, modeles: null, erreur: null };
      const [compte, modeles] = await Promise.all([bridge.compte(moteur.id), moteur.id === "claude" ? null : bridge.modeles(moteur.id)]);
      return {
        moteur,
        compte: compte.ok ? compte.data : null,
        modeles: modeles?.ok ? modeles.data : null,
        erreur: !compte.ok ? compte.message : modeles && !modeles.ok ? modeles.message : null,
      };
    }),
  );
  etat = suivant;
  signaler();
}

/** Relit les moteurs (après une connexion, une installation). */
export function actualiserMoteurs(): Promise<void> {
  lecture = lire().finally(() => (lecture = null));
  return lecture;
}

export function useMoteurs(): { moteurs: EtatMoteur[] | null; actualiser: () => Promise<void> } {
  const moteurs = useSyncExternalStore(
    (f) => {
      abonnes.add(f);
      return () => abonnes.delete(f);
    },
    () => etat,
    () => null,
  );
  useEffect(() => {
    if (!etat && !lecture) void actualiserMoteurs();
  }, []);
  const actualiser = useCallback(() => actualiserMoteurs(), []);
  return { moteurs, actualiser };
}

/** Un moteur prêt à répondre : installé et connecté. */
export const pret = (m: EtatMoteur) => !!m.moteur.chemin && !!m.compte?.connecte;
