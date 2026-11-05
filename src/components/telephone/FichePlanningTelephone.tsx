"use client";

import type { ReactNode, Ref } from "react";
import { Icon, type IconName } from "@/components/icons/Icon";
import { cn } from "@/lib/cn";
import { CaseRonde, CocheChoix, MessageErreur, PisteInterrupteur } from "./Controles";
import { NotePoste } from "./etats";
import { Feuille } from "./Feuille";
import { GroupeListe, LigneListe } from "./Liste";
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
  modifie = false,
  onRetour,
  onEnregistrer,
  pied,
  children,
}: {
  /** Des changements non enregistrés : ✕ et le retour demandent d'abord (E3-36). */
  modifie?: boolean;
  titre: string;
  onRetour: () => void;
  onEnregistrer: () => void;
  /** Le bouton d'enregistrement et ce qui l'accompagne (erreur, P-7). */
  pied: ReactNode;
  children: ReactNode;
}) {
  return (
    <PagePleine titre={titre} modifie={modifie} onFermer={onRetour} onEnvoyer={onEnregistrer} pied={pied}>
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

/** Une tuile d'icône grise dans une ligne de fiche. */
function TuileFiche({ icone }: { icone: IconName }) {
  return (
    <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-sm bg-fond-surface-grise text-icone-defaut">
      <Icon name={icone} size={18} />
    </span>
  );
}

const LIGNE_FICHE = "relative flex min-h-[52px] w-full items-center gap-3 border-b border-bordure-subtile px-3 py-1.5 text-left last:border-b-0";

/**
 * Une ligne de date ou d'heure : le sélecteur du système, posé invisible sur toute la ligne, sa valeur
 * écrite à droite en français. Sans valeur : le texte `vide` (« Facultatif », « Aucune »).
 */
export function LigneDateFiche({
  libelle,
  icone,
  type,
  valeur,
  affichage,
  vide,
  disabled,
  min,
  erreur,
  actif,
  champ,
  onChange,
}: {
  libelle: string;
  icone: IconName;
  type: "date" | "time";
  valeur: string;
  affichage: string | null;
  vide: string;
  disabled?: boolean;
  min?: string;
  erreur?: string | null;
  actif?: boolean;
  champ?: Ref<HTMLInputElement>;
  onChange: (valeur: string) => void;
}) {
  return (
    <li className={cn(LIGNE_FICHE, "flex-wrap focus-within:outline-2 focus-within:-outline-offset-2 focus-within:outline-bleu-k1-500", disabled && "text-texte-tertiaire")}>
      <TuileFiche icone={icone} />
      <span className="min-w-0 flex-1 text-body-s text-texte-principal">{libelle}</span>
      <span className={cn("shrink-0 text-ui", actif ? "font-medium text-texte-erreur" : "text-texte-secondaire")}>{affichage ?? vide}</span>
      {disabled ? null : <Icon name="chevron-right" size={18} className="shrink-0 text-icone-secondaire" />}
      <input
        ref={champ}
        type={type}
        aria-label={libelle}
        aria-invalid={erreur ? true : undefined}
        value={valeur}
        min={min}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-default"
      />
      {erreur ? <MessageErreur className="basis-full pb-1">{erreur}</MessageErreur> : null}
    </li>
  );
}

/** Une ligne qui ouvre un choix en feuille (« Catégorie », « Assigner à »). */
export function LigneChoixFiche({ libelle, icone, valeur, note, disabled, onClick }: { libelle: string; icone: IconName; valeur: string; note?: ReactNode; disabled?: boolean; onClick: () => void }) {
  return (
    <li className="border-b border-bordure-subtile last:border-b-0">
      <button type="button" disabled={disabled} aria-haspopup="dialog" onClick={onClick} className={cn(LIGNE_FICHE, "border-b-0 active:bg-fond-survol disabled:active:bg-transparent")}>
        <TuileFiche icone={icone} />
        <span className="min-w-0 flex-1 text-body-s text-texte-principal">
          {libelle}
          {note ? <span className="block text-ui-xs text-texte-secondaire">{note}</span> : null}
        </span>
        <span className="min-w-0 truncate text-ui text-texte-secondaire">{valeur}</span>
        {disabled ? null : <Icon name="chevron-right" size={18} className="shrink-0 text-icone-secondaire" />}
      </button>
    </li>
  );
}

/** Une ligne à interrupteur (« Toute la journée », « Chaque semaine »). */
export function LigneInterrupteurFiche({ libelle, icone, actif, disabled, onChange }: { libelle: string; icone: IconName; actif: boolean; disabled?: boolean; onChange: (actif: boolean) => void }) {
  return (
    <li className="border-b border-bordure-subtile last:border-b-0">
      <button type="button" role="switch" aria-checked={actif} disabled={disabled} onClick={() => onChange(!actif)} className={cn(LIGNE_FICHE, "border-b-0")}>
        <TuileFiche icone={icone} />
        <span className="min-w-0 flex-1 text-body-s text-texte-principal">{libelle}</span>
        <PisteInterrupteur actif={actif} />
      </button>
    </li>
  );
}

/** Le choix d'une valeur en feuille (Catégorie, Assigner à, Projet) : radios, coche sur la valeur actuelle, un pied facultatif. */
export function FeuilleChoixFiche<T extends string>({
  titre,
  options,
  valeur,
  note,
  apres,
  onChoisir,
  onFermer,
}: {
  titre: string;
  options: { valeur: T; libelle: string; visuel?: ReactNode }[];
  valeur: T;
  note?: ReactNode;
  apres?: ReactNode;
  onChoisir: (valeur: T) => void;
  onFermer: () => void;
}) {
  return (
    <Feuille titre={titre} onFermer={onFermer}>
      <GroupeListe>
        <div role="radiogroup" aria-label={titre}>
          {options.map((o) => (
            <LigneListe
              key={o.valeur}
              debut={o.visuel}
              nom={o.libelle}
              fin={<CocheChoix choisi={o.valeur === valeur} />}
              onClick={() => {
                onChoisir(o.valeur);
                onFermer();
              }}
            />
          ))}
        </div>
      </GroupeListe>
      {apres}
      {note ? <div className="mt-2 px-1 text-ui-xs text-texte-secondaire">{note}</div> : null}
    </Feuille>
  );
}

/** La raison en tête d'une fiche qui ne s'écrit pas (rappel reçu, E3-33). */
export function RaisonFiche({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2.5 rounded-md bg-fond-surface-grise px-3 py-2.5 text-ui text-texte-principal">
      <Icon name="lock-01" size={18} className="mt-px shrink-0 text-icone-defaut" />
      {children}
    </p>
  );
}

/** Les raisons sous le bouton d'enregistrement, réseau d'abord. */
export function NoteEnregistrement({ horsLigne, poste }: { horsLigne: boolean; poste: boolean }) {
  if (horsLigne) return <p className="mt-1 text-ui-xs text-texte-secondaire">Possible quand ce téléphone est en ligne</p>;
  return poste ? <NotePoste /> : null;
}
