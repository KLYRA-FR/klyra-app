"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** L'ancre d'un réglage : la recherche y mène et l'éclaire un instant. */
export const ancreReglage = (id: string) => `reglage-${id}`;

/** Un groupe de réglages dans une carte, avec son titre. */
export function Groupe({ titre, description, children, className }: { titre?: string; description?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("flex flex-col gap-2", className)}>
      {(titre || description) && (
        <div className="flex flex-col gap-0.5 px-1">
          {titre && <h3 className="m-0 text-ui-s font-semibold text-texte-principal">{titre}</h3>}
          {description && <p className="m-0 text-ui-xs leading-[1.45] text-texte-tertiaire">{description}</p>}
        </div>
      )}
      <div className="klyra-carte-flottante flex flex-col divide-y divide-bordure-subtile rounded-lg px-4">{children}</div>
    </section>
  );
}

/**
 * Une ligne de réglage : libellé et explication à gauche, contrôle à droite.
 * `id` : l'entrée du catalogue (recherche). `pile` : le contrôle passe dessous
 * (formulaire, liste).
 */
export function Ligne({
  id,
  libelle,
  description,
  children,
  pile,
}: {
  id?: string;
  libelle: string;
  description?: ReactNode;
  children?: ReactNode;
  pile?: boolean;
}) {
  return (
    <div
      id={id ? ancreReglage(id) : undefined}
      className={cn(
        "klyra-reglage -mx-4 flex scroll-mt-6 gap-x-6 gap-y-3 px-4 py-3.5",
        pile ? "flex-col" : "flex-wrap items-center justify-between",
      )}
    >
      <div className="flex min-w-[200px] flex-1 flex-col gap-0.5">
        <span className="text-ui-s font-medium text-texte-principal">{libelle}</span>
        {description && <span className="text-ui-xs leading-[1.45] text-texte-tertiaire">{description}</span>}
      </div>
      {children && <div className={cn("flex min-w-0 items-center gap-2", pile ? "w-full" : "shrink-0")}>{children}</div>}
    </div>
  );
}

/** Interrupteur oui / non (rôle `switch`), au bleu K1 quand il est actif. */
export function Interrupteur({
  actif,
  onChange,
  libelle,
  disabled,
}: {
  actif: boolean;
  onChange: (actif: boolean) => void;
  libelle: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={actif}
      aria-label={libelle}
      disabled={disabled}
      onClick={() => onChange(!actif)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-pill border-0 p-0 transition-colors duration-[220ms] ease-sortie",
        "disabled:cursor-not-allowed disabled:opacity-50",
        actif ? "bg-fond-accent" : "bg-gris-k2-500",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute top-0.5 left-0.5 size-4 rounded-full bg-fond-surface shadow-ombre-sm transition-transform duration-[220ms] ease-sortie",
          actif && "translate-x-4",
        )}
      />
    </button>
  );
}

/** Une valeur en lecture seule (version, dossier…). */
export function Valeur({ children, mono }: { children: ReactNode; mono?: boolean }) {
  return <span className={cn("text-right text-ui-s text-texte-secondaire [overflow-wrap:anywhere]", mono && "klyra-mono text-ui-xs")}>{children}</span>;
}

/** Ce qui ne marche que dans l'app de bureau. */
export function SeulementBureau({ children = "Ce réglage se fait dans l’app de bureau." }: { children?: ReactNode }) {
  return <span className="text-ui-xs text-texte-tertiaire">{children}</span>;
}

/** Un message d'erreur sous un réglage. */
export function Erreur({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="m-0 py-2 text-ui-xs text-texte-erreur">
      {children}
    </p>
  );
}
