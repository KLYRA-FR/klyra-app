import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface Onglet<T extends string> {
  id: T;
  label: string;
  icone?: ReactNode;
}

interface OngletsProps<T extends string> {
  onglets: Onglet<T>[];
  valeur: T;
  onChange: (id: T) => void;
  /** Nom du groupe pour les lecteurs d'écran. */
  libelle: string;
  /** `large` : libellés masqués quand le conteneur (@container) est étroit,
   *  il ne reste que l'icône (libellé au survol). */
  etiquettes?: "toujours" | "large";
  className?: string;
}

/**
 * Onglets du design system KLYRA (composant Onglets, `k-onglets`) : rail
 * `fond-surface-grise`, onglet actif blanc bordé `bordure-subtile`.
 * Taille réduite pour l'interface de l'app.
 */
export function Onglets<T extends string>({
  onglets,
  valeur,
  onChange,
  libelle,
  etiquettes = "toujours",
  className,
}: OngletsProps<T>) {
  return (
    <div role="tablist" aria-label={libelle} className={cn("inline-flex rounded-md- bg-fond-surface-grise p-0.5", className)}>
      {onglets.map((onglet) => {
        const actif = onglet.id === valeur;
        return (
          <button
            key={onglet.id}
            type="button"
            role="tab"
            aria-selected={actif}
            onClick={() => onChange(onglet.id)}
            title={onglet.label}
            className={cn(
              "inline-flex cursor-pointer items-center gap-1.5 rounded-sm border px-2.5 py-1 text-ui-s font-medium tracking-[-0.0125em]",
              "transition-colors duration-[220ms] ease-sortie",
              actif
                ? "border-bordure-subtile bg-fond-surface text-texte-principal"
                : "border-transparent bg-transparent text-texte-secondaire hover:text-texte-principal",
            )}
          >
            {onglet.icone}
            <span className={cn(etiquettes === "large" && onglet.icone && "sr-only @lg:not-sr-only")}>{onglet.label}</span>
          </button>
        );
      })}
    </div>
  );
}
