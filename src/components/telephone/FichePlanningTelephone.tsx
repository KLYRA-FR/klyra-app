"use client";

import type { ReactNode } from "react";
import { CaseRonde, MessageErreur } from "./Controles";
import { PagePleine } from "./PagePleine";

/**
 * T-07, la page pleine d'un événement ou d'un rappel : elle couvre la barre du bas, ses champs en
 * colonne (texte 16 px, sélecteurs de date et d'heure du système), le bouton d'enregistrement
 * collé en bas, au-dessus du clavier.
 */

export { CHAMP_TELEPHONE } from "./Controles";

/** T-07 dans la page pleine du socle (§ 4.4) : ✕, titre centré, enregistrement collé en bas. */
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
  return (
    <PagePleine titre={titre} onFermer={onRetour} onEnvoyer={onEnregistrer} pied={pied}>
      {children}
    </PagePleine>
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
      {erreur ? <MessageErreur id={`${id}-erreur`}>{erreur}</MessageErreur> : null}
    </div>
  );
}

/** Une case ronde dans une ligne de 44 px (« Toute la journée », « Chaque semaine ») : plus de case du système (§ 6.3). */
export function CaseFiche({ libelle, coche, onChange, disabled }: { libelle: string; coche: boolean; onChange: (coche: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={coche}
      disabled={disabled}
      onClick={() => onChange(!coche)}
      className="flex min-h-11 items-center gap-3 text-left text-body-s text-texte-principal disabled:text-texte-tertiaire"
    >
      <span className="flex size-6 shrink-0 items-center justify-center">
        <CaseRonde faite={coche} />
      </span>
      {libelle}
    </button>
  );
}

/** L'erreur du compte ou de l'ordinateur, sous le bouton d'enregistrement. */
export function ErreurFiche({ texte }: { texte: string | null }) {
  if (!texte) return null;
  return <MessageErreur className="mt-2">{texte}</MessageErreur>;
}
