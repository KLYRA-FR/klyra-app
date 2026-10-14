"use client";

import { useEffect, useState } from "react";
import { moinsDAnimations, useVisible } from "./Apparition";

/** courbe-sortie du design system, cubic-bezier(0.22, 1, 0.36, 1), approchée. */
const sortie = (t: number) => 1 - (1 - t) ** 4;

/**
 * Un chiffre qui compte de 0 jusqu'à sa valeur quand son bloc entre à
 * l'écran (dans une `Apparition`). Affiche directement la valeur si le
 * système demande moins d'animations. Le lecteur d'écran lit la valeur finale.
 */
export function Compteur({ valeur, delai = 0, duree = 900 }: { valeur: number; delai?: number; duree?: number }) {
  const visible = useVisible();
  const [affiche, setAffiche] = useState(0);

  useEffect(() => {
    if (!visible) return;
    if (moinsDAnimations() || valeur === 0) {
      const id = requestAnimationFrame(() => setAffiche(valeur));
      return () => cancelAnimationFrame(id);
    }
    let frame = 0;
    let debut: number | null = null;
    const pas = (t: number) => {
      debut ??= t + delai;
      const avance = Math.min(1, Math.max(0, (t - debut) / duree));
      setAffiche(Math.round(sortie(avance) * valeur));
      if (avance < 1) frame = requestAnimationFrame(pas);
    };
    frame = requestAnimationFrame(pas);
    return () => cancelAnimationFrame(frame);
  }, [visible, valeur, delai, duree]);

  return (
    <>
      <span aria-hidden="true">{affiche}</span>
      <span className="sr-only">{valeur}</span>
    </>
  );
}
