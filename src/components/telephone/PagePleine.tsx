"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { Icon } from "@/components/icons/Icon";
import { BoutonIcone } from "@/components/ui/Bouton";
import { cn } from "@/lib/cn";
import { ConfirmationFeuille } from "./Feuille";
import { useZoneVisible } from "./zone-visible";

/**
 * Page pleine (socle mobile § 4.4) : formulaires longs, éditeur, visionneuse. Elle monte du bas, couvre
 * la barre d'onglets, et suit la partie visible de l'écran : le pied (l'action principale) reste juste
 * au-dessus du clavier. Barre du haut : ✕ à gauche, titre centré. Fermer avec des modifications non
 * enregistrées demande « Abandonner les modifications ? » (texte du bureau).
 * Sans `titre`, la page reçoit son propre en-tête dans `children` (écrans pas encore recomposés).
 */
export function PagePleine({
  titre,
  onFermer,
  modifie = false,
  pied,
  onEnvoyer,
  children,
}: {
  titre?: string;
  onFermer?: () => void;
  /** Des modifications non enregistrées : fermer demande d'abord. */
  modifie?: boolean;
  pied?: ReactNode;
  /** La page est un formulaire : Entrée dans un champ l'envoie. */
  onEnvoyer?: () => void;
  children: ReactNode;
}) {
  const zone = useZoneVisible();
  const [abandon, setAbandon] = useState(false);
  const fermer = () => (modifie ? setAbandon(true) : onFermer?.());
  const envoyer = (e: FormEvent) => {
    e.preventDefault();
    onEnvoyer?.();
  };
  const Racine = onEnvoyer ? "form" : "div";

  return (
    <Racine
      aria-label={onEnvoyer ? titre : undefined}
      noValidate={onEnvoyer ? true : undefined}
      onSubmit={onEnvoyer ? envoyer : undefined}
      onKeyDown={(e) => {
        if (e.key === "Escape" && onFermer && !abandon) fermer();
      }}
      style={zone}
      className="klyra-page-pleine fixed inset-x-0 z-30 flex flex-col bg-fond-page"
    >
      {titre ? (
        <header className="shrink-0 bg-fond-page pt-[env(safe-area-inset-top)]">
          <div className="flex h-[52px] items-center gap-1 px-1.5">
            {onFermer ? (
              <BoutonIcone variant="discret" className="size-11" libelle="Fermer" data-son="fermer" onClick={fermer} icone={<Icon name="x-01" size={24} />} />
            ) : (
              <span className="size-11 shrink-0" />
            )}
            <h1 className="min-w-0 flex-1 truncate text-center text-body-s font-semibold text-texte-principal">{titre}</h1>
            <span aria-hidden="true" className="size-11 shrink-0" />
          </div>
        </header>
      ) : null}
      {titre ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-2 pb-6">
          <div className="flex flex-col gap-4">{children}</div>
        </div>
      ) : (
        children
      )}
      {pied ? <div data-pied-telephone className={cn("shrink-0 border-t border-bordure-defaut bg-fond-page px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))]")}>{pied}</div> : null}
      {abandon ? (
        <ConfirmationFeuille
          titre="Abandonner les modifications ?"
          texte="Les changements de ce formulaire ne seront pas enregistrés."
          confirmer="Abandonner"
          onConfirmer={() => onFermer?.()}
          onFermer={() => setAbandon(false)}
        />
      ) : null}
    </Racine>
  );
}
