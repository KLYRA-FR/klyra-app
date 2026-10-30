"use client";

import { useConvex, useConvexConnectionState } from "convex/react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { FunctionReference } from "convex/server";
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

export function BibliothequeProvider({ children }: { children: ReactNode }) {
  const compte = useCompte();
  if (compte.etat === "connecte" && compte.moi) {
    /* Une session = un fournisseur neuf : rien de la précédente ne survit, même un instant. */
    return (
      <BibliothequeConnectee key={compte.moi._id} moiId={compte.moi._id}>
        {children}
      </BibliothequeConnectee>
    );
  }
  const etat: EtatBibliotheque =
    compte.etat === "indisponible" ? "indisponible" : compte.etat === "retire" ? "retire" : compte.etat === "chargement" ? "chargement" : "deconnecte";
  return <BibliothequeContext.Provider value={nonDisponible(etat)}>{children}</BibliothequeContext.Provider>;
}

type Abonnement<T> = { valeur: T | undefined; erreur: unknown };

/** Une requête suivie en direct, sans faire tomber l'écran sur une erreur du serveur. */
function useAbonnement<Q extends FunctionReference<"query">>(requete: Q, args: Q["_args"] | null, tour: number): Abonnement<Q["_returnType"]> {
  const convex = useConvex();
  const [r, setR] = useState<Abonnement<Q["_returnType"]>>({ valeur: undefined, erreur: null });
  const cle = args === null ? null : JSON.stringify(args);
  useEffect(() => {
    if (cle === null) return;
    const suivi = convex.watchQuery(requete, JSON.parse(cle) as Q["_args"]);
    const lire = () => {
      try {
        setR({ valeur: suivi.localQueryResult(), erreur: null });
      } catch (e) {
        setR({ valeur: undefined, erreur: e });
      }
    };
    lire();
    return suivi.onUpdate(lire);
  }, [convex, requete, cle, tour]);
  return cle === null ? { valeur: undefined, erreur: null } : r;
}

function BibliothequeConnectee({ moiId, children }: { moiId: Id<"membres">; children: ReactNode }) {
  const convex = useConvex();
  const connexion = useConvexConnectionState();
  const { mes } = useAgents();
  const [tour, setTour] = useState(0);
  const [patience, setPatience] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setPatience(true), 4000);
    return () => clearTimeout(t);
  }, []);

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

  const horsLigne = !connexion.isWebSocketConnected && (connexion.hasEverConnected || patience);
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
  return <BibliothequeContext.Provider value={api_}>{children}</BibliothequeContext.Provider>;
}

export function useBibliotheque(): BibliothequeApi {
  return useContext(BibliothequeContext);
}
