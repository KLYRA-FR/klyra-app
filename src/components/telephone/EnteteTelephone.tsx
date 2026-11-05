"use client";

import { useState, type ReactNode, type UIEvent } from "react";
import { Icon } from "@/components/icons/Icon";
import { BoutonIcone } from "@/components/ui/Bouton";
import { cn } from "@/lib/cn";
import { BandeauReseau } from "./BandeauReseau";
import { PastillePoste } from "./PastillePoste";
import { useRetour } from "./retour";

/**
 * La barre du haut (socle mobile § 2.2), 52 px sous la zone de sécurité, deux formes :
 * - page poussée : « ‹ » (`parent`, ou `retour` qui fait autre chose), le titre court à gauche, les
 *   actions ; pas de pastille. « ‹ » revient en arrière dans l'app, ou va au parent si la page a été
 *   ouverte par un lien (§ 2.5, `useRetour`) ;
 * - page d'onglet (`onglet`) : la pastille de l'ordinateur à gauche, le titre court au centre (il
 *   n'apparaît qu'une fois le grand titre passé sous la barre, `defilee`), les actions à droite.
 */
export function EnteteTelephone({
  titre,
  retour,
  parent,
  droite,
  pastille,
  onglet = false,
  defilee = false,
}: {
  titre: string;
  retour?: () => void;
  parent?: string;
  droite?: ReactNode;
  /** Montrer la pastille sur une page qui n'est pas d'onglet (D-3 : par défaut, seulement les onglets). */
  pastille?: boolean;
  onglet?: boolean;
  defilee?: boolean;
}) {
  const versParent = useRetour(parent ?? "/chats");
  const surRetour = retour ?? (parent !== undefined ? versParent : undefined);
  const avecPastille = pastille ?? onglet;
  return (
    <header data-defilee={(onglet && defilee) || undefined} className="klyra-entete relative z-20 shrink-0 bg-fond-page pt-[env(safe-area-inset-top)]">
      <div className="flex h-[52px] items-center gap-1 pr-1.5 pl-2">
        {surRetour ? (
          <BoutonIcone variant="discret" className="size-11" libelle="Retour" onClick={surRetour} icone={<Icon name="chevron-left" size={24} />} />
        ) : null}
        {avecPastille ? (
          <span className="flex shrink-0 pl-2">
            <PastillePoste />
          </span>
        ) : null}
        {onglet ? (
          <p aria-hidden="true" className="klyra-entete-titre min-w-0 flex-1 truncate text-center text-body-s font-semibold text-texte-principal">
            {titre}
          </p>
        ) : (
          <h1 className={cn("min-w-0 flex-1 truncate text-body-s font-semibold text-texte-principal", !surRetour && "pl-2")}>{titre}</h1>
        )}
        {droite ? <div className="flex shrink-0 items-center">{droite}</div> : onglet ? <span aria-hidden="true" className="w-11 shrink-0" /> : null}
      </div>
      <BandeauReseau />
    </header>
  );
}

/**
 * Le grand titre d'une page d'onglet (§ 2.4) : 28 px, une partie facultative en graisse normale
 * (« **Planning** des agents »), un sous-titre facultatif, et un surtitre (la date de Chats, lot 2).
 * `replie` : la page a défilé, il passe dans la barre du haut.
 */
export function TitrePage({ fort, leger, sous, surtitre, replie = false }: { fort: string; leger?: string; sous?: string; surtitre?: string; replie?: boolean }) {
  return (
    <div className={cn("grid shrink-0 transition-[grid-template-rows,opacity] duration-[220ms] ease-sortie", replie ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr]")}>
      <div className="min-h-0 overflow-hidden">
        <div className="px-4 pt-1 pb-4">
          {surtitre ? <p className="mb-1 text-body-s text-texte-secondaire">{surtitre}</p> : null}
          <h1 className="text-h3 leading-[1.05] font-semibold tracking-title text-texte-principal">
            {fort}
            {leger ? <span className="font-normal"> {leger}</span> : null}
          </h1>
          {sous ? <p className="mt-1.5 text-ui text-texte-secondaire">{sous}</p> : null}
        </div>
      </div>
    </div>
  );
}

/**
 * Une page d'onglet (Chats, Planning, Agents, Projets, Plus) : la barre du haut avec la pastille, le
 * grand titre, puis le contenu, qui garde son propre défilement. Dès que le contenu défile, le grand
 * titre passe dans la barre (fond flouté, filet) ; il revient quand le contenu est remonté en haut.
 * `grandTitre` : un grand titre autre que le nom de l'onglet (« Bonjour Camille » sur Chats), la barre
 * gardant le nom de l'onglet.
 */
export function PageOnglet({
  titre,
  leger,
  sous,
  surtitre,
  grandTitre,
  droite,
  children,
  className,
}: {
  titre: string;
  leger?: string;
  sous?: string;
  surtitre?: string;
  grandTitre?: string;
  droite?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const [defilee, setDefilee] = useState(false);
  /* Le défilement d'un descendant (capture) : replié au-delà de 24 px, déplié seulement tout en haut. */
  const suivre = (e: UIEvent<HTMLDivElement>) => {
    const cible = e.target as HTMLElement;
    if (!(cible instanceof HTMLElement) || cible.scrollHeight <= cible.clientHeight) return;
    if (!defilee && cible.scrollTop > 24) setDefilee(true);
    else if (defilee && cible.scrollTop <= 0) setDefilee(false);
  };
  return (
    <div className={cn("relative flex min-h-0 flex-1 flex-col", className)} onScrollCapture={suivre}>
      <EnteteTelephone onglet titre={leger ? `${titre} ${leger}` : titre} droite={droite} defilee={defilee} />
      <TitrePage fort={grandTitre ?? titre} leger={grandTitre ? undefined : leger} sous={sous} surtitre={surtitre} replie={defilee} />
      {children}
    </div>
  );
}
