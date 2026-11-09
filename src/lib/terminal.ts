"use client";

import { useEffect, useState } from "react";
import { getBridge, type TerminalAgent } from "@/lib/bridge";

/**
 * Les terminaux interactifs des agents d'une conversation, vus de l'écran (onglet Terminal du panneau) :
 * relus toutes les `RELECTURE_LISTE_MS` tant que le panneau est monté, sur ce PC ou sur le VPS de la
 * conversation (`lieu`). La sortie, elle, se relit dans `VueTerminal`, seulement quand l'onglet est affiché.
 */

export const RELECTURE_LISTE_MS = 2000;
export const RELECTURE_FLUX_MS = 150;

const VIDE: TerminalAgent[] = [];

export function useTerminauxChat(chatId: string, lieu: string | null): TerminalAgent[] {
  const [liste, setListe] = useState<TerminalAgent[]>(VIDE);
  useEffect(() => {
    const pont = getBridge()?.terminal;
    if (!pont) return;
    let actif = true;
    const relire = () =>
      void pont.lister(chatId, lieu).then((r) => {
        if (!actif || !r.ok) return;
        setListe((avant) => (memeListe(avant, r.data) ? avant : r.data));
      });
    relire();
    const minuterie = setInterval(relire, RELECTURE_LISTE_MS);
    return () => {
      actif = false;
      clearInterval(minuterie);
    };
  }, [chatId, lieu]);
  return liste;
}

/** Deux listes identiques (même ordre, mêmes états) : pas de rendu de plus. */
export function memeListe(a: readonly TerminalAgent[], b: readonly TerminalAgent[]): boolean {
  return a.length === b.length && a.every((s, i) => s.id === b[i].id && s.fini === b[i].fini && s.code === b[i].code && s.titre === b[i].titre);
}

/** Le terminal à montrer : celui choisi s'il existe encore, sinon le plus récent qui tourne, sinon le plus récent. */
export function terminalAffiche(liste: readonly TerminalAgent[], choisi: string | null): TerminalAgent | null {
  const trouve = choisi ? liste.find((s) => s.id === choisi) : undefined;
  if (trouve) return trouve;
  const recents = [...liste].sort((a, b) => b.ouvertLe - a.ouvertLe);
  return recents.find((s) => !s.fini) ?? recents[0] ?? null;
}

/** L'état d'un terminal en mots, pour la personne. */
export function etatTerminal(s: TerminalAgent): string {
  if (!s.fini) return "En cours";
  return s.code === null || s.code === 0 ? "Terminé" : `Terminé (code ${s.code})`;
}
