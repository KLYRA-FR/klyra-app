"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { getBridge, type OngletNavigateur } from "@/lib/bridge";

/**
 * Le navigateur de KLYRA vu de l'écran : les onglets tenus par le process
 * principal (electron/navigateur/), suivis en direct. Un seul abonnement pour
 * toute l'app ; chaque conversation lit les siens.
 */

let onglets: OngletNavigateur[] = [];
let branche = false;
const abonnes = new Set<() => void>();

function brancher(): void {
  const pont = getBridge()?.navigateur;
  if (branche || !pont) return;
  branche = true;
  const publier = (etat: OngletNavigateur[]) => {
    onglets = etat;
    abonnes.forEach((f) => f());
  };
  pont.onEtat(publier);
  void pont.etat().then((r) => r.ok && publier(r.data));
}

function abonner(f: () => void): () => void {
  brancher();
  abonnes.add(f);
  return () => abonnes.delete(f);
}

const VIDE: OngletNavigateur[] = [];

/** Tous les onglets (toutes conversations). */
export function useOngletsNavigateur(): OngletNavigateur[] {
  return useSyncExternalStore(abonner, () => onglets, () => VIDE);
}

/** Les onglets d'une conversation, du plus ancien au plus récent. */
export function useOngletsChat(chatId: string): OngletNavigateur[] {
  const tous = useOngletsNavigateur();
  return useMemo(() => tous.filter((o) => o.chatId === chatId).sort((a, b) => a.creeLe - b.creeLe), [tous, chatId]);
}

/** Un agent utilise-t-il un onglet de cette conversation, ou attend-il la personne ? (pastille de l'onglet du panneau) */
export function useActiviteNavigateur(chatId: string): "pilote" | "attente" | null {
  const liste = useOngletsChat(chatId);
  if (liste.some((o) => o.main?.type === "demandee")) return "attente";
  return liste.some((o) => o.pilote) ? "pilote" : null;
}

/* L'onglet ouvert dans le panneau de chaque conversation, le temps de la session de l'app. */
const vus = new Map<string, string | null>();
const abonnesVus = new Set<() => void>();

export function useOngletVu(chatId: string): [string | null, (id: string | null) => void] {
  const vu = useSyncExternalStore(
    (f) => {
      abonnesVus.add(f);
      return () => abonnesVus.delete(f);
    },
    () => vus.get(chatId) ?? null,
    () => null,
  );
  const choisir = useMemo(
    () => (id: string | null) => {
      vus.set(chatId, id);
      abonnesVus.forEach((f) => f());
    },
    [chatId],
  );
  return [vu, choisir];
}

/** Ce qui se pose au-dessus du panneau (fenêtre, menu, liste) : la page native, toujours au premier plan, doit s'effacer. */
export const RECOUVREMENTS = '[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"],[data-flottant]';

/**
 * Place la page de l'onglet sur l'élément `zone` : son cadre suivi à chaque
 * image (la fenêtre, le panneau et sa poignée bougent sans prévenir), effacée
 * quand quelque chose la recouvrirait, retirée quand le composant s'en va.
 */
export function usePlacementOnglet(id: string | null, zone: React.RefObject<HTMLElement | null>): boolean {
  const pont = getBridge()?.navigateur;
  const recouvert = useSyncExternalStore(abonnerRecouvrement, lireRecouvrement, () => false);
  useEffect(() => {
    if (!pont || !id) return;
    let dernier = "";
    let image = 0;
    const suivre = () => {
      const el = zone.current;
      const cache = !el || document.visibilityState === "hidden" || lireRecouvrement();
      const r = el?.getBoundingClientRect();
      const cadre = !cache && r && r.width > 2 && r.height > 2 ? { x: r.left, y: r.top, width: r.width, height: r.height } : null;
      const cle = cadre ? `${id}:${Math.round(cadre.x)}:${Math.round(cadre.y)}:${Math.round(cadre.width)}:${Math.round(cadre.height)}` : "aucun";
      if (cle !== dernier) {
        dernier = cle;
        void pont.afficher(cadre ? id : null, cadre);
      }
      image = requestAnimationFrame(suivre);
    };
    image = requestAnimationFrame(suivre);
    return () => {
      cancelAnimationFrame(image);
      void pont.afficher(null, null);
    };
  }, [pont, id, zone]);
  return recouvert;
}

/* Le recouvrement, relu quand le DOM change : la vignette remplace la page tant qu'il dure. */
let recouvre = false;
const abonnesRecouvrement = new Set<() => void>();
let observateur: MutationObserver | null = null;
function lireRecouvrement(): boolean {
  return typeof document !== "undefined" && !!document.querySelector(RECOUVREMENTS);
}
function abonnerRecouvrement(f: () => void): () => void {
  abonnesRecouvrement.add(f);
  if (!observateur && typeof MutationObserver !== "undefined") {
    observateur = new MutationObserver(() => {
      const maintenant = lireRecouvrement();
      if (maintenant === recouvre) return;
      recouvre = maintenant;
      abonnesRecouvrement.forEach((g) => g());
    });
    observateur.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["role", "data-flottant"] });
  }
  return () => {
    abonnesRecouvrement.delete(f);
    if (!abonnesRecouvrement.size) {
      observateur?.disconnect();
      observateur = null;
    }
  };
}

/** Le site d'une adresse, pour une carte. */
export function siteDe(url: string): string {
  try {
    const u = new URL(url);
    return u.host.replace(/^www\./, "") || url;
  } catch {
    return url;
  }
}
