"use client";

import type { ReactNode } from "react";
import { cibleLien } from "@/lib/apercu/liens";

/** Ce que la visionneuse fait d'un lien cliqué (cf. `suivreLien` dans Visionneuse). */
export type SuivreLien = (href: string) => void;

const STYLE = "cursor-pointer text-texte-accent underline decoration-current/40 underline-offset-2 [overflow-wrap:anywhere] hover:decoration-current";

/**
 * Un lien d'un document. Le clic ne navigue jamais dans la page de l'app : il
 * passe par `suivre`. Un lien ignoré (javascript:, data:, hors du projet) reste
 * du texte simple.
 */
export function LienDocument({ href, titre, chemin, suivre, children }: { href: string; titre?: string | null; chemin: string; suivre: SuivreLien; children: ReactNode }) {
  const cible = cibleLien(href, chemin);
  if (cible.type === "ignore") {
    return (
      <span data-lien-ignore="" title="Lien ignoré : il ne mène ni à une adresse web, ni à un fichier du projet.">
        {children}
      </span>
    );
  }
  const infobulle = titre || (cible.type === "externe" ? cible.url : cible.type === "fichier" ? cible.chemin : `#${cible.ancre}`);
  return (
    <a
      href={cible.type === "externe" ? cible.url : "#"}
      data-lien={cible.type}
      title={infobulle}
      onClick={(e) => {
        e.preventDefault();
        suivre(href);
      }}
      onAuxClick={(e) => e.preventDefault()}
      className={STYLE}
    >
      {children}
    </a>
  );
}
