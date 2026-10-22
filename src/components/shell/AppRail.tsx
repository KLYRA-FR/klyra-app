"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { UtilisationRail } from "@/components/chat/CarteUtilisation";
import { Icon, type IconName } from "@/components/icons/Icon";
import { cn } from "@/lib/cn";
import { useProjects } from "@/lib/workspace";
import { CarteCompteRail } from "./CarteCompte";
import { NAVIGATION } from "./navigation";

/** Tuile carrée du rail : icône seule, libellé au survol. */
const tuile = (active: boolean) =>
  cn(
    "flex size-11 cursor-pointer items-center justify-center rounded-md border-0 no-underline",
    "transition-colors duration-[120ms] ease-sortie",
    active ? "bg-white/14 text-texte-inverse" : "bg-transparent text-texte-inverse-secondaire hover:bg-white/8 hover:text-texte-inverse",
  );

/** Ce que le bouton du rail ouvre à côté de lui. */
const PANNEAUX = {
  fichiers: { icone: "folder-open-01", nom: "les fichiers du projet", titre: "Fichiers du projet" },
  conversations: { icone: "message-square", nom: "les conversations", titre: "Conversations" },
} as const satisfies Record<string, { icone: IconName; nom: string; titre: string }>;

/**
 * Menu réduit, en noir, quand on est dans un projet ou dans les chats : il
 * laisse la place au panneau à côté (fichiers du projet, ou agents et
 * conversations). Signe KLYRA blanc en haut (blanc sur noir, autorisé).
 */
export function AppRail({
  panneau,
  filesOpen,
  onToggleFiles,
}: {
  panneau: keyof typeof PANNEAUX;
  filesOpen: boolean;
  onToggleFiles: () => void;
}) {
  const bouton = PANNEAUX[panneau];
  const projects = useProjects();
  const currentId = useSearchParams().get("id");
  const pathname = usePathname();

  return (
    <nav
      aria-label="Navigation principale"
      className="my-2 ml-2 flex w-[64px] shrink-0 flex-col items-center gap-1 rounded-xl bg-fond-inverse-fort pt-4 pb-3 in-data-[shell=desktop]:pt-10"
    >
      {/* Zone de déplacement de la fenêtre dans l'app de bureau. */}
      <div className="mb-5 flex h-8 items-center [-webkit-app-region:drag]">
        <Image src="/brand/logo-signe-white.svg" alt="KLYRA" width={24} height={24} priority />
      </div>

      {NAVIGATION.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-label={item.label}
          title={item.label}
          aria-current={pathname === item.href ? "page" : undefined}
          className={tuile(
            pathname === item.href || (item.href === "/chats" && pathname === "/chat" && panneau === "conversations"),
          )}
        >
          <Icon name={item.icon} size={20} />
        </Link>
      ))}

      {/* Les projets, comme dans le menu déplié : une tuile par projet, son initiale. */}
      <span aria-hidden="true" className="my-2 h-px w-6 bg-white/12" />
      <Link
        href="/projets"
        aria-label="Projets"
        title="Projets"
        className={tuile(pathname === "/projets")}
      >
        <Icon name="folder" size={20} />
      </Link>
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
              "flex size-9 items-center justify-center rounded-sm text-ui-xs font-semibold no-underline transition-colors duration-[120ms] ease-sortie",
              actif
                ? "bg-texte-inverse text-texte-principal"
                : p.pinned
                  ? "bg-bleu-k1-500 text-texte-inverse hover:bg-bleu-k1-500/85"
                  : "bg-white/10 text-texte-inverse hover:bg-white/16",
            )}
          >
            {p.name.charAt(0).toUpperCase()}
          </Link>
        );
      })}

      <span aria-hidden="true" className="my-2 h-px w-6 bg-white/12" />
      <button
        type="button"
        onClick={onToggleFiles}
        aria-pressed={filesOpen}
        aria-label={filesOpen ? `Masquer ${bouton.nom}` : `Afficher ${bouton.nom}`}
        title={bouton.titre}
        className={tuile(filesOpen)}
      >
        <Icon name={bouton.icone} size={20} />
      </button>

      <div className="mt-auto flex flex-col items-center gap-2">
        <UtilisationRail />
        <span aria-hidden="true" className="h-px w-6 bg-white/12" />
        <Link href="/reglages" aria-label="Réglages" title="Réglages" className={tuile(pathname === "/reglages")}>
          <Icon name="settings" size={20} />
        </Link>
        <CarteCompteRail />
      </div>
    </nav>
  );
}
