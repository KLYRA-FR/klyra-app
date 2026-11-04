"use client";

import type { ReactNode } from "react";
import { Icon } from "@/components/icons/Icon";
import { BoutonIcone } from "@/components/ui/Bouton";
import { PastillePoste } from "./PastillePoste";
import { useRetour } from "./retour";

/**
 * 52 px sous la zone de sécurité du haut. `parent` : la page d'où l'on vient d'ordinaire ; « ‹ » revient
 * en arrière dans l'app, ou y va si la page a été ouverte par un lien (socle § 2.5, `useRetour`).
 * `retour` : un retour qui fait autre chose (demander avant d'abandonner des modifications).
 */
export function EnteteTelephone({
  titre,
  retour,
  parent,
  droite,
  pastille = true,
}: {
  titre: string;
  retour?: () => void;
  parent?: string;
  droite?: ReactNode;
  pastille?: boolean;
}) {
  const versParent = useRetour(parent ?? "/chats");
  const surRetour = retour ?? (parent !== undefined ? versParent : undefined);
  return (
    <header className="shrink-0 bg-fond-page pt-[env(safe-area-inset-top)]">
      <div className="flex h-[52px] items-center gap-1 px-2">
        {surRetour ? (
          <BoutonIcone variant="discret" taille="md" libelle="Retour" onClick={surRetour} icone={<Icon name="chevron-left" size={24} />} />
        ) : null}
        <h1 className="min-w-0 flex-1 truncate text-body-s font-medium text-texte-principal">{titre}</h1>
        {pastille ? <PastillePoste /> : null}
        {droite}
      </div>
    </header>
  );
}
