"use client";

import { ConvexAuthProvider, useAuthActions, type TokenStorage } from "@convex-dev/auth/react";
import { ConvexReactClient, useConvex, useConvexAuth, useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { SignalPoste } from "@/components/compte/SignalPoste";
import { SyncCompte } from "@/components/compte/SyncCompte";
import { ServicePoste } from "@/components/compte/ServicePoste";
import { SignalTelephone } from "@/components/telephone/SignalTelephone";
import { AgendaCompte } from "@/components/planning/AgendaCompte";
import { PresenceKlyra } from "@/components/planning/PresenceKlyra";
import { getBridge, type KlyraBridge } from "@/lib/bridge";
import { ecartProfils, identiteValable, initialeDe } from "@/lib/identite";
import { useWorkspace } from "@/lib/workspace";

/**
 * Le compte d'équipe, en ligne sur Convex (cf. `docs/CONVEX-PLAN.md`) : connexion par
 * lien magique, puis l'équipe. Sur l'ordinateur, les jetons sont dans le trousseau
 * (electron/compte.ts). Dans le navigateur du téléphone, ils restent dans le
 * stockage de la page. L'adresse de production est publique (electron/compte.ts).
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
  /**
   * La session de cet appareil a été fermée depuis un autre (Réglages › Mobile), pas retirée de
   * l'équipe : le téléphone le dit au-dessus du formulaire de connexion (MO-T14).
   */
  sessionFermee: boolean;
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
  sessionFermee: false,
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
/** Gardé jusqu'à la prochaine connexion : un rechargement de la page ne fait pas oublier pourquoi. */
const CLE_SESSION_FERMEE = "klyra:compte:session-fermee";

function lireSessionFermee(): boolean {
  try {
    return localStorage.getItem(CLE_SESSION_FERMEE) === "1";
  } catch {
    return false;
  }
}

function garderSessionFermee(fermee: boolean) {
  try {
    if (fermee) localStorage.setItem(CLE_SESSION_FERMEE, "1");
    else localStorage.removeItem(CLE_SESSION_FERMEE);
  } catch {
    /* pas de stockage : l'indication reste en mémoire */
  }
}

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
  depot_invalide: "Ce nom de dépôt GitHub n’est pas valable.",
  depot_non_autorise: "Tu n’as pas accès à ce dépôt pour les agents.",
  jetons_non_configures: "Les clés GitHub des agents ne sont pas posées sur le compte d’équipe, ou GitHub les refuse.",
  app_non_installee: "L’App GitHub des agents n’est pas installée sur ce dépôt.",
  github_indisponible: "GitHub ne répond pas. Réessaie dans un moment.",
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
  // Artefacts de l'équipe (convex/artefactsEquipe.ts).
  lien_invalide: "Ce lien ne mène pas à un artefact claude.ai.",
  deja_partage: "Cet artefact est déjà partagé avec l’équipe.",
  description_trop_longue: "La description fait 500 caractères au plus.",
  document_invalide: "Ce document n’est pas valable : un fichier HTML, avec un titre.",
  reserve_au_createur: "Seul qui a créé le rappel peut changer ça.",
  rappel_invalide: "Ce rappel n’est pas valable : vérifie le titre, la date et la catégorie.",
  membre_inconnu: "Cette personne n’est plus dans l’équipe.",
  lot_trop_grand: "Trop de rappels d’un coup : 100 au plus.",
  conversation_invalide: "Cette conversation n’est pas valable.",
  poste_invalide: "Ce poste n’est pas valable.",
  session_actuelle: "C’est la session de cet appareil : déconnecte-le depuis ses propres réglages.",
  session_ordinateur: "C’est la session d’un ordinateur : déconnecte-le depuis Réglages › Équipe, sur cet ordinateur.",
  evenement_invalide: "Cet événement n’est pas valable : vérifie le titre, le jour et l’heure.",
  reserve_a_lorganisateur: "Seul l’organisateur peut changer cet événement.",
};

/** Le code d'erreur renvoyé par une fonction Convex (`convex/model/valeurs.ts`), ou null. */
export function codeErreur(erreur: unknown): string | null {
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

/** Le code d'un lien : klyra://, la page relais, ou l'adresse https de l'app (`/?code=`). */
export function codeDuLien(lien: string): string | null {
  try {
    const url = new URL(lien.trim());
    const code = url.searchParams.get("code");
    if (!code || !/^[A-Za-z0-9]{16,128}$/.test(code)) return null;
    const relais = url.protocol === "https:" && url.hostname.endsWith(".convex.site") && url.pathname === "/connexion";
    const protocole = url.protocol === "klyra:" && url.hostname === "connexion";
    const page = url.protocol === "https:" && (url.pathname === "/" || url.pathname === "");
    return relais || protocole || page ? code : null;
  } catch {
    return null;
  }
}

/** Mêmes adresses que `electron/compte.ts`. Elles ne sont pas secrètes. */
const CONVEX_PRODUCTION = "https://calculating-cuttlefish-710.eu-west-1.convex.cloud";
const CONVEX_DEVELOPPEMENT = "https://coordinated-ox-134.eu-west-1.convex.cloud";

function adresseNavigateur(): string {
  const forcee = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (forcee && /^https:\/\/[a-z0-9.-]+\.convex\.cloud$/.test(forcee)) return forcee;
  if (typeof window !== "undefined" && (location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
    /* Tests seulement (scripts/test-mobile.mjs) : un backend Convex local et jetable, jamais un vrai déploiement. */
    const local = localStorage.getItem("klyra:convex-local");
    return local && /^http:\/\/127\.0\.0\.1:\d{2,5}$/.test(local) ? local : CONVEX_DEVELOPPEMENT;
  }
  return CONVEX_PRODUCTION;
}

function stockageNavigateur(): TokenStorage {
  return {
    getItem: async (cle) => localStorage.getItem(cle),
    setItem: async (cle, valeur) => {
      localStorage.setItem(cle, valeur);
    },
    removeItem: async (cle) => {
      localStorage.removeItem(cle);
    },
  };
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
  const pont = getBridge()?.compte ?? null;
  /* Une fois pour toute la vie de la fenêtre. Le téléphone n'a pas de pont : il parle à Convex lui-même. */
  const [client] = useState(() => new ConvexReactClient(pont?.adresse || adresseNavigateur()));
  const [stockage] = useState(() => (pont ? stockageSysteme(pont) : stockageNavigateur()));
  return (
    /* Le code n'est pas consommé par Convex Auth tout seul : la règle « même appareil » reste ici. */
    <ConvexAuthProvider client={client} storage={stockage} shouldHandleCode={false} replaceURL={() => {}}>
      <CompteConnecte pont={pont}>{children}</CompteConnecte>
    </ConvexAuthProvider>
  );
}

function CompteConnecte({ pont, children }: { pont: NonNullable<KlyraBridge["compte"]> | null; children: ReactNode }) {
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

  /* Session fermée depuis un autre appareil, gardée jusqu'à une nouvelle connexion ou une sortie voulue ici. */
  const [fermeeGardee, setFermeeGardee] = useState(lireSessionFermee);
  const oublierSessionFermee = useCallback(() => {
    garderSessionFermee(false);
    setFermeeGardee(false);
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
        const { acceptee, attenteMs } = await envoyerDemande({ email, cible: pont ? "poste" : "web" });
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
    [envoyerDemande, pont],
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
        oublierSessionFermee();
      } catch (e) {
        setErreur(messageErreur(e));
      } finally {
        setOccupe(false);
      }
    },
    [signIn, oublierAdresse, oublierSessionFermee],
  );

  /* Le lien de l'e-mail ouvre l'app (klyra://) : au lancement, puis à chaque lien. */
  const ouvrirRef = useRef(ouvrirCode);
  useEffect(() => {
    ouvrirRef.current = ouvrirCode;
  }, [ouvrirCode]);
  useEffect(() => {
    if (!pont) {
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      if (!code || !/^[A-Za-z0-9]{16,128}$/.test(code)) return;
      const url = new URL(window.location.href);
      url.searchParams.delete("code");
      url.searchParams.delete("cible");
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
      void ouvrirRef.current(code);
      return;
    }
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
    oublierSessionFermee();
    await signOut();
  }, [signOut, oublierSessionFermee]);

  /* `moi` est null : retiré de l'équipe, ou session fermée depuis un autre appareil (le jeton
     d'accès reste valable jusqu'à une heure, mais le serveur refuse déjà tout). Dans le second cas,
     les jetons de cet appareil sont effacés et l'écran de connexion dit pourquoi. */
  const statut = useQuery(api.equipe.statutSession, isAuthenticated && moi === null ? {} : "skip");
  useEffect(() => {
    if (statut !== "session_fermee") return;
    garderSessionFermee(true);
    void signOut().then(() => {
      setFermeeGardee(true);
      if (pont) setErreur("Cette session a été fermée depuis un autre appareil : reconnecte-toi.");
    });
  }, [statut, signOut, pont]);

  const etat: Etat =
    isLoading || (isAuthenticated && moi === undefined)
      ? "chargement"
      : !isAuthenticated
        ? "deconnecte"
        : moi
          ? "connecte"
          : statut === "retire"
            ? "retire"
            : "chargement";
  const sessionFermee = etat !== "connecte" && (fermeeGardee || statut === "session_fermee");

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
      sessionFermee,
      erreur,
      demanderLien,
      ouvrirLienColle,
      oublierAdresse,
      seDeconnecter,
      modifierMonProfil,
    }),
    [etat, moi, demande, occupe, sessionFermee, erreur, demanderLien, ouvrirLienColle, oublierAdresse, seDeconnecter, modifierMonProfil],
  );
  return (
    <CompteContext.Provider value={valeur}>
      {/* Le téléphone ne bat pas la présence : sinon il ferait croire que le Mac est ouvert. */}
      <PresenceKlyra actif={etat === "connecte" && pont !== null} />
      <SignalPoste actif={etat === "connecte" && pont !== null} />
      <SyncCompte actif={etat === "connecte" && pont !== null} />
      {/* Les demandes du téléphone (dossier, fichier, routines…) : l'ordinateur ouvert y répond. */}
      <ServicePoste actif={etat === "connecte" && pont !== null} />
      {/* Hors de l'app de bureau (téléphone, navigateur) : la session se signale pour Réglages › Mobile. */}
      <SignalTelephone actif={etat === "connecte" && pont === null} />
      <AgendaCompte actif={etat === "connecte"} />
      {children}
    </CompteContext.Provider>
  );
}

export function useCompte(): CompteApi {
  return useContext(CompteContext);
}

/**
 * Le socket avec le serveur est-il ouvert ? Un booléen, mis à jour seulement quand il change :
 * `useConvexConnectionState` rend un nouvel objet à chaque événement de connexion, et ses rendus
 * en continu empêchaient les navigations de l'app d'aboutir une fois connecté.
 */
export function useSocketOuvert(): boolean {
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
