"use client";

import { useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { rangDansLApp } from "@/lib/telephone/retour";

/**
 * Le retour du téléphone (socle § 2.5, C-3) : « ‹ » fait comme le retour du système. La coque
 * numérote chaque entrée d'historique posée dans l'app (`history.state.klyraIdx`) : une page ouverte
 * depuis l'app revient en arrière ; ouverte par un lien ou une notification, elle va à son parent.
 */

type Poser = History["pushState"];

/** Le rang de l'entrée affichée, suivi à chaque entrée posée et à chaque retour (sens d'un retour). */
let rangActuel = 0;

/** Les feuilles ouvertes, par l'entrée d'historique qu'elles ont posée (§ 2.5). */
const feuillesOuvertes = new Set<string>();
export function marquerFeuille(id: string, ouverte: boolean) {
  if (ouverte) feuillesOuvertes.add(id);
  else feuillesOuvertes.delete(id);
}

/**
 * Posé une fois par la coque : chaque `pushState` (navigation de Next, lien, `router.push`) reçoit le
 * rang suivant, chaque `replaceState` garde le rang de l'entrée. Les données de Next sont gardées telles
 * quelles. L'app de bureau n'a pas cette coque.
 */
export function useNumeroterNavigation() {
  useEffect(() => {
    const historique = window.history;
    const pousser = historique.pushState;
    const remplacer = historique.replaceState;
    const avecRang = (data: unknown, rang: number) => (typeof data === "object" && data !== null ? { ...data, klyraIdx: rang } : { klyraIdx: rang });
    const nosPoser: Poser = function pushState(data, inutilise, url) {
      rangActuel = rangDansLApp(historique.state) + 1;
      return pousser.call(historique, avecRang(data, rangActuel), inutilise, url);
    };
    const nosRemplacer: Poser = function replaceState(data, inutilise, url) {
      rangActuel = rangDansLApp(historique.state);
      return remplacer.call(historique, avecRang(data, rangActuel), inutilise, url);
    };
    historique.pushState = nosPoser;
    historique.replaceState = nosRemplacer;
    /* Un rang restauré ne prouve pas qu'une page de cette ouverture précède l'entrée courante. */
    rangActuel = 0;
    remplacer.call(historique, avecRang(historique.state, 0), "");
    /* L'entrée d'une feuille fermée par une navigation reste dans l'historique : un retour la saute. */
    const surRetour = () => {
      const etat = historique.state as { klyraFeuille?: unknown } | null;
      const rang = rangDansLApp(etat);
      const recul = rang < rangActuel;
      rangActuel = rang;
      if (typeof etat?.klyraFeuille === "string" && !feuillesOuvertes.has(etat.klyraFeuille)) {
        if (recul) historique.back();
        else historique.forward();
      }
    };
    window.addEventListener("popstate", surRetour);
    return () => {
      window.removeEventListener("popstate", surRetour);
      /* Next a pu poser les siens par-dessus : on ne les retire jamais. */
      if (historique.pushState === nosPoser) historique.pushState = pousser;
      if (historique.replaceState === nosRemplacer) historique.replaceState = remplacer;
    };
  }, []);
}

/** « ‹ » d'une page poussée : en arrière s'il y a une page de l'app avant, sinon vers `parent`. */
export function useRetour(parent: string): () => void {
  const router = useRouter();
  return useCallback(() => {
    if (rangDansLApp(window.history.state) > 0 && window.history.length > 1) router.back();
    else router.replace(parent);
  }, [router, parent]);
}
