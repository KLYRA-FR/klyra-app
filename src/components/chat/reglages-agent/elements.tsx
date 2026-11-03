"use client";

import { useId, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import { Icon, type IconName } from "@/components/icons/Icon";
import { BoutonIcone } from "@/components/ui/Bouton";
import { annoncer } from "@/lib/annonces";
import { BridgeError } from "@/lib/bridge";
import { cn } from "@/lib/cn";
import { avecCommande } from "@/lib/raccourcis";

/*
 * Les briques du panneau des réglages d'un agent : groupes de lignes qui mènent chacune à son réglage
 * (sur le modèle d'OpenBot, aux couleurs KLYRA), champ modifié sur place, en-tête d'une sous-vue.
 */

/** Petit titre d'un groupe. */
export function TitreGroupe({ children }: { children: ReactNode }) {
  return <h3 className="m-0 px-0.5 text-ui-xs font-medium text-texte-tertiaire">{children}</h3>;
}

/** Un groupe : son titre, ses lignes dans une carte, une aide dessous. */
export function Groupe({ titre, aide, children }: { titre?: string; aide?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      {titre && <TitreGroupe>{titre}</TitreGroupe>}
      <div className="flex flex-col gap-px rounded-md border border-bordure-subtile bg-fond-surface p-1">{children}</div>
      {aide && <p className="m-0 px-0.5 text-ui-2xs leading-[1.45] text-texte-tertiaire">{aide}</p>}
    </section>
  );
}

export const LIGNE = "flex min-h-10 w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-left text-ui-s text-texte-principal";
export const LIGNE_ACTIVE =
  "cursor-pointer border-0 bg-transparent no-underline transition-colors duration-[120ms] ease-sortie hover:bg-fond-survol disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent";

/** Une ligne : icône, libellé, valeur à droite et flèche quand elle mène quelque part (sous-vue, lien, action). */
export function LigneReglage({
  icone,
  libelle,
  valeur,
  href,
  onClick,
  disabled,
  titre,
  fleche = true,
}: {
  icone: IconName;
  libelle: string;
  valeur?: ReactNode;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  titre?: string;
  fleche?: boolean;
}) {
  const actif = !disabled && (href || onClick);
  const contenu = (
    <>
      <Icon name={icone} size={16} className="shrink-0 text-icone-secondaire" />
      <span className="shrink-0 font-medium">{libelle}</span>
      <span className="ml-auto min-w-0 truncate text-right text-texte-secondaire">{valeur}</span>
      {fleche && actif && <Icon name="chevron-right" size={14} className="shrink-0 text-icone-secondaire" />}
    </>
  );
  if (href && !disabled)
    return (
      <Link href={href} title={titre} className={cn(LIGNE, LIGNE_ACTIVE)}>
        {contenu}
      </Link>
    );
  if (onClick)
    return (
      <button type="button" onClick={onClick} disabled={disabled} title={titre} className={cn(LIGNE, LIGNE_ACTIVE)}>
        {contenu}
      </button>
    );
  return (
    <div title={titre} className={LIGNE}>
      {contenu}
    </div>
  );
}

/** L'en-tête d'une sous-vue : retour, titre centré, une action à droite. */
export function EnteteVue({ titre, onRetour, action }: { titre: string; onRetour: () => void; action?: ReactNode }) {
  return (
    <div className="grid grid-cols-[32px_minmax(0,1fr)_32px] items-center gap-2">
      <BoutonIcone variant="discret" taille="compact" libelle="Retour aux réglages" icone={<Icon name="chevron-left" size={18} />} onClick={onRetour} data-son="fermer" />
      <h2 className="m-0 truncate text-center text-ui font-semibold text-texte-principal">{titre}</h2>
      <span className="flex justify-end">{action}</span>
    </div>
  );
}

/** Une ligne d'état sous une liste (chargement, vide, erreur). */
export function Note({ children, erreur }: { children: ReactNode; erreur?: boolean }) {
  return (
    <p role={erreur ? "alert" : undefined} className={cn("m-0 px-0.5 text-ui-xs leading-[1.5]", erreur ? "text-texte-erreur" : "text-texte-tertiaire")}>
      {children}
    </p>
  );
}

export const CHAMP_EN_LIGNE = cn(
  "w-full rounded-md border border-bordure-subtile bg-fond-surface px-3 text-ui-s text-texte-principal",
  "transition-[border-color] duration-[120ms] ease-sortie placeholder:text-texte-tertiaire",
  "hover:border-bordure-forte focus:border-focus focus:outline-none",
  "read-only:cursor-default read-only:bg-fond-surface-grise read-only:hover:border-bordure-subtile",
);

/** Le message d'une écriture refusée. */
export function messageErreur(e: unknown): string {
  if (e instanceof BridgeError && e.code === "conflit") return e.message || "Le fichier a changé sur le disque pendant ta saisie. Réessaie : rien n’a été écrasé.";
  return `L’enregistrement a échoué : ${e instanceof Error ? e.message : String(e)}`;
}

/**
 * Un champ modifié sur place : enregistré en quittant le champ (ou Entrée, ⌘ Entrée sur plusieurs
 * lignes), Échap rend la valeur d'avant. Une erreur garde la saisie et dit pourquoi.
 */
export function ChampEnLigne({
  libelle,
  valeur,
  enregistrer,
  valider,
  multiligne,
  lectureSeule,
  aide,
}: {
  libelle: string;
  valeur: string;
  enregistrer?: (valeur: string) => Promise<void>;
  valider?: (valeur: string) => string | null;
  multiligne?: boolean;
  lectureSeule?: boolean;
  aide?: ReactNode;
}) {
  const id = useId();
  const [saisie, setSaisie] = useState(valeur);
  const [edition, setEdition] = useState(false);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  // Hors édition, le champ suit la valeur enregistrée (changée ailleurs, sur le disque…).
  const affichee = edition ? saisie : valeur;
  const fige = lectureSeule || !enregistrer;

  const terminer = async () => {
    if (fige || enCours || !edition) return;
    const propre = saisie.trim().replace(/\s*\n\s*/g, " ");
    if (propre === valeur.trim()) {
      setEdition(false);
      setErreur(null);
      return;
    }
    const probleme = valider?.(propre) ?? null;
    if (probleme) {
      setErreur(probleme);
      return;
    }
    setEnCours(true);
    try {
      await enregistrer(propre);
      setEdition(false);
      setErreur(null);
      annoncer(`${libelle} enregistrée.`);
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setEnCours(false);
    }
  };

  const toucher = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setSaisie(valeur);
      setEdition(false);
      setErreur(null);
      e.currentTarget.blur();
    } else if (e.key === "Enter" && (!multiligne || avecCommande(e.nativeEvent))) {
      e.preventDefault();
      e.currentTarget.blur();
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="px-0.5 text-ui-xs font-medium text-texte-tertiaire">
        {libelle}
      </label>
      <textarea
        id={id}
        value={affichee}
        readOnly={fige}
        disabled={enCours}
        rows={multiligne ? 4 : 1}
        spellCheck={false}
        onFocus={() => {
          if (fige) return;
          if (!edition) setSaisie(valeur);
          setEdition(true);
        }}
        onChange={(e) => {
          setSaisie(e.target.value);
          setEdition(true);
        }}
        onBlur={() => void terminer()}
        onKeyDown={toucher}
        aria-invalid={erreur ? true : undefined}
        aria-describedby={erreur || aide ? `${id}-aide` : undefined}
        className={cn(CHAMP_EN_LIGNE, "min-h-[88px] resize-y py-2 leading-[1.5]")}
      />
      {erreur ? (
        <span id={`${id}-aide`} role="alert" className="px-0.5 text-ui-2xs leading-[1.45] text-texte-erreur">
          {erreur}
        </span>
      ) : (
        aide && (
          <span id={`${id}-aide`} className="px-0.5 text-ui-2xs leading-[1.45] text-texte-tertiaire">
            {aide}
          </span>
        )
      )}
    </div>
  );
}
