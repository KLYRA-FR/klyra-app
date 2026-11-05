"use client";

import { useEffect, useLayoutEffect, useRef, useState, ViewTransition, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ongletDe, rangDansLApp } from "@/lib/telephone/retour";
import { FournisseurAnnonce } from "./Annonce";
import { FournisseurReseau } from "./BandeauReseau";
import { useCompte, useSocketOuvert } from "@/lib/compte";
import { AgentsTelephone } from "./AgentsTelephone";
import { ArtefactsTelephone } from "./ArtefactsTelephone";
import { EcranPoste, PlusTelephone } from "./ListesTelephone";
import { ReglagesTelephone } from "./ReglagesTelephone";
import { AutomatisationsTelephone } from "./EcransAutomatisations";
import { ProjetsTelephone, ProjetTelephone } from "./EcransProjets";
import { useRetenirPoste } from "./poste";
import { useNumeroterNavigation } from "./retour";
import { actualiserSessionTelephone } from "@/lib/telephone/session-locale";
import { BarreOnglets } from "./BarreOnglets";
import { ChatsTelephone } from "./ChatsTelephone";
import { ConnexionTelephone } from "./ConnexionTelephone";
import { FilTelephone } from "./FilTelephone";
import { PlanningTelephone } from "./PlanningTelephone";
import { ServeursTelephone } from "./ServeursTelephone";
import { SuiviDemandesTickets } from "./DemandesTickets";
import { TicketsTelephone } from "./TicketsTelephone";
import Image from "next/image";
import { lienValable } from "../../../convex/model/push";
import { BoutonPrincipal } from "@/components/ui/BoutonPrincipal";
import { getBridge } from "@/lib/bridge";
import { composition, lireDerniereDonnee, retenirDerniereDonnee, texteHorsLigne, type Composition } from "@/lib/coque";
import { estIphone, lireNavigateur } from "@/lib/push";
import { SERVICE_WORKER, useSynchroPush } from "./push";
import { Icon } from "@/components/icons/Icon";
import { Bouton } from "@/components/ui/Bouton";
import { SuiviEspace } from "./EspaceTelephone";

const CLE_INSTALL = "klyra:installer";

function ecran(pathname: string): ReactNode {
  if (pathname === "/chats" || pathname === "/") return <ChatsTelephone />;
  if (pathname === "/chat") return <FilTelephone />;
  if (pathname === "/planning") return <PlanningTelephone />;
  if (pathname === "/equipe") return <AgentsTelephone />;
  if (pathname === "/projets") return <ProjetsTelephone />;
  if (pathname === "/plus") return <PlusTelephone />;
  if (pathname === "/reglages") return <ReglagesTelephone />;
  if (pathname === "/serveurs") return <ServeursTelephone />;
  if (pathname === "/routines") return <AutomatisationsTelephone />;
  if (pathname === "/artefacts") return <ArtefactsTelephone />;
  if (pathname === "/projet" || pathname === "/fichiers") return <ProjetTelephone />;
  if (pathname === "/tickets") return <TicketsTelephone />;
  if (pathname === "/marketplace") {
    return (
      <EcranPoste
        titre="Marketplace"
        icone="boutique-01"
        phrase={(sur) => `le Marketplace s’utilise sur ${sur}`}
        raison="Connecter une app ouvre sa page de connexion dans le navigateur de l’ordinateur, et ses clés y restent."
      />
    );
  }
  return <EcranPoste titre="KLYRA" icone="computer" phrase={(sur) => `cet écran s’utilise sur ${sur}`} raison="Il n’a pas encore de version pour le téléphone." />;
}

/* ─── Composition ────────────────────────────────────────────────── */

type Disposition = Exclude<Composition, "bureau">;

const dispositionActuelle = (): Disposition =>
  composition({ largeur: window.innerWidth, hauteur: window.innerHeight, electron: false }) === "tablette" ? "tablette" : "telephone";

/** Téléphone ou tablette, selon la fenêtre (spec mobile M-2 et § 9). Relue à chaque redimensionnement. */
function useComposition(): Disposition {
  const [valeur, setValeur] = useState<Disposition>(dispositionActuelle);
  useEffect(() => {
    const suivre = () => setValeur(dispositionActuelle());
    window.addEventListener("resize", suivre);
    return () => window.removeEventListener("resize", suivre);
  }, []);
  /* Sur la racine : les feuilles (montées dans le body) deviennent des fenêtres centrées à la tablette. */
  useEffect(() => {
    document.documentElement.dataset.composition = valeur;
    return () => {
      delete document.documentElement.dataset.composition;
    };
  }, [valeur]);
  return valeur;
}

/** Tablette (§ 9) : Chats en liste et fil côte à côte ; ailleurs, le contenu centré à une largeur lisible. */
function EcranTablette({ pathname }: { pathname: string }) {
  if (pathname === "/chats" || pathname === "/chat" || pathname === "/") {
    return (
      <div className="flex min-h-0 flex-1">
        <div className="flex w-[320px] shrink-0 flex-col border-r border-bordure-subtile">{ecran("/chats")}</div>
        <div className="flex min-w-0 flex-1 flex-col">
          {pathname === "/chat" ? (
            ecran("/chat")
          ) : (
            <p className="m-auto px-6 text-center text-ui text-texte-secondaire">Choisis une conversation dans la liste.</p>
          )}
        </div>
      </div>
    );
  }
  return <div className="mx-auto flex min-h-0 w-full max-w-[720px] flex-1 flex-col">{ecran(pathname)}</div>;
}

/* ─── Hors ligne (P-12) ──────────────────────────────────────────── */

/** Sans socket pendant ce délai, l'app se dit hors ligne (une reconnexion brève ne fait pas clignoter le bandeau). */
const COUPURE_MS = 5000;

/** « Hors ligne · données du 31/10 à 18:42 », ou null en ligne. L'heure est celle de la dernière donnée reçue. */
function useHorsLigne(): string | null {
  const socket = useSocketOuvert();
  const [reseau, setReseau] = useState(() => navigator.onLine);
  const [coupe, setCoupe] = useState(false);

  useEffect(() => {
    const lire = () => setReseau(navigator.onLine);
    window.addEventListener("online", lire);
    window.addEventListener("offline", lire);
    return () => {
      window.removeEventListener("online", lire);
      window.removeEventListener("offline", lire);
    };
  }, []);

  /* En ligne, les données arrivent en continu : l'heure gardée avance avec elles, jusqu'à la coupure. */
  useEffect(() => {
    if (!socket) {
      const minuteur = setTimeout(() => setCoupe(true), COUPURE_MS);
      return () => {
        clearTimeout(minuteur);
        setCoupe(false);
      };
    }
    const retenir = () => retenirDerniereDonnee(Date.now());
    retenir();
    const minuteur = setInterval(retenir, 30_000);
    return () => {
      clearInterval(minuteur);
      retenir();
    };
  }, [socket]);

  return !reseau || (!socket && coupe) ? texteHorsLigne(lireDerniereDonnee()) : null;
}

/* ─── Vue gardée (socle § 5.4) ───────────────────────────────────── */

/**
 * Ce que le téléphone a gardé (lectures, brouillons et accès VPS) ne survit pas à la déconnexion : session
 * fermée sur ce téléphone ou à distance, compte retiré, ou un autre compte connecté. Un démarrage sans
 * réseau n'efface rien (le compte n'a pas encore répondu).
 */
function useEffacerVuesGardees() {
  const { etat, moi, sessionFermee } = useCompte();
  const membre = etat === "connecte" && moi ? (moi._id as string) : null;
  const cle = `${etat}|${membre ?? ""}|${sessionFermee}`;
  const [traitee, setTraitee] = useState<string | null>(null);
  useLayoutEffect(() => {
    actualiserSessionTelephone({ membre, deconnecte: etat === "deconnecte", revoque: etat === "retire" || sessionFermee });
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Barrière de session : monter les lecteurs seulement après la purge locale, avant le prochain affichage.
    setTraitee(cle);
  }, [cle, membre, etat, sessionFermee]);
  return traitee === cle;
}

/* ─── Service worker et notifications touchées ───────────────────── */

/**
 * Le service worker (M-1) : la coque s'ouvre sans réseau, les notifications arrivent. Jamais dans
 * l'app de bureau ; en développement non plus (il garderait des fichiers qui changent sans cesse).
 * Une notification touchée, app ouverte : l'écran visé.
 */
function useServiceWorker() {
  const router = useRouter();
  useEffect(() => {
    if (getBridge() || !("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV === "production") {
      void navigator.serviceWorker.register(SERVICE_WORKER, { scope: "/", updateViaCache: "none" }).catch(() => {
        /* Sans service worker : l'app marche, sans copie hors ligne ni notifications. */
      });
    }
    const recevoir = (e: MessageEvent) => {
      const lien = (e.data as { type?: unknown; lien?: unknown } | null)?.lien;
      if ((e.data as { type?: unknown } | null)?.type === "klyra:ouvrir" && typeof lien === "string" && lienValable(lien)) router.push(lien);
    };
    navigator.serviceWorker.addEventListener("message", recevoir);
    return () => navigator.serviceWorker.removeEventListener("message", recevoir);
  }, [router]);
}

/* ─── Installation (M-1, T-00) ───────────────────────────────────── */

/** L'invite d'installation de Chrome (Android), gardée pour le bouton « Installer KLYRA ». */
interface InviteInstallation extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function useInstallation() {
  const [navigateur] = useState(lireNavigateur);
  const mobile = estIphone(navigateur) || /Android/i.test(navigateur.userAgent);
  const [choixNavigateur, setChoixNavigateur] = useState(() => {
    try {
      return localStorage.getItem(CLE_INSTALL) === "navigateur";
    } catch {
      return true;
    }
  });
  const [installee, setInstallee] = useState(navigateur.installee);
  const [invite, setInvite] = useState<InviteInstallation | null>(null);

  useEffect(() => {
    const garder = (e: Event) => {
      e.preventDefault();
      setInvite(e as InviteInstallation);
    };
    const fini = () => {
      setInstallee(true);
      setInvite(null);
    };
    window.addEventListener("beforeinstallprompt", garder);
    window.addEventListener("appinstalled", fini);
    return () => {
      window.removeEventListener("beforeinstallprompt", garder);
      window.removeEventListener("appinstalled", fini);
    };
  }, []);

  const continuer = () => {
    try {
      localStorage.setItem(CLE_INSTALL, "navigateur");
    } catch {
      /* Sans stockage : la page reviendra à la prochaine ouverture. */
    }
    setChoixNavigateur(true);
  };

  /* Le succès vient de l'événement du système (`appinstalled`), jamais du seul choix dans la demande (E8-57, E8-58). */
  const installer = async () => {
    if (!invite) return;
    await invite.prompt();
    await invite.userChoice;
    setInvite(null);
  };

  /* « Installer KLYRA sur l'écran d'accueil », depuis Ce téléphone (E8-23) : la page revient. */
  useEffect(() => {
    const proposer = () => {
      try {
        localStorage.removeItem(CLE_INSTALL);
      } catch {
        /* Sans stockage : la page s'affiche quand même pour cette ouverture. */
      }
      setChoixNavigateur(false);
    };
    window.addEventListener("klyra:proposer-installation", proposer);
    return () => window.removeEventListener("klyra:proposer-installation", proposer);
  }, []);

  /* La page ne s'affiche que dans le navigateur d'un téléphone ou d'une tablette, jamais dans l'app posée sur l'écran d'accueil. */
  const aProposer = mobile && !navigateur.installee && !choixNavigateur;
  return { aProposer, iphone: estIphone(navigateur), installee, invite, installer, continuer };
}

function EtapesInstallation({ etapes }: { etapes: ReactNode[] }) {
  return (
    <ol className="flex flex-col gap-3.5">
      {etapes.map((etape, i) => (
        <li key={i} className="flex items-start gap-3 text-body-s leading-[1.4] text-texte-principal">
          <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-full bg-fond-surface-grise text-ui font-semibold">
            {i + 1}
          </span>
          <span className="min-w-0 pt-0.5">{etape}</span>
        </li>
      ))}
    </ol>
  );
}

function PageInstallation({ installation, tablette }: { installation: ReturnType<typeof useInstallation>; tablette: boolean }) {
  const { iphone, installee, invite } = installation;
  const partager = (
    <>
      Touche le bouton{" "}
      <span className="inline-flex h-6 items-center gap-1 rounded-sm bg-fond-surface-grise px-1.5 align-[1px] text-ui font-medium">
        <Icon name="upload-01" size={16} />
        Partager
      </span>{" "}
      de Safari.
    </>
  );
  const menu = (
    <>
      Ouvre le menu{" "}
      <span className="inline-flex h-6 items-center rounded-sm bg-fond-surface-grise px-1.5 align-[1px]">
        <Icon name="dot-horizontal" size={16} />
      </span>{" "}
      du navigateur.
    </>
  );
  const etapes: ReactNode[] = iphone
    ? ["Ouvre cette page dans Safari.", partager, "Choisis d’ajouter KLYRA à l’écran d’accueil, puis confirme.", "Ouvre KLYRA depuis l’écran d’accueil."]
    : [menu, "Choisis d’installer KLYRA ou de l’ajouter à l’écran d’accueil.", "Ouvre KLYRA depuis l’écran d’accueil."];

  return (
    <div className="min-h-0 flex-1 overflow-y-auto pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto flex w-full max-w-sm flex-col gap-4 px-6 pt-6 pb-8">
        <Image src="/brand/logo-icone.svg" alt="" width={56} height={56} />
        {installee ? (
          <div role="status" className="flex flex-col items-center px-2 pt-20 text-center">
            <span aria-hidden="true" className="mb-4 flex size-12 items-center justify-center rounded-full bg-fond-teinte-bleue text-icone-accent">
              <Icon name="check-01" size={24} />
            </span>
            <h1 className="text-body-s font-semibold text-texte-principal">KLYRA est installée</h1>
            <p className="mt-1.5 max-w-[290px] text-ui text-texte-secondaire">Ouvre-la depuis l’écran d’accueil : c’est là que tu te connectes et que les notifications arrivent.</p>
          </div>
        ) : (
          <>
            <h1 className="mt-1 text-h3 leading-[1.05] font-semibold tracking-title text-texte-principal">Installer KLYRA sur {tablette ? "cette tablette" : "ce téléphone"}</h1>
            <p className="text-ui leading-[1.45] text-texte-secondaire">Posée sur l’écran d’accueil, KLYRA s’ouvre comme une app, même sans réseau, et peut te prévenir quand un agent attend ton accord.</p>
            {invite ? <BoutonPrincipal onClick={() => void installation.installer()}>Installer KLYRA</BoutonPrincipal> : <EtapesInstallation etapes={etapes} />}
            <div className="mt-1.5">
              <Bouton variant="discret" taille="md" className="w-full" onClick={installation.continuer}>
                Continuer dans le navigateur
              </Bouton>
              {iphone ? <p className="mt-1 text-center text-ui-xs text-texte-secondaire">Dans Safari, KLYRA ne pourra pas te prévenir.</p> : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ─── La coque ───────────────────────────────────────────────────── */

/**
 * L'app web, hors Electron. Sous 760 px (et téléphone couché), une colonne et la barre du bas ;
 * au-delà, la tablette : le rail à gauche, Chats en deux panneaux, le reste centré. L'ouverture est Chats.
 */
export function CoqueTelephone() {
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  const compte = useCompte();
  useRetenirPoste();
  useNumeroterNavigation();
  const sessionPrete = useEffacerVuesGardees();
  useServiceWorker();
  useSynchroPush();
  const disposition = useComposition();
  const horsLigne = useHorsLigne();
  const installation = useInstallation();

  useEffect(() => {
    if (pathname === "/") router.replace("/chats");
  }, [pathname, router]);
  const sens = useSensDeNavigation();

  /* La barre d'onglets se cache dans le fil et dans la visionneuse (§ 2.1) ; une page pleine la couvre. */
  const visionneuse = pathname === "/projet" && params.has("fichier");
  const sansBarre = pathname === "/chat" || visionneuse;
  const serveurs = pathname === "/serveurs";
  const tablette = disposition === "tablette";
  const connecte = compte.etat === "connecte";
  const navigation = connecte && !installation.aProposer;
  const barre = navigation && !tablette && !sansBarre;

  /* Ne monte pas les lecteurs du compte suivant avant d'avoir oublié la session précédente. */
  if (!sessionPrete) return null;

  return (
    <FournisseurReseau horsLigne={horsLigne}>
      <FournisseurAnnonce barreOnglets={barre}>
        {connecte ? <SuiviDemandesTickets /> : null}
        {connecte ? <SuiviEspace /> : null}
        <div className="flex h-full bg-fond-page">
          {tablette && navigation ? <BarreOnglets vertical /> : null}
          <div className="flex min-w-0 flex-1 flex-col">
            {installation.aProposer ? (
              <PageInstallation installation={installation} tablette={tablette} />
            ) : connecte || serveurs ? (
              /* Seule la zone de contenu glisse ou se fond (§ 2.6) ; la barre d'onglets ne bouge pas. Une
                 page par chemin : un paramètre remplacé (onglet segmenté, fiche ouverte) ne remonte pas l'écran. */
              <ViewTransition key={pathname} enter={sens} exit={sens} default="none">
                <div data-contenu-telephone className="flex min-h-0 flex-1 flex-col">
                  {tablette ? <EcranTablette pathname={pathname} /> : ecran(pathname)}
                </div>
              </ViewTransition>
            ) : (
              <ConnexionTelephone />
            )}
            {barre ? <BarreOnglets /> : null}
          </div>
        </div>
      </FournisseurAnnonce>
    </FournisseurReseau>
  );
}

/**
 * Le sens d'une navigation (§ 2.6), posé sur la racine (`data-sens`) avant que la transition ne joue :
 * changer d'onglet, avancer dans un onglet (rang d'historique qui monte), revenir (rang qui descend),
 * ou rien (même page, paramètres remplacés). Renvoie la classe de la transition de page.
 */
function useSensDeNavigation(): "klyra-page" | "none" {
  const pathname = usePathname();
  const avant = useRef<{ onglet: string; rang: number } | null>(null);
  useLayoutEffect(() => {
    const ici = { onglet: ongletDe(pathname), rang: rangDansLApp(window.history.state) };
    const precedent = avant.current;
    avant.current = ici;
    if (!precedent) return;
    document.documentElement.dataset.sens =
      precedent.onglet !== ici.onglet ? "onglet" : ici.rang > precedent.rang ? "avant" : ici.rang < precedent.rang ? "arriere" : "aucun";
  }, [pathname]);
  return typeof document !== "undefined" && "startViewTransition" in document ? "klyra-page" : "none";
}
