"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { Avatar, Kbd, Stack } from "klyra-ui";
import { cn } from "@/lib/cn";
import { Icon, type IconName } from "@/components/icons/Icon";
import { CarteUtilisation } from "@/components/chat/CarteUtilisation";
import { Bouton, BoutonIcone } from "@/components/ui/Bouton";
import { useProjects, useRoles, useWorkspace } from "@/lib/workspace";

/* Élément du menu. Actif : fond sombre du design system (comme la PillFiltre
   active), un seul à la fois. */
function MenuItem({
  href,
  active,
  icon,
  children,
  trailing,
}: {
  href: string;
  active: boolean;
  icon: ReactNode;
  children: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-9 items-center gap-3 rounded-sm px-3 text-ui font-medium no-underline",
        "transition-colors duration-[120ms] ease-sortie",
        active
          ? "klyra-surface-sombre text-texte-inverse"
          : "text-texte-secondaire hover:bg-fond-survol hover:text-texte-principal",
      )}
    >
      <span className={cn("flex w-4 justify-center", active ? "text-icone-inverse" : "text-icone-secondaire")}>{icon}</span>
      <span className="flex-1 truncate">{children}</span>
      {trailing !== undefined && (
        <span className={cn("klyra-mono text-ui-2xs", active ? "text-texte-inverse-secondaire" : "text-texte-tertiaire")}>
          {trailing}
        </span>
      )}
    </Link>
  );
}

function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex h-7 items-center justify-between pr-1 pl-3">
      <span className="text-ui-xs font-medium text-texte-tertiaire">{children}</span>
      {action}
    </div>
  );
}

/** Menu de gauche, sur toute la hauteur, posé sur le fond de page. Le logo est en haut. */
export function AppSidebar() {
  const pathname = usePathname();
  const currentId = useSearchParams().get("id");
  const { state } = useWorkspace();
  const projects = useProjects();
  const roles = useRoles();

  const nav: { href: string; label: string; icon: IconName; count?: number }[] = [
    { href: "/", label: "Accueil", icon: "home-01" },
    { href: "/chats", label: "Chats", icon: "message-square", count: state.chats.length },
    { href: "/planning", label: "Planning", icon: "calendar-01", count: state.routines.filter((r) => r.active).length },
    { href: "/equipe", label: "Équipe", icon: "users-profiles-01", count: roles.length - 1 },
    { href: "/artefacts", label: "Artefacts", icon: "layers-01", count: state.artefacts.length },
  ];

  return (
    <aside className="flex h-full w-[248px] shrink-0 flex-col px-3 pb-2">
      {/* Logo générique, à sa taille minimale (125 px de large). Aligné à
          gauche sur les icônes et les titres du menu (pl-3), et de même
          hauteur que la barre du haut (h-14) : il est centré sur la recherche.
          La zone sert aussi à déplacer la fenêtre. */}
      <div className="flex h-14 shrink-0 items-center pl-3 [-webkit-app-region:drag]">
        <Image src="/brand/logotype-generic.svg" alt="KLYRA" width={125} height={34} priority className="block" />
      </div>
      <Bouton
        variant="sombre"
        taille="md"
        iconeGauche={<Icon name="plus-01" size={20} />}
        iconeDroite={<Kbd onDark>⌘N</Kbd>}
        className="w-full justify-start px-4 text-ui"
      >
        <span className="mr-auto">Nouveau chat</span>
      </Bouton>

      {/* Menu et projets défilent si la fenêtre est basse : l'utilisation,
          les réglages et le compte restent toujours visibles en bas. */}
      <div className="-mx-3 flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-3 [scrollbar-width:none]">
        <nav aria-label="Navigation principale" className="mt-6 flex flex-col gap-0.5">
          <SectionTitle>Menu</SectionTitle>
          {nav.map((item) => (
            <MenuItem
              key={item.href}
              href={item.href}
              active={pathname === item.href}
              icon={<Icon name={item.icon} size={16} />}
              trailing={item.count}
            >
              {item.label}
            </MenuItem>
          ))}
        </nav>

        <div className="mt-6 flex flex-col gap-0.5">
          <SectionTitle
            action={
              <BoutonIcone
                taille="mini"
                icone={<Icon name="plus-01" size={16} />}
                libelle="Nouveau projet"
                className="text-icone-secondaire"
              />
            }
          >
            Projets
          </SectionTitle>
          {projects.map((project) => (
            <MenuItem
              key={project.id}
              href={`/projet?id=${project.id}`}
              active={pathname === "/projet" && currentId === project.id}
              icon={
                /* Marque carrée du projet, pleine en K1 quand il est épinglé. */
                <span
                  aria-hidden="true"
                  className={cn(
                    "size-2 rounded-[1px]",
                    project.pinned ? "bg-bleu-k1-500" : "border-[1.25px] border-current",
                  )}
                />
              }
            >
              {project.name}
            </MenuItem>
          ))}
        </div>
      </div>

      <div className="flex shrink-0 flex-col gap-2">
        <CarteUtilisation />
        <MenuItem href="/reglages" active={pathname === "/reglages"} icon={<Icon name="settings" size={16} />}>
          Réglages
        </MenuItem>
        <button
          type="button"
          className="flex w-full cursor-pointer items-center gap-2.5 rounded-md border border-bordure-subtile bg-fond-surface p-2.5 text-left shadow-ombre-xs transition-colors duration-[120ms] hover:border-bordure-forte"
        >
          <Avatar shape="circle" size="md" initials={state.currentUser.initial} alt="" gradient={false} />
          <Stack gap={1} className="min-w-0 flex-1">
            <span className="truncate text-ui-s font-medium text-texte-principal">{state.currentUser.name}</span>
            <span className="truncate text-ui-xs text-texte-tertiaire">{state.currentUser.title}</span>
          </Stack>
          <Icon name="chevron-down" size={16} className="text-icone-secondaire" />
        </button>
      </div>
    </aside>
  );
}
