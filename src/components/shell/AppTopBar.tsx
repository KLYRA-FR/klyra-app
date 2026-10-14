"use client";

import { Input, Kbd } from "klyra-ui";
import { Icon } from "@/components/icons/Icon";
import { Bouton, BoutonIcone } from "@/components/ui/Bouton";
import { FilAriane } from "./FilAriane";

/**
 * Barre du haut, au-dessus du contenu : fil d'Ariane à gauche, recherche au
 * centre, actions à droite. Elle sert aussi à déplacer la fenêtre dans l'app de bureau ; ses
 * contrôles sortent de la zone de déplacement.
 */
export function AppTopBar() {
  return (
    <header className="flex h-14 shrink-0 items-center gap-4 pr-3 [-webkit-app-region:drag]">
      {/* Où l'on est, à gauche de la recherche. */}
      <div className="flex min-w-0 flex-1 pl-1 [-webkit-app-region:no-drag]">
        <FilAriane />
      </div>

      <div className="w-full max-w-[440px] shrink-0 [-webkit-app-region:no-drag]">
        <Input
          size="sm"
          placeholder="Rechercher un chat, un projet, un fichier"
          aria-label="Rechercher"
          leftIcon={<Icon name="search-01" size={16} className="text-icone-secondaire" />}
          rightIcon={<Kbd>⌘K</Kbd>}
          className="rounded-sm border-bordure-subtile bg-fond-surface"
        />
      </div>

      <div className="flex flex-1 items-center justify-end gap-1.5 [-webkit-app-region:no-drag]">
        <BoutonIcone
          taille="compact"
          icone={<Icon name="bell-01" size={20} />}
          libelle="Notifications"
          className="text-icone-secondaire hover:text-icone-defaut"
        />
        <BoutonIcone
          taille="compact"
          icone={<Icon name="help-circle-contained" size={20} />}
          libelle="Aide"
          className="text-icone-secondaire hover:text-icone-defaut"
        />
        <Bouton variant="blanc" taille="compact" iconeGauche={<Icon name="users-profiles-plus" size={16} />} className="ml-1">
          Inviter
        </Bouton>
      </div>
    </header>
  );
}
