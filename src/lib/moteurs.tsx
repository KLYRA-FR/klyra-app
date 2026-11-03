"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { getBridge, type CompteClaude, type ModeleMoteur, type MoteurPoste } from "@/lib/bridge";

/**
 * Les moteurs d'une machine (ce poste, ou un VPS relié par son origine), leur compte et leurs modèles,
 * lus une fois et partagés par tous les écrans (choix rapide de la conversation, Réglages du serveur).
 * `actualiser` les relit.
 */

export interface EtatMoteur {
  moteur: MoteurPoste;
  compte: CompteClaude | null;
  /** null : pas encore lus (ou le moteur n'en annonce pas : Claude Code, cf. ChoixModele). */
  modeles: ModeleMoteur[] | null;
  erreur: string | null;
}

/** Par machine : "" pour ce poste, l'origine d'un VPS sinon. `erreur` : la machine n'a pas répondu. */
const etats = new Map<string, { moteurs: EtatMoteur[]; erreur: string | null }>();
const lectures = new Map<string, Promise<void>>();
const abonnes = new Set<() => void>();
const signaler = () => abonnes.forEach((f) => f());
const cleDe = (lieu?: string | null) => lieu || "";

async function lire(lieu: string | null): Promise<void> {
  const cle = cleDe(lieu);
  const bridge = getBridge()?.moteurs;
  if (!bridge) {
    etats.set(cle, { moteurs: [], erreur: null });
    return signaler();
  }
  const liste = await bridge.liste(lieu);
  if (!liste.ok) {
    etats.set(cle, { moteurs: [], erreur: liste.message });
    return signaler();
  }
  const suivant: EtatMoteur[] = await Promise.all(
    liste.data.map(async (moteur) => {
      if (!moteur.chemin) return { moteur, compte: null, modeles: null, erreur: null };
      const compte = await bridge.compte(moteur.id, lieu);
      // Les modèles de Codex demandent un compte connecté.
      const modeles = moteur.id === "claude" || !compte.ok || !compte.data.connecte ? null : await bridge.modeles(moteur.id, lieu);
      return {
        moteur,
        compte: compte.ok ? compte.data : null,
        modeles: modeles?.ok ? modeles.data : null,
        erreur: !compte.ok ? compte.message : modeles && !modeles.ok ? modeles.message : null,
      };
    }),
  );
  etats.set(cle, { moteurs: suivant, erreur: null });
  signaler();
}

/** Relit les moteurs d'une machine (après une connexion, une installation). */
export function actualiserMoteurs(lieu: string | null = null): Promise<void> {
  const cle = cleDe(lieu);
  const lecture = lire(lieu || null).finally(() => lectures.delete(cle));
  lectures.set(cle, lecture);
  return lecture;
}

/** `lieu` : l'origine d'un VPS relié ; absent : ce poste. */
export function useMoteurs(lieu: string | null = null): { moteurs: EtatMoteur[] | null; erreur: string | null; actualiser: () => Promise<void> } {
  const cle = cleDe(lieu);
  const etat = useSyncExternalStore(
    (f) => {
      abonnes.add(f);
      return () => abonnes.delete(f);
    },
    () => etats.get(cle) ?? null,
    () => null,
  );
  useEffect(() => {
    if (!etats.has(cle) && !lectures.has(cle)) void actualiserMoteurs(cle || null);
  }, [cle]);
  const actualiser = useCallback(() => actualiserMoteurs(cle || null), [cle]);
  return { moteurs: etat?.moteurs ?? null, erreur: etat?.erreur ?? null, actualiser };
}

/** Un moteur prêt à répondre : installé et connecté. */
export const pret = (m: EtatMoteur) => !!m.moteur.chemin && !!m.compte?.connecte;
