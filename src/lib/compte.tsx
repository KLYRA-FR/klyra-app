"use client";

import { ConvexAuthProvider, useAuthActions, type TokenStorage } from "@convex-dev/auth/react";
import { ConvexReactClient, useConvexAuth, useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { PresenceKlyra } from "@/components/planning/PresenceKlyra";
import { getBridge, type KlyraBridge } from "@/lib/bridge";
import { ecartProfils, identiteValable, initialeDe } from "@/lib/identite";
import { useWorkspace } from "@/lib/workspace";

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
  /**
   * Quand un nouveau lien pourra être demandé (horloge de cet ordinateur, d'après l'attente
   * donnée par le serveur). Le serveur applique le délai lui-même : ce n'est qu'un affichage.
   */
  prochaineDemande: number | null;
  /** La dernière demande est arrivée pendant le délai : aucun nouveau lien n'est parti. */
  demandeRefusee: boolean;
  /** Une demande de lien ou une connexion est en cours. */
  occupe: boolean;
  erreur: string | null;
  demanderLien: (email: string) => Promise<boolean>;
  /** Le lien collé à la main (klyra://… ou la page relais), si l'app ne s'est pas ouverte. */
  ouvrirLienColle: (lien: string) => Promise<void>;
  oublierAdresse: () => void;
  seDeconnecter: () => Promise<void>;
  /** Ton profil d'équipe, sur le serveur (la session dit qui tu es). Sans couleur : on garde la tienne. */
  modifierMonProfil: (profil: { nom: string; intitule: string; couleur?: string }) => Promise<void>;
}

const INDISPONIBLE: CompteApi = {
  etat: "indisponible",
  moi: null,
  adresseEnAttente: null,
  prochaineDemande: null,
  demandeRefusee: false,
  occupe: false,
  erreur: null,
  demanderLien: async () => false,
  ouvrirLienColle: async () => {},
  oublierAdresse: () => {},
  seDeconnecter: async () => {},
  modifierMonProfil: async () => {
    throw new Error("non_connecte");
  },
};

const CompteContext = createContext<CompteApi>(INDISPONIBLE);

/** Comme le serveur (`convex/model/valeurs.ts`) : sans espaces autour, en minuscules. */
export const normaliserEmail = (email: string) => email.trim().toLowerCase();

/** Le lien vaut 15 minutes (`DUREE_LIEN_MINUTES`) : l'adresse est oubliée ensuite. */
const DUREE_LIEN_MS = 15 * 60_000;
const CLE_ADRESSE = "klyra:compte:adresse";

/** La dernière demande de lien : l'adresse, quand le lien est parti, quand en redemander un. Survit au redémarrage. */
interface Demande {
  email: string;
  le: number;
  prochaine: number;
}

function lireDemande(): Demande | null {
  try {
    const brut = JSON.parse(localStorage.getItem(CLE_ADRESSE) ?? "null") as Partial<Demande> | null;
    if (!brut?.email || typeof brut.le !== "number" || Date.now() - brut.le >= DUREE_LIEN_MS) return null;
    return { email: brut.email, le: brut.le, prochaine: typeof brut.prochaine === "number" ? brut.prochaine : 0 };
  } catch {
    return null;
  }
}

function garderDemande(demande: Demande | null) {
  try {
    if (demande) localStorage.setItem(CLE_ADRESSE, JSON.stringify(demande));
    else localStorage.removeItem(CLE_ADRESSE);
  } catch {
    /* pas de stockage : la demande reste en mémoire */
  }
}

/** « 42 s », « 56 min » : l'attente avant un nouveau lien. */
export function formaterAttente(ms: number): string {
  return ms < 60_000 ? `${Math.max(1, Math.ceil(ms / 1000))} s` : `${Math.ceil(ms / 60_000)} min`;
}

const MESSAGES: Record<string, string> = {
  non_connecte: "Ta session a pris fin : reconnecte-toi.",
  reserve_aux_admins: "Réservé aux admins de l’équipe.",
  adresse_invalide: "Cette adresse e-mail n’est pas valable.",
  nom_invalide: "Le nom doit faire entre 1 et 80 caractères, le rôle 80 au plus.",
  couleur_invalide: "Cette couleur n’est pas dans la palette.",
  deja_membre: "Cette personne fait déjà partie de l’équipe.",
  deja_invitee: "Cette adresse est déjà invitée.",
  introuvable: "Cette personne ou cette invitation n’existe plus.",
  dernier_admin: "Il faut garder au moins un admin dans l’équipe.",
  trop_tot: "Un lien vient déjà d’être demandé pour cette adresse : attends une minute avant d’en redemander un.",
  // Bibliothèque KLYRA (convex/bibliotheque.ts).
  reserve_a_l_auteur: "Seul son auteur peut publier une mise à jour ou la retirer. Tu peux en faire une copie privée.",
  deja_publiee: "Tu as déjà partagé cet agent : publie plutôt une mise à jour.",
  conflit_version: "Une autre version vient d’être publiée entre-temps (depuis un autre ordinateur ?). Recharge la fiche avant de publier.",
  fiche_invalide: "La fiche est vide ou son en-tête est illisible.",
  trop_long: "La fiche est trop longue pour être partagée (60 000 caractères au plus, description 1 200).",
  cle_non_partagee: "La fiche contient des réglages qui ne se partagent pas : rouvre l’aperçu avant de partager.",
  secret_detecte: "La fiche contient ce qui ressemble à une clé ou un mot de passe : retire-le avant de partager.",
  chemin_personnel: "La fiche contient encore un chemin de ton ordinateur : rouvre l’aperçu avant de partager.",
  dependance_invalide: "Les dossiers à configurer ne correspondent pas à la fiche : rouvre l’aperçu avant de partager.",
  reserve_au_createur: "Seul qui a créé le rappel peut changer ça.",
  rappel_invalide: "Ce rappel n’est pas valable : vérifie le titre, la date et la catégorie.",
  membre_inconnu: "Cette personne n’est plus dans l’équipe.",
  lot_trop_grand: "Trop de rappels d’un coup : 100 au plus.",
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
  const [demande, setDemande] = useState<(Demande & { refusee: boolean }) | null>(() => {
    const gardee = lireDemande();
    return gardee && { ...gardee, refusee: false };
  });
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const envoyerDemande = useMutation(api.connexion.demanderLien);

  const oublierAdresse = useCallback(() => {
    garderDemande(null);
    setDemande(null);
  }, []);

  /* Le serveur répond de la même façon pour toute adresse (invitée, membre ou non) : acceptée ou
     non selon le délai, et l'attente avant la suivante. L'e-mail ne part que pour une adresse admise. */
  /* Un double clic ne fait qu'une demande (le serveur, lui, n'enverrait de toute façon qu'un lien). */
  const demandeEnCours = useRef(false);
  const demanderLien = useCallback(
    async (saisie: string) => {
      if (demandeEnCours.current) return false;
      demandeEnCours.current = true;
      const email = normaliserEmail(saisie);
      setErreur(null);
      setOccupe(true);
      try {
        const { acceptee, attenteMs } = await envoyerDemande({ email });
        const precedente = lireDemande();
        const maintenant = Date.now();
        const suivante = {
          email,
          le: acceptee || precedente?.email !== email ? maintenant : precedente.le,
          prochaine: maintenant + attenteMs,
        };
        garderDemande(suivante);
        setDemande({ ...suivante, refusee: !acceptee });
        return true;
      } catch (e) {
        setErreur(messageErreur(e));
        return false;
      } finally {
        demandeEnCours.current = false;
        setOccupe(false);
      }
    },
    [envoyerDemande],
  );

  const ouvrirCode = useCallback(
    async (code: string) => {
      const email = lireDemande()?.email;
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

  const envoyerProfil = useMutation(api.equipe.modifierMonProfil);
  const couleurActuelle = moi?.couleur;
  const modifierMonProfil = useCallback(
    async ({ nom, intitule, couleur }: { nom: string; intitule: string; couleur?: string }) => {
      if (!couleurActuelle) throw new Error("non_connecte");
      await envoyerProfil({ nom, intitule, couleur: couleur ?? couleurActuelle });
    },
    [envoyerProfil, couleurActuelle],
  );

  /* Le profil du compte, pour toute l'app, seulement tant que la session est celle d'un membre actif.
     Déconnecté, retiré, en cours de vérification ou hors ligne : plus rien du compte n'est affiché. */
  const { appliquerProfilCompte } = useWorkspace();
  const connecte = etat === "connecte" && moi ? moi : null;
  const [nomCompte, intituleCompte, couleurCompte] = [connecte?.nom ?? null, connecte?.intitule ?? null, connecte?.couleur ?? null];
  useEffect(() => {
    appliquerProfilCompte(nomCompte !== null && intituleCompte !== null && couleurCompte !== null ? { nom: nomCompte, intitule: intituleCompte, couleur: couleurCompte } : null);
  }, [appliquerProfilCompte, nomCompte, intituleCompte, couleurCompte]);
  useEffect(() => () => appliquerProfilCompte(null), [appliquerProfilCompte]);

  const valeur = useMemo<CompteApi>(
    () => ({
      etat,
      moi: moi ?? null,
      adresseEnAttente: demande?.email ?? null,
      prochaineDemande: demande?.prochaine ?? null,
      demandeRefusee: demande?.refusee ?? false,
      occupe,
      erreur,
      demanderLien,
      ouvrirLienColle,
      oublierAdresse,
      seDeconnecter,
      modifierMonProfil,
    }),
    [etat, moi, demande, occupe, erreur, demanderLien, ouvrirLienColle, oublierAdresse, seDeconnecter, modifierMonProfil],
  );
  return (
    <CompteContext.Provider value={valeur}>
      <PresenceKlyra actif={etat === "connecte"} />
      {children}
    </CompteContext.Provider>
  );
}

export function useCompte(): CompteApi {
  return useContext(CompteContext);
}

/**
 * Ton identité et sa modification, selon les règles de `src/lib/identite.ts` :
 * connecté, le compte d'abord (le serveur valide), puis cet ordinateur ; sinon,
 * cet ordinateur seulement. La photo et les préférences ne bougent jamais ici.
 */
export function useMonIdentite() {
  const { state, moi, modifierProfil } = useWorkspace();
  const compte = useCompte();
  const connecte = moi.source === "compte" && compte.etat === "connecte";
  const ecart = useMemo(() => ecartProfils(state.currentUser, state.profilCompte), [state.currentUser, state.profilCompte]);

  const garderIci = useCallback(
    (nom: string, intitule: string) => modifierProfil({ name: nom, title: intitule, initial: initialeDe(nom) }),
    [modifierProfil],
  );

  /** Nom et rôle (et couleur, depuis Réglages › Équipe). Lève une erreur lisible si c'est refusé. */
  const enregistrer = useCallback(
    async (nom: string, intitule: string, couleur?: string) => {
      const propre = identiteValable(nom, intitule);
      if (!propre) throw new Error(MESSAGES.nom_invalide);
      if (connecte) {
        try {
          await compte.modifierMonProfil({ ...propre, couleur });
        } catch (e) {
          throw new Error(messageErreur(e));
        }
      }
      garderIci(propre.nom, propre.intitule);
    },
    [connecte, compte, garderIci],
  );

  return { moi, connecte, ecart, enregistrer, garderIci };
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
  return {
    membres: membres as Membre[] | undefined,
    invitations: invitations as Invitation[] | undefined,
    inviter,
    annulerInvitation,
    changerRole,
    retirer,
  };
}
