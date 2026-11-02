"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "convex/react";
import { Icon, type IconName } from "@/components/icons/Icon";
import { api } from "../../../convex/_generated/api";
import { cn } from "@/lib/cn";
import { useCompte } from "@/lib/compte";
import { nombreATraiter } from "@/lib/telephone/chats";

const ONGLETS: { href: string; label: string; icon: IconName }[] = [
  { href: "/chats", label: "Chats", icon: "message-square" },
  { href: "/planning", label: "Planning", icon: "calendar-01" },
  { href: "/equipe", label: "Agents", icon: "users-profiles-01" },
  { href: "/projets", label: "Projets", icon: "projets-dossier" },
  { href: "/plus", label: "Plus", icon: "dot-horizontal" },
];

function actif(pathname: string, href: string): boolean {
  if (href === "/chats") return pathname === "/chats" || pathname === "/chat" || pathname === "/";
  if (href === "/equipe") return pathname === "/equipe";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Barre du bas, cinq entrées. Cachée par la coque dans un fil ouvert. `vertical` : la tablette
 * (spec mobile § 9), un rail de 64 px à gauche comme celui du bureau, mêmes entrées.
 */
export function BarreOnglets({ vertical = false }: { vertical?: boolean }) {
  const pathname = usePathname();
  const { etat } = useCompte();
  const conversations = useQuery(api.conversationsCompte.liste, etat === "connecte" ? {} : "skip");
  const attente = nombreATraiter(conversations ?? []);

  return (
    <nav
      aria-label="Navigation"
      className={
        vertical
          ? "my-2 ml-2 flex w-16 shrink-0 flex-col items-center overflow-y-auto rounded-xl bg-fond-inverse-fort pt-[calc(12px+env(safe-area-inset-top))] pb-[calc(12px+env(safe-area-inset-bottom))]"
          : "shrink-0 border-t border-bordure-subtile bg-fond-surface shadow-ombre-navbar pb-[env(safe-area-inset-bottom)]"
      }
    >
      {vertical ? <Image src="/brand/logo-icone.svg" alt="" width={36} height={36} className="mb-3 shrink-0" /> : null}
      <ul className={vertical ? "flex w-full flex-col items-center gap-1" : "flex h-14"}>
        {ONGLETS.map((onglet) => {
          const selectionne = actif(pathname, onglet.href);
          return (
            <li key={onglet.href} className={vertical ? "w-14" : "min-w-16 flex-1"}>
              <Link
                href={onglet.href}
                aria-current={selectionne ? "page" : undefined}
                className={cn(
                  "flex flex-col items-center justify-center gap-0.5 text-ui-xs",
                  !vertical && (selectionne ? "h-14 text-texte-principal" : "h-14 text-icone-secondaire"),
                  vertical && "min-h-14 rounded-md transition-colors duration-[120ms] ease-sortie",
                  vertical && (selectionne ? "bg-white/14 text-texte-inverse" : "text-texte-inverse-secondaire active:bg-white/8"),
                )}
              >
                <span className="relative">
                  <Icon name={onglet.icon} size={24} />
                  {onglet.href === "/chats" && attente > 0 ? (
                    <span
                      className={cn(
                        "absolute -top-1 -right-2 min-w-4 rounded-full px-1 text-center text-ui-xs leading-4",
                        vertical ? "bg-fond-surface text-texte-principal" : "bg-texte-principal text-texte-inverse",
                      )}
                    >
                      {attente > 9 ? "9+" : attente}
                    </span>
                  ) : null}
                </span>
                {onglet.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
