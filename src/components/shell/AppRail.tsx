"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Avatar } from "klyra-ui";
import { Icon, type IconName } from "@/components/icons/Icon";
import { cn } from "@/lib/cn";
import { useWorkspace } from "@/lib/workspace";

const NAV: { href: string; label: string; icon: IconName }[] = [
  { href: "/", label: "Accueil", icon: "home-01" },
  { href: "/chats", label: "Chats", icon: "message-square" },
  { href: "/projets", label: "Projets", icon: "folder" },
  { href: "/fichiers", label: "Fichiers", icon: "image-01" },
  { href: "/equipe", label: "Équipe", icon: "users-profiles-01" },
];

/** Tuile carrée du rail : icône seule, libellé au survol. */
const tuile = (active: boolean) =>
  cn(
    "flex size-11 cursor-pointer items-center justify-center rounded-md border-0 no-underline",
    "transition-colors duration-[120ms] ease-sortie",
    active ? "bg-white/14 text-texte-inverse" : "bg-transparent text-texte-inverse-secondaire hover:bg-white/8 hover:text-texte-inverse",
  );

/**
 * Menu réduit, en noir, quand on est dans un projet : il laisse la place au
 * panneau du projet. Signe KLYRA blanc en haut (blanc sur noir, autorisé).
 */
export function AppRail({ filesOpen, onToggleFiles }: { filesOpen: boolean; onToggleFiles: () => void }) {
  const pathname = usePathname();
  const { state } = useWorkspace();

  return (
    <nav
      aria-label="Navigation principale"
      className="my-2 ml-2 flex w-[64px] shrink-0 flex-col items-center gap-1 rounded-xl bg-fond-inverse-fort pt-4 pb-3 in-data-[shell=desktop]:pt-10"
    >
      {/* Zone de déplacement de la fenêtre dans l'app de bureau. */}
      <div className="mb-5 flex h-8 items-center [-webkit-app-region:drag]">
        <Image src="/brand/logo-signe-white.svg" alt="KLYRA" width={24} height={24} priority />
      </div>

      {NAV.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-label={item.label}
          title={item.label}
          aria-current={pathname === item.href ? "page" : undefined}
          className={tuile(pathname === item.href || (item.href === "/projets" && pathname === "/projet"))}
        >
          <Icon name={item.icon} size={20} />
        </Link>
      ))}

      <span aria-hidden="true" className="my-2 h-px w-6 bg-white/12" />
      <button
        type="button"
        onClick={onToggleFiles}
        aria-pressed={filesOpen}
        aria-label={filesOpen ? "Masquer les fichiers du projet" : "Afficher les fichiers du projet"}
        title="Fichiers du projet"
        className={tuile(filesOpen)}
      >
        <Icon name="folder-open-01" size={20} />
      </button>

      <div className="mt-auto flex flex-col items-center gap-2">
        <Link href="/reglages" aria-label="Réglages" title="Réglages" className={tuile(pathname === "/reglages")}>
          <Icon name="settings" size={20} />
        </Link>
        <Avatar shape="circle" size="md" initials={state.currentUser.initial} alt={state.currentUser.name} gradient={false} />
      </div>
    </nav>
  );
}
