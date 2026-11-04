"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Icon } from "@/components/icons/Icon";
import { cn } from "@/lib/cn";

/**
 * Hors ligne (socle mobile § 5.5, P-12) : un bandeau de 32 px collé sous la barre du haut, « Hors
 * ligne · données de 18:42 ». Au retour du réseau, « De nouveau en ligne » pendant 2 s, puis il se
 * replie (220 ms). La coque dit l'état ; chaque barre du haut l'affiche sous elle.
 */

type EtatReseau = { texte: string; retour: false } | { texte: "De nouveau en ligne"; retour: true } | null;

const ContexteReseau = createContext<EtatReseau>(null);

const RETOUR_MS = 2000;

/** `horsLigne` : le texte P-12, ou null en ligne. */
export function FournisseurReseau({ horsLigne, children }: { horsLigne: string | null; children: ReactNode }) {
  const [precedent, setPrecedent] = useState(horsLigne);
  const [retour, setRetour] = useState(false);
  if (precedent !== horsLigne) {
    setPrecedent(horsLigne);
    setRetour(!horsLigne && precedent !== null);
  }
  useEffect(() => {
    if (!retour) return;
    const minuteur = setTimeout(() => setRetour(false), RETOUR_MS);
    return () => clearTimeout(minuteur);
  }, [retour]);
  const etat: EtatReseau = horsLigne ? { texte: horsLigne, retour: false } : retour ? { texte: "De nouveau en ligne", retour: true } : null;
  return <ContexteReseau.Provider value={etat}>{children}</ContexteReseau.Provider>;
}

/** Le bandeau, sous la barre du haut. Replié (hauteur 0) quand tout va bien. */
export function BandeauReseau() {
  const etat = useContext(ContexteReseau);
  const [dernier, setDernier] = useState(etat);
  if (etat && etat !== dernier) setDernier(etat);
  const visible = dernier ?? etat;
  return (
    <div data-replie={!etat || undefined} className="klyra-bandeau-reseau">
      <div className="min-h-0 overflow-hidden">
        {visible ? (
          <p
            role="status"
            className={cn(
              "flex h-8 items-center justify-center gap-2 px-4 text-ui-xs font-medium",
              visible.retour ? "bg-fond-teinte-bleue text-texte-accent" : "bg-fond-inverse text-texte-inverse",
            )}
          >
            <Icon name="globe-01" size={16} className="shrink-0" />
            <span className="truncate">{visible.texte}</span>
          </p>
        ) : null}
      </div>
    </div>
  );
}
