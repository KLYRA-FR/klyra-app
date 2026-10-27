import { forwardRef, type ForwardedRef, type ReactNode, type SelectHTMLAttributes } from "react";
import { Icon } from "@/components/icons/Icon";
import { cn } from "@/lib/cn";

export interface PuceOption<T extends string> {
  value: T;
  label: string;
}

interface PuceSelectProps<T extends string> extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "onChange" | "value"> {
  options: PuceOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Libellé lu par les lecteurs d'écran (« Rôle », « Projet »). */
  libelle: string;
  icone?: ReactNode;
}

/**
 * Puce de choix posée dans la barre d'un composeur (rôle, projet) : petite,
 * bordée `bordure-subtile`, rayon 6 comme les boutons. Liste native (clavier,
 * accessibilité), posée invisible sur toute la puce : un clic n'importe où,
 * flèche comprise, l'ouvre.
 */
function PuceSelectInner<T extends string>(
  { options, value, onChange, libelle, icone, className, ...rest }: PuceSelectProps<T>,
  ref: ForwardedRef<HTMLSelectElement>,
) {
  const choisie = options.find((o) => o.value === value)?.label ?? "";
  return (
    <label
      className={cn(
        "relative inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-xs border border-bordure-subtile bg-fond-surface pr-2 pl-2.5",
        "text-ui-s font-medium text-texte-principal transition-colors duration-[220ms] ease-sortie hover:border-bordure-forte",
        /* Le contour de focus seulement au clavier, à l'arrondi de la puce. */
        "has-[select:focus-visible]:outline-2 has-[select:focus-visible]:outline-offset-2 has-[select:focus-visible]:outline-focus",
        className,
      )}
    >
      {icone && <span className="flex text-icone-secondaire">{icone}</span>}
      <span className="sr-only">{libelle}</span>
      {/* Ce qu'on voit : le choix en cours et la flèche. */}
      <span aria-hidden="true" className="truncate">
        {choisie}
      </span>
      <Icon name="chevron-down" size={16} className="shrink-0 text-icone-secondaire" />
      {/* La liste native couvre toute la puce, invisible : un clic n'importe où l'ouvre. */}
      <select
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="absolute inset-0 size-full cursor-pointer appearance-none opacity-0 outline-none"
        {...rest}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export const PuceSelect = forwardRef(PuceSelectInner) as <T extends string>(
  props: PuceSelectProps<T> & { ref?: ForwardedRef<HTMLSelectElement> },
) => ReturnType<typeof PuceSelectInner>;
