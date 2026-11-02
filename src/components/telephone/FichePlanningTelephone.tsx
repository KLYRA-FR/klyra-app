"use client";

import { useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { EnteteTelephone } from "./EnteteTelephone";

/**
 * T-07, la page pleine d'un événement ou d'un rappel : elle couvre la barre du bas, ses champs en
 * colonne (texte 16 px, sélecteurs de date et d'heure du système), le bouton d'enregistrement
 * collé en bas, au-dessus du clavier.
 */

/** Classes d'un champ du téléphone : 48 px, texte 16 px (en dessous, Safari agrandit la page au focus). */
export const CHAMP_TELEPHONE = "h-12 w-full rounded-md border border-bordure-champ bg-fond-surface px-3 text-body-s text-texte-principal disabled:opacity-60";

/**
 * La page suit la partie visible de l'écran (`visualViewport`) : quand le clavier s'ouvre, le
 * bouton d'enregistrement reste juste au-dessus de lui.
 */
function useZoneVisible(): CSSProperties {
  const [zone, setZone] = useState<{ height: number; top: number } | null>(null);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const lire = () => setZone({ height: vv.height, top: vv.offsetTop });
    lire();
    vv.addEventListener("resize", lire);
    vv.addEventListener("scroll", lire);
    return () => {
      vv.removeEventListener("resize", lire);
      vv.removeEventListener("scroll", lire);
    };
  }, []);
  return zone ? { top: zone.top, height: zone.height } : { top: 0, bottom: 0 };
}

export function PageFiche({
  titre,
  onRetour,
  onEnregistrer,
  pied,
  children,
}: {
  titre: string;
  onRetour: () => void;
  onEnregistrer: () => void;
  /** Le bouton d'enregistrement et ce qui l'accompagne (erreur, P-7). */
  pied: ReactNode;
  children: ReactNode;
}) {
  const zone = useZoneVisible();
  const envoyer = (e: FormEvent) => {
    e.preventDefault();
    onEnregistrer();
  };
  return (
    <form
      aria-label={titre}
      noValidate
      onSubmit={envoyer}
      onKeyDown={(e) => {
        if (e.key === "Escape") onRetour();
      }}
      style={zone}
      className="fixed inset-x-0 z-30 flex flex-col bg-fond-page motion-safe:animate-[feuille_220ms_cubic-bezier(0.16,1,0.3,1)]"
    >
      <EnteteTelephone titre={titre} retour={onRetour} />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-2 pb-6">
        <div className="flex flex-col gap-4">{children}</div>
      </div>
      {pied ? <div className="shrink-0 border-t border-bordure-subtile bg-fond-page px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))]">{pied}</div> : null}
    </form>
  );
}

/** Un champ : son libellé, le contrôle, et l'erreur juste dessous (`text-texte-erreur`). */
export function ChampFiche({ id, libelle, erreur, children }: { id: string; libelle: string; erreur?: string | null; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-ui font-medium text-texte-principal">
        {libelle}
      </label>
      {children}
      {erreur ? (
        <p id={`${id}-erreur`} className="text-ui-xs text-texte-erreur">
          {erreur}
        </p>
      ) : null}
    </div>
  );
}

/** Une case du système dans une ligne de 44 px (« Toute la journée », « Chaque semaine »). */
export function CaseFiche({ libelle, coche, onChange, disabled }: { libelle: string; coche: boolean; onChange: (coche: boolean) => void; disabled?: boolean }) {
  return (
    <label className={cn("flex min-h-11 items-center gap-3 text-body-s text-texte-principal", disabled && "opacity-60")}>
      <input type="checkbox" checked={coche} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="size-5 accent-bleu-k1-500" />
      {libelle}
    </label>
  );
}

/** L'erreur du compte ou de l'ordinateur, sous le bouton d'enregistrement. */
export function ErreurFiche({ texte }: { texte: string | null }) {
  if (!texte) return null;
  return (
    <p role="alert" className="mt-2 text-ui text-texte-erreur">
      {texte}
    </p>
  );
}
