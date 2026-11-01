"use client";

import type { ReactNode } from "react";
import { Icon } from "@/components/icons/Icon";
import { BoutonIcone } from "@/components/ui/Bouton";
import { PastillePoste } from "./PastillePoste";

/** 52 px sous la zone de sécurité du haut. */
export function EnteteTelephone({
  titre,
  retour,
  droite,
  pastille = true,
}: {
  titre: string;
  retour?: () => void;
  droite?: ReactNode;
  pastille?: boolean;
}) {
  return (
    <header className="shrink-0 bg-fond-page pt-[env(safe-area-inset-top)]">
      <div className="flex h-[52px] items-center gap-1 px-2">
        {retour ? (
          <BoutonIcone variant="discret" taille="md" libelle="Retour" onClick={retour} icone={<Icon name="chevron-left" size={24} />} />
        ) : null}
        <h1 className="min-w-0 flex-1 truncate text-body-s font-medium text-texte-principal">{titre}</h1>
        {pastille ? <PastillePoste /> : null}
        {droite}
      </div>
    </header>
  );
}
