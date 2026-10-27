"use client";

import { Fragment } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Icon } from "@/components/icons/Icon";
import { useRoles } from "@/lib/workspace";

interface Etape {
  label: string;
  href?: string;
}

/** Nom de chaque page du menu. */
const PAGES: Record<string, string> = {
  "/": "Accueil",
  "/chats": "Chats",
  "/projets": "Projets",
  "/fichiers": "Fichiers",
  "/equipe": "Équipe",
  "/planning": "Planning",
  "/routines": "Routines",
  "/artefacts": "Artefacts",
  "/reglages": "Réglages",
};

/** Les écrans d'une fiche d'agent (`/equipe?agent=…&mode=…`). */
const MODES: Record<string, string> = {
  modifier: "Modifier",
  lou: "Avec Lou",
  historique: "Historique",
};

/**
 * Fil d'Ariane de la barre du haut : où l'on est (« Équipe › Hugo › Modifier »).
 * Chaque étape avant la dernière ramène à son niveau.
 */
export function FilAriane() {
  const pathname = usePathname();
  const params = useSearchParams();
  const roles = useRoles();

  const etapes: Etape[] = [{ label: PAGES[pathname] ?? "KLYRA", href: pathname }];
  if (pathname === "/equipe") {
    const agent = roles.find((r) => r.id === params.get("agent"));
    const mode = params.get("mode");
    if (params.get("nouveau")) etapes.push({ label: "Nouvel agent" });
    else if (agent) {
      etapes.push({ label: agent.name, href: `/equipe?agent=${agent.id}` });
      if (mode && MODES[mode]) {
        if (mode === "lou") etapes.push({ label: MODES.modifier, href: `/equipe?agent=${agent.id}&mode=modifier` });
        etapes.push({ label: MODES[mode] });
      }
    }
  }

  return (
    <nav aria-label="Fil d’Ariane" className="min-w-0">
      <ol className="m-0 flex min-w-0 list-none items-center gap-1.5 p-0 text-ui-s">
        {etapes.map((etape, i) => {
          const dernier = i === etapes.length - 1;
          return (
            <Fragment key={`${etape.label}-${i}`}>
              {i > 0 && (
                <li aria-hidden="true" className="flex text-icone-secondaire">
                  <Icon name="chevron-right" size={14} />
                </li>
              )}
              <li className="min-w-0 truncate">
                {dernier || !etape.href ? (
                  <span aria-current={dernier ? "page" : undefined} className="font-medium text-texte-principal">
                    {etape.label}
                  </span>
                ) : (
                  <Link
                    href={etape.href}
                    className="text-texte-tertiaire no-underline transition-colors duration-[120ms] hover:text-texte-accent"
                  >
                    {etape.label}
                  </Link>
                )}
              </li>
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
