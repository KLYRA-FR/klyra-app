"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Icon } from "@/components/icons/Icon";
import { PixelCheck } from "@/components/ui/PixelCheck";
import { cn } from "@/lib/cn";

/**
 * Les contrôles du téléphone (socle mobile § 6.3), sur le design system du bureau : un seul champ,
 * une seule puce, l'interrupteur du bureau, la coche d'un choix, la case ronde. Aucun nouveau token.
 */

const CHAMP_COMMUN =
  "rounded-md border border-bordure-champ bg-fond-surface text-body-s text-texte-principal placeholder:text-texte-placeholder focus-visible:border-bordure-champ-survol focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus aria-[invalid=true]:border-[1.5px] aria-[invalid=true]:border-bordure-erreur disabled:border-transparent disabled:bg-fond-survol disabled:text-texte-tertiaire";

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

/** La piste de l'interrupteur du bureau (36 × 20, K1 allumé, 220 ms) : toute la ligne est la cible. */
export function PisteInterrupteur({ actif }: { actif: boolean }) {
  return (
    <span aria-hidden="true" className={cn("relative inline-flex h-5 w-9 shrink-0 rounded-pill transition-colors duration-[220ms] ease-sortie", actif ? "bg-fond-accent" : "bg-gris-k2-500")}>
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
