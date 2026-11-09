"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, type MouseEvent, type ReactNode } from "react";
import { UtilisationRail } from "@/components/chat/CarteUtilisation";
import { Icon, type IconName } from "@/components/icons/Icon";
import { Infobulle } from "@/components/ui/Infobulle";
import { cn } from "@/lib/cn";
import { useMenuProjet } from "@/components/project/MenuProjet";
import { colonneTicket } from "@/lib/tickets";
import { estConversationAgent, FIL, useChatsEspace, useProjects, useWorkspace } from "@/lib/workspace";
import { CarteCompteRail } from "./CarteCompte";
import { NAVIGATION } from "./navigation";
import { PastilleMcp } from "./ConnexionsAgents";
import { PastilleMaj } from "./PastilleMaj";

/** Une entrée du rail : l'icône seule, à sa taille de dessin (24 px, trait plein) ; le nom au survol. */
const ENTREE =
  "flex size-12 cursor-pointer items-center justify-center rounded-md border-0 no-underline transition-colors duration-[120ms] ease-sortie";
const entree = (active: boolean) =>
  cn(
    ENTREE,
    active ? "bg-white/14 text-texte-inverse" : "bg-transparent text-texte-inverse-secondaire hover:bg-white/8 hover:text-texte-inverse",
  );

function Entree({ icone, nom }: { icone: IconName; nom: string; active?: boolean }): ReactNode {
  return (
    <>
      <Icon name={icone} size={24} />
      <span className="sr-only">{nom}</span>
    </>
  );
}

/** Ce que le bouton du rail ouvre à côté de lui. */
const PANNEAUX = {
  fichiers: { icone: "layout-left", nom: "Projet", cible: "les conversations et les fichiers du projet" },
  conversations: { icone: "layout-left", nom: "Liste", cible: "les conversations" },
} as const satisfies Record<string, { icone: IconName; nom: string; cible: string }>;

const SEPARATEUR = <span aria-hidden="true" className="my-1.5 h-px w-8 shrink-0 bg-white/12" />;

const CLE_DERNIER_CHAT = "klyra:dernier-chat";

/** Le dernier écran de chats vu (`/chat?id=…` d'un agent ou d'un fil), gardé le temps de la session. */
function dernierChat(): string | null {
  try {
    return sessionStorage.getItem(CLE_DERNIER_CHAT);
  } catch {
    return null;
  }
}

/** Le rail sur « Chats », hors des chats : on rouvre le dernier agent ou fil vu (s'il existe encore), sinon l'accueil. */
function versDernierChat(e: MouseEvent, pathname: string, chats: { id: string }[], aller: (href: string) => void) {
  if (pathname === "/chats" || pathname === "/chat" || e.metaKey || e.ctrlKey || e.shiftKey) return;
  const lien = dernierChat();
  const id = lien ? new URL(lien, "http://x").searchParams.get("id") : null;
  if (!lien || !id || (id.startsWith(FIL) && !chats.some((c) => c.id === id))) return;
  e.preventDefault();
  aller(lien);
}

/** Sans projet épinglé, le rail montre les plus récents, pas plus. */
const RECENTS_MAX = 3;

/** « Portfolio Pelin » → « PP », « Klyra » → « KL » : deux lettres pour distinguer les projets. */
function sigle(nom: string): string {
  const mots = nom.trim().split(/[\s\-_]+/).filter(Boolean);
  const lettres = mots.length > 1 ? mots[0][0] + mots[1][0] : nom.trim().slice(0, 2);
  return lettres.toUpperCase();
}

/**
 * Le menu de l'app, toujours en rail : en noir, le logo-icône KLYRA
 * (carré K1, signe blanc) en haut — le signe bleu seul sur noir est interdit. Dans un projet ou dans les chats, il ouvre le panneau
 * d'à côté (fichiers du projet, ou agents et conversations).
 */
export function AppRail({
  panneau,
  filesOpen = false,
  onToggleFiles,
}: {
  panneau?: keyof typeof PANNEAUX;
  filesOpen?: boolean;
  onToggleFiles?: () => void;
}) {
  const bouton = panneau ? PANNEAUX[panneau] : null;
  const projects = useProjects();
  const { ouvrirMenu: ouvrirMenuProjet, menuProjet } = useMenuProjet();
  const currentId = useSearchParams().get("id");
  const pathname = usePathname();
  /* Les tickets à valider : ils t'attendent, leur nombre se pose sur l'entrée Tickets. */
  const { travail } = useWorkspace().state;
  const chats = useChatsEspace();
  const router = useRouter();
  /* Quitter les chats puis revenir par le rail : on retrouve l'agent et le fil laissés, pas l'accueil. */
  useEffect(() => {
    const id = pathname === "/chat" ? currentId : null;
    try {
      if (id && estConversationAgent(id)) sessionStorage.setItem(CLE_DERNIER_CHAT, `/chat?id=${encodeURIComponent(id)}`);
      else if (pathname === "/chats") sessionStorage.removeItem(CLE_DERNIER_CHAT);
    } catch { /* stockage indisponible */ }
  }, [pathname, currentId]);
  const aValider = chats.filter((c) => c.fil && colonneTicket(c.fil, !!travail[c.id]) === "a-valider").length;
  /* Les projets du rail : les épinglés (sinon les plus récents), et celui qu'on regarde. Tous les autres : Projets. */
  const epingles = projects.filter((p) => p.pinned);
  const choisis = epingles.length ? epingles : [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, RECENTS_MAX);
  /* Le projet regardé : sa page, ou une de ses conversations (un projet s'ouvre sur sa dernière conversation). */
  const projetOuvert = pathname === "/projet" ? currentId : pathname === "/chat" ? (chats.find((c) => c.id === currentId)?.projectId ?? null) : null;
  const courant = projetOuvert ? projects.find((p) => p.id === projetOuvert) : undefined;
  const projetsRail = courant && !choisis.includes(courant) ? [...choisis, courant] : choisis;

  return (
    <nav
      aria-label="Navigation principale"
      className="my-2 ml-2 flex w-[72px] shrink-0 flex-col items-center rounded-xl bg-fond-inverse-fort pt-4 pb-3 in-data-[shell=desktop]:pt-9"
    >
      {/* Le logo-icône KLYRA (carré K1, signe blanc) ; la zone sert aussi à déplacer la fenêtre. */}
      <Infobulle texte="Accueil" cote="droite" className="mb-3">
        <Link href="/" aria-label="KLYRA, accueil" className="flex h-10 shrink-0 items-center [-webkit-app-region:drag]">
          <Image src="/brand/logo-icone.svg" alt="" width={36} height={36} priority />
        </Link>
      </Infobulle>

      {/* Le milieu défile si la fenêtre est basse : le bas du rail reste visible. */}
      <div className="flex min-h-0 w-full flex-1 flex-col items-center gap-0.5 overflow-y-auto [scrollbar-width:none]">
        {NAVIGATION.map((item) => {
          const active = pathname === item.href || (item.href === "/chats" && (pathname === "/equipe" || (pathname === "/chat" && panneau === "conversations")));
          return (
            <Infobulle key={item.href} texte={item.label} cote="droite">
            <Link href={item.href} data-visite={item.href} onClick={item.href === "/chats" ? (e) => versDernierChat(e, pathname, chats, router.push) : undefined} aria-current={active ? "page" : undefined} className={cn(entree(active), "relative")}>
              <Entree icone={item.icon} nom={item.label} active={active} />
              {item.href === "/tickets" && aValider > 0 && (
                <span className="absolute top-1.5 right-1.5 flex h-4 min-w-4 items-center justify-center rounded-pill bg-bleu-k1-500 px-1 text-ui-2xs leading-none font-semibold text-texte-inverse">
                  {aValider}
                  <span className="sr-only"> à valider</span>
                </span>
              )}
            </Link>
            </Infobulle>
          );
        })}

        {SEPARATEUR}
        {/* Les projets : une tuile par projet du rail, ses deux lettres ; la liste complète est dans Projets. */}
        <Infobulle texte="Projets" cote="droite">
          <Link href="/projets" data-visite="/projets" className={entree(pathname === "/projets")}>
            <Entree icone="projets-dossier" nom="Projets" active={pathname === "/projets"} />
          </Link>
        </Infobulle>
        {menuProjet}
        <div className="flex flex-col items-center gap-1.5 py-1">
          {projetsRail.map((p) => {
            const actif = projetOuvert === p.id;
            return (
              <Infobulle key={p.id} texte={p.name} cote="droite">
              <Link
                href={`/projet?id=${p.id}`}
                aria-label={p.name}
                aria-current={actif ? "page" : undefined}
                onContextMenu={(e) => ouvrirMenuProjet(e, p)}
                className={cn(
                  "flex size-10 items-center justify-center rounded-md text-ui-s font-semibold no-underline transition-[background-color,box-shadow] duration-[120ms] ease-sortie",
                  "bg-white/10 text-texte-inverse hover:bg-white/16",
                  actif && "ring-2 ring-texte-inverse ring-offset-2 ring-offset-fond-inverse-fort",
                )}
              >
                {sigle(p.name)}
              </Link>
              </Infobulle>
            );
          })}
        </div>

        {bouton && onToggleFiles && (
          <>
            {SEPARATEUR}
            <Infobulle texte={filesOpen ? `Masquer ${bouton.cible}` : `Afficher ${bouton.cible}`} cote="droite">
            <button
              type="button"
              onClick={onToggleFiles}
              aria-pressed={filesOpen}
              data-son="panneau"
              aria-label={filesOpen ? `Masquer ${bouton.cible}` : `Afficher ${bouton.cible}`}
              className={entree(filesOpen)}
            >
              <Entree icone={bouton.icone} nom={bouton.nom} active={filesOpen} />
            </button>
            </Infobulle>
          </>
        )}
      </div>

      <div className="flex shrink-0 flex-col items-center gap-1 pt-2">
        <PastilleMcp />
        <PastilleMaj />
        <UtilisationRail />
        {SEPARATEUR}
        {/* L'avatar ouvre ton menu : Réglages et Serveurs. */}
        <span className="pt-1">
          <CarteCompteRail />
        </span>
      </div>
    </nav>
  );
}
