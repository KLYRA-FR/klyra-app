"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Compteur } from "@/components/ui/Compteur";
import { Icon, type IconName } from "@/components/icons/Icon";
import { BoutonIcone } from "@/components/ui/Bouton";
import { cn } from "@/lib/cn";
import { CocheChoix, EnvoiEnCours, PisteInterrupteur } from "./Controles";
import { useAppuiLong } from "./Feuille";
import { jouer } from "@/lib/sons/sons";

/**
 * Listes et cartes du téléphone (socle mobile § 3) : le contenu se pose en groupes blancs et en
 * cartes sur le fond de page, comme au bureau (D-1). Les écrans des lots suivants s'en servent.
 */

/** En-tête de section : titre, compte, lien facultatif à droite (« Tout voir › », cible 44). */
export function SectionListe({ titre, compte, compteAccent = false, lien, children, className }: { titre: string; compte?: number; compteAccent?: boolean; lien?: { libelle: string; href: string }; children: ReactNode; className?: string }) {
  return (
    <section aria-label={titre} className={className}>
      <div className="flex items-baseline gap-1.5 px-1 pb-2">
        <h2 className="text-ui font-semibold text-texte-principal">
          {titre}
          {compte !== undefined ? <span className={cn("ml-1.5", compteAccent ? "font-semibold text-texte-accent" : "font-normal text-texte-secondaire")}>{compte}</span> : null}
        </h2>
        {lien ? (
          <Link href={lien.href} className="relative ml-auto inline-flex items-center gap-0.5 text-ui font-medium text-texte-secondaire after:absolute after:-inset-x-2 after:-inset-y-3.5">
            {lien.libelle}
            <Icon name="chevron-right" size={16} />
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/** Le groupe blanc qui porte des lignes : arrondi, filet intérieur, ombre légère. */
export function GroupeListe({ children, className }: { children: ReactNode; className?: string }) {
  return <ul className={cn("overflow-hidden rounded-xl border border-bordure-subtile bg-fond-surface shadow-ombre-xs", className)}>{children}</ul>;
}

/** Une étiquette : un nom lisible, jamais un identifiant (C-2). */
export function Etiquette({ ton = "neutre", children }: { ton?: "neutre" | "bleue" | "orange"; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-sm px-1.5 text-ui-xs font-medium whitespace-nowrap",
        ton === "bleue" ? "bg-fond-teinte-bleue text-texte-accent" : ton === "orange" ? "bg-fond-tag-orange text-texte-accent-orange" : "bg-fond-surface-grise text-texte-principal",
      )}
    >
      {children}
    </span>
  );
}

/** La tuile d'icône d'une ligne (36 px). `bleue` : l'élément mis en avant. */
export function TuileIcone({ icone, bleue = false }: { icone: IconName; bleue?: boolean }) {
  return (
    <span aria-hidden="true" className={cn("flex size-9 shrink-0 items-center justify-center rounded-md-moins", bleue ? "bg-fond-teinte-bleue text-icone-accent" : "bg-fond-surface-grise text-icone-defaut")}>
      <Icon name={icone} size={20} />
    </span>
  );
}

const RETRAITS = { aucun: "before:left-4", tuile: "before:left-16", avatar: "before:left-[68px]" } as const;

/**
 * Une ligne de liste (§ 3.2) : début (avatar 40, tuile 36, case), nom et étiquette, méta à droite
 * (l'heure, ou « En cours » en bleu), ligne 2 sur une ou deux lignes, fin (chevron, valeur, contrôle).
 * Pressée : fond de survol. Inactive : nom grisé et sa raison dessous, jamais une ligne grise sans raison.
 * D-7 : un élément qui a sa page n'a pas de « ⋯ » visible (appui long, et un bouton pour les lecteurs
 * d'écran) ; un élément sans page garde son « ⋯ » (`menuVisible`).
 */
export function LigneListe({
  id,
  href,
  onClick,
  debut,
  retrait = "aucun",
  nom,
  nonLu = false,
  etiquette,
  meta,
  metaAccent = false,
  ligne2,
  uneLigne = false,
  fin,
  danger = false,
  inactive = false,
  raison,
  onMenu,
  menuVisible = false,
}: {
  /** Une ancre (un réglage trouvé par la recherche, éclairé en arrivant). */
  id?: string;
  href?: string;
  onClick?: () => void;
  debut?: ReactNode;
  retrait?: keyof typeof RETRAITS;
  nom: ReactNode;
  nonLu?: boolean;
  etiquette?: ReactNode;
  meta?: ReactNode;
  metaAccent?: boolean;
  ligne2?: ReactNode;
  uneLigne?: boolean;
  /** « chevron », ou ce qui se pose à droite (valeur et chevron, interrupteur, coche). */
  fin?: "chevron" | ReactNode;
  danger?: boolean;
  inactive?: boolean;
  /** Pourquoi la ligne est inactive (P-7). */
  raison?: ReactNode;
  onMenu?: () => void;
  menuVisible?: boolean;
}) {
  const appui = useAppuiLong(() => onMenu?.());
  const libelleMenu = `Actions pour ${typeof nom === "string" ? nom : "cet élément"}`;
  const corps = (
    <>
      {debut}
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span
            className={cn(
              "min-w-0 truncate text-body-s",
              nonLu ? "font-semibold" : "font-medium",
              danger ? "text-texte-erreur" : inactive ? "text-texte-tertiaire" : "text-texte-principal",
            )}
          >
            {nom}
          </span>
          {etiquette}
          {meta ? <span className={cn("ml-auto shrink-0 pl-2 text-ui-xs whitespace-nowrap", metaAccent ? "font-semibold text-texte-accent" : "text-texte-secondaire")}>{meta}</span> : null}
        </span>
        {ligne2 ? <span className={cn("mt-0.5 block text-ui leading-[1.35] text-texte-secondaire", uneLigne ? "truncate" : "line-clamp-2")}>{ligne2}</span> : null}
        {inactive && raison ? <span className="mt-0.5 block text-ui-xs text-texte-secondaire">{raison}</span> : null}
      </span>
      {fin === "chevron" ? <Icon name="chevron-right" size={20} className="shrink-0 text-icone-secondaire" /> : fin}
    </>
  );
  const classeCorps = cn(
    "flex min-h-14 min-w-0 flex-1 items-center gap-3 py-2.5 pr-3 pl-4 text-left no-underline transition-colors duration-[120ms] ease-sortie",
    retrait === "avatar" && "min-h-[72px]",
    !inactive && "active:bg-fond-survol data-[presse]:bg-fond-survol",
  );
  return (
    <li
      id={id}
      className={cn(
        "relative flex items-center",
        id && "klyra-reglage scroll-mt-4",
        "[&:not(:first-child)]:before:absolute [&:not(:first-child)]:before:top-0 [&:not(:first-child)]:before:right-0 [&:not(:first-child)]:before:h-px [&:not(:first-child)]:before:bg-bordure-defaut [&:not(:first-child)]:before:content-['']",
        RETRAITS[retrait],
      )}
    >
      {href && !inactive ? (
        <Link href={href} {...(onMenu ? appui : {})} className={classeCorps}>
          {corps}
        </Link>
      ) : !onClick && !onMenu && !inactive ? (
        /* Une valeur lue, ou une ligne dont le contrôle est à sa fin (un bouton n'en contient pas un autre). */
        <div className={classeCorps}>{corps}</div>
      ) : (
        <button type="button" disabled={inactive || !onClick} onClick={onClick} {...(onMenu ? appui : {})} className={cn(classeCorps, "disabled:cursor-default")}>
          {corps}
        </button>
      )}
      {onMenu && menuVisible ? (
        <BoutonIcone variant="discret" className="mr-1 size-11" libelle={libelleMenu} aria-haspopup="dialog" onClick={onMenu} icone={<Icon name="dot-horizontal" size={20} />} />
      ) : onMenu ? (
        <button type="button" className="sr-only" aria-haspopup="dialog" onClick={onMenu}>
          {libelleMenu}
        </button>
      ) : null}
    </li>
  );
}

const ITEM_LISTE =
  "relative [&:not(:first-child)]:before:absolute [&:not(:first-child)]:before:top-0 [&:not(:first-child)]:before:right-0 [&:not(:first-child)]:before:left-4 [&:not(:first-child)]:before:h-px [&:not(:first-child)]:before:bg-bordure-defaut [&:not(:first-child)]:before:content-['']";

/** Une phrase sous l'en-tête d'une section. */
export function SousSection({ children }: { children: ReactNode }) {
  return <p className="-mt-0.5 mx-1 mb-2.5 text-ui-xs leading-[1.4] text-texte-secondaire">{children}</p>;
}

/** Une phrase sous un groupe (ce qui reste, ce qui attend). */
export function NoteListe({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("mx-1 mt-2.5 text-ui-xs leading-[1.4] text-texte-secondaire", className)}>{children}</p>;
}

/** Une valeur lue, à droite d'une ligne. */
export function ValeurLigne({ children }: { children: ReactNode }) {
  return <span className="shrink-0 text-right text-ui text-texte-secondaire">{children}</span>;
}

/**
 * Une ligne d'interrupteur (§ 6.3) : toute la ligne est la cible, `role="switch"`. `envoi` : un geste
 * sur l'ordinateur attend sa réponse (« Envoi… », piste à 45 %) ; la valeur reste la dernière confirmée.
 */
export function LigneInterrupteur({
  id,
  nom,
  ligne2,
  uneLigne = false,
  actif,
  disabled = false,
  envoi = false,
  onChange,
}: {
  id?: string;
  nom: string;
  ligne2?: ReactNode;
  uneLigne?: boolean;
  actif: boolean;
  disabled?: boolean;
  envoi?: boolean;
  onChange: (actif: boolean) => void;
}) {
  return (
    <li id={id} className={cn(ITEM_LISTE, id && "klyra-reglage scroll-mt-4")}>
      <button
        type="button"
        role="switch"
        aria-checked={actif}
        aria-label={nom}
        aria-busy={envoi || undefined}
        disabled={disabled || envoi}
        onClick={() => {
          jouer(actif ? "desactive" : "active");
          onChange(!actif);
        }}
        className="flex min-h-14 w-full items-center gap-2.5 py-2.5 pr-3.5 pl-4 text-left transition-colors duration-[120ms] ease-sortie active:bg-fond-survol disabled:active:bg-transparent disabled:[&_[data-piste]]:opacity-45"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-body-s font-medium text-texte-principal">{nom}</span>
          {ligne2 ? <span className={cn("mt-0.5 block text-ui leading-[1.35] text-texte-secondaire", uneLigne ? "truncate" : "line-clamp-2")}>{ligne2}</span> : null}
        </span>
        {envoi ? <EnvoiEnCours /> : null}
        <span data-piste className="flex shrink-0">
          <PisteInterrupteur actif={actif} />
        </span>
      </button>
    </li>
  );
}

/**
 * Une ligne de choix unique (§ 6.3) : `role="radio"`, la coche à droite de la ligne choisie, jamais la
 * teinte seule. Inactive : nom grisé, étiquette et raison dessous (P-7, P-8).
 */
export function LigneChoix({
  id,
  nom,
  ligne2,
  meta,
  etiquette,
  raison,
  choisi,
  inactive = false,
  envoi = false,
  onChoisir,
  debut,
  finSiPasChoisi,
}: {
  id?: string;
  nom: string;
  ligne2?: ReactNode;
  /** Une tuile devant le nom : le filet se décale d'autant. */
  debut?: ReactNode;
  /** Ce qui se pose à droite tant que la ligne n'est pas choisie (un compte). */
  finSiPasChoisi?: ReactNode;
  meta?: ReactNode;
  etiquette?: ReactNode;
  raison?: ReactNode;
  choisi: boolean;
  inactive?: boolean;
  envoi?: boolean;
  onChoisir?: () => void;
}) {
  return (
    <li id={id} className={cn(ITEM_LISTE, debut ? "[&:not(:first-child)]:before:left-16" : undefined, id && "klyra-reglage scroll-mt-4")}>
      <button
        type="button"
        role="radio"
        aria-checked={choisi}
        aria-busy={envoi || undefined}
        disabled={inactive || envoi}
        onClick={onChoisir}
        className="flex min-h-14 w-full items-center gap-3 py-2.5 pr-3 pl-4 text-left transition-colors duration-[120ms] ease-sortie active:bg-fond-survol disabled:active:bg-transparent disabled:[&_[data-coche]]:opacity-45"
      >
        {debut}
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className={cn("min-w-0 truncate text-body-s font-medium", inactive ? "text-texte-tertiaire" : "text-texte-principal")}>{nom}</span>
            {etiquette}
          </span>
          {inactive && raison ? <span className="mt-0.5 block text-ui-xs text-texte-secondaire">{raison}</span> : null}
          {!inactive && ligne2 ? <span className="mt-0.5 line-clamp-2 block text-ui leading-[1.35] text-texte-secondaire">{ligne2}</span> : null}
        </span>
        {meta ? <span className="shrink-0 text-ui-xs text-texte-secondaire">{meta}</span> : null}
        {envoi ? (
          <EnvoiEnCours />
        ) : inactive ? null : !choisi && finSiPasChoisi ? (
          finSiPasChoisi
        ) : (
          <span data-coche className="flex shrink-0">
            <CocheChoix choisi={choisi} />
          </span>
        )}
      </button>
    </li>
  );
}

/** Le compte de ce qui attend sur un autre serveur (K1, la couleur « non lu » du bureau). */
export function CompteEspace({ valeur, libelle }: { valeur: number; libelle: string }) {
  return (
    <span aria-label={libelle} className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-pill bg-fond-accent px-1.5 text-ui-xs font-semibold text-texte-inverse">
      {valeur}
    </span>
  );
}

/** Une ligne qui ouvre une page publique hors de l'app. */
export function LigneLienExterne({ id, href, nom }: { id?: string; href: string; nom: string }) {
  return (
    <li id={id} className={cn(ITEM_LISTE, id && "klyra-reglage scroll-mt-4")}>
      <a href={href} target="_blank" rel="noopener noreferrer" className="flex min-h-14 items-center gap-3 py-2.5 pr-4 pl-4 no-underline transition-colors duration-[120ms] ease-sortie active:bg-fond-survol">
        <span className="min-w-0 flex-1 truncate text-body-s font-medium text-texte-principal">{nom}</span>
        <Icon name="link-external" size={20} className="shrink-0 text-icone-secondaire" />
      </a>
    </li>
  );
}

/** Une carte blanche (§ 3.3). `onClick` : pressable (échelle 0,98 et ombre retirée, 120 ms). */
export function Carte({ titre, children, onClick, className }: { titre?: ReactNode; children?: ReactNode; onClick?: () => void; className?: string }) {
  const classe = cn(
    "block rounded-xl border border-bordure-subtile bg-fond-surface p-4 text-left shadow-ombre-ambiante",
    onClick && "w-full transition-[transform,box-shadow] duration-[120ms] ease-sortie active:scale-[0.98] active:shadow-none",
    className,
  );
  const contenu = (
    <>
      {titre ? <h3 className="text-body-s font-semibold text-texte-principal">{titre}</h3> : null}
      {children ? <div className={cn("text-ui text-texte-secondaire", titre ? "mt-1" : undefined)}>{children}</div> : null}
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className={classe}>
      {contenu}
    </button>
  ) : (
    <div className={classe}>{contenu}</div>
  );
}

/** La tuile chiffre du bureau, en grille de 2 : orbe K1, chiffre qui compte à la première apparition. */
export function TuileChiffre({ icone, valeur, libelle, detail }: { icone: IconName; valeur: number; libelle: string; detail?: string }) {
  return (
    <div className="rounded-xl border border-bordure-subtile bg-fond-surface p-3.5 shadow-ombre-ambiante">
      <div className="flex items-start justify-between">
        <span aria-hidden="true" className="klyra-orbe flex size-8 items-center justify-center rounded-full text-icone-inverse">
          <Icon name={icone} size={18} />
        </span>
        <span className="klyra-mono text-h4 leading-none font-semibold tracking-title text-texte-principal">
          <Compteur valeur={valeur} />
        </span>
      </div>
      <p className="mt-3.5 text-ui font-semibold text-texte-principal">{libelle}</p>
      {detail ? <p className="mt-0.5 text-ui-xs text-texte-secondaire">{detail}</p> : null}
    </div>
  );
}
