"use client";

import { useEffect, useState } from "react";
import { EVENEMENT_ANNONCE } from "@/lib/annonces";

/** La région lue par les lecteurs d'écran pour les gestes sur les agents (cf. `annoncer`). Montée une fois. */
export function RegionAnnonces() {
  const [texte, setTexte] = useState("");
  useEffect(() => {
    const lire = (e: Event) => {
      // Vider d'abord : la même annonce deux fois de suite est relue.
      setTexte("");
      requestAnimationFrame(() => setTexte((e as CustomEvent<string>).detail));
    };
    window.addEventListener(EVENEMENT_ANNONCE, lire);
    return () => window.removeEventListener(EVENEMENT_ANNONCE, lire);
  }, []);
  return (
    <div role="status" aria-live="polite" className="sr-only" data-annonces-agents>
      {texte}
    </div>
  );
}
