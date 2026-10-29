"use client";

import { ConvexAuthProvider, useAuthActions, type TokenStorage } from "@convex-dev/auth/react";
import { ConvexReactClient, useConvexAuth, useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { getBridge, type KlyraBridge } from "@/lib/bridge";

/**
 * Le compte d'équipe, en ligne sur Convex (cf. `docs/CONVEX-PLAN.md`) : connexion par
 * lien magique, puis l'équipe. Les jetons de session sont gardés par le trousseau du
 * système (electron/compte.ts). Dans un navigateur, sans l'app de bureau, il n'y a pas de compte.
 */

export type Role = "admin" | "membre";

export interface Membre {
  _id: Id<"membres">;
  email: string;
  nom: string;
  intitule: string;
  couleur: string;
  role: Role;
}

export interface Invitation {
  _id: Id<"invitations">;
  email: string;
  nom: string;
  role: Role;
}

type Etat = "indisponible" | "chargement" | "deconnecte" | "connecte" | "retire";

interface CompteApi {
  etat: Etat;
  moi: Membre | null;
  /** L'adresse à qui le dernier lien a été demandé, tant qu'il est valable. */
  adresseEnAttente: string | null;
  /** Une demande de lien ou une connexion est en cours. */
  occupe: boolean;
  erreur: string | null;
  demanderLien: (email: string) => Promise<boolean>;
  /** Le lien collé à la main (klyra://… ou la page relais), si l'app ne s'est pas ouverte. */
  ouvrirLienColle: (lien: string) => Promise<void>;
  oublierAdresse: () => void;
  seDeconnecter: () => Promise<void>;
}

const INDISPONIBLE: CompteApi = {
  etat: "indisponible",
  moi: null,
  adresseEnAttente: null,
  occupe: false,
  erreur: null,
  demanderLien: async () => false,
  ouvrirLienColle: async () => {},
  oublierAdresse: () => {},
  seDeconnecter: async () => {},
};

const CompteContext = createContext<CompteApi>(INDISPONIBLE);

/** Comme le serveur (`convex/model/valeurs.ts`) : sans espaces autour, en minuscules. */
export const normaliserEmail = (email: string) => email.trim().toLowerCase();

/** Le lien vaut 15 minutes (`DUREE_LIEN_MINUTES`) : l'adresse est oubliée ensuite. */
const DUREE_LIEN_MS = 15 * 60_000;
const CLE_ADRESSE = "klyra:compte:adresse";

function lireAdresse(): string | null {
  try {
    const brut = JSON.parse(localStorage.getItem(CLE_ADRESSE) ?? "null") as { email: string; le: number } | null;
    return brut && Date.now() - brut.le < DUREE_LIEN_MS ? brut.email : null;
  } catch {
    return null;
  }
}

function garderAdresse(email: string | null) {
  try {
    if (email) localStorage.setItem(CLE_ADRESSE, JSON.stringify({ email, le: Date.now() }));
    else localStorage.removeItem(CLE_ADRESSE);
  } catch {
    /* pas de stockage : l'adresse reste en mémoire */
  }
}

const MESSAGES: Record<string, string> = {
  non_connecte: "Ta session a pris fin : reconnecte-toi.",
  reserve_aux_admins: "Réservé aux admins de l’équipe.",
  adresse_invalide: "Cette adresse e-mail n’est pas valable.",
  nom_invalide: "Le nom doit faire entre 1 et 80 caractères.",
  couleur_invalide: "Cette couleur n’est pas dans la palette.",
  deja_membre: "Cette personne fait déjà partie de l’équipe.",
  deja_invitee: "Cette adresse est déjà invitée.",
  introuvable: "Cette personne ou cette invitation n’existe plus.",
  dernier_admin: "Il faut garder au moins un admin dans l’équipe.",
};

/** Le code d'erreur renvoyé par une fonction Convex (`convex/model/valeurs.ts`), ou null. */
function codeErreur(erreur: unknown): string | null {
  if (erreur instanceof ConvexError && typeof erreur.data === "string") return erreur.data;
  const message = erreur instanceof Error ? erreur.message : String(erreur);
  return Object.keys(MESSAGES).find((code) => message.includes(code)) ?? (message.includes("connexion_refusee") ? "connexion_refusee" : null);
}

export function messageErreur(erreur: unknown): string {
  const code = codeErreur(erreur);
  if (code && MESSAGES[code]) return MESSAGES[code];
  const message = erreur instanceof Error ? erreur.message : String(erreur);
  if (/Could not verify code|Invalid verification code/i.test(message)) {
    return "Ce lien n’est plus valable : déjà utilisé, expiré, ou demandé pour une autre adresse. Demande un nouveau lien.";
  }
  return "Le serveur de l’équipe ne répond pas. Vérifie la connexion, puis réessaie.";
}

/** Le code d'un lien de connexion : klyra://connexion?code=… ou la page relais https://…/connexion?code=…. */
export function codeDuLien(lien: string): string | null {
  try {
    const url = new URL(lien.trim());
    const relais = url.protocol === "https:" && url.hostname.endsWith(".convex.site") && url.pathname === "/connexion";
    const app = url.protocol === "klyra:" && url.hostname === "connexion";
    const code = url.searchParams.get("code");
    return (relais || app) && code && /^[A-Za-z0-9]{16,128}$/.test(code) ? code : null;
  } catch {
    return null;
  }
}

function stockageSysteme(pont: NonNullable<KlyraBridge["compte"]>): TokenStorage {
  return {
    getItem: async (cle) => {
      const r = await pont.lireJeton(cle);
      return r.ok ? r.data : null;
    },
    setItem: async (cle, valeur) => {
      await pont.ecrireJeton(cle, valeur);
    },
    removeItem: async (cle) => {
      await pont.retirerJeton(cle);
    },
  };
}

export function CompteProvider({ children }: { children: ReactNode }) {
  const pont = getBridge()?.compte;
  /* Une fois pour toute la vie de la fenêtre : l'adresse est connue dès le premier rendu. */
  const [client] = useState(() => (pont?.adresse ? new ConvexReactClient(pont.adresse) : null));
  const [stockage] = useState(() => (pont ? stockageSysteme(pont) : undefined));
  if (!client || !pont) return <CompteContext.Provider value={INDISPONIBLE}>{children}</CompteContext.Provider>;
  return (
    /* Le code n'arrive jamais dans l'adresse de la page : c'est le lien klyra:// qui l'apporte. */
    <ConvexAuthProvider client={client} storage={stockage} shouldHandleCode={false} replaceURL={() => {}}>
      <CompteConnecte pont={pont}>{children}</CompteConnecte>
    </ConvexAuthProvider>
  );
}

function CompteConnecte({ pont, children }: { pont: NonNullable<KlyraBridge["compte"]>; children: ReactNode }) {
  const router = useRouter();
  const { isLoading, isAuthenticated } = useConvexAuth();
  const { signIn, signOut } = useAuthActions();
  const moi = useQuery(api.equipe.moi, isAuthenticated ? {} : "skip");
  const [adresseEnAttente, setAdresseEnAttente] = useState<string | null>(() => lireAdresse());
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const oublierAdresse = useCallback(() => {
    garderAdresse(null);
    setAdresseEnAttente(null);
  }, []);

  const demanderLien = useCallback(
    async (saisie: string) => {
      const email = normaliserEmail(saisie);
      setErreur(null);
      setOccupe(true);
      try {
        await signIn("postshiba", { email });
      } catch (e) {
        /* Adresse ni invitée ni membre : le même message qu'un envoi, pour ne pas dire qui est dans l'équipe. */
        if (codeErreur(e) !== "connexion_refusee") {
          setErreur(messageErreur(e));
          return false;
        }
      } finally {
        setOccupe(false);
      }
      garderAdresse(email);
      setAdresseEnAttente(email);
      return true;
    },
    [signIn],
  );

  const ouvrirCode = useCallback(
    async (code: string) => {
      const email = lireAdresse();
      setErreur(null);
      if (!email) {
        setErreur("Ce lien a été demandé depuis un autre ordinateur, ou il y a plus de 15 minutes. Demande un nouveau lien ici.");
        return;
      }
      setOccupe(true);
      try {
        await signIn("postshiba", { email, code });
        oublierAdresse();
      } catch (e) {
        setErreur(messageErreur(e));
      } finally {
        setOccupe(false);
      }
    },
    [signIn, oublierAdresse],
  );

  /* Le lien de l'e-mail ouvre l'app (klyra://) : au lancement, puis à chaque lien. */
  const ouvrirRef = useRef(ouvrirCode);
  useEffect(() => {
    ouvrirRef.current = ouvrirCode;
  }, [ouvrirCode]);
  useEffect(() => {
    const prendre = async () => {
      const r = await pont.prendreCode();
      if (!r.ok || !r.data) return;
      router.push("/reglages?section=equipe");
      await ouvrirRef.current(r.data);
    };
    void prendre();
    return pont.onLien(() => void prendre());
  }, [pont, router]);

  const ouvrirLienColle = useCallback(
    async (lien: string) => {
      const code = codeDuLien(lien);
      if (!code) return setErreur("Ce n’est pas un lien de connexion KLYRA. Copie tout le lien de l’e-mail ou de la page qui s’est ouverte.");
      await ouvrirCode(code);
    },
    [ouvrirCode],
  );

  const seDeconnecter = useCallback(async () => {
    setErreur(null);
    await signOut();
  }, [signOut]);

  const etat: Etat = isLoading || (isAuthenticated && moi === undefined) ? "chargement" : !isAuthenticated ? "deconnecte" : moi ? "connecte" : "retire";

  const valeur = useMemo<CompteApi>(
    () => ({ etat, moi: moi ?? null, adresseEnAttente, occupe, erreur, demanderLien, ouvrirLienColle, oublierAdresse, seDeconnecter }),
    [etat, moi, adresseEnAttente, occupe, erreur, demanderLien, ouvrirLienColle, oublierAdresse, seDeconnecter],
  );
  return <CompteContext.Provider value={valeur}>{children}</CompteContext.Provider>;
}

export function useCompte(): CompteApi {
  return useContext(CompteContext);
}

/**
 * L'équipe et sa gestion. Seulement sous un compte connecté (`etat === "connecte"`) :
 * les invitations ne se lisent que par un admin.
 */
export function useEquipe(admin: boolean) {
  const membres = useQuery(api.equipe.membres, {});
  const invitations = useQuery(api.equipe.invitationsEnAttente, admin ? {} : "skip");
  const inviter = useMutation(api.equipe.inviter);
  const annulerInvitation = useMutation(api.equipe.annulerInvitation);
  const changerRole = useMutation(api.equipe.changerRole);
  const retirer = useMutation(api.equipe.retirer);
  const modifierMonProfil = useMutation(api.equipe.modifierMonProfil);
  return {
    membres: membres as Membre[] | undefined,
    invitations: invitations as Invitation[] | undefined,
    inviter,
    annulerInvitation,
    changerRole,
    retirer,
    modifierMonProfil,
  };
}
