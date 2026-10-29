import type { ReactNode } from "react";
import { ListeDeroulante, type OptionListe } from "@/components/ui/ListeDeroulante";

export type PuceOption<T extends string> = OptionListe<T>;

interface PuceSelectProps<T extends string> {
  options: PuceOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Libellé lu par les lecteurs d'écran (« Rôle », « Projet »). */
  libelle: string;
  icone?: ReactNode;
  className?: string;
}

/**
 * Puce de choix posée dans la barre d'un composeur (rôle, projet) : petite,
 * bordée `bordure-subtile`, rayon 6 comme les boutons. Sa liste est celle de
 * l'app (`ListeDeroulante`), qui s'ouvre vers le haut au-dessus du composeur.
 */
export function PuceSelect<T extends string>({ options, value, onChange, libelle, icone, className }: PuceSelectProps<T>) {
  return (
    <ListeDeroulante
      variante="puce"
      libelle={libelle}
      icone={icone}
      options={options}
      value={value}
      onChange={onChange}
      largeurListe={220}
      className={className}
    />
  );
}
