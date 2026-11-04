"use client";

import { useConvex } from "convex/react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useAbonnement } from "@/lib/bibliotheque";
import { messageErreur, useCompte, useSocketOuvert } from "@/lib/compte";

/**
 * Les artefacts de l'équipe dans l'interface (cf. `convex/artefactsEquipe.ts`), comme la Bibliothèque KLYRA :
 * seulement pour la session en cours d'un membre actif (chaque réponse dit pour qui elle a été lue : `pour`),
 * tout en mémoire, jamais sur le disque. Monté par l'écran Artefacts : rien n'est suivi ailleurs.
 */

export type EtatArtefactsEquipe = "indisponible" | "deconnecte" | "retire" | "chargement" | "hors-ligne" | "pret" | "erreur";

export interface ArtefactEquipe {
  _id: string;
  url: string;
  titre: string;
  description: string;
  majLe: number;
  auteur: { nom: string; couleur: string; actif: boolean };
  /** La session en cours l'a partagé, d'après le serveur. */
  deMoi: boolean;
}

interface ArtefactsEquipeApi {
  etat: EtatArtefactsEquipe;
  /** Vide hors de l'état « pret ». */
  artefacts: ArtefactEquipe[];
  message: string | null;
  reessayer: () => void;
  partager: (a: { url: string; titre: string; description: string }) => Promise<void>;
  modifier: (artefactId: string, a: { titre: string; description: string }) => Promise<void>;
  retirer: (artefactId: string) => Promise<void>;
}

const nonDisponible = (etat: EtatArtefactsEquipe): ArtefactsEquipeApi => ({
  etat,
  artefacts: [],
  message: null,
  reessayer: () => {},
  partager: async () => {
    throw new Error("Connecte-toi à ton compte d’équipe pour partager.");
  },
  modifier: async () => {
    throw new Error("Connecte-toi à ton compte d’équipe.");
  },
  retirer: async () => {
    throw new Error("Connecte-toi à ton compte d’équipe.");
  },
});

const ArtefactsEquipeContext = createContext<ArtefactsEquipeApi>(nonDisponible("indisponible"));

/* Même construction que `BibliothequeProvider` : la partie liée à la session est un composant sans rendu,
   à côté des enfants, remonté à chaque changement de compte. */
export function ArtefactsEquipeProvider({ children }: { children: ReactNode }) {
  const compte = useCompte();
  const [publiee, setPubliee] = useState<{ moiId: string; api: ArtefactsEquipeApi } | null>(null);
  const moiId = compte.etat === "connecte" ? (compte.moi?._id ?? null) : null;
  const etat: EtatArtefactsEquipe =
    compte.etat === "indisponible" ? "indisponible" : compte.etat === "retire" ? "retire" : compte.etat === "connecte" || compte.etat === "chargement" ? "chargement" : "deconnecte";
  const valeur = useMemo(() => (moiId && publiee?.moiId === moiId ? publiee.api : nonDisponible(etat)), [moiId, publiee, etat]);
  return (
    <ArtefactsEquipeContext.Provider value={valeur}>
      {moiId && <ArtefactsEquipeConnectes key={moiId} moiId={moiId as Id<"membres">} surValeur={setPubliee} />}
      {children}
    </ArtefactsEquipeContext.Provider>
  );
}

function ArtefactsEquipeConnectes({ moiId, surValeur }: { moiId: Id<"membres">; surValeur: (v: { moiId: string; api: ArtefactsEquipeApi }) => void }) {
  const convex = useConvex();
  const connecte = useSocketOuvert();
  const [tour, setTour] = useState(0);
  /* Hors ligne seulement après 2,5 s sans connexion, comme la bibliothèque. */
  const [horsLigne, setHorsLigne] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setHorsLigne(!connecte), connecte ? 0 : 2500);
    return () => clearTimeout(t);
  }, [connecte]);

  const liste = useAbonnement(api.artefactsEquipe.lister, {}, tour);
  const valeur = liste.valeur && liste.valeur.pour === moiId ? liste.valeur.artefacts : undefined;
  const etat: EtatArtefactsEquipe = liste.erreur ? "erreur" : horsLigne ? "hors-ligne" : valeur ? "pret" : "chargement";
  const reessayer = useCallback(() => setTour((t) => t + 1), []);

  const api_ = useMemo<ArtefactsEquipeApi>(() => {
    const envoyer = async (f: () => Promise<unknown>) => {
      try {
        await f();
      } catch (e) {
        /* L'erreur d'origine reste en `cause` : l'écran y lit le code (`deja_partage`). */
        throw new Error(messageErreur(e), { cause: e });
      }
    };
    return {
      etat,
      artefacts: etat === "pret" ? (valeur ?? []) : [],
      message: liste.erreur ? messageErreur(liste.erreur) : null,
      reessayer,
      partager: (a) => envoyer(() => convex.mutation(api.artefactsEquipe.partager, a)),
      modifier: (artefactId, a) => envoyer(() => convex.mutation(api.artefactsEquipe.modifier, { artefactId: artefactId as Id<"artefactsEquipe">, ...a })),
      retirer: (artefactId) => envoyer(() => convex.mutation(api.artefactsEquipe.retirer, { artefactId: artefactId as Id<"artefactsEquipe"> })),
    };
  }, [etat, valeur, liste.erreur, reessayer, convex]);
  useEffect(() => surValeur({ moiId, api: api_ }), [api_, moiId, surValeur]);
  return null;
}

export function useArtefactsEquipe(): ArtefactsEquipeApi {
  return useContext(ArtefactsEquipeContext);
}
