"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { UtilisationRail } from "@/components/chat/CarteUtilisation";
import { Icon, type IconName } from "@/components/icons/Icon";
import { cn } from "@/lib/cn";
import { useProjects } from "@/lib/workspace";
import { CarteCompteRail } from "./CarteCompte";
import { NAVIGATION } from "./navigation";
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
  fichiers: { icone: "layout-left", nom: "Fichiers", titre: "Fichiers du projet", cible: "les fichiers du projet" },
  conversations: { icone: "layout-left", nom: "Liste", titre: "Agents et conversations", cible: "les conversations" },
} as const satisfies Record<string, { icone: IconName; nom: string; titre: string; cible: string }>;

const SEPARATEUR = <span aria-hidden="true" className="my-1.5 h-px w-8 shrink-0 bg-white/12" />;

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
  const currentId = useSearchParams().get("id");
  const pathname = usePathname();

  return (
    <nav
      aria-label="Navigation principale"
      className="my-2 ml-2 flex w-[72px] shrink-0 flex-col items-center rounded-xl bg-fond-inverse-fort pt-4 pb-3 in-data-[shell=desktop]:pt-9"
    >
      {/* Le logo-icône KLYRA (carré K1, signe blanc) ; la zone sert aussi à déplacer la fenêtre. */}
      <Link href="/" aria-label="KLYRA, accueil" className="mb-3 flex h-10 shrink-0 items-center [-webkit-app-region:drag]">
        <Image src="/brand/logo-icone.svg" alt="" width={36} height={36} priority />
      </Link>

      {/* Le milieu défile si la fenêtre est basse : le bas du rail reste visible. */}
      <div className="flex min-h-0 w-full flex-1 flex-col items-center gap-0.5 overflow-y-auto [scrollbar-width:none]">
        {NAVIGATION.map((item) => {
          const active = pathname === item.href || (item.href === "/chats" && (pathname === "/equipe" || (pathname === "/chat" && panneau === "conversations")));
          return (
            <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} title={item.label} className={entree(active)}>
              <Entree icone={item.icon} nom={item.label} active={active} />
            </Link>
          );
        })}

        {SEPARATEUR}
        {/* Les projets : une tuile par projet, son initiale (pleine en K1 si épinglé). */}
        <Link href="/projets" title="Projets" className={entree(pathname === "/projets")}>
          <Entree icone="projets-dossier" nom="Projets" active={pathname === "/projets"} />
        </Link>
        <div className="flex flex-col items-center gap-1.5 py-1">
          {projects.map((p) => {
            const actif = pathname === "/projet" && currentId === p.id;
            return (
              <Link
                key={p.id}
                href={`/projet?id=${p.id}`}
                aria-label={p.name}
                title={p.name}
                aria-current={actif ? "page" : undefined}
                className={cn(
                  "flex size-10 items-center justify-center rounded-md text-ui-s font-semibold no-underline transition-[background-color,box-shadow] duration-[120ms] ease-sortie",
                  p.pinned ? "bg-bleu-k1-500 text-texte-inverse" : "bg-white/10 text-texte-inverse hover:bg-white/16",
                  actif && "ring-2 ring-texte-inverse ring-offset-2 ring-offset-fond-inverse-fort",
                )}
              >
                {p.name.charAt(0).toUpperCase()}
              </Link>
            );
          })}
        </div>

        {bouton && onToggleFiles && (
          <>
            {SEPARATEUR}
            <button
              type="button"
              onClick={onToggleFiles}
              aria-pressed={filesOpen}
              aria-label={filesOpen ? `Masquer ${bouton.cible}` : `Afficher ${bouton.cible}`}
              title={bouton.titre}
              className={entree(filesOpen)}
            >
              <Entree icone={bouton.icone} nom={bouton.nom} active={filesOpen} />
            </button>
          </>
        )}
      </div>

      <div className="flex shrink-0 flex-col items-center gap-1 pt-2">
        <PastilleMaj />
        <UtilisationRail />
        {SEPARATEUR}
        {/* Les réglages s'ouvrent d'un clic sur l'avatar. */}
        <span className="pt-1">
          <CarteCompteRail />
        </span>
      </div>
    </nav>
  );
}
