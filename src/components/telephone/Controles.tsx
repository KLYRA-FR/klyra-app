"use client";

import type { ButtonHTMLAttributes, KeyboardEvent, ReactNode } from "react";
import { Icon } from "@/components/icons/Icon";
import { BoutonIcone } from "@/components/ui/Bouton";
import { PixelCheck } from "@/components/ui/PixelCheck";
import { cn } from "@/lib/cn";

/**
 * Les contrôles du téléphone (socle mobile § 6.3), sur le design system du bureau : un seul champ,
 * une seule puce, l'interrupteur du bureau, la coche d'un choix, la case ronde. Aucun nouveau token.
 */

/* Correction AA d'Iris (§ 6.3, 04/11) : au repos, contour `texte-tertiaire` (3,79:1) et placeholder
   `texte-secondaire` (7:1), au lieu du filet `bordure-champ` et de `texte-placeholder`. */
const CHAMP_COMMUN =
  "rounded-md border border-texte-tertiaire bg-fond-surface text-body-s text-texte-principal placeholder:text-texte-secondaire focus-visible:border-bordure-champ-survol focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus aria-[invalid=true]:border-[1.5px] aria-[invalid=true]:border-bordure-erreur disabled:border-transparent disabled:bg-fond-survol disabled:text-texte-tertiaire";

/** Un champ natif (`input`, `textarea`) : 48 px, texte 16 px (en dessous, Safari agrandit la page au focus). */
export const CHAMP_TELEPHONE = cn("h-12 w-full px-3.5", CHAMP_COMMUN);

/** Le même champ quand c'est un `Input` ou un `Textarea` de klyra-ui (ils posent leur hauteur). */
export const CHAMP_KLYRA_UI = CHAMP_COMMUN;

/** L'erreur d'un champ ou d'un formulaire : en rouge, avec son icône (au lieu d'un texte noir). */
export function MessageErreur({ id, children, className }: { id?: string; children: ReactNode; className?: string }) {
  return (
    <p id={id} role="alert" className={cn("flex items-start gap-1.5 text-ui text-texte-erreur", className)}>
      <Icon name="help-circle-contained" size={16} className="mt-0.5 shrink-0" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/**
 * Puce de filtre ou de portée (un seul style) : 36 px dans une cible de 44, repos blanc bordé,
 * choisie sombre. Une rangée de puces défile à l'horizontale.
 */
export function Puce({ choisie = false, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { choisie?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={choisie}
      className={cn(
        "relative inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xs px-3.5 text-ui font-medium whitespace-nowrap transition-[background-color,transform] duration-[120ms] ease-sortie active:scale-[0.98]",
        "after:absolute after:inset-x-0 after:-inset-y-1",
        choisie ? "klyra-surface-sombre text-texte-inverse" : "border border-bordure-defaut bg-fond-surface text-texte-principal",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/**
 * La piste de l'interrupteur du bureau (36 × 20, K1 allumé, 220 ms) : toute la ligne est la cible.
 * Éteint mais disponible : un contour intérieur de 1,5 px `texte-tertiaire` (AA, § 6.3).
 */
export function PisteInterrupteur({ actif }: { actif: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 rounded-pill transition-colors duration-[220ms] ease-sortie",
        actif ? "bg-fond-accent" : "bg-gris-k2-500 shadow-[inset_0_0_0_1.5px_var(--color-texte-tertiaire)]",
      )}
    >
      <span className={cn("absolute top-0.5 left-0.5 size-4 rounded-full bg-fond-surface shadow-ombre-sm transition-transform duration-[220ms] ease-sortie", actif && "translate-x-4")} />
    </span>
  );
}

/** La coche d'un choix unique, à droite de la ligne choisie (comme `ListeDeroulante`). */
export function CocheChoix({ choisi }: { choisi: boolean }) {
  return choisi ? <Icon name="check-01" size={24} className="shrink-0 text-icone-accent" /> : <span aria-hidden="true" className="size-6 shrink-0" />;
}

/** Case à cocher ronde de 24 px (anneau `texte-tertiaire`, 3,8:1) ; faite, la coche KLYRA. */
export function CaseRonde({ faite }: { faite: boolean }) {
  return faite ? (
    <PixelCheck className="h-[13px] w-[18px]" />
  ) : (
    <span aria-hidden="true" className="size-6 shrink-0 rounded-full border-[1.5px] border-texte-tertiaire" />
  );
}

/** Un `Bouton` sombre ou blanc désactivé, comme aux maquettes : gris plein, sans bord (`b desactive`). */
export const BOUTON_INACTIF = "klyra-bouton-inactif";

/**
 * Les segments d'une page poussée (§ 6.3) : rail de 2 px, segments de 40 px touchés sur 44, un nombre
 * discret. `nombre` absent : la source n'a pas été lue, on ne montre pas de faux zéro.
 */
export function Segments<T extends string>({
  libelle,
  valeur,
  onChange,
  segments,
  className,
}: {
  libelle: string;
  valeur: T;
  onChange: (id: T) => void;
  segments: { id: T; label: string; icone?: ReactNode; nombre?: number }[];
  className?: string;
}) {
  const touche = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const rang = segments.findIndex((s) => s.id === valeur);
    const suivant = segments[(rang + (e.key === "ArrowRight" ? 1 : segments.length - 1)) % segments.length];
    e.preventDefault();
    onChange(suivant.id);
  };
  return (
    <div role="tablist" aria-label={libelle} onKeyDown={touche} className={cn("flex rounded-md-moins bg-fond-surface-grise p-0.5", className)}>
      {segments.map((s) => {
        const actif = s.id === valeur;
        return (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={actif}
            tabIndex={actif ? 0 : -1}
            onClick={() => onChange(s.id)}
            className={cn(
              "relative flex h-10 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[8px] border text-ui transition-colors duration-[120ms] ease-sortie after:absolute after:inset-x-0 after:-inset-y-0.5",
              actif ? "border-bordure-defaut bg-fond-surface font-semibold text-texte-principal shadow-ombre-xs" : "border-transparent font-medium text-texte-secondaire",
            )}
          >
            {s.icone}
            <span className="truncate">{s.label}</span>
            {s.nombre !== undefined ? <span className="font-normal text-texte-secondaire">{s.nombre}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/** Le champ de recherche d'une page (48 px, 16 px) : la loupe, « effacer » dès qu'il y a du texte. */
export function ChampRecherche({ valeur, onChange, placeholder, libelle }: { valeur: string; onChange: (v: string) => void; placeholder: string; libelle: string }) {
  return (
    <div className="flex h-12 items-center gap-2.5 rounded-md border border-texte-tertiaire bg-fond-surface pr-1 pl-3.5 focus-within:border-bordure-champ-survol focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus">
      <Icon name="search-01" size={20} className="shrink-0 text-icone-secondaire" />
      <input
        role="searchbox"
        enterKeyHint="search"
        aria-label={libelle}
        placeholder={placeholder}
        value={valeur}
        onChange={(e) => onChange(e.target.value)}
        className="h-full min-w-0 flex-1 bg-transparent text-body-s text-texte-principal outline-none placeholder:text-texte-secondaire"
      />
      {valeur ? <BoutonIcone variant="discret" className="size-11" libelle="Effacer la recherche" onClick={() => onChange("")} icone={<Icon name="x-01" size={20} />} /> : null}
    </div>
  );
}

/** Une rangée de puces qui défile à l'horizontale, jusqu'au bord de l'écran. */
export function RangeePuces({ libelle, children }: { libelle: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={libelle} className="-mx-4 flex gap-2 overflow-x-auto px-4 py-1 [scrollbar-width:none]">
      {children}
    </div>
  );
}
