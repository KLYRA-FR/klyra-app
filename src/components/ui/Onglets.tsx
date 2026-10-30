import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface Onglet<T extends string> {
  id: T;
  label: string;
  icone?: ReactNode;
  /** Un nombre discret après le libellé (« Mes agents 12 »). */
  nombre?: number;
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
  /** `serre` : posé à 8 px du bord d'une carte de 16 px ; rail arrondi à 8, onglet à 6 (arrondis emboîtés). */
  arrondi?: "normal" | "serre";
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
  arrondi = "normal",
  className,
}: OngletsProps<T>) {
  return (
    <div
      role="tablist"
      aria-label={libelle}
      className={cn("inline-flex bg-fond-surface-grise p-0.5", arrondi === "serre" ? "rounded-sm" : "rounded-md-moins", className)}
      /* ← et → passent d'un onglet à l'autre et l'activent ; Tab entre ensuite dans le contenu. */
      onKeyDown={(e) => {
        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
        const liste = e.currentTarget;
        const rang = onglets.findIndex((o) => o.id === valeur);
        const suivant = onglets[(rang + (e.key === "ArrowRight" ? 1 : onglets.length - 1)) % onglets.length];
        e.preventDefault();
        onChange(suivant.id);
        requestAnimationFrame(() => liste.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus());
      }}
    >
      {onglets.map((onglet) => {
        const actif = onglet.id === valeur;
        return (
          <button
            key={onglet.id}
            type="button"
            role="tab"
            aria-selected={actif}
            tabIndex={actif ? 0 : -1}
            onClick={() => onChange(onglet.id)}
            title={onglet.label}
            className={cn(
              "inline-flex cursor-pointer items-center gap-1.5 border px-2.5 py-1 text-ui-s font-medium tracking-[-0.0125em]",
              arrondi === "serre" ? "rounded-xs" : "rounded-sm",
              "transition-colors duration-[220ms] ease-sortie",
              actif
                ? "border-bordure-subtile bg-fond-surface text-texte-principal"
                : "border-transparent bg-transparent text-texte-secondaire hover:text-texte-principal",
            )}
          >
            {onglet.icone}
            <span className={cn(etiquettes === "large" && onglet.icone && "sr-only @lg:not-sr-only")}>{onglet.label}</span>
            {onglet.nombre !== undefined && onglet.nombre > 0 && <span className="text-texte-tertiaire">{onglet.nombre}</span>}
          </button>
        );
      })}
    </div>
  );
}
