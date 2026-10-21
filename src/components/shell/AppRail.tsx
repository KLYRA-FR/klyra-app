"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Avatar } from "klyra-ui";
import { UtilisationRail } from "@/components/chat/CarteUtilisation";
import { Icon, type IconName } from "@/components/icons/Icon";
import { cn } from "@/lib/cn";
import { useWorkspace } from "@/lib/workspace";

const NAV: { href: string; label: string; icon: IconName }[] = [
  { href: "/", label: "Accueil", icon: "home-01" },
  { href: "/chats", label: "Chats", icon: "message-square" },
  { href: "/projets", label: "Projets", icon: "folder" },
  { href: "/planning", label: "Planning", icon: "calendar-01" },
  { href: "/equipe", label: "Équipe", icon: "users-profiles-01" },
  { href: "/artefacts", label: "Artefacts", icon: "layers-01" },
];

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
          className={tuile(
            pathname === item.href ||
              (item.href === "/projets" && pathname === "/projet") ||
              (item.href === "/chats" && pathname === "/chat" && panneau === "conversations"),
          )}
        >
          <Icon name={item.icon} size={20} />
        </Link>
      ))}

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
        <Avatar shape="circle" size="md" initials={state.currentUser.initial} alt={state.currentUser.name} gradient={false} />
      </div>
    </nav>
  );
}
