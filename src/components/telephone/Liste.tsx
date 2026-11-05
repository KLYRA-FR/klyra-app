"use client";

import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { Compteur } from "@/components/ui/Compteur";
import { Icon, type IconName } from "@/components/icons/Icon";
import { BoutonIcone } from "@/components/ui/Bouton";
import { cn } from "@/lib/cn";
import { CocheChoix } from "./Controles";
import { useAppuiLong } from "./Feuille";

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
export const CLASSE_GROUPE = "overflow-hidden rounded-xl border border-bordure-subtile bg-fond-surface shadow-ombre-xs";
export function GroupeListe({ children, className }: { children: ReactNode; className?: string }) {
  return <ul className={cn(CLASSE_GROUPE, className)}>{children}</ul>;
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

/** La tuile d'icône d'une ligne (36 px). `bleue` : l'élément mis en avant. `grande` : l'en-tête d'un menu (44 px). */
export function TuileIcone({ icone, bleue = false, grande = false }: { icone: IconName; bleue?: boolean; grande?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn("flex shrink-0 items-center justify-center rounded-md-moins", grande ? "size-11" : "size-9", bleue ? "bg-fond-teinte-bleue text-icone-accent" : "bg-fond-surface-grise text-icone-defaut")}
    >
      <Icon name={icone} size={grande ? 22 : 20} />
    </span>
  );
}

/** La valeur d'une ligne de formulaire, et son chevron. */
export function ValeurLigne({ children, chevron = true }: { children: ReactNode; chevron?: boolean }) {
  return (
    <span className="flex max-w-[55%] shrink-0 items-center gap-1 text-ui text-texte-secondaire">
      <span className="truncate">{children}</span>
      {chevron ? <Icon name="chevron-right" size={20} className="shrink-0 text-icone-secondaire" /> : null}
    </span>
  );
}

const FILET_LIGNE =
  "[&:not(:first-child)]:before:absolute [&:not(:first-child)]:before:top-0 [&:not(:first-child)]:before:right-0 [&:not(:first-child)]:before:h-px [&:not(:first-child)]:before:bg-bordure-defaut [&:not(:first-child)]:before:content-['']";

/** Une ligne de choix unique (D-6) : toute la ligne est la cible, la coche à droite. Dans un `radiogroup`. */
export function LigneChoix({
  nom,
  ligne2,
  debut,
  etiquette,
  choisie,
  desactivee = false,
  autoFocus = false,
  onChoisir,
}: {
  nom: ReactNode;
  ligne2?: ReactNode;
  debut?: ReactNode;
  etiquette?: ReactNode;
  choisie: boolean;
  desactivee?: boolean;
  autoFocus?: boolean;
  onChoisir: () => void;
}) {
  return (
    <li className={cn("relative flex items-center before:left-4", FILET_LIGNE)}>
      <button
        type="button"
        role="radio"
        aria-checked={choisie}
        disabled={desactivee}
        data-autofocus={autoFocus || undefined}
        onClick={onChoisir}
        className="flex min-h-[52px] min-w-0 flex-1 items-center gap-3 py-2.5 pr-3 pl-4 text-left transition-colors duration-[120ms] ease-sortie active:bg-fond-survol disabled:text-texte-tertiaire"
      >
        {debut}
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className={cn("min-w-0 truncate text-body-s", ligne2 ? "font-medium" : "font-normal")}>{nom}</span>
            {etiquette}
          </span>
          {ligne2 ? <span className="mt-0.5 block text-ui leading-[1.35] text-texte-secondaire">{ligne2}</span> : null}
        </span>
        <CocheChoix choisi={choisie} />
      </button>
    </li>
  );
}

/**
 * Une ligne dont la valeur se règle avec le sélecteur du système (heure, date) : la valeur française à
 * droite, le contrôle natif invisible par-dessus (D-6). `children` sans `valeur` : un champ visible.
 */
export function LigneSaisie({ icone, nom, valeur, erreur = false, children }: { icone?: IconName; nom: string; valeur?: ReactNode; erreur?: boolean; children: ReactNode }) {
  return (
    <li className={cn("relative flex min-h-14 items-center gap-3 py-2.5 pr-3 pl-4", icone ? "before:left-16" : "before:left-4", FILET_LIGNE, valeur !== undefined && "active:bg-fond-survol")}>
      {icone ? <TuileIcone icone={icone} /> : null}
      <span className={cn("min-w-0 flex-1 truncate text-body-s font-medium", erreur ? "text-texte-erreur" : "text-texte-principal")}>{nom}</span>
      {valeur !== undefined ? <ValeurLigne>{valeur}</ValeurLigne> : null}
      {children}
    </li>
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
  eclairee = false,
  className,
  style,
  role,
  coche,
}: {
  /** Revenue d'un geste réussi : elle s'éclaire 1 800 ms. */
  eclairee?: boolean;
  /** Sur la ligne elle-même (un chantier d'agent, sa couleur). */
  className?: string;
  style?: CSSProperties;
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
  /** Toute la ligne est un interrupteur (`switch` et son état `coche`). */
  role?: "switch";
  coche?: boolean;
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
    <li data-eclaire={eclairee || undefined} style={style} className={cn("klyra-telephone-eclaire relative flex items-center", FILET_LIGNE, RETRAITS[retrait], className)}>
      {href && !inactive ? (
        <Link href={href} {...(onMenu ? appui : {})} className={classeCorps}>
          {corps}
        </Link>
      ) : (
        <button type="button" role={role} aria-checked={role ? coche : undefined} disabled={inactive || !onClick} onClick={onClick} {...(onMenu ? appui : {})} className={cn(classeCorps, "disabled:cursor-default")}>
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
