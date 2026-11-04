"use client";

import { useConvex } from "convex/react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useAbonnement } from "@/lib/bibliotheque";
import { getBridge } from "@/lib/bridge";
import { messageErreur, useCompte, useSocketOuvert } from "@/lib/compte";
import { useLieuActif } from "@/lib/lieux";
import { agentPartageable } from "@/lib/rendus-espace";

/**
 * Les documents HTML partagés avec l'équipe (cf. `convex/documentsKlyra.ts`).
 * Un document privé n'est pas ici : il reste dans son espace. La ligne Convex naît au partage.
 * La liste est celle de l'espace actif. Rien n'est gardé sur le disque.
 */

export type EtatDocuments = "indisponible" | "deconnecte" | "retire" | "chargement" | "hors-ligne" | "pret" | "erreur";

export interface DocumentKlyra {
  _id: string;
  titre: string;
  description: string;
  agent: string | null;
  lieu: string | null;
  /** Le chemin d'origine, pour l'auteur seulement. */
  origine: string | null;
  taille: number;
  version: number;
  majLe: number;
  auteur: { nom: string; couleur: string; actif: boolean };
  deMoi: boolean;
}

export interface EspaceCompte {
  octets: number;
  nombre: number;
  complet: boolean;
}

/** D'où lire le HTML : la copie locale, ou le livrable du VPS servi par le serveur. */
export interface SourcePartage {
  chemin: string;
  distant: { lieu: string; id: string; dossier: boolean } | null;
  titre: string;
  description: string;
  origine: string;
  agent: string | null;
}

interface DocumentsKlyraApi {
  etat: EtatDocuments;
  documents: DocumentKlyra[];
  espace: EspaceCompte | null;
  message: string | null;
  reessayer: () => void;
  partager: (source: SourcePartage) => Promise<void>;
  reprendre: (documentId: string) => Promise<void>;
  supprimer: (documentId: string) => Promise<void>;
  /** Ouvre la page dans la fenêtre isolée. L'écran ne reçoit pas l'adresse de stockage. */
  ouvrir: (documentId: string, titre: string) => Promise<void>;
  /** Vignette PNG (data URL), ou null si elle n'a pas pu être dessinée. */
  vignette: (documentId: string, majLe: number, forcer: boolean) => Promise<string | null>;
}

const nonDisponible = (etat: EtatDocuments): DocumentsKlyraApi => ({
  etat,
  documents: [],
  espace: null,
  message: null,
  reessayer: () => {},
  partager: async () => {
    throw new Error("Connecte-toi à ton compte d’équipe pour partager.");
  },
  reprendre: async () => {
    throw new Error("Connecte-toi à ton compte d’équipe.");
  },
  supprimer: async () => {
    throw new Error("Connecte-toi à ton compte d’équipe.");
  },
  ouvrir: async () => {
    throw new Error("Connecte-toi à ton compte d’équipe.");
  },
  vignette: async () => null,
});

const DocumentsKlyraContext = createContext<DocumentsKlyraApi>(nonDisponible("indisponible"));

export function DocumentsKlyraProvider({ children }: { children: ReactNode }) {
  const compte = useCompte();
  const lieu = useLieuActif();
  const [publiee, setPubliee] = useState<{ cle: string; api: DocumentsKlyraApi } | null>(null);
  const moiId = compte.etat === "connecte" ? (compte.moi?._id ?? null) : null;
  const cle = moiId ? `${moiId}\0${lieu ?? ""}` : null;
  const etat: EtatDocuments =
    compte.etat === "indisponible" ? "indisponible" : compte.etat === "retire" ? "retire" : compte.etat === "connecte" || compte.etat === "chargement" ? "chargement" : "deconnecte";
  const valeur = useMemo(() => (cle && publiee?.cle === cle ? publiee.api : nonDisponible(etat)), [cle, publiee, etat]);
  return (
    <DocumentsKlyraContext.Provider value={valeur}>
      {moiId && cle && <DocumentsConnectes key={cle} moiId={moiId as Id<"membres">} lieu={lieu} cle={cle} surValeur={setPubliee} />}
      {children}
    </DocumentsKlyraContext.Provider>
  );
}

function octetsDe(base64: string): Uint8Array {
  const binaire = atob(base64);
  const bytes = new Uint8Array(binaire.length);
  for (let i = 0; i < binaire.length; i++) bytes[i] = binaire.charCodeAt(i);
  return bytes;
}

function DocumentsConnectes({
  moiId,
  lieu,
  cle,
  surValeur,
}: {
  moiId: Id<"membres">;
  lieu: string | null;
  cle: string;
  surValeur: (v: { cle: string; api: DocumentsKlyraApi }) => void;
}) {
  const convex = useConvex();
  const connecte = useSocketOuvert();
  const [tour, setTour] = useState(0);
  const [horsLigne, setHorsLigne] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setHorsLigne(!connecte), connecte ? 0 : 2500);
    return () => clearTimeout(t);
  }, [connecte]);

  const liste = useAbonnement(api.documentsKlyra.lister, { lieu }, tour);
  const bilan = useAbonnement(api.documentsKlyra.espace, {}, tour);
  const documents = liste.valeur && liste.valeur.pour === moiId && liste.valeur.lieu === lieu ? liste.valeur.documents : undefined;
  const espace = bilan.valeur;
  const erreur = liste.erreur ?? bilan.erreur;
  const etat: EtatDocuments = erreur ? "erreur" : horsLigne ? "hors-ligne" : documents && espace ? "pret" : "chargement";
  const reessayer = useCallback(() => setTour((t) => t + 1), []);

  const lireHtml = useCallback(
    async (documentId: string) => {
      let recu: { html: string };
      try {
        recu = await convex.action(api.documentsKlyra.contenu, { documentId: documentId as Id<"documentsKlyra">, lieu });
      } catch (e) {
        throw new Error(messageErreur(e), { cause: e });
      }
      if (typeof recu.html !== "string") throw new Error("Le document n’a pas pu être lu.");
      return recu.html;
    },
    [convex, lieu],
  );
  const ouvrir = useCallback(
    async (documentId: string, titre: string) => {
      const html = await lireHtml(documentId);
      const bridge = getBridge();
      if (!bridge?.documents?.ouvrir) throw new Error("L’ouverture marche dans l’app de bureau.");
      const r = await bridge.documents.ouvrir(html, titre);
      if (!r.ok) throw new Error(r.message);
    },
    [lireHtml],
  );
  const vignette = useCallback(
    async (documentId: string, majLe: number, forcer: boolean) => {
      const bridge = getBridge();
      if (!bridge?.documents?.vignette) return null;
      const html = await lireHtml(documentId);
      const r = await bridge.documents.vignette(`${documentId}:${majLe}`, html, forcer);
      return r.ok ? r.data : null;
    },
    [lireHtml],
  );

  const api_ = useMemo<DocumentsKlyraApi>(() => {
    const envoyer = async (f: () => Promise<unknown>) => {
      try {
        await f();
      } catch (e) {
        throw new Error(messageErreur(e), { cause: e });
      }
    };
    return {
      etat,
      documents: etat === "pret" ? (documents ?? []) : [],
      espace: etat === "pret" && espace ? espace : null,
      message: erreur ? messageErreur(erreur) : null,
      reessayer,
      partager: async (source) => {
        const bridge = getBridge();
        const lecture = source.distant
          ? bridge?.rendus.lireHtmlVps?.(source.distant.lieu, source.distant.id, source.distant.dossier)
          : bridge?.rendus.lireHtml?.(source.chemin);
        if (!lecture) throw new Error("Le partage marche dans l’app de bureau.");
        const lu = await lecture;
        if (!lu.ok) throw new Error(lu.message);
        const bytes = octetsDe(lu.data);
        let adresse: string;
        try {
          adresse = await convex.mutation(api.documentsKlyra.preparerDepot, {});
        } catch (e) {
          throw new Error(messageErreur(e), { cause: e });
        }
        const reponse = await fetch(adresse, {
          method: "POST",
          headers: { "Content-Type": "text/html" },
          body: new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], { type: "text/html" }),
        });
        if (!reponse.ok) throw new Error("Le document n’a pas pu partir vers le compte. Réessaie.");
        const { storageId } = (await reponse.json()) as { storageId: Id<"_storage"> };
        await envoyer(() =>
          convex.mutation(api.documentsKlyra.partager, {
            fichier: storageId,
            titre: source.titre,
            description: source.description,
            origine: source.origine,
            agent: agentPartageable(source.agent),
            lieu,
          }),
        );
      },
      reprendre: (documentId) => envoyer(() => convex.mutation(api.documentsKlyra.reprendre, { documentId: documentId as Id<"documentsKlyra">, lieu })),
      supprimer: (documentId) => envoyer(() => convex.mutation(api.documentsKlyra.supprimer, { documentId: documentId as Id<"documentsKlyra">, lieu })),
      ouvrir,
      vignette,
    };
  }, [etat, documents, espace, erreur, reessayer, convex, lieu, ouvrir, vignette]);
  useEffect(() => surValeur({ cle, api: api_ }), [api_, cle, surValeur]);
  return null;
}

export function useDocumentsKlyra(): DocumentsKlyraApi {
  return useContext(DocumentsKlyraContext);
}
