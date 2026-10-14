import { forwardRef, type SVGProps } from "react";
import { cn } from "@/lib/cn";
import { ICONS, type IconName } from "./icon-data";

export type { IconName };

interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: IconName;
  /** 16 (UI dense), 20 (boutons, champs), 24 (par défaut). */
  size?: number;
}

/**
 * Icône du set officiel KLYRA (groupe Icons du design system).
 * Prend la couleur du texte voisin (currentColor). Décorative par défaut :
 * le libellé accessible est porté par le bouton qui l'entoure.
 */
export const Icon = forwardRef<SVGSVGElement, IconProps>(function Icon(
  { name, size = 24, className, ...rest },
  ref,
) {
  const { viewBox, body } = ICONS[name];
  return (
    <svg
      ref={ref}
      aria-hidden="true"
      width={size}
      height={size}
      viewBox={viewBox}
      fill="none"
      className={cn("shrink-0", className)}
      {...rest}
    >
      {body}
    </svg>
  );
});
