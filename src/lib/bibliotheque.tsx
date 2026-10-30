"use client";

import { useConvex } from "convex/react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getFunctionName, makeFunctionReference, type FunctionReference } from "convex/server";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { Dependance } from "../../convex/model/definitions";
import { useAgents } from "@/lib/agents";
import { messageErreur, useCompte } from "@/lib/compte";

/**
 * La Bibliothèque KLYRA dans l'interface (cf. `convex/bibliotheque.ts`).
 * - Seulement pour la session en cours d'un membre actif : déconnecté, retiré ou sous un autre compte,
 *   rien de la session précédente ne s'affiche (chaque réponse dit pour qui elle a été lue : `pour`).
 * - Tout reste en mémoire : jamais de cache sur le disque.
 * - Hors ligne : les agents déjà ajoutés marchent ; la bibliothèque attend le réseau.
 */

export type EtatBibliotheque = "indisponible" | "deconnecte" | "retire" | "chargement" | "hors-ligne" | "pret" | "erreur";

export interface DefinitionResume {
  _id: string;
  slug: string;
  nom: string;
  role: string;
  description: string;
  capacites: string[];
  modele: string | null;
  dependances: Dependance[];
  version: number;
  majLe: number;
  auteur: { nom: string; couleur: string; actif: boolean };
  /** La session en cours en est l'autrice, d'après le serveur. */
  deMoi: boolean;
}

export interface DefinitionComplete extends DefinitionResume {
  contenu: string;
}

/** Où en est la définition d'un agent de cet ordinateur, pour la session en cours. */
export interface EtatDefinition {
  _id: string;
  version: number;
  majLe: number;
  retiree: boolean;
  deMoi: boolean;
}

export interface PublicationEnvoyee {
  contenu: string;
  role: string;
  dependances: Dependance[];
}

interface BibliothequeApi {
  etat: EtatBibliotheque;
  /** Le membre de la session en cours ; null sans session vérifiée. */
  moiId: string | null;
  /** Les définitions partagées (vide hors de l'état « pret »). */
  definitions: DefinitionResume[];
  /** Les définitions d'où viennent les agents ajoutés sous ce compte, et celles qu'il a publiées. */
  etats: Map<string, EtatDefinition>;
  message: string | null;
  reessayer: () => void;
  lire: (definitionId: string) => Promise<DefinitionComplete | null>;
  publier: (p: PublicationEnvoyee) => Promise<string>;
  mettreAJour: (definitionId: string, versionAttendue: number, p: PublicationEnvoyee) => Promise<number>;
  retirer: (definitionId: string) => Promise<void>;
}

const nonDisponible = (etat: EtatBibliotheque): BibliothequeApi => ({
  etat,
  moiId: null,
  definitions: [],
  etats: new Map(),
  message: null,
  reessayer: () => {},
  lire: async () => null,
  publier: async () => {
    throw new Error("Connecte-toi à ton compte d’équipe pour partager.");
  },
  mettreAJour: async () => {
    throw new Error("Connecte-toi à ton compte d’équipe pour publier.");
  },
  retirer: async () => {
    throw new Error("Connecte-toi à ton compte d’équipe.");
  },
});

const BibliothequeContext = createContext<BibliothequeApi>(nonDisponible("indisponible"));

/*
 * Les enfants ne changent jamais de place dans l'arbre (sinon toute l'app serait remontée à chaque
 * connexion) : la partie liée à la session est un composant sans rendu, à côté, qui publie sa valeur.
 * Une valeur ne sert que pour la session qui l'a produite : sous un autre compte, rien ne s'affiche.
 */
export function BibliothequeProvider({ children }: { children: ReactNode }) {
  const compte = useCompte();
  const [publiee, setPubliee] = useState<BibliothequeApi | null>(null);
  const moiId = compte.etat === "connecte" ? (compte.moi?._id ?? null) : null;
  const etat: EtatBibliotheque =
    compte.etat === "indisponible" ? "indisponible" : compte.etat === "retire" ? "retire" : compte.etat === "connecte" || compte.etat === "chargement" ? "chargement" : "deconnecte";
  const valeur = useMemo(() => (moiId && publiee?.moiId === moiId ? publiee : nonDisponible(etat)), [moiId, publiee, etat]);
  return (
    <BibliothequeContext.Provider value={valeur}>
      {/* Une session = une instance neuve : rien de la précédente ne survit. */}
      {moiId && <BibliothequeConnectee key={moiId} moiId={moiId as Id<"membres">} surValeur={setPubliee} />}
      {children}
    </BibliothequeContext.Provider>
  );
}

/**
 * Le socket avec le serveur est-il ouvert ? Un booléen, mis à jour seulement quand il change :
 * `useConvexConnectionState` rend un nouvel objet à chaque événement de connexion, et ses rendus
 * en continu empêchaient les navigations de l'app d'aboutir une fois connecté.
 */
function useSocketOuvert(): boolean {
  const convex = useConvex();
  const [ouvert, setOuvert] = useState(() => convex.connectionState().isWebSocketConnected);
  useEffect(() => {
    const lire = () => setOuvert(convex.connectionState().isWebSocketConnected);
    const arret = convex.subscribeToConnectionState(lire);
    lire();
    return arret;
  }, [convex]);
  return ouvert;
}

type Abonnement<T> = { valeur: T | undefined; erreur: unknown };

/**
 * Une requête suivie en direct, sans faire tomber l'écran sur une erreur du serveur. Repérée par son
 * nom, jamais par l'objet `api.x.y` : c'est un nouvel objet à chaque rendu, et l'abonnement serait
 * refait sans fin (l'app ne naviguait plus une fois connectée).
 */
function useAbonnement<Q extends FunctionReference<"query">>(requete: Q, args: Q["_args"] | null, tour: number): Abonnement<Q["_returnType"]> {
  const convex = useConvex();
  const [r, setR] = useState<Abonnement<Q["_returnType"]>>({ valeur: undefined, erreur: null });
  const nom = getFunctionName(requete);
  const cle = args === null ? null : JSON.stringify(args);
  useEffect(() => {
    if (cle === null) return;
    const suivi = convex.watchQuery(makeFunctionReference<"query">(nom) as Q, JSON.parse(cle) as Q["_args"]);
    const lire = () => {
      try {
        setR({ valeur: suivi.localQueryResult(), erreur: null });
      } catch (e) {
        setR({ valeur: undefined, erreur: e });
      }
    };
    lire();
    return suivi.onUpdate(lire);
  }, [convex, nom, cle, tour]);
  return cle === null ? { valeur: undefined, erreur: null } : r;
}

function BibliothequeConnectee({ moiId, surValeur }: { moiId: Id<"membres">; surValeur: (api: BibliothequeApi) => void }) {
  const convex = useConvex();
  const connecte = useSocketOuvert();
  const { mes } = useAgents();
  const [tour, setTour] = useState(0);
  /* Hors ligne seulement après 2,5 s sans connexion : la reconnexion qui suit une connexion au compte
     ne doit pas griser le partage un instant. */
  const [horsLigne, setHorsLigne] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setHorsLigne(!connecte), connecte ? 0 : 2500);
    return () => clearTimeout(t);
  }, [connecte]);

  const liste = useAbonnement(api.bibliotheque.lister, {}, tour);

  /* Seulement les définitions liées à ce compte : celles des agents qu'il a ajoutés ou publiés. */
  const ids = useMemo(() => {
    const trouves = new Set<string>();
    for (const e of Object.values(mes?.agents ?? {})) {
      const o = e.origine;
      if ((o.type === "bibliotheque" || o.type === "copie") && o.compte === moiId) trouves.add(o.definitionId);
      if (o.type === "local" && o.publie?.compte === moiId) trouves.add(o.publie.definitionId);
    }
    return [...trouves].sort();
  }, [mes, moiId]);
  const suivis = useAbonnement(api.bibliotheque.etats, ids.length ? { ids } : null, tour);

  const valeur = liste.valeur && liste.valeur.pour === moiId ? liste.valeur.definitions : undefined;
  const etat: EtatBibliotheque = liste.erreur ? "erreur" : horsLigne ? "hors-ligne" : valeur ? "pret" : "chargement";

  const etats = useMemo(() => {
    const m = new Map<string, EtatDefinition>();
    if (suivis.valeur && suivis.valeur.pour === moiId) for (const e of suivis.valeur.etats) m.set(e._id, e);
    for (const d of valeur ?? []) if (d.deMoi) m.set(d._id, { _id: d._id, version: d.version, majLe: d.majLe, retiree: false, deMoi: true });
    return m;
  }, [suivis.valeur, valeur, moiId]);

  const reessayer = useCallback(() => setTour((t) => t + 1), []);
  const traduire = (e: unknown) => new Error(messageErreur(e));

  const api_ = useMemo<BibliothequeApi>(
    () => ({
      etat,
      moiId,
      definitions: etat === "pret" ? (valeur ?? []) : [],
      etats,
      message: liste.erreur ? messageErreur(liste.erreur) : null,
      reessayer,
      lire: async (definitionId) => {
        try {
          const r = await convex.query(api.bibliotheque.lire, { definitionId });
          return r.pour === moiId ? r.definition : null;
        } catch (e) {
          throw traduire(e);
        }
      },
      publier: async (p) => {
        try {
          return await convex.mutation(api.bibliotheque.publier, p);
        } catch (e) {
          throw traduire(e);
        }
      },
      mettreAJour: async (definitionId, versionAttendue, p) => {
        try {
          return await convex.mutation(api.bibliotheque.mettreAJour, { definitionId: definitionId as Id<"definitionsAgents">, versionAttendue, ...p });
        } catch (e) {
          throw traduire(e);
        }
      },
      retirer: async (definitionId) => {
        try {
          await convex.mutation(api.bibliotheque.retirer, { definitionId: definitionId as Id<"definitionsAgents"> });
        } catch (e) {
          throw traduire(e);
        }
      },
    }),
    [etat, moiId, valeur, etats, liste.erreur, reessayer, convex],
  );
  useEffect(() => surValeur(api_), [api_, surValeur]);
  return null;
}

export function useBibliotheque(): BibliothequeApi {
  return useContext(BibliothequeContext);
}
