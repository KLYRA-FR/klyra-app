"use client";

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

/** Barre du bas, cinq entrées. Cachée par la coque dans un fil ouvert. */
export function BarreOnglets() {
  const pathname = usePathname();
  const { etat } = useCompte();
  const conversations = useQuery(api.conversationsCompte.liste, etat === "connecte" ? {} : "skip");
  const attente = nombreATraiter(conversations ?? []);

  return (
    <nav aria-label="Navigation" className="shrink-0 border-t border-bordure-subtile bg-fond-surface shadow-ombre-navbar pb-[env(safe-area-inset-bottom)]">
      <ul className="flex h-14">
        {ONGLETS.map((onglet) => {
          const selectionne = actif(pathname, onglet.href);
          return (
            <li key={onglet.href} className="min-w-16 flex-1">
              <Link
                href={onglet.href}
                aria-current={selectionne ? "page" : undefined}
                className={cn(
                  "flex h-14 flex-col items-center justify-center gap-0.5 text-ui-xs",
                  selectionne ? "text-texte-principal" : "text-icone-secondaire",
                )}
              >
                <span className="relative">
                  <Icon name={onglet.icon} size={24} />
                  {onglet.href === "/chats" && attente > 0 ? (
                    <span className="absolute -top-1 -right-2 min-w-4 rounded-full bg-texte-principal px-1 text-center text-ui-xs leading-4 text-texte-inverse">
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
