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
 * bordée `bordure-subtile`, rayon 6 comme les boutons. Liste native, pour le
 * clavier et l'accessibilité.
 */
function PuceSelectInner<T extends string>(
  { options, value, onChange, libelle, icone, className, ...rest }: PuceSelectProps<T>,
  ref: ForwardedRef<HTMLSelectElement>,
) {
  return (
    <label
      className={cn(
        "relative inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-xs border border-bordure-subtile bg-fond-surface pr-7 pl-2.5",
        "text-ui-s font-medium text-texte-principal transition-colors duration-[220ms] ease-sortie hover:border-bordure-forte",
        "focus-within:border-focus",
        className,
      )}
    >
      {icone && <span className="text-icone-secondaire">{icone}</span>}
      <span className="sr-only">{libelle}</span>
      <select
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="cursor-pointer appearance-none bg-transparent [color:inherit] [font:inherit] outline-none"
        {...rest}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <Icon name="chevron-down" size={16} className="pointer-events-none absolute right-2 text-icone-secondaire" />
    </label>
  );
}

export const PuceSelect = forwardRef(PuceSelectInner) as <T extends string>(
  props: PuceSelectProps<T> & { ref?: ForwardedRef<HTMLSelectElement> },
) => ReturnType<typeof PuceSelectInner>;
