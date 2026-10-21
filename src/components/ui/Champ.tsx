import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Classes du contrôle d'un champ (Input, Select, Textarea de klyra-ui), au rayon des champs. */
export const CHAMP = "rounded-md border-bordure-champ text-ui";

/** Champ du design system (k-champ) : libellé, contrôle, aide ou erreur. */
export function Champ({
  label,
  aide,
  erreur,
  children,
  className,
}: {
  label: string;
  aide?: ReactNode;
  erreur?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("flex flex-col gap-2", className)}>
      <span className="text-ui-s font-medium text-texte-principal">{label}</span>
      {children}
      {erreur ? (
        <span role="alert" className="text-ui-xs text-texte-erreur">
          {erreur}
        </span>
      ) : (
        aide && <span className="text-ui-xs leading-[1.45] text-texte-tertiaire">{aide}</span>
      )}
    </label>
  );
}
